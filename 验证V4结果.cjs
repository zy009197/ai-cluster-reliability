const fs=require('fs'),assert=require('assert'),crypto=require('crypto'),path=require('path');
const dir=__dirname,d=JSON.parse(fs.readFileSync(path.join(dir,'Shapley贡献结果.json'),'utf8')),R=require('./场景与证据.js')(),E=require('./月度训练仿真引擎.js')();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex'),close=(a,b,t=1e-8)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
assert.equal(d.codeSHA256,digest(['月度训练仿真引擎.js','Shapley贡献计算.js','场景与证据.js'].map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n')));
assert.equal(d.scenarioSHA256,digest(R.canonical(d.scenario)));assert.equal(d.experimentSHA256,digest(R.canonical(d.experiment)));assert.deepEqual(d.config,d.scenario.config);assert.deepEqual(d.experiment.scales,d.scale.map(r=>r.n));
let maxLedgerResidual=0,maxShapleyResidual=0;
for(const r of d.scale){
 assert.equal(r.coalitions.length,256);close(r.contributions.reduce((s,c)=>s+c.shapley.mean,0),r.all.mean-r.base.mean);
 maxShapleyResidual=Math.max(maxShapleyResidual,Math.abs(r.residual));
 for(const v of r.coalitions){assert(v.mean>=0&&v.mean<=1);assert(v.se>=0);assert(v.low<=v.mean&&v.high>=v.mean);}
 for(const key of ['base','all']){const g=r.diagnostics[key],ledger=g.ledger;close(ledger.delivered/720,r[key].mean);close(ledger.grossWork-ledger.rollback,ledger.delivered+ledger.terminalDiscard+ledger.unrecoveredCorruptWork);
  close(Object.entries(ledger).filter(([k])=>!['grossWork','residual'].includes(k)).reduce((s,[,v])=>s+v,0),720);maxLedgerResidual=Math.max(maxLedgerResidual,Math.abs(ledger.residual));
  const v=g.delivery;assert(v.p05<=v.p50&&v.p50<=v.p95);assert(v.p05>=0&&v.p95<=1);
 }
}
const html=fs.readFileSync(path.join(dir,'正确有效产出改进分析.html'),'utf8');assert.deepEqual(JSON.parse(html.match(/<script id="precomputed" type="application\/json">([\s\S]*?)<\/script>/)[1]),d);
const summary={status:'passed',version:E.version,scales:d.scale.length,combinations:d.scale.length*256,totalJobs:d.totalJobs,trials:d.config.trials,maxLedgerResidual,maxShapleyResidual,codeSHA256:d.codeSHA256,checks:['source hash and experiment identity','all coalition ranges','Shapley efficiency','progress reconciliation','720 hour ledger conservation','quantile ordering','HTML and CLI embedded data match']};
fs.writeFileSync(path.join(dir,'V4数值验证结果.json'),JSON.stringify(summary,null,2));console.log(summary);
