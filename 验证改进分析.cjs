const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto'),vm=require('vm');
const E=require('./三类故障仿真引擎.js')(),A=require('./改进方向计算.js')(E);
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'正确有效产出改进分析数据.json'),'utf8'));
const html=fs.readFileSync(path.join(__dirname,'正确有效产出改进分析.html'),'utf8');
const close=(a,b)=>assert(Math.abs(a-b)<1e-10,a+' != '+b);
assert.equal(data.metric,'delivery');
const plain={...E.defaults,fits:[0,0,0,0],saveSeconds:0,intervalSeconds:7200};
const missed=E.simulate(10000,plain,1,{hours:62,disableRandom:true,events:[{at:11,kind:'silent'}]});
close(missed.effective,11/62);close(missed.delivery,0);assert.equal(missed.cleanEnd,0);
for(const hours of [36,62]){
 const healed=E.simulate(10000,plain,1,{hours,disableRandom:true,events:[{at:11,kind:'silent',detectAfter:24}]});
 close(healed.delivery,hours===36?0:35/62);
}
const late=E.simulate(10000,{...plain,silentDetect:100},1,{hours:62,disableRandom:true,events:[{at:60,kind:'silent',detectAfter:24}]});
close(late.delivery,0);close(E.simulate(10000,plain).delivery,1);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'三类故障仿真引擎.js'))).digest('hex'),data.engineSHA256);
assert.deepEqual(data.baseline,{...E.defaults,fits:E.defaults.fits.map(v=>Number(v.toFixed(6)))});
for(const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(!script[1].includes('application/json'))new vm.Script(script[2]);
for(const r of data.scale){
 for(const key of ['base','silent','local','both']){assert(r[key].mean>=0&&r[key].mean<=1);assert(r[key].se>=0);}
 close(r.gainBoth.mean,r.both.mean-r.base.mean);
 close(r.gainSilentAfterLocal.mean,r.both.mean-r.local.mean);
 close(r.gainLocal.mean+r.gainSilentAfterLocal.mean,r.gainBoth.mean);
 close(r.interaction.mean,r.both.mean-r.silent.mean-r.local.mean+r.base.mean);
}
for(const sweep of data.sweep){
 const s=data.scale.find(s=>s.n===sweep.n),first=sweep.points[0],last=sweep.points.at(-1);
 assert.equal(sweep.points.length,21);assert.equal(last.q,100);close(first.global.mean,s.base.mean);close(first.local.mean,s.local.mean);
 close(last.global.mean,s.silent.mean);close(last.local.mean,s.both.mean);
 for(const p of sweep.points){close(p.gainGlobal.mean,p.global.mean-first.global.mean);close(p.gainLocal.mean,p.local.mean-first.local.mean);}
 assert.equal(first.gainGlobal.se,0);assert.equal(first.gainLocal.se,0);
}
for(const r of data.rankings)for(const c of r.contexts){
 const expected=data.scale.find(s=>s.n===r.n)[{global:'base',local:'local',local100:'both'}[c.id]];
 close(c.baseline.mean,expected.mean);
 c.items.forEach((item,i)=>{close(item.gain.mean,item.result.mean-c.baseline.mean);if(i)assert(c.items[i-1].gain.mean>=item.gain.mean);});
}
assert.throws(()=>A.run({trials:0}),/至少 2/);
const smoke=A.run({trials:8,recoveryTarget:120,intervalTarget:7200,saveTarget:10,fitTarget:data.baseline.fits.reduce((a,b)=>a+b,0)});
for(const row of smoke.rankings)for(const c of row.contexts)for(const item of c.items)if(['recovery','checkpoint','save','fit'].includes(item.id)){close(item.gain.mean,0);close(item.gain.se,0);}
const audit=JSON.parse(fs.readFileSync(path.join(__dirname,'静默错误交付口径复核数据.json'),'utf8'));
for(const r of audit.rows){const p=data.sweep.find(s=>s.n===r.n).points.find(p=>p.q===r.q);if(p)close(p[r.mode].mean,r.delivery.mean);}
for(const sid of ['model-core','analysis-core']){
 const name=sid==='model-core'?'三类故障仿真引擎.js':'改进方向计算.js';
 const embedded=html.match(new RegExp('<script id="'+sid+'">([\\s\\S]*?)</script>'))[1].trim();
 assert.equal(embedded,fs.readFileSync(path.join(__dirname,name),'utf8').trim());
}
const out={status:'passed',checks:['baseline equals V2 defaults','delivery zeros unresolved silent corruption','delivery remains zero during silent repair','verified recovery restores delivery','late 100% detection does not imply recovery by deadline','engine hash matches source','embedded code equals source','sweep endpoints include 100% and match scale scenarios','all shared points equal independent delivery audit','gain and interaction identities','ranking references and ordering','zero-change targets give zero gain and variance','invalid sample count rejected'],scenarios:data.totalJobs,trials:data.config.trials};
fs.writeFileSync(path.join(__dirname,'改进分析数值验证结果.json'),JSON.stringify(out,null,2));console.log(out);
