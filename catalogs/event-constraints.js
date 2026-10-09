// 浏览器与工程共用的故障预算约束；只调整类内分配，不改变类别总故障率。
function createEventConstraints() {
  const policy=Object.freeze({version:'event-budget-v3-sdc1.4',referenceCards:10000,hardMtbfHours:30,
    shares:Object.freeze({'中断':.966,'亚健康':.02,'静默':.014}),coreId:'CORE-sdc',coreSilentShare:.85,
    zeroSilentIds:Object.freeze(['SRAM-sdc','MODULE-sdc','MEMT-sdc','MEMP-sdc','CPU-sdc','DDR-sdc','SSD-sdc','MGMT-sdc','STORAGE-sdc','OPT-sdc','POWER-sdc','COOL-sdc'])});
  const totalFit=1e9/(policy.referenceCards*policy.hardMtbfHours*policy.shares['中断']);
  function totals(events){return Object.fromEntries(Object.keys(policy.shares).map(t=>[t,events.filter(e=>e.type===t).reduce((s,e)=>s+e.fit,0)]));}
  function enforce(events){
    const rows=events.map(e=>({...e})),ids=new Set();
    for(const e of rows){if(ids.has(e.id))throw Error('重复 ID：'+e.id);ids.add(e.id);
      if(!Object.hasOwn(policy.shares,e.type)||!Number.isFinite(e.fit)||e.fit<0)throw Error(e.id+'：类型或 FIT 无效');
      if(policy.zeroSilentIds.includes(e.id)){if(e.type!=='静默')throw Error(e.id+'：已审计为静默类零预算事件，不能修改类型');e.fit=0;}
    }
    const core=rows.find(e=>e.id===policy.coreId);if(!core||core.type!=='静默')throw Error('必须保留 CORE-sdc 静默事件');
    const allocate=(subset,budget)=>{const sum=subset.reduce((s,e)=>s+e.fit,0);if(!Number.isFinite(sum)||sum<=0)throw Error('该类正预算缺少非零分配权重');for(const e of subset)e.fit=e.fit/sum*budget;};
    for(const type of ['中断','亚健康'])allocate(rows.filter(e=>e.type===type),totalFit*policy.shares[type]);
    allocate(rows.filter(e=>e.type==='静默'&&e.id!==policy.coreId),totalFit*policy.shares['静默']*(1-policy.coreSilentShare));
    core.fit=totalFit*policy.shares['静默']*policy.coreSilentShare;
    assertValid(rows);return rows;
  }
  function assertValid(rows){
    const sums=totals(rows);
    for(const [type,share] of Object.entries(policy.shares))if(Math.abs(sums[type]-totalFit*share)>1e-8)throw Error(type+'预算不满足固定比例');
    const core=rows.find(e=>e.id===policy.coreId);
    if(!core||Math.abs(core.fit/sums['静默']-policy.coreSilentShare)>1e-10)throw Error('AI Core 静默占比不满足85%');
    for(const e of rows)if(policy.zeroSilentIds.includes(e.id)&&e.fit!==0)throw Error(e.id+'必须保持零预算');
    return sums;
  }
  return {policy,totalFit,totals,enforce,assertValid};
}
if(typeof module!=='undefined')module.exports=createEventConstraints();
