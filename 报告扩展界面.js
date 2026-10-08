function createSystemPanels({E,A,R,getData,importConfig,codeSHA256,$,f,pct,table,canvas,el,text}){
 const groups=[
  ['事件发生与基线',[
   ['fit0','HBM 单卡等效 FIT',0],['fit1','GPU 单卡等效 FIT',0],['fit2','网络单卡等效 FIT',0],['fit3','其他单卡等效 FIT',0],
   ['slowPct','亚健康占比 / %',0,100],['silentPct','静默占比 / %',0,100],
   ['hardDetect','中断自动检出率 / %',0,100],['hardSeconds','中断自动发现 / s',0],['fallbackMinutes','中断超时发现 / min',0],
   ['slowDetect','亚健康检出率 / %',0,100],['slowMinutes','亚健康发现 / min',0],['slowHours','未检出亚健康持续 / h',0],['slowLoss','每次亚健康吞吐损失 / %',0,100],
   ['globalMinutes','全局人工恢复基线 / min',0],['localMinutes','局部人工恢复基线 / min',0],['intervalSeconds','持久化 CP 周期基线 / s',.001],['saveSeconds','持久化 CP 阻塞基线 / s',0]]],
  ['拓扑与共享故障（待校准）',[
   ['cardsPerServer','每服务器卡数',1,10000,1],['serversPerRack','每机柜服务器数',1,10000,1],['recoveryDomains','局部恢复域数量',1,1000,1],
   ['placement','卡在恢复域中的部署',[['compact','连续部署'],['striped','跨域交错部署']]],
   ['networkScope','网络中断影响范围',[['card','单卡'],['server','服务器'],['rack','机柜'],['job','全作业']]],
   ['otherScope','其他中断影响范围',[['card','单卡'],['server','服务器'],['rack','机柜'],['job','全作业']]],
   ['serverFIT','附加每服务器 FIT',0],['rackFIT','附加每机柜 FIT',0],['sharedFIT','全作业共享 FIT',0]]],
  ['恢复约束与静默保障（待校准）',[
   ['repairSlots','并发恢复任务数（0=无限）',0,10000,1],['minActiveFraction','最低可训练容量比例 / 0–1',0,1],['reconfigureSeconds','局部恢复引发全局停顿 / s',0],
   ['silentLocatePct','静默污染起点定位成功率 / %',0,100],['cleanVerifyPct','干净恢复点验证成功率 / %',0,100],['silentRecoveryPct','静默恢复成功率 / %',0,100],
   ['silentMonitorPct','启用静默即时监测的吞吐开销 / %',0,100],['replayRate','重放相对吞吐 / 0–1',0,1]]]
 ];
 const defs=groups.flatMap(g=>g[1]);let model={...getData().config.model};
 const dirty=()=>{$('#status').textContent='参数已修改，图表保留上次完整结果；点击刷新应用。';$('#error').textContent='';};
 for(const [title,fields]of groups){const h=document.createElement('h3');h.textContent=title;const box=document.createElement('div');box.className='controls';$('#model-controls').append(h,box);
  for(const [k,label,min,max,step]of fields){const lab=document.createElement('label');lab.textContent=label;const select=Array.isArray(min),input=document.createElement(select?'select':'input');input.id='model-'+k;input.setAttribute('aria-label',label);
   if(select)for(const [v,t]of min){const o=document.createElement('option');o.value=v;o.textContent=t;input.append(o);}else{input.type='number';input.min=min;input.step=step||'any';if(max!==undefined)input.max=max;}
   lab.append(input);box.append(lab);input.addEventListener('input',()=>{dirty();fitDraft();});
  }
 }
 const fitNote=document.createElement('p');fitNote.id='fit-derived';fitNote.className='small';$('#model-controls').prepend(fitNote);
 function fitDraft(){const vals=[0,1,2,3].map(i=>+$('#model-fit'+i).value),total=vals.reduce((a,b)=>a+b,0);fitNote.textContent='草稿单卡等效总 FIT '+f(total,6)+'；'+vals.map((v,i)=>['HBM','GPU','网络','其他'][i]+'：占 '+(total?pct(v/total):'—')+'，独立等效 MTBF '+(v?f(1e9/v)+' h':'∞')).join('；')+'。组件占比由 FIT 动态计算，不是另一个输入。';}
 function setModel(m){model={...m};for(const [k,,min]of defs){const v=k.startsWith('fit')?m.fits[+k.slice(3)]:m[k];$('#model-'+k).value=Array.isArray(min)?v:Number(v.toFixed(6));}fitDraft();}
 function readModel(){const out={...model,fits:[0,1,2,3].map(i=>+$('#model-fit'+i).value)};for(const [k,,min]of defs)if(!k.startsWith('fit'))out[k]=Array.isArray(min)?$('#model-'+k).value:+$('#model-'+k).value;return out;}
 setModel(model);
 function drawTopology(){const d=getData(),n=+$('#size').value,p=d.baseline,t=E.topology(n,p),{svg,w}=canvas('#topology-plot',330,'设备与恢复域依赖图'),gap=18,bw=(w-62-3*gap)/4;
  const boxes=[['训练任务',f(n)+' 卡 / 720 h'],['机柜层',f(t.racks)+' 柜'],['服务器层',f(t.servers)+' 台'],['加速卡层',p.cardsPerServer+' 卡 / 服务器']];
  boxes.forEach(([a,b],i)=>{const x=31+i*(bw+gap);svg.append(el('rect',{x,y:30,width:bw,height:77,rx:5,fill:'#f4f7fa',stroke:'#afc2d1'}));text(svg,x+bw/2,60,a,{'text-anchor':'middle','font-size':16,'font-weight':600});text(svg,x+bw/2,87,b,{'text-anchor':'middle'});if(i<3)text(svg,x+bw+gap/2,73,'→',{'text-anchor':'middle','font-size':18});});
  text(svg,32,141,'故障根因及影响范围：单卡 / 服务器 / 机柜 / 全作业共享',{'font-size':14});
  svg.append(el('path',{d:'M '+w/2+' 151 V 174 H 31 V 208 M '+w/2+' 174 H '+(w/2+12)+' V 208',stroke:'#879cac',fill:'none'}));
  for(const [i,title,line1,line2]of [[0,'全局恢复','任意中断 → 全作业停顿与 CP 回退','共享背景事件在停顿期间仍可发生'],[1,'局部恢复 · '+t.domains+' 个域',(p.placement==='compact'?'连续部署':'交错部署')+' · 每域 '+Math.min(...t.sizes)+'–'+Math.max(...t.sizes)+' 卡','首柜故障 → '+t.impacted('rack',0).length+' 个恢复域受影响']]){const x=31+i*(w-62)/2;svg.append(el('rect',{x,y:205,width:(w-80)/2,height:102,rx:5,fill:i?'#eaf6f3':'#eef3f9',stroke:i?'#087f76':'#2864a0'}));text(svg,x+15,230,title,{'font-size':16,'font-weight':600});text(svg,x+15,259,line1,{'font-size':12});text(svg,x+15,285,line2,{'font-size':12});}
  $('#topology-summary').textContent='已应用：'+(p.repairSlots?p.repairSlots+' 个并发恢复任务':'恢复并发暂无限制')+'；最低运行容量 '+pct(p.minActiveFraction)+'；局部恢复全局停顿 '+f(p.reconfigureSeconds)+' s。首台服务器中断影响 '+t.impacted('server',0).length+' 域，首机柜中断影响 '+t.impacted('rack',0).length+' 域，共享中断影响全部 '+t.domains+' 域。';
  const ns=[10000,100000,500000],rates=ns.map(n=>E.summary(p,n));
  table('#rate-table',[['全类事件 MTBF / h',...rates.map(r=>Number.isFinite(r.mtbf)?f(r.mtbf,3):'∞')],['硬中断 MTBF / h',...rates.map(r=>Number.isFinite(r.hardMtbf)?f(r.hardMtbf,3):'∞')],['单卡等效运行事件率 / h',...rates.map(r=>f(r.componentRate,5))],['附加日历事件率 / h',...rates.map(r=>f(r.backgroundRate,5))],['按事件率加权自动检出率',...rates.map(r=>pct(r.auto))]]);
 }
 const items=[['pause','停顿（含容量不足等待）','#8195a6'],['checkpointSave','保存检查点阻塞','#9bb4c9'],['unavailableCapacity','局部停机的容量损失','#d3a86d'],['slowdown','亚健康吞吐损失','#cf8b64'],['monitoring','即时监测开销','#977fb2'],['replaySlowdown','重放额外降速','#bb9ac7'],['rollback','实际回退删除的计算','#b7615c'],['unrecoveredCorruptWork','月底尚未恢复的错误计算','#d39090'],['terminalDiscard','污染终态导致其余进度判废','#8d4949'],['delivered','最终正确可交付净进度','#087f76']];
 function drawLedger(){const r=getData().scale.find(r=>r.n===+$('#size').value),a=r.diagnostics.base,b=r.diagnostics.all,{svg,w}=canvas('#ledger-plot',390,'月度训练时间损失账本'),left=95,right=25,scale=(w-left-right)/720;
  text(svg,24,30,'720 h = 互斥损失 + 正确交付净进度',{'font-size':17,'font-weight':600});
  for(const [index,diag,label]of [[0,a,'基线'],[1,b,'全部改进']]){const y=65+index*63;let pos=left;text(svg,20,y+23,label,{'font-size':13});for(const [key,name,color]of items){const v=diag.ledger[key],rect=el('rect',{x:pos,y,width:v*scale,height:33,fill:color,'data-ledger-key':key,'data-hours':v});rect.append(el('title',{},name+'：'+f(v,4)+' h'));svg.append(rect);pos+=v*scale;}}
  for(let i=0;i<=4;i++)text(svg,left+(w-left-right)*i/4,181,(180*i)+' h',{'text-anchor':i===0?'start':i===4?'end':'middle','font-size':12});
  items.forEach(([key,label,color],i)=>{const col=i%2,row=Math.floor(i/2),x=24+col*(w-48)/2,y=215+row*31;svg.append(el('rect',{x,y:y-11,width:13,height:13,fill:color}));text(svg,x+21,y,label,{'font-size':12});});
  table('#ledger-table',items.map(([k,label])=>[label,f(a.ledger[k],4),f(b.ledger[k],4),(b.ledger[k]-a.ledger[k]>=0?'+':'')+f(b.ledger[k]-a.ledger[k],4)]));
  $('#ledger-balance').textContent='守恒残差：基线 '+a.ledger.residual.toExponential(2)+' h；全部改进 '+b.ledger.residual.toExponential(2)+' h。grossWork 包含重复计算，仅用于诊断，不重复加入本表。';
  table('#distribution-table',[['时间可运行比例',pct(a.uptime),pct(b.uptime)],['作业可运行容量比例',pct(a.capacity),pct(b.capacity)],['月底无未恢复污染概率',pct(a.cleanEnd),pct(b.cleanEnd)],...['p05','p50','p95'].map(k=>['单次任务正确产出 '+k.toUpperCase(),pct(a.delivery[k]),pct(b.delivery[k])]),['累计恢复排队 / 任务小时',f(a.stats.repairQueueHours,3),f(b.stats.repairQueueHours,3)],['平均共享根因故障数',f(a.stats.commonFailures,2),f(b.stats.commonFailures,2)]]);
 }
 function trace(){const d=getData(),p=A.setup(d.config).params($('#trace-mode').value==='all'?255:0),r=E.simulate(+$('#size').value,p,9137,{trace:true});const names={'repair-scheduled':'恢复任务入队',hard:'中断',slow:'亚健康',silent:'静默污染',resume:'恢复运行','domain-up':'局部域恢复','silent-detected-rollback':'检出并回退','slow-repair':'亚健康恢复',end:'月度结束'};
  table('#trace-table',r.trace.slice(0,60).map(e=>[f(e.t,5),names[e.kind]||e.kind,f(e.correct,5),f(e.durableCheckpoint,5),f(e.activeCards),e.repairStartedAt===null?'等待检出后排队':e.affectedDomains!==undefined?'影响 '+e.affectedDomains+' 域；排队 '+f(e.repairStartedAt-e.discoveredAt,3)+' h':e.candidateKind?'恢复点：'+e.candidateKind+'；成功：'+e.recoverySuccess:e.corrupt?'污染未解除':'干净状态']));
 }
 function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('#export-scenario').onclick=()=>download('可靠性场景V4.json',R.scenario(getData().config,E.version,codeSHA256));
 $('#export-result').onclick=()=>download('可靠性评估结果V4.json',getData());
 $('#import-scenario').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;const value=JSON.parse(await file.text());if(value.codeSHA256!==codeSHA256)throw new Error('场景代码摘要不匹配，请使用当前文件导出的 V4 场景');const c=R.parseScenario(value,A,E.version);importConfig(c);setModel(c.model);dirty();$('#status').textContent='场景已导入草稿，点击刷新计算；当前图表仍为原结果。';}catch(err){$('#error').textContent=err.message;}finally{e.target.value='';}};
 $('#trace-mode').onchange=trace;
 function render(){const d=getData();$('#version-note').textContent='模型 '+E.version+' · 每项新约束均参与仿真 · 仍需现场数据校准';drawTopology();drawLedger();trace();table('#evidence-table',R.evidence.map(e=>[e.parameter,e.status,e.source]));$('#scenario-id').textContent='代码 SHA-256：'+codeSHA256+'；场景 SHA-256：'+(d.scenarioSHA256||'计算后生成')+'；实验 SHA-256：'+(d.experimentSHA256||'尚未生成')+'。参数导入与手动修改属于场景假设，不提升证据等级。';}
 return {readModel,setModel,render,drawTopology,drawLedger,fields:defs};
}
