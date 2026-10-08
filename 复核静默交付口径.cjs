const fs=require('fs'),path=require('path'),assert=require('assert');
const dir=path.join(process.cwd(),'AI集群可靠性评估');
let src=fs.readFileSync(path.join(dir,'三类故障仿真引擎.js'),'utf8');
const needle='return {effective:Math.max(0,correct/T),uptime:uptime/T,';
assert(src.includes(needle));src=src.replace(needle,'return {delivery:epoch?0:Math.max(0,correct/T),cleanEnd:epoch?0:1,effective:Math.max(0,correct/T),uptime:uptime/T,');
const E=new Function('module',src+';return createReliabilityEngine();')({exports:{}});
const params={...E.defaults,fits:E.defaults.fits.map(v=>Number(v.toFixed(6)))},trials=8192;
function stats(a){const m=a.reduce((s,x)=>s+x,0)/a.length;const se=Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)/a.length);return {mean:m,se,low:Math.max(0,m-1.96*se),high:Math.min(1,m+1.96*se)};}
const rows=[],qs=[0,10,20,30,40,50,60,70,80,90,95,99,99.9,100];
for(const n of [10000,100000,200000,500000]){
 for(const mode of ['global','local'])for(const q of qs){const values={retained:[],delivery:[],cleanEnd:[]};for(let i=0;i<trials;i++){
 const r=E.simulate(n,{...params,mode,silentDetect:q},(9137+Math.imul(i+1,2654435761)+n)>>>0);
 values.retained.push(r.effective);values.delivery.push(r.delivery);values.cleanEnd.push(r.cleanEnd);
 }rows.push({n,mode,q,...Object.fromEntries(Object.entries(values).map(([k,a])=>[k,stats(a)]))});}
 console.log('Computed '+n+' cards');
}
// Deterministic semantic tests: a missed corruption invalidates final delivery,
// while detection + verified rollback restores delivery only after recovery.
const p={...params,fits:[0,0,0,0],intervalSeconds:36000,saveSeconds:0};
const missed=E.simulate(1000,p,1,{hours:62,disableRandom:true,events:[{at:11,kind:'silent',detectAfter:Infinity}]});
assert.equal(missed.effective,11/62);assert.equal(missed.delivery,0);assert.equal(missed.cleanEnd,0);
const healed=E.simulate(1000,p,1,{hours:62,disableRandom:true,events:[{at:11,kind:'silent',detectAfter:24}]});
assert.equal(healed.delivery,35/62);assert.equal(healed.cleanEnd,1);
const late=E.simulate(1000,{...p,silentDetect:100},1,{hours:62,disableRandom:true,events:[{at:60,kind:'silent',detectAfter:24}]});
assert.equal(late.delivery,0);
const out={title:'静默错误：保留进度与终态交付口径复核',trials,params,qs,rows,tests:['missed error zeros final delivery but preserves old progress metric','detected and repaired error restores clean delivery','100% eventual detection does not fix an error before the window ends'],definition:'delivery = E[correctProgress(T) * I(no unresolved silent epoch at T)] / T; cleanEnd = P(no unresolved silent epoch at T)'};
fs.writeFileSync(path.join(dir,'静默错误交付口径复核数据.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(rows.filter(r=>r.n===500000&&[0,95,100].includes(r.q)),null,2));
