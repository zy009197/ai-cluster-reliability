const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=__dirname,read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const data=JSON.parse(process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):read('Shapley贡献结果.json'));
const output=process.argv[3]||path.join(dir,'正确有效产出改进分析.html');
for(const n of [10000,100000,200000,500000])if(!data.scale.some(r=>r.n===n)||!data.sweep.some(r=>r.n===n))throw new Error('完整报告需要 1 万、10 万、20 万、50 万卡结果及静默扫描');
const hash=crypto.createHash('sha256').update(['月度训练仿真引擎.js','Shapley贡献计算.js','场景与证据.js'].map(read).join('\n')).digest('hex');
if(data.codeSHA256!==hash)throw new Error('结果与模型代码不一致；请先运行 计算Shapley贡献.cjs');
const script=(name,id)=>'<script'+(id?' id="'+id+'"':'')+'>'+read(name).replace(/<\/script/gi,'<\\/script')+'</script>';
let html=read('报告模板.html').replace('/* STYLE */',read('报告样式.css'))
 .replace('<!-- ENGINE -->',script('月度训练仿真引擎.js','engine'))
 .replace('<!-- ANALYSIS -->',script('Shapley贡献计算.js','analysis'))
 .replace('<!-- DATA -->','<script id="precomputed" type="application/json">'+JSON.stringify(data).replace(/</g,'\\u003c')+'</script>')
 .replace('<!-- REGISTRY -->',script('场景与证据.js','registry'))
 .replace('<!-- EXTENSIONS -->',script('报告扩展界面.js','extensions'))
 .replace('<!-- UI -->',script('报告界面.js','ui'));
fs.writeFileSync(output,html);
if(!process.argv[3]){
fs.writeFileSync(path.join(dir,'Shapley参数示例.json'),JSON.stringify(data.config,null,2));
fs.writeFileSync(path.join(dir,'可靠性场景V4.json'),JSON.stringify(data.scenario,null,2));
}
console.log('已构建自包含 HTML；模型代码摘要 '+hash);
