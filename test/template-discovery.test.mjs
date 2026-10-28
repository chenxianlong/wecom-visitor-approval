import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractTemplateJob,TemplateDiscovery,approvalRange} from '../template-discovery.mjs';
import {visitWindow} from '../gate-pass.mjs';
const control=(id,title,kind='Text',config)=>({property:{id,title:[{text:title,lang:'zh_CN'}],control:kind},config});
const template={template_content:{controls:[control('table','访客','Table',{table:{children:[control('name','姓名'),control('phone','手机号码')]}}),control('date','入校日期','Date'),control('range','入校时间段','DateRange'),control('plate','入校车牌号码'),control('email','结果通知邮箱')]}};
const start=+new Date('2026-10-22T12:00:00+08:00'),member={userid:'host',name:'测试被访人'};
function info(sp_no='202610220001',time=start+1000){return {sp_no,template_id:'t',sp_status:2,apply_time:Math.floor(time/1000),applyer:{userid:'host'},apply_data:{contents:[{id:'table',value:{children:[{list:[{id:'name',value:{text:'模拟访客'}},{id:'phone',value:{text:'13800138000'}}]}]}},{id:'date',value:{date:{s_timestamp:String(+new Date('2026-10-22T00:00:00+08:00')/1000)}}},{id:'range',value:{date_range:{new_begin:+new Date('2026-10-22T12:00:00+08:00')/1000,new_end:+new Date('2026-10-24T00:00:00+08:00')/1000}}},{id:'plate',value:{text:'粤 S·a1234'}},{id:'email',value:{text:''}}]}};}
test('其他入口按模板控件提取，跨天预约保留真实结束日期，无邮箱也启用结果及门禁',()=>{
 const j=extractTemplateJob(info(),template,member,start+60000);
 assert.equal(j.source,'template-discovery');assert.equal(j.date,'2026-10-22');assert.equal(j.endDate,'2026-10-23');assert.equal(j.start,'12:00');assert.equal(j.end,'24:00');assert.equal(j.email,'');assert.equal(j.state,'disabled');assert.equal(j.hostNotifyEnabled,true);assert.equal(j.plate,'粤SA1234');assert.equal(j.firstVisitorPhone,'13800138000');assert.equal(j.carGateRequested,true);
 assert.equal(visitWindow(j.date,j.start,j.end,j.endDate).endAt,+new Date('2026-10-24T00:00:00+08:00'));
});
test('只从显式邮箱字段读取邮件地址，无效邮箱不阻断其他通知',()=>{
 const a=info();a.apply_data.contents.find(c=>c.id==='email').value.text='visitor@example.com';assert.equal(extractTemplateJob(a,template,member).email,'visitor@example.com');
 a.apply_data.contents.find(c=>c.id==='email').value.text='bad\r\nBcc: other@example.com';const j=extractTemplateJob(a,template,member);assert.equal(j.email,'');assert.match(j.emailError,/无效/);assert.equal(j.hostNotifyEnabled,true);
});
test('拒绝身份不匹配、缺少时段、日期冲突和第一位访客手机号缺失，不猜测资料',()=>{
 assert.throws(()=>extractTemplateJob(info(),template,{userid:'other',name:'其他人'}),/申请人/);
 const a=info();a.apply_data.contents=a.apply_data.contents.filter(c=>c.id!=='range');assert.throws(()=>extractTemplateJob(a,template,member),/起止时间/);
 const b=info();b.apply_data.contents.find(c=>c.id==='date').value.date.s_timestamp=String(start/1000-86400);assert.throws(()=>extractTemplateJob(b,template,member),/不一致/);
 const c=info();const rows=c.apply_data.contents[0].value.children;rows.unshift({list:[{id:'name',value:{text:'第一位'}},{id:'phone',value:{text:'bad'}}]});assert.throws(()=>extractTemplateJob(c,template,member),/第一位/);
});
function discoverySetup(){
 let now=start+60000;const jobs=new Map(),calls=[];const d=new TemplateDiscovery({env:{TEMPLATE_DISCOVERY_ENABLED:'true',WECOM_TEMPLATE_ID:'t'},now:()=>now,getJobs:()=>jobs,saveJobs:async()=>{},api:async(path,body)=>{
  calls.push({path,body});if(path==='oa/gettemplatedetail')return template;if(path==='user/get')return member;
  if(path==='oa/getapprovaldetail')return {info:info(body.sp_no,body.sp_no==='202610220002'?start-86400000:body.sp_no==='202610220003'?start-60000:start+1000)};
  if(path==='oa/getapprovalinfo'){
   if(body.filters.some(f=>f.key==='sp_status'))return {sp_no_list:['202610220002'],new_next_cursor:''};
   return body.new_cursor===''?{sp_no_list:['202610220001'],new_next_cursor:'next'}:{sp_no_list:['202610220003'],new_next_cursor:''};
  }throw Error('unexpected');
 }});d.state={templateId:'t',activatedAt:start,lastScanAt:start,bootstrapDone:false,pending:{},imported:0,skipped:0};d.save=async()=>{};
 return {d,jobs,calls,advance:()=>now+=60000};
}
test('全入口发现支持短页游标，只接入上线后新提交的单据，跳过此前所有单据',async()=>{
 const {d,jobs,calls,advance}=discoverySetup();await d.tick();assert.equal(jobs.size,1);assert.ok(jobs.has('template:202610220001'));assert.equal(jobs.has('template:202610220002'),false);assert.equal(jobs.has('template:202610220003'),false);assert.ok(calls.some(c=>c.body.new_cursor==='next'));assert.equal(d.state.imported,1);advance();await d.tick();assert.equal(jobs.size,1);assert.equal(d.state.imported,1);
});
test('H5已登记审批编号不再导入，读取失败保留重试状态而不误推进成功',async()=>{
 const {d,jobs}=discoverySetup();jobs.set('h5',{sp_no:'202610220001'});const original=d.api;d.api=async(p,b)=>{if(p==='oa/getapprovaldetail'&&b.sp_no==='202610220003')throw Error('upstream token is secret');return original(p,b);};await d.tick();assert.equal(jobs.has('template:202610220001'),false);assert.ok(d.state.pending['202610220003']);assert.doesNotMatch(d.state.pending['202610220003'].error,/secret/);
});

test('内部申请审批中修改资料后，推送前重读最新车牌和时段，不清空既有发送状态',async()=>{
 const {d,jobs}=discoverySetup();await d.tick();const j=jobs.get('template:202610220001');j.hostDeliveries={2:{state:'sent',messageId:'old'}};
 const changed=info();changed.apply_data.contents.find(c=>c.id==='plate').value.text='粤B-12345';changed.apply_data.contents.find(c=>c.id==='range').value.date_range.new_end=+new Date('2026-10-25T12:00:00+08:00')/1000;
 await d.refreshJob(j,changed);assert.equal(j.plate,'粤B12345');assert.equal(j.endDate,'2026-10-25');assert.equal(j.end,'12:00');assert.equal(j.hostDeliveries[2].messageId,'old');
});


test('全入口启用时间持久化，进程重启不重置起点',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path');
 const parent=path.resolve('private');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'discovery-unit-'));
 try{
  const env={TEMPLATE_DISCOVERY_ENABLED:'true',WECOM_TEMPLATE_ID:'t',DATA_DIR:dir},jobs=new Map();
  const first=new TemplateDiscovery({env,api:async()=>{throw Error('No network');},getJobs:()=>jobs,saveJobs:async()=>{},now:()=>100500});await first.init();assert.equal(first.state.activatedAt,100000);
  const restarted=new TemplateDiscovery({env,api:async()=>{throw Error('No network');},getJobs:()=>jobs,saveJobs:async()=>{},now:()=>9000000});await restarted.init();assert.equal(restarted.state.activatedAt,100000);
 }finally{await fs.unlink(path.join(dir,'template-discovery.json'));await fs.rmdir(dir);}
});

test('企业微信原生半天时段包含最后半天，同起止时间加显式43200秒可表示下午半天',()=>{const value=info();const range=value.apply_data.contents.find(c=>c.id==='range').value;range.date_range={type:'halfday',new_begin:1792728000,new_end:1792728000,new_duration:43200,perday_duration:86400};value.apply_data.contents.find(c=>c.id==='date').value.date.s_timestamp=String(+new Date('2026-10-23T00:00:00+08:00')/1000);const job=extractTemplateJob(value,template,{userid:'host',name:'模拟老师'});assert.equal(job.date,'2026-10-23');assert.equal(job.start,'12:00');assert.equal(job.end,'24:00');assert.equal(job.endDate,'2026-10-23');});

test('半天解析区分包含末半天与排他结束，不延长按小时或既有H5的预约',()=>{const begin=1792728000;assert.equal(approvalRange({type:'halfday',new_begin:begin,new_end:begin+43200,new_duration:43200}).finish,(begin+43200)*1000);assert.equal(approvalRange({type:'halfday',new_begin:begin-43200,new_end:begin,new_duration:86400}).finish,(begin+43200)*1000);assert.equal(approvalRange({type:'hour',new_begin:begin,new_end:begin+3600,new_duration:3600}).finish,(begin+3600)*1000);for(const range of [{type:'hour',new_begin:begin,new_end:begin,new_duration:43200},{type:'halfday',new_begin:begin,new_end:begin},{type:'halfday',new_begin:begin,new_end:begin,new_duration:86400},{type:'halfday',new_begin:begin+60,new_end:begin+60,new_duration:43200}])assert.throws(()=>approvalRange(range));});
