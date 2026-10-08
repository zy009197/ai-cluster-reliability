function createMonthlyTrainingEngine() {
  const version='4.0-domain-ledger';
  const weights=[.172,.301,.084,.443],initialFit=1e9/300000/.976;
  const defaults={fits:weights.map(w=>initialFit*w),slowPct:2,silentPct:.4,
    hardDetect:95,slowDetect:95,silentDetect:0,hardSeconds:10,fallbackMinutes:1,
    slowMinutes:5,silentHours:1/3600,mode:'global',globalMinutes:120,localMinutes:120,
    silentMinutes:1/60,stepSeconds:1,silentFallbackHours:120,fallbackDistribution:'fixed',
    intervalSeconds:7200,saveSeconds:10,slowHours:24,slowLoss:5,retentionHours:null,replayRate:1,
    cardsPerServer:8,serversPerRack:32,recoveryDomains:50,placement:'compact',
    networkScope:'card',otherScope:'card',serverFIT:0,rackFIT:0,sharedFIT:0,
    repairSlots:0,minActiveFraction:0,reconfigureSeconds:0,
    silentLocatePct:100,cleanVerifyPct:100,silentRecoveryPct:100,silentMonitorPct:0};
  const scales=[1000,5000,10000,25000,50000,75000,100000,150000,200000,250000,300000,400000,500000];
  const topologyCache=new Map();
  function validate(p,n=1000){
    if(!Number.isInteger(n)||n<1)throw new Error('卡数必须为正整数');
    if(!Array.isArray(p.fits)||p.fits.length!==4||p.fits.some(v=>!Number.isFinite(v)||v<0))throw new Error('四类单卡等效 FIT 必须为非负数');
    for(const k of ['cardsPerServer','serversPerRack','recoveryDomains'])if(!Number.isInteger(p[k])||p[k]<1)throw new Error(k+' 必须为正整数');
    if(!Number.isInteger(p.repairSlots)||p.repairSlots<0)throw new Error('恢复并发数必须为非负整数，0 表示不限制');
    for(const k of ['hardDetect','slowDetect','silentDetect','slowLoss','silentLocatePct','cleanVerifyPct','silentRecoveryPct','silentMonitorPct'])if(!Number.isFinite(p[k])||p[k]<0||p[k]>100)throw new Error(k+' 必须在 0–100 之间');
    if(!Number.isFinite(p.slowPct)||!Number.isFinite(p.silentPct)||p.slowPct<0||p.silentPct<0||p.slowPct+p.silentPct>100)throw new Error('三类故障占比无效');
    if(!Number.isFinite(p.intervalSeconds)||!Number.isFinite(p.stepSeconds)||p.intervalSeconds<=0||p.stepSeconds<=0)throw new Error('周期和 step 时长必须大于 0');
    for(const k of ['hardSeconds','fallbackMinutes','slowMinutes','silentHours','globalMinutes','localMinutes','silentMinutes','silentFallbackHours','saveSeconds','slowHours','serverFIT','rackFIT','sharedFIT','reconfigureSeconds'])if(!Number.isFinite(p[k])||p[k]<0)throw new Error(k+' 必须为非负有限数');
    if(!Number.isFinite(p.minActiveFraction)||!Number.isFinite(p.replayRate)||p.minActiveFraction<0||p.minActiveFraction>1||p.replayRate<0||p.replayRate>1)throw new Error('容量阈值和重放速率须在 0–1 之间');
    if(!['global','local'].includes(p.mode)||!['compact','striped'].includes(p.placement)||!['fixed','exponential'].includes(p.fallbackDistribution))throw new Error('不支持的运行策略');
    for(const k of ['networkScope','otherScope'])if(!['card','server','rack','job'].includes(p[k]))throw new Error('不支持的故障影响范围');
    return p;
  }
  function topology(n,p){
    const key=[n,p.cardsPerServer,p.serversPerRack,p.recoveryDomains,p.placement].join('|');
    if(topologyCache.has(key))return topologyCache.get(key);
    const domains=Math.min(n,p.recoveryDomains),sizes=Array.from({length:domains},(_,d)=>p.placement==='striped'?Math.floor((n-1-d)/domains)+1:Math.ceil((d+1)*n/domains)-Math.ceil(d*n/domains));
    const cardDomain=c=>p.placement==='striped'?c%domains:Math.min(domains-1,Math.floor(c*domains/n));
    function impacted(scope,card){
      if(scope==='job')return Array.from({length:domains},(_,i)=>i);
      const width=scope==='rack'?p.cardsPerServer*p.serversPerRack:scope==='server'?p.cardsPerServer:1;
      const start=Math.floor(card/width)*width,end=Math.min(n,start+width);
      if(p.placement==='striped'){if(end-start>=domains)return Array.from({length:domains},(_,i)=>i);return Array.from({length:end-start},(_,i)=>(start+i)%domains).sort((a,b)=>a-b);}
      const lo=cardDomain(start),hi=cardDomain(end-1);return Array.from({length:hi-lo+1},(_,i)=>lo+i);
    }
    const out={n,servers:Math.ceil(n/p.cardsPerServer),racks:Math.ceil(n/(p.cardsPerServer*p.serversPerRack)),domains,sizes,cardDomain,impacted};
    topologyCache.set(key,out);return out;
  }
  function summary(p,n){
    const top=topology(n,p),fit=p.fits.reduce((a,b)=>a+b,0),ph=1-(p.slowPct+p.silentPct)/100;
    const componentRate=n*fit/1e9,backgroundRate=(top.servers*p.serverFIT+top.racks*p.rackFIT+p.sharedFIT)/1e9;
    return {fit,componentRate,backgroundRate,mtbf:componentRate+backgroundRate?1/(componentRate+backgroundRate):Infinity,
      hardMtbf:componentRate*ph+backgroundRate?1/(componentRate*ph+backgroundRate):Infinity,
      auto:componentRate+backgroundRate?((componentRate*ph+backgroundRate)*p.hardDetect/100+componentRate*(p.slowPct*p.slowDetect+p.silentPct*p.silentDetect)/10000)/(componentRate+backgroundRate):0,
      eventual:ph+p.slowPct*p.slowDetect/10000+p.silentPct/100,servers:top.servers,racks:top.racks,domains:top.domains};
  }
  function random(seed) {
    let x = seed >>> 0;
    return () => { x = (Math.imul(x,1664525)+1013904223)>>>0; return (x+.5)/4294967296; };
  }
  function cycleTraining(x,tau,save) {
    const L=tau+save, cycles=Math.floor(x/L);
    return cycles*tau+Math.min(x-cycles*L,tau);
  }
  // Arithmetic checkpoint batching: independent of checkpoint frequency.
  function advance(phase,dt,tau,save) {
    const L=tau+save, end=phase+dt, count=Math.floor(end/L+1e-11);
    let next=end-count*L;
    if(next<0 && next>-1e-9)next=0;
    const work=Math.max(0,cycleTraining(end,tau,save)-cycleTraining(phase,tau,save));
    return {work, phase:Math.max(0,next), commits:count,
      commitElapsed:count?count*L-phase:0,
      commitWork:count?count*tau-Math.min(phase,tau):0};
  }
  function timeForWork(phase,work,tau,save) {
    if(work<=1e-12)return 0;
    let elapsed=0;
    if(phase>=tau){elapsed=tau+save-phase;phase=0;}
    const available=tau-phase;
    if(work<=available)return elapsed+work;
    work-=available;elapsed+=available+save;
    const full=Math.max(0,Math.ceil(work/tau)-1);
    return elapsed+full*(tau+save)+(work-full*tau);
  }
  class Queue {
    constructor(){this.items=[];this.serial=0;}
    add(event){event.serial=this.serial++;const a=this.items;a.push(event);let i=a.length-1;while(i){const j=(i-1)>>1;if(!this.before(a[i],a[j]))break;[a[i],a[j]]=[a[j],a[i]];i=j;}}
    before(a,b){return a.at<b.at || (a.at===b.at && a.serial<b.serial);}
    peek(){return this.items[0];}
    pop(){const a=this.items, first=a[0],end=a.pop();if(a.length){a[0]=end;let i=0;while(true){let j=2*i+1;if(j>=a.length)break;if(j+1<a.length&&this.before(a[j+1],a[j]))j++;if(!this.before(a[j],a[i]))break;[a[i],a[j]]=[a[j],a[i]];i=j;}}return first;}
  }
  function simulate(n,p,seed=1,options={}){
    const T=options.hours??720,rng=random(seed),queue=new Queue(),top=topology(n,p);
    const m=p.mode==='local'?top.domains:1,sizes=p.mode==='local'?top.sizes:[n];
    const up=new Array(m).fill(true),downUntil=new Array(m).fill(0),slots=[],repairDemands=new Array(m).fill(0);
    let globalRepairDemands=0;
    const tau=p.intervalSeconds/3600,save=p.saveSeconds/3600,fit=p.fits.reduce((a,b)=>a+b,0),lambda=n*fit/1e9;
    const background=[top.servers*p.serverFIT/1e9,top.racks*p.rackFIT/1e9,p.sharedFIT/1e9],bg=background.reduce((a,b)=>a+b,0);
    const ph=1-(p.slowPct+p.silentPct)/100,ps=p.slowPct/100,slows=new Map();
    let t=0,progress=0,correct=0,phase=0,uptime=0,capacityHours=0,activeCards=n;
    let cp={position:0,at:0,clean:true},cleanCp={...cp},epoch=null,epochSerial=0;
    let paused=false,pauseUntil=Infinity,repairingSilent=false,silentAttemptSuccess=false,replayUntil=0;
    let slowSerial=0,slowFactor=1,events=0;
    const ledger={pause:0,checkpointSave:0,unavailableCapacity:0,slowdown:0,monitoring:0,replaySlowdown:0,grossWork:0,rollback:0};
    const stats={hard:0,slow:0,silent:0,silentDetected:0,silentImmediate:0,silentFallback:0,silentRestarts:0,
      silentRollbackHours:0,silentRollbackWork:0,hardRollbackWork:0,slowRepairs:0,recoveryFailures:0,unsafeCandidateFallbacks:0,
      repairQueueHours:0,repairTasks:0,commonFailures:0,affectedDomainSum:0};
    const trace=options.trace?[]:null;
    const record=(kind,detail={})=>{if(trace)trace.push({t,kind,progress,correct,activeCards,corrupt:!!epoch,durableCheckpoint:cp.position,...detail});};
    const fraction=()=>activeCards/n;
    const operational=()=>!paused&&globalRepairDemands===0&&activeCards>0&&fraction()+1e-12>=p.minActiveFraction;
    function recalcSlow(){slowFactor=1;for(const s of slows.values())if(up[s.domain])slowFactor*=1-p.slowLoss/100;}
    function chooseCard(){if(activeCards===0)return 0;let c;do{c=Math.min(n-1,Math.floor(rng()*n));}while(p.mode==='local'&&!up[top.cardDomain(c)]);return c;}
    function rollback(position){if(position>progress+1e-8)throw new Error('恢复点不能超出当前进度');const loss=Math.max(0,progress-position);ledger.rollback+=loss;progress=position;correct=epoch?Math.min(correct,progress):progress;phase=0;return loss;}
    function pause(duration){paused=true;pauseUntil=Math.max(Number.isFinite(pauseUntil)?pauseUntil:t,t+duration);}
    function reserveRepair(detection,repair){
      const discovered=t+detection;let started=discovered;
      if(p.repairSlots>0){if(slots.length<p.repairSlots)slots.push(0);let i=0;for(let j=1;j<slots.length;j++)if(slots[j]<slots[i])i=j;started=Math.max(discovered,slots[i]);slots[i]=started+repair;}
      stats.repairQueueHours+=started-discovered;stats.repairTasks++;
      return {discovered,started,ended:started+repair};
    }
    function ordinaryGlobalPause(duration,reason){
      if(epoch)epoch.stepValid=false;
      const lost=rollback(cp.position);if(reason==='hard')stats.hardRollbackWork+=lost;
      pause(duration);
    }
    function repairAffected(domains,detection,repair,reason,detail={}){
      if(p.repairSlots>0){
        if(p.mode==='global'){
          globalRepairDemands++;if(epoch)epoch.stepValid=false;
          const lost=rollback(cp.position);if(reason==='hard')stats.hardRollbackWork+=lost;
        }else{
          for(const d of domains){repairDemands[d]++;if(up[d]){up[d]=false;activeCards-=sizes[d];}}
          if(epoch&&domains.includes(epoch.domain))epoch.stepValid=false;
          if(p.reconfigureSeconds>0)pause(p.reconfigureSeconds/3600);recalcSlow();
        }
        queue.add({at:t+detection,type:'repair-discovered',domains,repair,reason});
        record(reason,{...detail,affectedDomains:domains.length,discoveredAt:t+detection,repairStartedAt:null});return;
      }
      const plan=reserveRepair(detection,repair);
      if(p.mode==='global')ordinaryGlobalPause(plan.ended-t,reason);
      else{
        for(const d of domains){if(up[d]){up[d]=false;activeCards-=sizes[d];}downUntil[d]=Math.max(downUntil[d],plan.ended);queue.add({at:downUntil[d],type:'up',domain:d});}
        if(epoch&&domains.includes(epoch.domain))epoch.stepValid=false;
        if(p.reconfigureSeconds>0)pause(p.reconfigureSeconds/3600);
        recalcSlow();
      }
      record(reason,{...detail,affectedDomains:domains.length,discoveredAt:plan.discovered,repairStartedAt:plan.started,recoveredAt:plan.ended});
    }
    function triggerHard(forcedDelay,scope='card',card,source='card-equivalent'){
      stats.hard++;const detection=forcedDelay??(rng()<p.hardDetect/100?p.hardSeconds/3600:p.fallbackMinutes/60);
      const c=card??chooseCard(),physical=top.impacted(scope,c),domains=p.mode==='local'?physical:[0];
      stats.affectedDomainSum+=physical.length;
      repairAffected(domains,detection,(p.mode==='global'?p.globalMinutes:p.localMinutes)/60,'hard',{source,scope,card:c,physicalDomains:physical.length});
    }
    function triggerSlow(){
      stats.slow++;const id=++slowSerial,card=chooseCard(),domain=p.mode==='local'?top.cardDomain(card):0;
      slows.set(id,{domain});recalcSlow();queue.add({at:t+p.slowHours,type:'slow-expire',id});
      if(rng()<p.slowDetect/100)queue.add({at:t+p.slowMinutes/60,type:'slow-detect',id});record('slow',{domain});
    }
    function triggerSilent(forcedDelay,forcedChannel){
      stats.silent++;
      if(!epoch){
        const immediate=forcedChannel?forcedChannel==='immediate':rng()<p.silentDetect/100;
        const stepWork=p.stepSeconds/3600,stepPosition=Math.min(progress,Math.floor(progress/stepWork+1e-9)*stepWork);
        const speed=fraction()*slowFactor*(p.silentDetect>0?1-p.silentMonitorPct/100:1);
        const age=speed>0?(progress-stepPosition)/speed:0,card=chooseCard();
        epoch={id:++epochSerial,onset:t,clean:{...cleanCp},step:{position:stepPosition,at:Math.max(0,t-age),clean:true},
          stepValid:true,domain:p.mode==='local'?top.cardDomain(card):0,channel:immediate?'immediate':'fallback',repairing:false};
        correct=progress;
        const fallback=p.fallbackDistribution==='exponential'?-Math.log(rng())*p.silentFallbackHours:p.silentFallbackHours;
        queue.add({at:t+(forcedDelay??(immediate?p.silentHours:fallback)),type:'silent-detect',id:epoch.id});
      }
      record('silent');
    }
    const succeeds=pct=>pct===100?true:pct===0?false:rng()<pct/100;
    function silentDetection(id){
      if(!epoch||epoch.id!==id||epoch.repairing)return;epoch.repairing=true;
      stats.silentDetected++;if(epoch.channel==='immediate')stats.silentImmediate++;else stats.silentFallback++;
      const located=succeeds(p.silentLocatePct),verified=located&&succeeds(p.cleanVerifyPct);
      // The policy receives a candidate only if localization and verification succeed.
      const useStep=verified&&epoch.channel==='immediate'&&epoch.stepValid&&epoch.step.position>=epoch.clean.position;
      const candidate=verified?(useStep?epoch.step:epoch.clean):{position:0,at:0,clean:true};
      if(!verified){stats.unsafeCandidateFallbacks++;stats.silentRestarts++;}
      stats.silentRollbackHours+=t-candidate.at;
      const previous=progress;replayUntil=Math.max(replayUntil,previous);
      const lost=rollback(candidate.position);stats.silentRollbackWork+=lost;correct=progress;
      // A volatile step snapshot is never promoted to a durable checkpoint.
      cp=verified?{...epoch.clean}:{position:0,at:0,clean:true};cleanCp={...cp};epoch.clean={...cp};
      silentAttemptSuccess=succeeds(p.silentRecoveryPct);repairingSilent=true;pause(p.silentMinutes/60);
      record('silent-detected-rollback',{channel:epoch.channel,candidateKind:useStep?'volatile-step':'durable',located,verified,recoverySuccess:silentAttemptSuccess});
    }
    for(const e of options.events||[])queue.add({...e,type:'forced'});
    while(t<T-1e-10){
      if(++events>300000)throw new Error('事件数超过上限；请检查故障率或恢复重试设置');
      const running=operational(),frac=fraction(),hazard=(options.disableRandom?0:(running?lambda*frac:0)+bg);
      const faultAt=hazard?t-Math.log(rng())/hazard:Infinity,pending=queue.peek()?.at??Infinity;
      const replay=progress<replayUntil-1e-10&&!epoch,monitor=p.silentDetect>0?1-p.silentMonitorPct/100:1;
      const replayFactor=replay?p.replayRate:1,speed=frac*slowFactor*monitor*replayFactor;
      const replayAt=running&&replay&&speed>0?t+timeForWork(phase,(replayUntil-progress)/speed,tau,save):Infinity;
      const next=Math.min(T,faultAt,pending,paused?pauseUntil:Infinity,replayAt),dt=Math.max(0,next-t);
      if(next<t-1e-8)throw new Error('事件时间顺序错误');
      if(running){
        const step=advance(phase,dt,tau,save),old=progress,increment=step.work*speed;
        ledger.checkpointSave+=dt-step.work;ledger.unavailableCapacity+=step.work*(1-frac);
        ledger.slowdown+=step.work*frac*(1-slowFactor);ledger.monitoring+=step.work*frac*slowFactor*(1-monitor);
        ledger.replaySlowdown+=step.work*frac*slowFactor*monitor*(1-replayFactor);ledger.grossWork+=increment;
        progress+=increment;if(!epoch)correct=progress;
        if(step.commits){cp={position:old+step.commitWork*speed,at:t+step.commitElapsed,clean:!epoch};if(cp.clean)cleanCp={...cp};}
        phase=step.phase;uptime+=dt;capacityHours+=dt*frac;
      }else ledger.pause+=dt;
      t=next;if(t>=T-1e-10)break;
      if(paused&&t>=pauseUntil-1e-10){
        paused=false;pauseUntil=Infinity;
        if(repairingSilent){
          repairingSilent=false;
          if(silentAttemptSuccess){epoch=null;correct=progress;}
          else{stats.recoveryFailures++;epoch.repairing=false;epoch.stepValid=false;queue.add({at:t+Math.max(1/3600,p.silentFallbackHours),type:'silent-detect',id:epoch.id});}
        }
        record('resume');continue;
      }
      if(pending<=t+1e-10){
        const e=queue.pop();
        if(e.type==='repair-discovered'){
          const plan=reserveRepair(0,e.repair);queue.add({at:plan.ended,type:'repair-complete',domains:e.domains});
          record('repair-scheduled',{affectedDomains:e.domains.length,discoveredAt:plan.discovered,repairStartedAt:plan.started,recoveredAt:plan.ended});
        }else if(e.type==='repair-complete'){
          if(p.mode==='global'){globalRepairDemands--;if(globalRepairDemands===0)record('resume');}
          else{for(const d of e.domains){repairDemands[d]--;if(repairDemands[d]===0&&!up[d]){up[d]=true;activeCards+=sizes[d];record('domain-up',{domain:d});}}recalcSlow();}
        }else if(e.type==='up'){if(downUntil[e.domain]<=t+1e-10&&!up[e.domain]){up[e.domain]=true;activeCards+=sizes[e.domain];recalcSlow();record('domain-up',{domain:e.domain});}}
        else if(e.type==='slow-expire'){slows.delete(e.id);recalcSlow();}
        else if(e.type==='slow-detect'){const s=slows.get(e.id);if(s){slows.delete(e.id);recalcSlow();stats.slowRepairs++;repairAffected([s.domain],0,(p.mode==='global'?p.globalMinutes:p.localMinutes)/60,'slow-repair');}}
        else if(e.type==='silent-detect')silentDetection(e.id);
        else if(e.type==='forced'){
          if(e.kind==='silent')triggerSilent(e.detectAfter,e.channel);
          if(e.kind==='hard')triggerHard(e.detectAfter,e.scope??'card',e.card??0,'scripted');
          if(e.kind==='slow')triggerSlow();
        }
        continue;
      }
      if(replayAt<=t+1e-10){replayUntil=0;continue;}
      const componentHazard=running?lambda*frac:0;
      if(rng()*hazard>=componentHazard){
        stats.commonFailures++;let x=rng()*bg,index=0;while(index<2&&x>=background[index]){x-=background[index++];}
        const scope=['server','rack','job'][index],width=index===0?p.cardsPerServer:p.cardsPerServer*p.serversPerRack;
        const card=index===2?0:Math.floor(rng()*(index===0?top.servers:top.racks))*width;
        triggerHard(undefined,scope,card,'background-'+scope);
      }else{
        let x=rng()*fit,source=0;while(source<3&&x>=p.fits[source]){x-=p.fits[source++];}
        const type=rng();
        if(type<ph)triggerHard(undefined,source===2?p.networkScope:source===3?p.otherScope:'card',undefined,['HBM','GPU','network','other'][source]);
        else if(type<ph+ps)triggerSlow();else triggerSilent();
      }
    }
    record('end');
    const delivered=epoch?0:correct;
    ledger.unrecoveredCorruptWork=Math.max(0,progress-correct);ledger.terminalDiscard=epoch?correct:0;ledger.delivered=delivered;
    const sum=ledger.pause+ledger.checkpointSave+ledger.unavailableCapacity+ledger.slowdown+ledger.monitoring+ledger.replaySlowdown+ledger.rollback+ledger.unrecoveredCorruptWork+ledger.terminalDiscard+ledger.delivered;
    ledger.residual=T-sum;
    if(Math.abs(ledger.residual)>1e-6)throw new Error('训练时间账本不守恒：'+ledger.residual);
    return {effective:Math.max(0,correct/T),uptime:uptime/T,capacity:capacityHours/T,delivery:delivered/T,cleanEnd:epoch?0:1,
      progress,correct,saveHours:ledger.checkpointSave,ledger,stats,trace};
  }
  function estimate(n,p,trials,seed=9137,hours=720){
    validate(p,n);if(!Number.isInteger(trials)||trials<2)throw new Error('轨迹数必须为至少 2 的整数');
    const keys=['delivery','effective','uptime','capacity','cleanEnd'],values=Object.fromEntries(keys.map(k=>[k,[]]));let stats=null,ledger=null;
    for(let i=0;i<trials;i++){const r=simulate(n,p,(seed+Math.imul(i+1,2654435761)+n)>>>0,{hours});for(const k of keys)values[k].push(r[k]);if(!stats){stats=Object.fromEntries(Object.keys(r.stats).map(k=>[k,0]));ledger=Object.fromEntries(Object.keys(r.ledger).map(k=>[k,0]));}for(const k in stats)stats[k]+=r.stats[k]/trials;for(const k in ledger)ledger[k]+=r.ledger[k]/trials;}
    const out={n,trials,stats,ledger};
    for(const k of keys){const a=values[k],mean=a.reduce((s,v)=>s+v,0)/trials,se=Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/(trials-1)/trials);a.sort((a,b)=>a-b);out[k]={mean,se,low:Math.max(0,mean-1.96*se),high:Math.min(1,mean+1.96*se),p05:a[Math.floor((trials-1)*.05)],p50:a[Math.floor((trials-1)*.5)],p95:a[Math.floor((trials-1)*.95)]};}
    return out;
  }
  return {version,defaults,weights,scales,validate,topology,summary,advance,timeForWork,simulate,estimate};
}
if(typeof module!=='undefined')module.exports=createMonthlyTrainingEngine;
