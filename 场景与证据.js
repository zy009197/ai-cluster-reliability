function createScenarioRegistry(){
  const schemaVersion=1;
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
  const evidence=[
    {parameter:'万卡硬中断 MTBF、每机 8 卡、30 天窗口',status:'用户基线',source:'本任务用户确认；不是厂商规格或现场校准结果'},
    {parameter:'故障类型 2% / 0.4%、检测延迟、人工恢复、5 天兜底',status:'用户场景',source:'本任务逐项确认；静默漏检恢复保留污染前进度'},
    {parameter:'HBM / GPU / 网络 / 其他 FIT 分解',status:'情景分摊',source:'将万卡 MTBF 归一化后分摊；不是独立器件 FIT 实测值'},
    {parameter:'1 秒 step、定位/验证/恢复成功率、监测开销',status:'待校准假设',source:'无现场样本；100% 成功率代表理想能力'},
    {parameter:'每柜 32 台、恢复域部署、容量阈值、恢复并发',status:'拓扑与策略假设',source:'可计算模板；尚无实际资产/网络映射'},
    {parameter:'附加服务器 / 机柜 / 共享 FIT',status:'未纳入、未校准',source:'默认 0；与单卡等效 FIT 中已计事件不能重复累加'},
    {parameter:'Shapley 8 项目标',status:'评估方案',source:'目标组合决定贡献分配，不代表已经实施或已测得的收益'}
  ];
  function scenario(config,modelVersion,codeSHA256){return {schemaVersion,modelVersion,codeSHA256,config,evidence};}
  function parseScenario(value,A,modelVersion){
    if(!value||value.schemaVersion!==schemaVersion||value.modelVersion!==modelVersion)throw new Error('场景格式或模型版本不匹配；请使用本版导出的场景');
    return A.setup(value.config).config;
  }
  return {schemaVersion,canonical,evidence,scenario,parseScenario};
}
if(typeof module!=='undefined')module.exports=createScenarioRegistry;
