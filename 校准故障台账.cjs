// Read-only calibration: produces evidence, never modifies simulation defaults.
const fs=require('fs');
function calibrate(input){
 if(input.schemaVersion!==1||!Array.isArray(input.exposures)||!Array.isArray(input.events))throw new Error('需要 schemaVersion=1、exposures 和 events 数组');
 const groups=new Map(),ids=new Set(),roots=new Map();
 for(const e of input.exposures){
  if(typeof e.componentClass!=='string'||!e.componentClass||groups.has(e.componentClass))throw new Error('每类 exposure 须唯一且有名称');
  if(!Number.isFinite(e.deviceHours)||e.deviceHours<=0||!['operating','calendar'].includes(e.clock))throw new Error('暴露时长须为正数，clock 为 operating/calendar');
  groups.set(e.componentClass,{...e,observedRootEvents:0,alarms:0,manifestations:{hard:0,slow:0,silent:0}});
 }
 for(const e of input.events){
  if(!e.eventId||!e.rootEventId||ids.has(e.eventId))throw new Error('事件须有唯一 eventId 和 rootEventId');ids.add(e.eventId);
  if(!groups.has(e.componentClass)||!['hard','slow','silent'].includes(e.manifestation))throw new Error('事件缺少匹配 exposure 或合法 manifestation');
  const g=groups.get(e.componentClass);g.alarms++;
  if(roots.has(e.rootEventId)){const old=roots.get(e.rootEventId);if(old.componentClass!==e.componentClass||old.manifestation!==e.manifestation)throw new Error('同一根因事件的归属冲突：'+e.rootEventId);continue;}
  roots.set(e.rootEventId,e);g.observedRootEvents++;g.manifestations[e.manifestation]++;
 }
 const rows=Array.from(groups.values()).map(g=>({...g,observedFIT:g.observedRootEvents/g.deviceHours*1e9,
  observedMTBFHours:g.observedRootEvents?g.deviceHours/g.observedRootEvents:null,
  zeroEventUpper95FIT:g.observedRootEvents===0?-Math.log(.05)/g.deviceHours*1e9:null}));
 return {schemaVersion:1,synthetic:input.synthetic===true,status:input.synthetic?'合成样例，不能用于现场校准结论':'待审核数据',rows,
  limitations:['仅按已给出的根因 ID 去重，不自动推断根因；输入需覆盖同一统计窗口。',
   'FIT 分母为该类设备暴露小时之和；运行时钟与日历时钟分开使用。',
   '这是已观测事件率，漏记和漏检会导致低估；不能用已检出日志反推静默检出率。',
   '0 事件不等于故障率为 0；给出独立齐次 Poisson 假设下一侧 95% 上界。',
   '不自动覆盖模型；HBM/GPU/服务器等类目必须先消除嵌套和根因重复。']};
}
if(require.main===module){const args=process.argv.slice(2);if(args.length!==2)throw new Error('用法：node 校准故障台账.cjs 输入.json 输出.json');fs.writeFileSync(args[1],JSON.stringify(calibrate(JSON.parse(fs.readFileSync(args[0],'utf8'))),null,2));}
module.exports=calibrate;
