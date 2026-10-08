function createImprovementAnalysis(E) {
  const defaultConfig={trials:8192,silentHours:24,retentionHours:72,recoveryTarget:15,
    intervalTarget:600,saveTarget:.1,fitTarget:E.defaults.fits.reduce((a,b)=>a+b,0)/2,
    silentDelayTarget:5,silentRepairTarget:15};
  const keys=[10000,100000,200000,500000],qValues=Array.from({length:21},(_,i)=>i*5);
  const copy=p=>({...p,fits:[...p.fits]});
  function run(config={},onProgress=()=>{}) {
    const cfg={...defaultConfig,...config};
    if(!Number.isInteger(cfg.trials)||cfg.trials<2)throw new Error('每情景轨迹数必须为至少 2 的整数');
    const base={...E.defaults,fits:E.defaults.fits.map(v=>Number(v.toFixed(6))),
      silentHours:cfg.silentHours,retentionHours:cfg.retentionHours};
    const settings=[
      {id:'global',name:'全局恢复 · 静默检出 0%',params:copy(base)},
      {id:'local',name:'局部容错 · 静默检出 0%',params:{...copy(base),mode:'local'}},
      {id:'local100',name:'局部容错 · 静默检出 100%',params:{...copy(base),mode:'local',silentDetect:100}}
    ];
    const candidates=[
      {id:'mode',name:'恢复改为局部容错',target:'全局 → 50 域局部',apply:p=>({...copy(p),mode:'local'})},
      {id:'silent',name:'提高静默检出率',target:'0% → 100%；检出延迟保持 '+cfg.silentHours+' h',apply:p=>({...copy(p),silentDetect:100})},
      {id:'recovery',name:'缩短中断/亚健康修复',target:'120 → '+cfg.recoveryTarget+' min；静默修复不变',apply:p=>({...copy(p),globalMinutes:cfg.recoveryTarget,localMinutes:cfg.recoveryTarget})},
      {id:'checkpoint',name:'缩短检查点周期',target:'7,200 → '+cfg.intervalTarget+' s；保存阻塞不变',apply:p=>({...copy(p),intervalSeconds:cfg.intervalTarget})},
      {id:'fit',name:'降低总 FIT',target:'3,415.30 → '+cfg.fitTarget.toFixed(2)+'；来源同比缩放',apply:p=>({...copy(p),fits:p.fits.map(v=>v*cfg.fitTarget/p.fits.reduce((a,b)=>a+b,0))})},
      {id:'save',name:'降低检查点阻塞',target:'10 → '+cfg.saveTarget+' s；周期不变',apply:p=>({...copy(p),saveSeconds:cfg.saveTarget})},
      {id:'hardDetection',name:'提高中断自动检出率',target:'95% → 100%；保留人工恢复',apply:p=>({...copy(p),hardDetect:100})},
      {id:'slowDetection',name:'提高亚健康检出率',target:'95% → 100%；恢复动作不变',apply:p=>({...copy(p),slowDetect:100})},
      {id:'silentDelay',name:'缩短静默检出延迟',target:cfg.silentHours+' h → '+cfg.silentDelayTarget+' min；仅在检出 100% 后比较',apply:p=>({...copy(p),silentHours:cfg.silentDelayTarget/60})},
      {id:'silentRepair',name:'缩短静默修复/加载',target:'120 → '+cfg.silentRepairTarget+' min；回退重算另计',apply:p=>({...copy(p),silentMinutes:cfg.silentRepairTarget})}
    ];
    const jobs=new Map();
    const key=(n,p)=>n+'|'+JSON.stringify(p);
    function request(n,p){const k=key(n,p);if(!jobs.has(k))jobs.set(k,{n,p});return k;}
    const modes=['global','local'];
    const sweepPlan=keys.map(n=>({n,points:qValues.map(q=>({q,refs:modes.map(mode=>request(n,{...copy(base),mode,silentDetect:q}))}))}));
    const scalePlan=E.scales.map(n=>({n,refs:[request(n,base),request(n,{...copy(base),silentDetect:100}),request(n,{...copy(base),mode:'local'}),request(n,{...copy(base),mode:'local',silentDetect:100})]}));
    const rankPlan=keys.map(n=>({n,contexts:settings.map(setting=>{
      const ref=request(n,setting.params);
      return {id:setting.id,name:setting.name,ref,items:candidates.filter(c=>{
        if(c.id==='mode')return setting.id==='global';
        if(c.id==='silent')return setting.id!=='local100';
        if(c.id==='silentDelay'||c.id==='silentRepair')return setting.id==='local100';
        return true;
      }).map(c=>({id:c.id,name:c.name,target:c.target,ref:request(n,c.apply(setting.params))}))};
    })}));
    const cache=new Map();let done=0;
    for(const [k,job]of jobs){
      const values=new Float64Array(cfg.trials);
      for(let i=0;i<cfg.trials;i++)values[i]=E.simulate(job.n,job.p,(9137+Math.imul(i+1,2654435761)+job.n)>>>0).delivery;
      cache.set(k,{values,result:stats(values)});
      onProgress(++done,jobs.size,job.n);
    }
    function stats(values){
      let sum=0,sq=0;for(const v of values){sum+=v;sq+=v*v;}
      const mean=sum/values.length,se=Math.sqrt(Math.max(0,(sq-sum*sum/values.length)/(values.length-1))/values.length);
      return {mean,se,low:mean-1.96*se,high:mean+1.96*se};
    }
    function combine(refs,weights){
      const arrays=refs.map(r=>cache.get(r).values),out=new Float64Array(cfg.trials);
      for(let i=0;i<out.length;i++)for(let j=0;j<weights.length;j++)out[i]+=arrays[j][i]*weights[j];
      return stats(out);
    }
    const sweep=sweepPlan.map(row=>({n:row.n,points:row.points.map(p=>({
      q:p.q,global:cache.get(p.refs[0]).result,local:cache.get(p.refs[1]).result,
      gainGlobal:combine([p.refs[0],row.points[0].refs[0]],[1,-1]),
      gainLocal:combine([p.refs[1],row.points[0].refs[1]],[1,-1])
    }))}));
    const scale=scalePlan.map(row=>({
      n:row.n,base:cache.get(row.refs[0]).result,silent:cache.get(row.refs[1]).result,
      local:cache.get(row.refs[2]).result,both:cache.get(row.refs[3]).result,
      gainSilent:combine([row.refs[1],row.refs[0]],[1,-1]),
      gainLocal:combine([row.refs[2],row.refs[0]],[1,-1]),
      gainBoth:combine([row.refs[3],row.refs[0]],[1,-1]),
      gainSilentAfterLocal:combine([row.refs[3],row.refs[2]],[1,-1]),
      interaction:combine(row.refs,[1,-1,-1,1])
    }));
    const rankings=rankPlan.map(row=>({n:row.n,contexts:row.contexts.map(c=>({
      id:c.id,name:c.name,baseline:cache.get(c.ref).result,
      items:c.items.map(item=>({...item,ref:undefined,result:cache.get(item.ref).result,gain:combine([item.ref,c.ref],[1,-1])})).sort((a,b)=>b.gain.mean-a.gain.mean)
    }))}));
    return {version:'2.1-delivery',metric:'delivery',config:cfg,baseline:base,totalJobs:jobs.size,sweep,scale,rankings,
      assumptions:['交付产出率 = E[正确净进度 × 窗口结束时无未恢复静默污染的指示量] / 720 h；同轨迹联合计算',
        '默认恢复模式为全局，人工恢复检测后 2 h，漏检兜底发现 30 min',
        '静默检出率扫描 0–100%；所有点固定检出延迟与干净检查点保留窗口',
        '局部容错限于中断/亚健康；静默污染仍全局回退',
        '排名只针对列出的目标幅度，不计实现成本；总 FIT 改动按固定三类表现占比同比影响所有事件',
        '置信区间是固定模型下均值的约 95% 点位采样区间；提升及交互项用逐轨迹差值估计方差，不包含参数不确定性']
    };
  }
  return {defaultConfig,keys,qValues,run};
}
if(typeof module!=='undefined')module.exports=createImprovementAnalysis;
