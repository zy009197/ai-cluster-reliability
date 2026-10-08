function createReliabilityEngine() {
  const weights = [.172, .301, .084, .443];
  const initialFit = 1e9 / 300000 / .976;
  const defaults = {
    fits: weights.map(w => initialFit * w),
    slowPct: 2, silentPct: .4, hardDetect: 95, slowDetect: 95, silentDetect: 0,
    hardSeconds: 10, fallbackMinutes: 30, slowMinutes: 5, silentHours: 24,
    mode: 'global', globalMinutes: 120, localMinutes: 120, silentMinutes: 120,
    intervalSeconds: 7200, saveSeconds: 10, slowHours: 24, slowLoss: 5,
    retentionHours: 72, replayRate: 1
  };
  const scales = [1000,5000,10000,25000,50000,75000,100000,150000,200000,250000,300000,400000,500000];
  function random(seed) {
    let x = seed >>> 0;
    return () => { x = (Math.imul(x,1664525)+1013904223)>>>0; return (x+.5)/4294967296; };
  }
  function summary(p,n) {
    const fit=p.fits.reduce((a,b)=>a+b,0), ph=1-(p.slowPct+p.silentPct)/100;
    return {fit, mtbf:fit?1e9/(n*fit):Infinity, hardMtbf:fit*ph?1e9/(n*fit*ph):Infinity,
      auto:ph*p.hardDetect/100+p.slowPct*p.slowDetect/10000+p.silentPct*p.silentDetect/10000,
      eventual:ph+p.slowPct*p.slowDetect/10000+p.silentPct*p.silentDetect/10000};
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
  function simulate(n,p,seed=1,options={}) {
    const T=options.hours ?? 720, rng=random(seed), queue=new Queue();
    const tau=p.intervalSeconds/3600, save=p.saveSeconds/3600, m=p.mode==='local'?50:1;
    const lambda=n*p.fits.reduce((a,b)=>a+b,0)/1e9;
    const ph=1-(p.slowPct+p.silentPct)/100, ps=p.slowPct/100;
    const up=new Array(m).fill(true), downUntil=new Array(m).fill(0);
    let active=m,t=0,progress=0,correct=0,phase=0,uptime=0,capacityHours=0,saveHours=0;
    let cp={position:0,at:0,clean:true},cleanCp={...cp},epoch=null,epochSerial=0;
    let paused=false,pauseUntil=Infinity,repairingSilent=false,replayUntil=0;
    let slowSerial=0,events=0,slowFactor=1;const slows=new Map();
    const stats={hard:0,slow:0,silent:0,silentDetected:0,silentRollbackHours:0,
      silentRollbackWork:0,silentRestarts:0,hardRollbackWork:0,slowRepairs:0};
    const trace=options.trace?[]:null;
    const record=kind=>{if(trace)trace.push({t,kind,progress,correct,active,corrupt:!!epoch});};
    function recalcSlow(){slowFactor=1;for(const s of slows.values())if(up[s.domain])slowFactor*=1-p.slowLoss/100;}
    function chooseDomain(){if(m===1)return 0;let d;do{d=Math.floor(rng()*m);}while(!up[d]);return d;}
    function localRepair(domain,until){
      if(up[domain]){up[domain]=false;active--;}
      downUntil[domain]=Math.max(downUntil[domain],until);
      queue.add({at:downUntil[domain],type:'up',domain});recalcSlow();
    }
    function ordinaryGlobalPause(duration,reason){
      const lost=Math.max(0,progress-cp.position);
      if(reason==='hard')stats.hardRollbackWork+=lost;
      progress=cp.position;correct=epoch?Math.min(correct,progress):progress;phase=0;
      paused=true;pauseUntil=Math.max(Number.isFinite(pauseUntil)?pauseUntil:0,t+duration);
    }
    function silentDetection(id) {
      if(!epoch || epoch.id!==id || epoch.repairing)return;
      epoch.repairing=true;
      const retained=t-epoch.clean.at<=p.retentionHours+1e-10;
      const chosen=retained?epoch.clean:{position:0,at:0,clean:true};
      stats.silentDetected++;
      stats.silentRollbackHours+=t-chosen.at;
      stats.silentRollbackWork+=Math.max(0,progress-chosen.position);
      if(!retained)stats.silentRestarts++;
      replayUntil=Math.max(replayUntil,progress);
      progress=chosen.position;correct=progress;cp={...chosen};phase=0;
      paused=true;repairingSilent=true;
      pauseUntil=Math.max(Number.isFinite(pauseUntil)?pauseUntil:0,t+p.silentMinutes/60);
      record('silent-detected-rollback');
    }
    const scripted=options.events || [];
    for(const e of scripted)queue.add({...e,type:'forced'});
    while(t<T-1e-10) {
      if(++events>200000)throw new Error('事件数超过计算上限，请降低 FIT 或缩短评估窗口。');
      const running=!paused && active>0, fraction=active/m;
      const hazard=running && !options.disableRandom?lambda*fraction:0;
      const faultAt=hazard?t-Math.log(rng())/hazard:Infinity;
      const pending=queue.peek()?.at ?? Infinity;
      const replay=progress<replayUntil-1e-10 && !epoch;
      const speed=fraction*slowFactor*(replay?p.replayRate:1);
      const replayAt=running && replay && speed>0?t+timeForWork(phase,(replayUntil-progress)/speed,tau,save):Infinity;
      const next=Math.min(T,faultAt,pending,paused?pauseUntil:Infinity,replayAt);
      if(next<t-1e-8)throw new Error('事件时间顺序错误。');
      const dt=Math.max(0,next-t);
      if(running){
        const step=advance(phase,dt,tau,save),old=progress;
        progress+=step.work*speed;
        if(!epoch)correct=progress;
        if(step.commits){
          cp={position:old+step.commitWork*speed,at:t+step.commitElapsed,clean:!epoch};
          if(cp.clean)cleanCp={...cp};
        }
        phase=step.phase;uptime+=dt;capacityHours+=dt*fraction;saveHours+=dt-step.work;
      }
      t=next;
      if(t>=T-1e-10)break;
      if(paused && t>=pauseUntil-1e-10) {
        paused=false;pauseUntil=Infinity;
        if(repairingSilent){
          epoch=null;repairingSilent=false;correct=progress;
          cp={position:progress,at:t,clean:true};cleanCp={...cp};
        }
        record('resume');
        continue;
      }
      if(pending<=t+1e-10){
        const e=queue.pop();
        if(e.type==='up'){
          if(downUntil[e.domain]<=t+1e-10 && !up[e.domain]){
            up[e.domain]=true;active++;recalcSlow();
          }
        }else if(e.type==='slow-expire'){
          slows.delete(e.id);recalcSlow();
        }else if(e.type==='slow-detect'){
          const s=slows.get(e.id);
          if(s){
            slows.delete(e.id);recalcSlow();stats.slowRepairs++;
            if(p.mode==='global')ordinaryGlobalPause(p.globalMinutes/60,'slow');
            else localRepair(s.domain,t+p.localMinutes/60);
          }
        }else if(e.type==='silent-detect'){
          silentDetection(e.id);
        }else if(e.type==='forced'){
          if(e.kind==='silent')triggerSilent(e.detectAfter);
          if(e.kind==='hard')triggerHard(0);
        }
        continue;
      }
      if(replayAt<=t+1e-10){replayUntil=0;continue;}
      const type=rng();
      if(type<ph)triggerHard();
      else if(type<ph+ps)triggerSlow();
      else triggerSilent();
    }
    function triggerHard(forcedDelay) {
      stats.hard++;
      const detection=forcedDelay ?? (rng()<p.hardDetect/100?p.hardSeconds/3600:p.fallbackMinutes/60);
      if(p.mode==='global')ordinaryGlobalPause(detection+p.globalMinutes/60,'hard');
      else localRepair(chooseDomain(),t+detection+p.localMinutes/60);
      record('hard');
    }
    function triggerSlow() {
      stats.slow++;
      const id=++slowSerial,domain=chooseDomain();
      slows.set(id,{domain});recalcSlow();
      queue.add({at:t+p.slowHours,type:'slow-expire',id});
      if(rng()<p.slowDetect/100)queue.add({at:t+p.slowMinutes/60,type:'slow-detect',id});
    }
    function triggerSilent(forcedDelay) {
      stats.silent++;
      if(!epoch){epoch={id:++epochSerial,onset:t,clean:{...cleanCp},repairing:false};correct=progress;}
      if(forcedDelay!==undefined || rng()<p.silentDetect/100){
        queue.add({at:t+(forcedDelay??p.silentHours),type:'silent-detect',id:epoch.id});
      }
      record('silent');
    }
    record('end');
    return {effective:Math.max(0,correct/T),uptime:uptime/T,capacity:capacityHours/T,
      delivery:epoch?0:Math.max(0,correct/T),cleanEnd:epoch?0:1,
      progress,correct,saveHours,stats,trace};
  }
  function estimate(n,p,trials,seed=9137,hours=720) {
    if(!Number.isInteger(trials)||trials<2)throw new Error('请选择有效的模拟轨迹数。');
    const sums={effective:0,uptime:0,capacity:0},sq={effective:0,uptime:0,capacity:0};
    let stats=null;
    for(let i=0;i<trials;i++){
      const r=simulate(n,p,(seed+Math.imul(i+1,2654435761)+n)>>>0,{hours});
      for(const k of Object.keys(sums)){sums[k]+=r[k];sq[k]+=r[k]*r[k];}
      if(!stats)stats=Object.fromEntries(Object.keys(r.stats).map(k=>[k,0]));
      for(const k of Object.keys(stats))stats[k]+=r.stats[k];
    }
    const result={n,trials,stats};
    for(const k of Object.keys(sums)){
      const mean=sums[k]/trials,variance=Math.max(0,(sq[k]-sums[k]*sums[k]/trials)/(trials-1));
      const se=Math.sqrt(variance/trials);
      result[k]={mean,se,low:Math.max(0,mean-1.96*se),high:Math.min(1,mean+1.96*se)};
    }
    result.silentRollbackHours=stats.silentDetected?stats.silentRollbackHours/stats.silentDetected:null;
    result.silentRollbackWork=stats.silentDetected?stats.silentRollbackWork/stats.silentDetected:null;
    result.silentRestartFraction=stats.silentDetected?stats.silentRestarts/stats.silentDetected:null;
    return result;
  }
  return {defaults,weights,scales,summary,advance,timeForWork,simulate,estimate};
}
if(typeof module!=='undefined')module.exports=createReliabilityEngine;
