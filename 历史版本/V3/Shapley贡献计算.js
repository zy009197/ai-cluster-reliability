function createShapleyAnalysis(E) {
  const defaults={trials:2048,stepSeconds:1,silentDetectSeconds:1,silentRecoverySeconds:1,
    silentFallbackDays:5,fallbackDistribution:'fixed',silentTarget:95,
    recoveryTarget:15,intervalTarget:600,saveTarget:.1,
    fitTarget:E.defaults.fits.reduce((a,b)=>a+b,0)/2};
  const keyScales=[10000,100000,200000,500000],qValues=Array.from({length:21},(_,i)=>i*5);
  function stats(values){let s=0,sq=0;for(const v of values){s+=v;sq+=v*v;}const mean=s/values.length,se=Math.sqrt(Math.max(0,(sq-s*s/values.length)/(values.length-1))/values.length);return {mean,se,low:mean-1.96*se,high:mean+1.96*se};}
  function bitCount(x){let c=0;while(x){x&=x-1;c++;}return c;}
  function choose(n,k){let r=1;for(let j=1;j<=k;j++)r=r*(n-j+1)/j;return r;}
  // Each input is a complete coalition value. This exact subset sum averages all m! orders.
  function shapleyValues(values,m){
    if(values.length!==2**m)throw new Error('组合数量必须为 2^m');
    const out=new Float64Array(m);
    for(let i=0;i<m;i++)for(let s=0;s<values.length;s++)if(!(s&(1<<i)))out[i]+=(values[s|(1<<i)]-values[s])/(m*choose(m-1,bitCount(s)));
    return out;
  }
  function setup(config={}){
    const c={...defaults,...config};
    if(!Number.isInteger(c.trials)||c.trials<2)throw new Error('采样次数必须是至少 2 的整数');
    for(const k of ['stepSeconds','silentDetectSeconds','silentRecoverySeconds','silentFallbackDays','recoveryTarget','intervalTarget','saveTarget','fitTarget','silentTarget'])if(!Number.isFinite(c[k])||c[k]<0)throw new Error('无效参数：'+k);
    if(c.stepSeconds<=0||c.intervalTarget<=0||c.silentTarget>100)throw new Error('step 和检查点周期必须大于零，检出率不得超过 100%');
    if(!['fixed','exponential'].includes(c.fallbackDistribution))throw new Error('不支持的兜底时间分布');
    const baseline={...E.defaults,fits:E.defaults.fits.map(v=>Number(v.toFixed(6))),
      stepSeconds:c.stepSeconds,silentHours:c.silentDetectSeconds/3600,silentMinutes:c.silentRecoverySeconds/60,
      silentFallbackHours:c.silentFallbackDays*24,fallbackDistribution:c.fallbackDistribution};
    const factors=[
      {id:'silent',name:'静默即时检出率',target:'0% → '+c.silentTarget+'%',patch:{silentDetect:c.silentTarget}},
      {id:'mode',name:'局部弹性容错',target:'全局 → 50 域局部',patch:{mode:'local'}},
      {id:'recovery',name:'中断/亚健康恢复',target:'120 → '+c.recoveryTarget+' min',patch:{globalMinutes:c.recoveryTarget,localMinutes:c.recoveryTarget}},
      {id:'checkpoint',name:'检查点周期',target:'7200 → '+c.intervalTarget+' s',patch:{intervalSeconds:c.intervalTarget}},
      {id:'fit',name:'总 FIT',target:'3415.30 → '+c.fitTarget.toFixed(2),patch:{fits:baseline.fits.map(v=>v*c.fitTarget/baseline.fits.reduce((a,b)=>a+b,0))}},
      {id:'save',name:'检查点保存阻塞',target:'10 → '+c.saveTarget+' s',patch:{saveSeconds:c.saveTarget}},
      {id:'hardDetection',name:'中断自动检出率',target:'95% → 100%',patch:{hardDetect:100}},
      {id:'slowDetection',name:'亚健康检出率',target:'95% → 100%',patch:{slowDetect:100}}
    ];
    function params(mask){let p={...baseline};factors.forEach((f,i)=>{if(mask&(1<<i))p={...p,...f.patch};});return p;}
    return {config:c,baseline,factors,params};
  }
  function run(config={},onProgress=()=>{},scales=E.scales){
    const {config:c,baseline,factors,params}=setup(config),m=factors.length,count=2**m;
    if(!Array.isArray(scales)||!scales.length||scales.some(n=>!Number.isInteger(n)||n<=0))throw new Error('卡数必须是正整数数组');
    const rows=[],sweep=[];let done=0;
    const total=scales.length*count+scales.filter(n=>keyScales.includes(n)).length*(qValues.length-1-(qValues.includes(c.silentTarget)&&c.silentTarget!==0?1:0))*2;
    const samples=(n,p)=>{const a=new Float64Array(c.trials);for(let i=0;i<a.length;i++)a[i]=E.simulate(n,p,(9137+Math.imul(i+1,2654435761)+n)>>>0,{hours:720}).delivery;return a;};
    const diff=(a,b)=>{const d=new Float64Array(a.length);for(let i=0;i<d.length;i++)d[i]=a[i]-b[i];return stats(d);};
    for(const n of scales){
      const values=[];
      for(let mask=0;mask<count;mask++){values.push(samples(n,params(mask)));onProgress({done:++done,total,n,phase:'coalitions'});}
      const estimates=values.map(stats),contributions=[];
      for(let i=0;i<m;i++){
        const a=new Float64Array(c.trials);
        for(let mask=0;mask<count;mask++)if(!(mask&(1<<i))){const w=1/(m*choose(m-1,bitCount(mask))),lo=values[mask],hi=values[mask|(1<<i)];for(let j=0;j<a.length;j++)a[j]+=w*(hi[j]-lo[j]);}
        contributions.push({...factors[i],patch:undefined,shapley:stats(a),standalone:diff(values[1<<i],values[0]),last:diff(values[count-1],values[(count-1)^(1<<i)])});
      }
      const gain=diff(values[count-1],values[0]),residual=contributions.reduce((s,f)=>s+f.shapley.mean,0)-gain.mean;
      if(Math.abs(residual)>1e-10)throw new Error('Shapley 加和验证失败');
      rows.push({n,base:estimates[0],silent:estimates[1],local:estimates[2],both:estimates[3],all:estimates[count-1],gain,residual,contributions,coalitions:estimates});
      if(keyScales.includes(n)){
        const points=[];
        for(const q of qValues){const point={q};for(const mode of ['global','local']){
          const baseMask=mode==='global'?0:2;
          const a=q===0?values[baseMask]:q===c.silentTarget?values[baseMask|1]:samples(n,{...baseline,mode,silentDetect:q});
          point[mode]=stats(a);point[mode+'Gain']=diff(a,values[baseMask]);
          if(q!==0&&q!==c.silentTarget)onProgress({done:++done,total,n,phase:'sweep'});
        }points.push(point);}sweep.push({n,points});
      }
    }
    return {version:'3.0-step-shapley',metric:'delivery',hours:720,config:c,baseline,factors:factors.map(({patch,...f})=>f),scale:rows,sweep,totalJobs:done,
      assumptions:['所有组合共享新的故障处理规则；Shapley 不归因统计口径变化',
        '即时检出回退至错误前 step；漏检后兜底回到污染前的永久干净检查点',
        '尚未检出的首次污染不会被后续另一条 step 告警自动清除',
        '5 天默认以固定延迟近似平均值，可切换均值 5 天的指数分布',
        'step 默认 1 s，静默检测 1 s，恢复准备 1 s；重算损失另外计入进度，不计 2 h 人工恢复',
        'step 重放状态可用性为模型假设；周期检查点保存开销仍显式计入，额外 step 状态管理成本未标定',
        '50 域局部隔离为理想假设，静默污染仍全局回退；不包含维修队列、带宽争用和共同原因故障',
        'Shapley 枚举全部组合；交付值为蒙特卡洛估计。置信区间仅反映采样误差，不含参数和模型不确定性']};
  }
  return {defaults,keyScales,qValues,setup,run,shapleyValues,stats};
}
if(typeof module!=='undefined')module.exports=createShapleyAnalysis;
