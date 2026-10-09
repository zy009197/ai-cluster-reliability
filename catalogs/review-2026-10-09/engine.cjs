// 逐事件审计引擎：保留已确认基线，按机制覆盖与回退链改变事件后果。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const previous=require('./reference.cjs');
const {current,legacy}=require('./inputs.json');
const events=current.events.map(e=>{const old=legacy.events.find(o=>o.id===e.id);return {...e,type:old.type,scope:old.scope,persistence:old.persistence,replay:old.replay,process:old.process,elastic:old.elastic};});
const config={...previous.config},P=require('./mechanism-policy.json');
function parameters(opts={}){return {...config,...(opts.fast?{checkpointComputeSeconds:P['C-FAST'].computeSeconds,checkpointSaveSeconds:P['C-FAST'].saveSeconds}:{}),...(opts.hardDetect?{detectProbability:P['D-HARD'].coverage,detectSeconds:P['D-HARD'].detectSeconds}:{}),...(opts.slowDetect?{slowDetectProbability:P['D-SLOW'].coverage,slowDetectHours:P['D-SLOW'].detectSeconds/3600}:{})};}
const eventGroups=Object.fromEntries(['hard','slow','sdc'].map(t=>[t,events.filter(e=>e.type===t)]));
const typeTotals=Object.fromEntries(Object.entries(eventGroups).map(([t,es])=>[t,es.reduce((s,e)=>s+e.fit,0)]));
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return(x+.5)/4294967296;};}
function simulate(cards,stage,seed,p=config,opts={}){
  const random=rng(seed),tech=rng(seed^0xa5a5bEEF),T=p.horizonHours,tau=p.checkpointComputeSeconds/3600,save=p.checkpointSaveSeconds/3600,L=tau+save;
  const hard=cards/p.referenceCards/p.referenceMtbfHours;
  const rates=[hard,stage>=1?hard*p.shares.slow/p.shares.hard:0,stage>=2?hard*p.shares.sdc/p.shares.hard:0],rate=rates.reduce((a,b)=>a+b,0);
  const arrival=()=>rate?-Math.log(random())/rate:Infinity;
  let remaining=arrival(),t=0,progress=0,cp=0,cleanCp=0,cpDirty=false,phase=0,dirty=null,downUntil=0;
  const slows=[],locals=[];
  const perEvent={};
  function item(id){return perEvent[id]??=(Object.fromEntries(['events','recoveries','downtime','rollback','slowdown','localLoss','terminalInvalid'].map(k=>[k,0])));}
  let currentId=null;
  const schedule=eventGroups;
  function pick(type,u){const es=schedule[type],sum=typeTotals[type];let v=u*sum;for(const e of es){v-=e.fit;if(v<0)return e;}return es.at(-1);}
  function snapshot(){cp=progress;cpDirty=!!dirty;if(!dirty)cleanCp=cp;phase=0;}
  function globalPause(cause,seconds){const until=t+seconds/3600,added=Math.max(0,Math.min(T,until)-Math.min(T,Math.max(t,downUntil)));byCause[cause].downtime+=added;item(currentId).downtime+=added;downUntil=Math.max(downUntil,until);}

  const ledger={downtime:0,save:0,slowdown:0,rollback:0,terminalInvalid:0,localLoss:0};
  const counts={hard:0,slow:0,sdc:0,manual:0,sdcRecoveries:0};
  const byCause=Object.fromEntries(['hard','slow','sdc'].map(k=>[k,{events:0,recoveries:0,downtime:0,rollback:0,slowdown:0,terminalInvalid:0,localLoss:0}]));
  const recovery=()=>{const manual=random()>=p.recoverySuccess;if(manual)counts.manual++;return(p.recoveryAttemptSeconds+(manual?p.manualAdditionalSeconds:0))/3600;};
  function pause(cause,delay=0,seconds=null){
    byCause[cause].recoveries++;item(currentId).recoveries++;
    const manualBefore=counts.manual,fallback=recovery()*3600;
    if(seconds!==null)counts.manual=manualBefore;
    globalPause(cause,delay*3600+(seconds===null?fallback:seconds));
  }

  function rollback(to,cause){const loss=Math.max(0,progress-to);ledger.rollback+=loss;byCause[cause].rollback+=loss;item(currentId).rollback+=loss;progress=to;phase=0;}
  function ordinaryRecovery(delay=0,event=null){
    if(event){
      let failed=0;
      if(opts.replay&&event.replay){
        if(tech()<P['R-REPLAY'].success){pause('hard',delay,P['R-REPLAY'].successSeconds);return;}
        failed+=P['R-REPLAY'].failureSeconds;
      }
      if(opts.elastic&&event.elastic){
        if(tech()<P['R-ELASTIC'].success){
          // 容量等效近似：域间可继续训练，状态冗余保证无全局回滚。
          // 故障域不可用180秒，短全局协调暂停另计；同域重叠合并。
          byCause.hard.recoveries++;item(currentId).recoveries++;
          const domain=Math.floor(tech()*P['R-ELASTIC'].domains),until=t+delay+(failed+P['R-ELASTIC'].recoverSeconds)/3600;
          const active=locals.find(x=>x.domain===domain);
          if(active){if(until>active.until)active.until=until;}else locals.push({domain,until,id:currentId});
          globalPause('hard',failed+(opts.elasticSyncSeconds??P['R-ELASTIC'].syncSeconds));return;
        }
        failed+=P['R-ELASTIC'].failureSeconds;
      }
      if(opts.process&&event.process){
        if(tech()<P['R-PROCESS'].success){rollback(cp,'hard');if(!cpDirty)dirty=null;pause('hard',delay,failed+P['R-PROCESS'].successSeconds);return;}
        failed+=P['R-PROCESS'].failureSeconds;
      }
      delay+=failed/3600;
    }

    rollback(cp,'hard');
    // 首个污染检查点尚未写入时，全局回滚可顺带清除污染。
    if(!cpDirty)dirty=null;
    pause('hard',delay);
  }
  function slowRecovery(){
    // 亚健康状态仍可保存：本次恢复保留当前进度，现场快照/加载包含在恢复时间内。
    // 带静默污染的状态仍然带错，不能更新最后干净检查点。
    snapshot();
    pause('slow');
  }
  function advance(dt){
    if(t<downUntil-1e-9){ledger.downtime+=dt;return;}
    const end=phase+dt,commits=Math.floor((end+1e-10)/L);
    const train=x=>Math.floor(x/L)*tau+Math.min(x%L,tau);
    const compute=Math.max(0,train(end)-train(phase)),slowFactor=Math.pow(1-p.slowLoss,slows.length),localFactor=1-locals.length/P['R-ELASTIC'].domains,factor=slowFactor*localFactor;
    if(commits){cp=progress+(commits*tau-Math.min(phase,tau))*factor;cpDirty=!!dirty;if(!dirty)cleanCp=cp;}
    progress+=compute*factor;
    ledger.save+=Math.max(0,dt-compute);
    const slowLoss=compute*(1-slowFactor),localLoss=compute*slowFactor*(1-localFactor);
    ledger.slowdown+=slowLoss;ledger.localLoss+=localLoss;byCause.hard.localLoss+=localLoss;
    for(const s of slows)item(s.id).slowdown+=slowLoss/slows.length;
    for(const l of locals)item(l.id).localLoss+=localLoss/locals.length;
    phase=Math.max(0,end-commits*L);
    remaining=Math.max(0,remaining-dt);
  }
  while(t<T-1e-9){
    const up=t>=downUntil-1e-9;
    const nextFault=up?t+remaining:Infinity;
    let next=Math.min(T,nextFault,up?Infinity:downUntil,dirty?dirty.discover:Infinity);
    for(const s of slows)next=Math.min(next,s.until);
    for(const l of locals)next=Math.min(next,l.until);
    advance(Math.max(0,next-t));t=next;
    if(t>=T-1e-9)break;
    // 发现时间按墙钟计算，恢复请求若重叠则合并停机区间。
    if(dirty&&dirty.discover<=t+1e-9){
      currentId=dirty.id;rollback(cleanCp,'sdc');cp=cleanCp;cpDirty=false;dirty=null;counts.sdcRecoveries++;
      pause('sdc');
    }
    for(let i=locals.length-1;i>=0;i--)if(locals[i].until<=t+1e-9)locals.splice(i,1);
    let detectedSlow=false;
    for(let i=slows.length-1;i>=0;i--)if(slows[i].until<=t+1e-9){if(slows[i].detected){detectedSlow=true;currentId=slows[i].id;}slows.splice(i,1);}
    if(detectedSlow)slowRecovery();
    if(nextFault<=t+1e-9){
      const r=random()*rate;
      if(r<rates[0]){const e=pick('hard',r/rates[0]);currentId=e.id;item(e.id).events++;counts.hard++;ordinaryRecovery((random()<p.detectProbability?p.detectSeconds:p.timeoutSeconds)/3600,e);}
      else if(r<rates[0]+rates[1]){const e=pick('slow',(r-rates[0])/rates[1]);currentId=e.id;item(e.id).events++;counts.slow++;const detected=random()<p.slowDetectProbability;slows.push({id:e.id,detected,until:t+(detected?p.slowDetectHours:p.slowLifetimeHours)});}
      else{
        const e=pick('sdc',(r-rates[0]-rates[1])/rates[2]);currentId=e.id;item(e.id).events++;counts.sdc++;
        if(opts.sdcDetect&&tech()<(opts.sdcCoverage??P['D-SDC'].coverage)){
          if(!dirty){
            const target=opts.step?Math.max(cp,progress-(opts.stepSeconds??P['R-SDC'].stepSeconds)/3600):cp;
            const oldPhase=phase;
            rollback(target,'sdc');
            if(opts.step)phase=oldPhase;
            // 易失step恢复不冒充新持久化检查点，也不推进最后干净CKPT。
          }
          // 已存在的漏检污染不能被新事件的即时检测错误地洗白。
          pause('sdc',P['D-SDC'].detectSeconds/3600,opts.step?P['R-SDC'].recoverSeconds:null);
        }else if(!dirty)dirty={discover:t+p.sdcDelayHours,id:e.id};
      }
      remaining=arrival();
    }
  }
  const correct=dirty?cleanCp:progress;
  ledger.terminalInvalid=progress-correct;if(dirty)item(dirty.id).terminalInvalid+=ledger.terminalInvalid;
  for(const cause of ['hard','slow','sdc'])byCause[cause].events=counts[cause];
  byCause.slow.slowdown=ledger.slowdown;byCause.sdc.terminalInvalid=ledger.terminalInvalid;
  const accounted=correct+Object.values(ledger).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(accounted-T)<1e-6,`时间账不平: ${accounted-T}`);
  assert.ok(correct>=-1e-7&&correct<=T+1e-7);
  for(const key of ['downtime','rollback','slowdown','terminalInvalid','localLoss'])assert.ok(Math.abs(Object.values(byCause).reduce((s,c)=>s+c[key],0)-ledger[key])<1e-6,`类别账不平: ${key}`);
  for(const key of ['downtime','rollback','slowdown','terminalInvalid','localLoss'])assert.ok(Math.abs(Object.values(perEvent).reduce((s,c)=>s+c[key],0)-ledger[key])<1e-6,`事件账不平: ${key}`);
  return {operationalAvailability:1-ledger.downtime/T,usefulThroughput:correct/T,correctHours:correct,
    ledger,counts,byCause,perEvent,unresolvedSilent:!!dirty};
}

module.exports={simulate,parameters,config,events,previous,typeTotals};
