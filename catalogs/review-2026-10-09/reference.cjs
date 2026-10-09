const assert=require('node:assert/strict');
const config={"scope": "hard-interruptions-only", "referenceCards": 10000, "referenceMtbfHours": 30, "checkpointComputeSeconds": 300, "checkpointSaveSeconds": 4, "recoveryAttemptSeconds": 180, "recoverySuccess": 0.99, "manualAdditionalSeconds": 7200, "detectProbability": 0.95, "detectSeconds": 10, "timeoutSeconds": 60, "eventCatalog": {"path": "catalogs/故障事件库.json", "revision": "event-budget-v3-sdc1.4-reviewed-85", "events": 54, "classFit": {"中断": 3333.333333333333, "亚健康": 69.01311249137338, "静默": 48.30917874396136}, "sha256": "6b0f6c209a8edb116f870d5e57022aaa0758a025d3c4561a875ac6e150e1d5dc"}, "horizonHours": 720, "shares": {"hard": 0.9660000000000001, "slow": 0.020000000000000007, "sdc": 0.014000000000000005}, "slowDetectProbability": 0.95, "slowDetectHours": 0.08333333333333333, "slowLifetimeHours": 24, "slowLoss": 0.05, "sdcImmediateProbability": 0, "sdcDelayHours": 120, "sdcDelayDistribution": "fixed", "terminalRule": "retain-last-clean-checkpoint-if-corrupt", "trials": 20000, "seed": 20261009};
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return(x+.5)/4294967296;};}
function simulate(cards,stage,seed,p=config){
  const random=rng(seed),T=p.horizonHours,tau=p.checkpointComputeSeconds/3600,save=p.checkpointSaveSeconds/3600,L=tau+save;
  const hard=cards/p.referenceCards/p.referenceMtbfHours;
  const rates=[hard,stage>=1?hard*p.shares.slow/p.shares.hard:0,stage>=2?hard*p.shares.sdc/p.shares.hard:0],rate=rates.reduce((a,b)=>a+b,0);
  const arrival=()=>rate?-Math.log(random())/rate:Infinity;
  let remaining=arrival(),t=0,progress=0,cp=0,cleanCp=0,cpDirty=false,phase=0,dirty=null,downUntil=0;
  const slows=[];
  const ledger={downtime:0,save:0,slowdown:0,rollback:0,terminalInvalid:0};
  const counts={hard:0,slow:0,sdc:0,manual:0,sdcRecoveries:0};
  const byCause=Object.fromEntries(['hard','slow','sdc'].map(k=>[k,{events:0,recoveries:0,downtime:0,rollback:0,slowdown:0,terminalInvalid:0}]));
  const recovery=()=>{const manual=random()>=p.recoverySuccess;if(manual)counts.manual++;return(p.recoveryAttemptSeconds+(manual?p.manualAdditionalSeconds:0))/3600;};
  function pause(cause,delay=0){
    byCause[cause].recoveries++;
    const until=t+delay+recovery();
    // 重叠停机只把新增区间归给本次请求，并裁剪到任务终点。
    byCause[cause].downtime+=Math.max(0,Math.min(T,until)-Math.min(T,Math.max(t,downUntil)));
    downUntil=Math.max(downUntil,until);
  }
  function rollback(to,cause){const loss=Math.max(0,progress-to);ledger.rollback+=loss;byCause[cause].rollback+=loss;progress=to;phase=0;}
  function ordinaryRecovery(delay=0){
    rollback(cp,'hard');
    // 首个污染检查点尚未写入时，全局回滚可顺带清除污染。
    if(!cpDirty)dirty=null;
    pause('hard',delay);
  }
  function slowRecovery(){
    // 亚健康状态仍可保存：本次恢复保留当前进度，现场快照/加载包含在恢复时间内。
    // 带静默污染的状态仍然带错，不能更新最后干净检查点。
    cp=progress;cpDirty=!!dirty;if(!dirty)cleanCp=cp;phase=0;
    pause('slow');
  }
  function advance(dt){
    if(t<downUntil-1e-9){ledger.downtime+=dt;return;}
    const end=phase+dt,commits=Math.floor((end+1e-10)/L);
    const train=x=>Math.floor(x/L)*tau+Math.min(x%L,tau);
    const compute=Math.max(0,train(end)-train(phase)),factor=Math.pow(1-p.slowLoss,slows.length);
    if(commits){cp=progress+(commits*tau-Math.min(phase,tau))*factor;cpDirty=!!dirty;if(!dirty)cleanCp=cp;}
    progress+=compute*factor;
    ledger.save+=Math.max(0,dt-compute);ledger.slowdown+=compute*(1-factor);
    phase=Math.max(0,end-commits*L);
    remaining=Math.max(0,remaining-dt);
  }
  while(t<T-1e-9){
    const up=t>=downUntil-1e-9;
    const nextFault=up?t+remaining:Infinity;
    let next=Math.min(T,nextFault,up?Infinity:downUntil,dirty?dirty.discover:Infinity);
    for(const s of slows)next=Math.min(next,s.until);
    advance(Math.max(0,next-t));t=next;
    if(t>=T-1e-9)break;
    // 发现时间按墙钟计算，恢复请求若重叠则合并停机区间。
    if(dirty&&dirty.discover<=t+1e-9){
      rollback(cleanCp,'sdc');cp=cleanCp;cpDirty=false;dirty=null;counts.sdcRecoveries++;
      pause('sdc');
    }
    let detectedSlow=false;
    for(let i=slows.length-1;i>=0;i--)if(slows[i].until<=t+1e-9){detectedSlow ||= slows[i].detected;slows.splice(i,1);}
    if(detectedSlow)slowRecovery();
    if(nextFault<=t+1e-9){
      const r=random()*rate;
      if(r<rates[0]){counts.hard++;ordinaryRecovery((random()<p.detectProbability?p.detectSeconds:p.timeoutSeconds)/3600);}
      else if(r<rates[0]+rates[1]){counts.slow++;const detected=random()<p.slowDetectProbability;slows.push({detected,until:t+(detected?p.slowDetectHours:p.slowLifetimeHours)});}
      else{counts.sdc++;if(!dirty)dirty={discover:t+p.sdcDelayHours};}
      remaining=arrival();
    }
  }
  const correct=dirty?cleanCp:progress;
  ledger.terminalInvalid=progress-correct;
  for(const cause of ['hard','slow','sdc'])byCause[cause].events=counts[cause];
  byCause.slow.slowdown=ledger.slowdown;byCause.sdc.terminalInvalid=ledger.terminalInvalid;
  const accounted=correct+Object.values(ledger).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(accounted-T)<1e-6,`时间账不平: ${accounted-T}`);
  assert.ok(correct>=-1e-7&&correct<=T+1e-7);
  for(const key of ['downtime','rollback','slowdown','terminalInvalid'])assert.ok(Math.abs(Object.values(byCause).reduce((s,c)=>s+c[key],0)-ledger[key])<1e-6,`类别账不平: ${key}`);
  return {operationalAvailability:1-ledger.downtime/T,usefulThroughput:correct/T,correctHours:correct,
    ledger,counts,byCause,unresolvedSilent:!!dirty};
}

module.exports={config,simulate};
