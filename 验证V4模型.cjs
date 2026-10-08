const assert=require('assert'),fs=require('fs');
const E=require('./月度训练仿真引擎.js')(),checks=[];
const near=(a,b,t=1e-8)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
const plain={...E.defaults,fits:[0,0,0,0],saveSeconds:0,hardSeconds:0,hardDetect:100};
function run(p,events=[],hours=10,n=1024){return E.simulate(n,{...plain,...p},17,{disableRandom:true,events,hours,trace:true});}
function test(name,fn){fn();checks.push(name);}
test('no-fault checkpoint overhead matches renewal-cycle arithmetic',()=>{
 const r=run({saveSeconds:10},[],24);near(r.correct,24-11*10/3600);near(r.ledger.checkpointSave,11*10/3600);
});
test('volatile step is not a durable checkpoint',()=>{
 const r=run({},[{at:1.5,kind:'silent',channel:'immediate'},{at:1.6,kind:'hard',detectAfter:0}]);
 const s=r.trace.find(x=>x.kind==='silent-detected-rollback'),h=r.trace.find(x=>x.kind==='hard');
 near(s.progress,1.5);near(s.durableCheckpoint,0);near(h.progress,0);near(r.ledger.residual,0);
});
test('a newer clean durable checkpoint wins over an older step snapshot',()=>{
 const r=run({intervalSeconds:1,stepSeconds:10},[{at:1.5/3600,kind:'silent',channel:'immediate'},{at:3/3600,kind:'hard',detectAfter:0}],.01);
 const e=r.trace.find(x=>x.kind==='silent-detected-rollback');near(e.progress,1/3600);assert.equal(e.candidateKind,'durable');near(r.ledger.residual,0);
});
test('topology covers non-divisible card counts exactly',()=>{
 for(const placement of ['compact','striped'])for(const n of [1,17,1024,10001]){
  const t=E.topology(n,{...plain,placement});const counts=new Array(t.domains).fill(0);
  for(let c=0;c<n;c++){counts[t.cardDomain(c)]++;assert(t.impacted('server',c).includes(t.cardDomain(c)));}
  assert.deepEqual(counts,t.sizes);assert.equal(t.sizes.reduce((a,b)=>a+b),n);
 }
});
test('rack failure and placement actually change lost capacity',()=>{
 const ev=[{at:1,kind:'hard',detectAfter:0,scope:'rack',card:0}];
 const compact=run({mode:'local',recoveryDomains:4},ev),striped=run({mode:'local',recoveryDomains:4,placement:'striped'},ev);
 near(compact.delivery,.95);near(striped.delivery,.8);assert.equal(compact.trace.find(x=>x.kind==='hard').affectedDomains,1);assert.equal(striped.trace.find(x=>x.kind==='hard').affectedDomains,4);
});
test('finite repair resources queue concurrent failures',()=>{
 const ev=[{at:1,kind:'hard',detectAfter:0,card:0},{at:1,kind:'hard',detectAfter:0,card:512}];
 const a=run({mode:'local',recoveryDomains:4,repairSlots:1},ev),b=run({mode:'local',recoveryDomains:4},ev);
 near(a.stats.repairQueueHours,2);near(b.stats.repairQueueHours,0);near(a.delivery,.85);near(b.delivery,.9);
});
test('repair queue uses detection order, not future reservations',()=>{
 const r=run({mode:'local',recoveryDomains:4,repairSlots:1},[{at:1,kind:'hard',detectAfter:1,card:0},{at:1.1,kind:'hard',detectAfter:0,card:512}]);
 const plans=r.trace.filter(x=>x.kind==='repair-scheduled');near(plans[0].t,1.1);near(plans[0].repairStartedAt,1.1);near(plans[1].repairStartedAt,3.1);near(r.stats.repairQueueHours,1.1);
});
test('minimum active capacity threshold stops and resumes job',()=>{
 const r=run({mode:'local',recoveryDomains:4,minActiveFraction:.9},[{at:1,kind:'hard',detectAfter:0}]);near(r.delivery,.8);near(r.ledger.pause,2);
});
test('local reconfiguration global pause is accounted once',()=>{
 const r=run({mode:'local',recoveryDomains:4,reconfigureSeconds:360},[{at:1,kind:'hard',detectAfter:0}]);near(r.ledger.pause,.1);near(r.ledger.unavailableCapacity,.475);near(r.ledger.residual,0);
});
test('localization failure falls back to origin; valid candidate preserves progress',()=>{
 const ev=[{at:3,kind:'silent',channel:'fallback',detectAfter:1}];
 const a=run({},ev),b=run({silentLocatePct:0},ev);
 near(a.trace.find(x=>x.kind==='silent-detected-rollback').progress,2);near(b.trace.find(x=>x.kind==='silent-detected-rollback').progress,0);
 assert.equal(b.stats.unsafeCandidateFallbacks,1);
});
test('failed silent restoration is not counted as clean delivery',()=>{
 const r=run({silentRecoveryPct:0,silentFallbackHours:.1},[{at:3,kind:'silent',channel:'immediate'}]);near(r.delivery,0);assert(r.stats.recoveryFailures>1);near(r.ledger.residual,0);
});
test('monitoring overhead enters delivered work',()=>{near(run({silentDetect:95,silentMonitorPct:10}).delivery,.9);near(run({silentDetect:0,silentMonitorPct:10}).delivery,1);});
test('full-up baseline calibration remains 30 hours hard MTBF at 10k',()=>{near(E.summary(E.defaults,10000).hardMtbf,30);near(E.summary(E.defaults,500000).hardMtbf,.6);});
test('calendar shared faults continue during repair and create queue',()=>{
 const r=E.simulate(1024,{...plain,sharedFIT:1e9,repairSlots:1},42,{hours:20});assert(r.stats.commonFailures>3);assert(r.stats.repairQueueHours>0);near(r.ledger.residual,0);
});
test('input validation rejects non-finite values and invalid probabilities',()=>{for(const patch of [{slowPct:NaN},{intervalSeconds:Infinity},{minActiveFraction:NaN},{silentPct:101},{repairSlots:1.5}])assert.throws(()=>E.validate({...plain,...patch}));});
test('randomized overlapping faults conserve every hour',()=>{
 for(let i=1;i<=240;i++){
  const p={...E.defaults,mode:i%2?'local':'global',recoveryDomains:5,placement:i%3?'compact':'striped',repairSlots:i%4,
   fits:[500000,500000,500000,500000],networkScope:'rack',otherScope:'server',rackFIT:5e7,sharedFIT:1e8,
   silentDetect:i%2?95:0,slowPct:10,silentPct:10,silentFallbackHours:2,silentLocatePct:80,cleanVerifyPct:95,silentRecoveryPct:80,
   intervalSeconds:1800,globalMinutes:15,localMinutes:15,minActiveFraction:i%2?.6:0,silentMonitorPct:3};
  const r=E.simulate(1024,p,i,{hours:20});near(r.ledger.residual,0,1e-6);assert(r.delivery>=0&&r.delivery<=1);assert(r.ledger.rollback>=0);
 }
});
test('calibration deduplicates root events and rejects conflicting evidence',()=>{
 const calibrate=require('./校准故障台账.cjs'),sample=require('./故障台账格式示例.json'),r=calibrate(sample);
 assert.equal(r.rows[0].observedRootEvents,2);assert.equal(r.rows[0].alarms,3);near(r.rows[0].observedFIT,2/7200000*1e9);
 assert(r.rows[1].zeroEventUpper95FIT>0);assert.equal(r.synthetic,true);
 assert.throws(()=>calibrate({...sample,events:[...sample.events,sample.events[0]]}));
});
test('scenario roundtrip and canonical key ordering',()=>{
 const R=require('./场景与证据.js')(),A=require('./Shapley贡献计算.js')(E),c=A.setup({trials:8,model:{repairSlots:2}}).config;
 assert.deepEqual(R.parseScenario(R.scenario(c,E.version,'test'),A,E.version),c);
 assert.equal(R.canonical({b:1,a:2}),R.canonical({a:2,b:1}));assert.throws(()=>R.parseScenario({schemaVersion:0},A,E.version));
});
const out={version:E.version,status:'passed',checks};fs.writeFileSync(__dirname+'/V4模型验证结果.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
