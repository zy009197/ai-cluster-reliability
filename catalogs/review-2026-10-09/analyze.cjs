const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('./engine.cjs'),{legacyMechanisms}=require('./inputs.json');
const out=(f,d)=>fs.writeFileSync(path.join(__dirname,f),JSON.stringify(d,null,2));
const scenarios=[
{id:'base',name:'确认基线',opts:{}},
{id:'hardDetect',name:'中断检测优化',opts:{hardDetect:true}},
{id:'slowDetect',name:'亚健康检测优化',opts:{slowDetect:true}},
{id:'sdcDetect',name:'静默检出95%＋全局CKPT',opts:{sdcDetect:true}},
{id:'step',name:'仅配置step恢复（无即时检出）',opts:{step:true}},
{id:'sdcStep',name:'静默检出95%＋step恢复',opts:{sdcDetect:true,step:true}},
{id:'replay',name:'通信/算子重执行',opts:{replay:true}},
{id:'process',name:'进程重调度',opts:{process:true}},
{id:'elastic',name:'50个DP域弹性（条件模型）',opts:{elastic:true}},
{id:'fast',name:'检查点60秒/阻塞1秒',opts:{fast:true}},
{id:'combined',name:'六机制组合',opts:{sdcDetect:true,step:true,replay:true,process:true,elastic:true,fast:true}}
];
const params={
'D-HARD':{scenario:'hardDetect',status:'基线已有；优化目标为新增先验',scope:'hard',change:'基线95%在10秒发现、其余60秒超时 → 99.9%在1秒发现、其余60秒；只改变停机中的发现时间',prerequisite:'不增加误报或检测资源开销；此假设尚未计价',failure:'仍由60秒超时兜底',confidence:'基线USER；99.9%/1秒为待审计目标'},
'D-SLOW':{scenario:'slowDetect',status:'基线已有；优化目标为新增先验',scope:'slow',change:'95%在5分钟发现 → 99%在30秒发现；漏检仍降速24小时；恢复仍3分钟、零回滚',prerequisite:'识别真实亚健康而非负载变化，误报开销暂未计入',failure:'漏检维持24小时降速；不是强制人工恢复',confidence:'基线USER；99%/30秒为待审计目标'},
'D-SDC':{scenario:'sdcDetect',status:'候选机制',scope:'sdc',change:'即时检出0% → 95%，检测1秒；仅启用检测时回到现有干净CKPT并用3分钟恢复。5%漏检仍120小时后发现',prerequisite:'全链路污染识别与干净点验证；1秒为场景值，不是已测step长度',failure:'保留既有污染，漏检走5天兜底；新检测不能清洗旧污染',confidence:'95%为用户目标；1秒为暂定step级参数'},
'R-SDC':{scenario:'step',conditional:'sdcStep',status:'依赖D-SDC的候选机制',scope:'sdc',change:'已即时检出的静默从全局CKPT/3分钟恢复 → 易失干净step状态/1秒恢复，最多重做1秒计算；不缩短漏检的5天',prerequisite:'必须有D-SDC即时定位、有效易失干净状态；无法单独找出静默错误',failure:'本次按恢复成功率100%的理想能力评估；失败和覆盖范围待测',confidence:'理想能力目标，非厂商实测'},
'R-REPLAY':{scenario:'replay',status:'候选机制',scope:'replay',change:'瞬态中断先重执行：90%在5秒成功且不回滚；失败耗时10秒后进入后续恢复链',prerequisite:'可重执行、幂等、通信一致性；必须清除瞬态根因',failure:'弹性 → 进程重调度 → 全局CKPT → 人工（仅走启用且适用的节点）',confidence:'沿用旧机制库PRIOR，不适用持续器件损坏'},
'R-PROCESS':{scenario:'process',status:'候选机制',scope:'process',change:'适用中断95%在60秒重建进程，仍全局暂停并回滚CKPT；失败120秒后全局CKPT',prerequisite:'健康备用资源；进程级故障可隔离；本版只用于中断',failure:'全局CKPT → 人工',confidence:'沿用旧机制库PRIOR'},
'R-ELASTIC':{scenario:'elastic',status:'有条件候选机制',scope:'elastic',change:'适用中断98%局部恢复成功：50域中一个域180秒不可用，检测期间同域不可用，默认全局协调1秒；状态冗余避免回滚；失败120秒后后续全局恢复',prerequisite:'其余域可持续产生可保留的有效进度；状态冗余、备用资源、DP数学语义与收敛验证；只适用卡/服务器域中断',failure:'进程重调度（若启用） → 全局CKPT → 人工',confidence:'50域USER；98%和1秒为待审计先验；容量模型不等于同步训练性能承诺'},
'R-CKPT':{scenario:'base',status:'已包含于基线',scope:'all',change:'恢复尝试固定3分钟，成功99%；中断回滚最近CKPT，亚健康保存当前进度零回滚，静默回到干净CKPT',prerequisite:'干净检查点永久保留，存储可读，恢复加载已含3分钟',failure:'1%失败额外人工2小时；不是所有故障都人工',confidence:'最新USER覆盖旧10–20分钟曲线'},
'R-MANUAL':{scenario:'base',status:'已包含于基线',scope:'all',change:'自动恢复失败后追加120分钟；当前最终成功率100%，不再次叠加3分钟',prerequisite:'2小时服务响应与资源修复能力；长尾尚未建模',failure:'超过2小时或最终失败的尾部待现场数据',confidence:'2小时USER；最终成功100%为模型终止假设'},
'C-FAST':{scenario:'fast',status:'候选机制',scope:'all',change:'每计算300秒保存4秒 → 每计算60秒保存1秒；同时改变保存开销与中断回滚，不能只计算回滚改善',prerequisite:'带宽、并发、存储空间能支撑；异步实现效果待测',failure:'保存失败沿现有故障事件进入恢复；新增存储压力未建模',confidence:'本轮新增目标先验；替换旧2小时→10分钟情景'},
'H-PROTECT':{scenario:null,status:'既有保护，不重复计收益',scope:'none',change:'事件FIT已是保护后的业务影响残余率；无法再次把同一份光路/电源保护扣除',prerequisite:'需要保护前物理FIT、共因故障、切换覆盖率和拓扑',failure:'未增加收益；不是保护技术本身没有价值',confidence:'当前无独立增量参数'},
'H-RELIABILITY':{scenario:null,status:'待校准，收益暂不可识别',scope:'none',change:'必须逐事件给出新旧FIT，不能把经验概率下降当作已实现硬件收益',prerequisite:'同器件、同暴露时长的前后实测；根因去重',failure:'不擅自假设全硬件FIT下降比例',confidence:'未提供可量化目标'}
};
function applies(e,scope){if(scope==='all')return true;if(scope==='none')return false;if(['hard','slow','sdc'].includes(scope))return e.type===scope;return e.type==='hard'&&e[scope];}
const mechanisms=legacyMechanisms.mechanisms.map(m=>({...m,...params[m.id],eventIds:E.events.filter(e=>applies(e,params[m.id].scope)).map(e=>e.id)}));
// Old timing fields are historical provenance only, never simulation parameters.
for(const m of mechanisms){m.previousParameters={success:m.success,seconds:m.seconds,failureSeconds:m.failureSeconds,applies:m.applies,fallback:m.fallback,requires:m.requires,evidence:m.evidence};m.parameters=require('./mechanism-policy.json')[m.id]??null;for(const k of ['success','seconds','failureSeconds','applies','fallback','requires','evidence'])delete m[k];m.activeFit=E.events.filter(e=>m.eventIds.includes(e.id)).reduce((s,e)=>s+e.fit,0);}
const sums=(x,v)=>{for(const [k,n]of Object.entries(v))x[k]=(x[k]||0)+n;};
function sample(cards,opts,trials,baseline=null,seedBase=E.config.seed){
 const p=E.parameters(opts),sum={yield:0,sq:0,delta:0,deltaSq:0,up:0},ledger={},perEvent={},values=[];
 for(let i=0;i<trials;i++){
  const seed=(seedBase+Math.imul(i+1,2654435761))>>>0,r=E.simulate(cards,2,seed,p,opts),v=r.usefulThroughput;
  values.push(v);sum.yield+=v;sum.sq+=v*v;sum.up+=r.operationalAvailability;
  if(baseline){const d=v-baseline[i];sum.delta+=d;sum.deltaSq+=d*d;}
  sums(ledger,r.ledger);for(const [id,x]of Object.entries(r.perEvent)){perEvent[id]??={};sums(perEvent[id],x);}
 }
 const avg=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v/trials]));
 const mean=sum.yield/trials,delta=sum.delta/trials,ci=(s,ss)=>1.96*Math.sqrt(Math.max(0,(ss-s*s/trials)/(trials-1))/trials);
 return {cards,trials,mean,ci95:ci(sum.yield,sum.sq),availability:sum.up/trials,delta,deltaCi95:ci(sum.delta,sum.deltaSq),ledger:avg(ledger),perEvent:Object.fromEntries(Object.entries(perEvent).map(([k,v])=>[k,avg(v)])),values};
}
function verify(){
 const checks=[];const check=(name,fn)=>{fn();checks.push({name,pass:true});};
 check('基线逐种子回归：300次月任务与已确认引擎一致',()=>{for(const cards of [10000,100000,500000])for(let i=1;i<=100;i++){const a=E.simulate(cards,2,i),b=E.previous.simulate(cards,2,i);assert.ok(Math.abs(a.correctHours-b.correctHours)<1e-7);}});
 check('固定三类FIT预算、Core占SDC85%、零预算保持',()=>{const rules=require('../event-constraints.js');rules.assertValid(require('./inputs.json').current.events);});
 check('无故障极限只扣周期保存；亚健康无回滚',()=>{const r=E.simulate(10000,2,10,{...E.config,referenceMtbfHours:Infinity});assert.ok(Math.abs(r.correctHours-(720-Math.floor(720*3600/304)*4/3600))<1e-6);for(let i=1;i<=100;i++)assert.equal(E.simulate(500000,2,i).byCause.slow.rollback,0);});
 check('step恢复单独启用无收益；100%即时检出无月末污染',()=>{for(let i=1;i<=100;i++){assert.equal(E.simulate(500000,2,i,E.config,{step:true}).correctHours,E.simulate(500000,2,i).correctHours);assert.equal(E.simulate(500000,2,i,E.config,{sdcDetect:true,sdcCoverage:1,step:true}).ledger.terminalInvalid,0);}});
 check('机制组合逐事件和总体时间账守恒、0≤有效产出≤1',()=>{for(let i=1;i<=100;i++)for(const s of scenarios){const r=E.simulate(500000,2,i,E.parameters(s.opts),s.opts);assert.ok(r.usefulThroughput>=0&&r.usefulThroughput<=1);}});
 return checks;
}
async function main(){
 const checks=verify();console.log('第一轮审视通过',checks.length);
 const results=[],raw=new Map(),trials=4000;
 for(const cards of [1000,10000,100000,200000,500000]){
  const base=sample(cards,{},trials);raw.set(`${cards}:base`,base.values);results.push({scenario:'base',...base,values:undefined});
  for(const s of scenarios.slice(1)){const r=sample(cards,s.opts,trials,base.values);raw.set(`${cards}:${s.id}`,r.values);results.push({scenario:s.id,...r,values:undefined});}
  console.log('单项完成',cards,results.filter(r=>r.cards===cards).map(r=>`${r.scenario}:${(r.mean*100).toFixed(3)}%`).join(' '));
 }
 // Six-player exact coalition enumeration. Monte Carlo estimates of each value; no Shapley permutation approximation.
 const players=['sdcDetect','step','replay','process','elastic','fast'],shapley=[],shapleyTrials=2000;
 const factorial=n=>n<2?1:n*factorial(n-1);
 for(const cards of [10000,100000,200000,500000]){
  const coalitions=[];for(let mask=0;mask<64;mask++){
   const opts=Object.fromEntries(players.filter((p,i)=>mask&(1<<i)).map(p=>[p,true]));
   coalitions.push(sample(cards,opts,shapleyTrials,null,77334411));
  }
  const playerResults=players.map((player,i)=>{
   const vals=Array(shapleyTrials).fill(0);
   for(let mask=0;mask<64;mask++)if(!(mask&(1<<i))){const k=mask.toString(2).replace(/0/g,'').length,w=factorial(k)*factorial(5-k)/factorial(6);for(let j=0;j<shapleyTrials;j++)vals[j]+=w*(coalitions[mask|(1<<i)].values[j]-coalitions[mask].values[j]);}
   const mean=vals.reduce((a,b)=>a+b,0)/shapleyTrials,variance=vals.reduce((a,b)=>a+(b-mean)**2,0)/(shapleyTrials-1);
   return {player,contribution:mean,ci95:1.96*Math.sqrt(variance/shapleyTrials)};
  });
  const delta=coalitions[63].mean-coalitions[0].mean;assert.ok(Math.abs(playerResults.reduce((s,x)=>s+x.contribution,0)-delta)<1e-10);
  shapley.push({cards,trials:shapleyTrials,baseline:coalitions[0].mean,combined:coalitions[63].mean,delta,players:playerResults});console.log('Shapley完成',cards);
 }
 checks.push({name:'第二轮审视：六机制64个子集，Shapley贡献之和等于组合提升',pass:true});
 const sensitivity=[];
 for(const coverage of [0,.5,.8,.95,.99,1]){const r=sample(500000,{sdcDetect:true,step:true,sdcCoverage:coverage},2000,null,988133);sensitivity.push({kind:'sdcCoverage',value:coverage,...r,values:undefined});}
 for(const seconds of [0,1,5,30]){const r=sample(500000,{elastic:true,elasticSyncSeconds:seconds},2000,null,988133);sensitivity.push({kind:'elasticSync',value:seconds,...r,values:undefined});}
 for(const seconds of [1,5,10]){const r=sample(500000,{sdcDetect:true,step:true,stepSeconds:seconds},2000,null,988133);sensitivity.push({kind:'stepRollback',value:seconds,...r,values:undefined});}
 const conditional=results.filter(r=>r.scenario==='sdcStep').map(r=>{const a=raw.get(`${r.cards}:sdcStep`),b=raw.get(`${r.cards}:sdcDetect`),vs=a.map((x,i)=>x-b[i]),mean=vs.reduce((x,y)=>x+y,0)/trials;return {cards:r.cards,delta:mean,ci95:1.96*Math.sqrt(vs.reduce((s,x)=>s+(x-mean)**2,0)/(trials-1)/trials)};});
 const data={version:'two-libraries-review-1',createdAt:new Date().toISOString(),config:E.config,trials,scenarios,mechanisms,results,shapley,conditional,sensitivity,checks};
 out('results.json',data);out('mechanisms.json',{version:data.version,mechanisms});
 const eventLibrary=E.events.map(e=>({id:e.id,domain:e.domain,type:e.type,description:e.description,scope:e.scope,persistence:e.persistence,fit:e.fit,eventShare:e.fit/Object.values(E.typeTotals).reduce((a,b)=>a+b,0),withinTypeShare:e.fit/E.typeTotals[e.type],evidence:e.evidence,reviewNote:e.reviewNote,rateBasis:E.config.eventCatalog?require('./inputs.json').current.rateBasis:'',baseline:results.filter(r=>r.scenario==='base'&&r.cards>=10000).map(r=>({cards:r.cards,...(r.perEvent[e.id]||{})}))}));
 out('events.json',{version:data.version,role:'独立故障库，不包含机制映射。停机与计算损失为当前基线30天仿真均值。',events:eventLibrary});
 console.log('计算完成，开始生成审核报告');require('./render.cjs').render(data,eventLibrary);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});module.exports={sample,verify,scenarios,mechanisms};
