const assert=require('assert'),fs=require('fs'),path=require('path');
const E=require('./月度训练仿真引擎.js')(),A=require('./Shapley贡献计算.js')(E);
const close=(a,b,t=1e-9)=>assert(Math.abs(a-b)<t,a+' != '+b);
const plain={...E.defaults,fits:[0,0,0,0],saveSeconds:0};
const trial=(events,hours=200,p=plain)=>E.simulate(10000,p,17,{events,hours,disableRandom:true,trace:true});
const missed=trial([{at:10.0001,kind:'silent',channel:'fallback'}]);
close(missed.trace.find(r=>r.kind==='silent-detected-rollback').t,130.0001);
close(missed.trace.find(r=>r.kind==='silent-detected-rollback').progress,10);
close(missed.correct,200-120-.0001-1/3600);assert.equal(missed.stats.silentFallback,1);
const immediate=trial([{at:10.0001,kind:'silent',channel:'immediate'}]);
assert((200-immediate.correct)*3600<=3+1e-7);assert.equal(immediate.cleanEnd,1);assert.equal(immediate.stats.silentImmediate,1);
const late=trial([{at:150,kind:'silent',channel:'fallback'}]);close(late.delivery,0);
const overlapping=trial([{at:10,kind:'silent',channel:'fallback'},{at:11,kind:'silent',channel:'immediate',detectAfter:0}],20);
close(overlapping.delivery,0);assert.equal(overlapping.stats.silentDetected,0);
const hard=trial([{at:3,kind:'hard'}],10,{...plain,hardDetect:0});
close(hard.trace.find(r=>r.kind==='resume').t,5+1/60);
assert.equal(E.defaults.retentionHours,null);assert.equal(E.defaults.fallbackMinutes,1);
let fallbackSum=0;
for(let i=0;i<2048;i++){
 const exp=E.simulate(10000,{...plain,fallbackDistribution:'exponential'},(9137+Math.imul(i+1,2654435761))>>>0,{hours:10000,disableRandom:true,trace:true,events:[{at:1,kind:'silent',channel:'fallback'}]});
 fallbackSum+=exp.trace.find(r=>r.kind==='silent-detected-rollback').t-1;
}
assert(Math.abs(fallbackSum/2048-120)<5*120/Math.sqrt(2048));
const coeff=[.1,.2,-.05],values=Array.from({length:8},(_,mask)=>.3+coeff.reduce((s,c,i)=>s+(mask&(1<<i)?c:0),0));
const phi=A.shapleyValues(values,3);coeff.forEach((v,i)=>close(phi[i],v));
A.shapleyValues([0,0,0,1],2).forEach(v=>close(v,.5));
const dummy=A.shapleyValues([0,1,0,1],2);close(dummy[0],1);close(dummy[1],0);
assert.throws(()=>A.setup({stepSeconds:0}));assert.throws(()=>A.setup({trials:1}));
const smoke=A.run({trials:8,silentTarget:0,recoveryTarget:120,intervalTarget:7200,saveTarget:10,fitTarget:E.defaults.fits.map(v=>Number(v.toFixed(6))).reduce((a,b)=>a+b,0)},()=>{},[10000]);
for(const r of smoke.scale){close(r.residual,0);for(const id of ['silent','recovery','checkpoint','save','fit']){const v=r.contributions.find(f=>f.id===id);close(v.shapley.mean,0);close(v.shapley.se,0);}}
const output={status:'passed',checks:['hard timeout fallback is one minute','silent immediate branch loses at most detection + preparation + one step','missed silent fallback occurs after 120 hours and preserves clean progress','exponential fallback mean matches 120 hours','clean checkpoint never expires','unresolved corruption zeros delivery','later alarm does not erase earlier missed corruption','additive Shapley game','pure interaction equally allocated','dummy contribution is zero','negative contribution preserved','model no-change targets have zero Shapley and variance','Shapley efficiency identity'],exponentialFallbackMeanHours:fallbackSum/2048,silentFallbackTrace:missed.trace};
fs.writeFileSync(path.join(__dirname,'Shapley验证结果.json'),JSON.stringify(output,null,2));console.log(output.status,output.checks);
