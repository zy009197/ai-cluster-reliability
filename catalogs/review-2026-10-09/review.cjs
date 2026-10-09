// 独立复核入口：可重复运行，不修改源故障预算与已确认基线。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const A=require('./analyze.cjs'),E=require('./engine.cjs');
const d=require('./results.json');
const checks=A.verify();
for(const r of d.results){assert.ok(Math.abs(r.mean*720+Object.values(r.ledger).reduce((a,b)=>a+b,0)-720)<1e-6);for(const k of ['downtime','rollback','slowdown','localLoss','terminalInvalid'])assert.ok(Math.abs(Object.values(r.perEvent).reduce((s,e)=>s+(e[k]||0),0)-r.ledger[k])<1e-6);}
checks.push({name:'第三轮结果审视：55组场景逐事件损失与720小时总账一致',pass:true});
for(const m of d.mechanisms){for(const id of m.eventIds)assert.ok(E.events.some(e=>e.id===id));if(['R-REPLAY','R-PROCESS','R-ELASTIC'].includes(m.id))assert.ok(m.eventIds.every(id=>id.endsWith('-hard')));if(m.id==='R-ELASTIC')assert.ok(m.eventIds.every(id=>!['rack','job'].includes(E.events.find(e=>e.id===id).scope)));}
checks.push({name:'第四轮覆盖审视：所有机制引用存在；机柜/共享故障不混入局部恢复',pass:true});
const html=fs.readFileSync(path.join(__dirname,'故障事件与可靠性机制收益审核.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
// 离线执行交互脚本，仅核对生成内容和筛选结果，不启动或控制浏览器。
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='eventType'?'all':id==='eventSearch'?'':'500000',checked:false,innerHTML:'',textContent:'',handlers:{},addEventListener(k,fn){this.handlers[k]=fn;}});return nodes.get(id);}
const selectors=d.mechanisms.filter(m=>m.scenario&&m.scenario!=='base').map(m=>({...node('select-'+m.id),dataset:{mechanism:m.id}}));
const document={querySelector:s=>node(s.slice(1)),getElementById:node,querySelectorAll:s=>s==='.impactScale'?selectors:[]};
vm.runInNewContext(script,{document,console});
assert.equal((node('eventRows').innerHTML.match(/<tr>/g)||[]).length,54);
node('eventType').value='sdc';node('hideZero').checked=true;node('eventType').handlers.input();assert.equal((node('eventRows').innerHTML.match(/<tr>/g)||[]).length,6);
node('rankScale').value='10000';node('rankScale').handlers.change();assert.ok(node('ranking').innerHTML.includes('静默检出95%'));
node('shapleyScale').value='200000';node('shapleyScale').handlers.change();assert.ok(node('shapleySummary').textContent.includes('贡献合计相等'));
for(const s of selectors){s.value='100000';s.handlers.change();assert.ok(node('impact-'+s.dataset.mechanism).innerHTML.includes('CORE-hard'));}
checks.push({name:'第五轮离线界面检查：内嵌脚本执行、54条事件筛选、规模切换与逐机制对照通过',pass:true});
const source=require('./inputs.json').current;
assert.ok(source.events.filter(e=>e.type==='静默'&&e.fit===0).length===12);
checks.push({name:'初始输入完整保留：54条事件、12条SDC零预算不变',pass:true});
fs.writeFileSync(path.join(__dirname,'review-checks.json'),JSON.stringify({checks,uiMethod:'离线脚本与生成内容验证；未宣称浏览器视觉验收'},null,2));
console.log(JSON.stringify({checks:checks.length,status:'passed'},null,2));
