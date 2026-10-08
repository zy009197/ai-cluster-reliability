const assert=require('assert'),fs=require('fs'),path=require('path');
const E=require('./三类故障仿真引擎.js')();
const close=(x,y,tol=1e-9)=>assert(Math.abs(x-y)<tol,x+' != '+y);
const plain={...E.defaults,fits:[0,0,0,0],saveSeconds:0,intervalSeconds:7200};
close(E.summary(E.defaults,10000).mtbf,29.28);
close(E.summary(E.defaults,10000).hardMtbf,30);
close(E.summary(E.defaults,10000).auto,.9462);
close(E.summary(E.defaults,10000).eventual,.995);
close(E.simulate(10000,plain).effective,1);
const step=E.simulate(10000,{...plain,intervalSeconds:6,saveSeconds:.001});
close(step.effective,E.advance(0,720,6/3600,.001/3600).work/720);
const hard=E.simulate(10000,plain,1,{hours:10,disableRandom:true,events:[{at:3,kind:'hard'}]});
close(hard.correct,7);close(hard.uptime,.8);close(hard.stats.hardRollbackWork,1);
const localHard=E.simulate(10000,{...plain,mode:'local'},1,{hours:10,disableRandom:true,events:[{at:3,kind:'hard'}]});
close(localHard.correct,9.96);close(localHard.uptime,1);
const fixture={hours:62,disableRandom:true,trace:true,events:[{at:11,kind:'silent',detectAfter:24}]};
const sdc=E.simulate(10000,plain,1,fixture);
close(sdc.correct,35);close(sdc.stats.silentRollbackHours,25);close(sdc.stats.silentRollbackWork,25);
close(sdc.trace.find(x=>x.kind==='silent-detected-rollback').correct,10);
close(sdc.trace.find(x=>x.kind==='resume').t,37);
const expired=E.simulate(10000,{...plain,retentionHours:20},1,fixture);
close(expired.correct,25);assert.equal(expired.stats.silentRestarts,1);
const missed=E.simulate(10000,plain,1,{...fixture,events:[{at:11,kind:'silent'}]});
close(missed.correct,11);assert.equal(missed.stats.silentDetected,0);
const halfSpeed=E.simulate(10000,{...plain,replayRate:.5},1,fixture);
close(halfSpeed.correct,22.5);
close(E.simulate(10000,{...plain,mode:'local'},1,fixture).correct,35);
for(const phase of [0,.25,1,1.15]){
  const tau=1,save=.2,dt=11.37,steps=200000,dx=dt/steps;
  let quadrature=0;
  for(let i=0;i<steps;i++)if((phase+(i+.5)*dx)%(tau+save)<tau)quadrature+=dx;
  close(E.advance(phase,dt,tau,save).work,quadrature,.0002);
  for(const work of [.1,.8,3.3]){
    const duration=E.timeForWork(phase,work,tau,save);
    close(E.advance(phase,duration,tau,save).work,work);
  }
}
const hardOnly={...E.defaults,slowPct:0,silentPct:0,hardDetect:100,hardSeconds:0};
const empirical=E.estimate(100000,hardOnly,4096);
const lambda=100000*hardOnly.fits.reduce((a,b)=>a+b)/1e9;
const analytic=lambda*2/(Math.expm1(lambda*(2+10/3600))*(1+lambda*2));
assert(Math.abs(empirical.effective.mean-analytic)<5*empirical.effective.se+.006);
for(const mode of ['global','local'])for(const q of [0,95]){
  const p={...E.defaults,mode,silentDetect:q,silentHours:1};
  const r=E.estimate(500000,p,256);
  assert(r.effective.mean>=0&&r.effective.mean<=r.uptime.mean+1e-10);
  assert(r.capacity.mean<=r.uptime.mean+1e-10);
  assert.deepEqual(r,E.estimate(500000,p,256));
}
const report={status:'passed',checks:['FIT and coverage','no-fault finite-window progress','step checkpoint batching','global rollback','local capacity loss','silent delayed detection and rollback','expired clean checkpoint fallback','undetected silent freeze','replay throughput','global silent propagation in local mode','checkpoint quadrature','hard-only renewal cross-check','bounded outputs and reproducibility'],
  hardOnly:{simulation:empirical.effective,steadyState:analytic},silentTimeline:sdc.trace};
fs.writeFileSync(path.join(__dirname,'新版引擎验证结果.json'),JSON.stringify(report,null,2)+'\n');
console.log('All model checks passed.',report.hardOnly);
