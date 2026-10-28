import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {extractVisitors,visitWindow} from './gate-pass.mjs';
import {normalizePlate} from './plate.mjs';

const label=c=>(c.property?.title||c.title||[]).find(t=>t.lang==='zh_CN')?.text||(c.property?.title||c.title||[])[0]?.text||'';
const normalized=s=>s.replace(/[\s*＊：:]/g,'');
const fieldsHash=info=>crypto.createHash('sha256').update(JSON.stringify({contents:info.apply_data?.contents,applyer:info.applyer})).digest('hex');
const parts=ms=>{const value=new Date(ms+8*3600000).toISOString();return {date:value.slice(0,10),time:value.slice(11,16)};};
export function approvalRange(range){
 const begin=Number(range?.new_begin)*1000;let finish=Number(range?.new_end)*1000;
 if(!Number.isFinite(begin)||!Number.isFinite(finish)||begin<=0||finish<begin||begin%60000||finish%60000)throw Error('审批预约起止时间缺失或无效');
 if(range.type==='halfday'){
  const half=43200000,duration=Number(range.new_duration)*1000,day=range.perday_duration;
  const boundary=t=>['00:00','12:00'].includes(parts(t).time);
  if(!boundary(begin)||!boundary(finish))throw Error('审批预约起止时间缺失或无效');
  // Native half-day controls encode the START of the final included half-day.
  // Distinguish that from exclusive endpoints using the explicit calendar duration.
  if(Number.isFinite(duration)&&duration>0&&(day===undefined||Number(day)===86400)){
   if(duration===finish-begin+half)finish+=half;
   else if(duration!==finish-begin)throw Error('审批预约起止时间缺失或无效');
  }
 }
 if(finish<=begin)throw Error('审批预约起止时间缺失或无效');
 return {begin,finish};
}
export function extractTemplateJob(info,template,member,now=Date.now()){
 if(!/^\d{10,30}$/.test(info?.sp_no||'')||!info.applyer?.userid||member?.userid!==info.applyer.userid||!member.name)throw Error('审批申请人信息不完整');
 const controls=template.template_content?.controls||[],contents=info.apply_data?.contents||[];
 const field=titles=>{const c=controls.find(c=>titles.includes(normalized(label(c))));return c?contents.find(v=>v.id===c.property.id)?.value:undefined;};
 const visitors=extractVisitors(info,template);
 const relevantTables=controls.filter(c=>c.property?.control==='Table'&&(c.config?.table?.children||[]).some(child=>['手机号码','手机号'].includes(label(child))));
 const rowCount=relevantTables.reduce((count,table)=>count+(contents.find(c=>c.id===table.property.id)?.value?.children||[]).length,0);
 if(rowCount!==visitors.length||visitors.some(v=>!v.name.trim()))throw Error('审批访客明细不完整，不能替代第一位访客手机号');
 // Never fall back to an entire day when a range is missing or malformed.
 const range=field(['入校时间段'])?.date_range;
 const {begin,finish}=approvalRange(range);
 const first=parts(begin),last=parts(finish);
 const explicitDate=field(['入校日期'])?.date?.s_timestamp;
 if(!explicitDate||parts(Number(explicitDate)*1000).date!==first.date)throw Error('入校日期与预约开始日期不一致');
 const midnight=last.time==='00:00',endDate=midnight?parts(finish-1).date:last.date,end=midnight?'24:00':last.time;
 visitWindow(first.date,first.time,end,endDate);
 const plate=normalizePlate(field(['入校车牌号码','入校车牌号'])?.text||'');
 const emailValue=field(['结果通知邮箱','通知邮箱','电子邮箱','邮箱'])?.text;
 const rawEmail=typeof emailValue==='string'?emailValue.trim():'';
 const validEmail=rawEmail.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(rawEmail);
 const email=rawEmail&&validEmail?rawEmail:'';
 const applicant=field(['外部申请人姓名'])?.text?.trim()||visitors[0].name;
 return {key:'template:'+info.sp_no,fieldsHash:fieldsHash(info),source:'template-discovery',sp_no:info.sp_no,hash:'template:'+info.sp_no,email,applicantName:applicant,hostUserid:member.userid,hostName:member.name,hostNotifyEnabled:true,hostDeliveries:{},date:first.date,start:first.time,end,endDate,plate,firstVisitorPhone:visitors[0].phone,carGateRequested:!!plate,visitorCount:visitors.length,state:email?'waiting':'disabled',nextAt:now,hostNextAt:now,createdAt:Number(info.apply_time)*1000,discoveredAt:now,...(rawEmail&&!validEmail?{emailError:'审批单邮箱格式无效，未安排邮件'}:{})};
}

export class TemplateDiscovery{
 constructor({env,api,getJobs,saveJobs,now=Date.now}){this.env=env;this.api=api;this.getJobs=getJobs;this.saveJobs=saveJobs;this.now=now;this.file=path.join(env.DATA_DIR||'private/runtime','template-discovery.json');this.busy=false;this.queue=Promise.resolve();this.template=null;this.templateUntil=0;}
 async init(){
  if(this.env.TEMPLATE_DISCOVERY_ENABLED!=='true')return;
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
  try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const now=Math.floor(this.now()/1000)*1000;this.state={templateId:this.env.WECOM_TEMPLATE_ID,activatedAt:now,lastScanAt:now,pending:{},imported:0,skipped:0};}
  if(this.state.templateId!==this.env.WECOM_TEMPLATE_ID)throw Error('审批发现任务模板配置不匹配');
  await this.save();
 }
 async save(){const content=JSON.stringify(this.state);const task=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',content,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=task;return task;}
 async scan(start,end){
  const filters=[{key:'template_id',value:this.env.WECOM_TEMPLATE_ID}];
  let cursor='';const seen=new Set();
  for(let page=0;page<100;page++){
   const out=await this.api('oa/getapprovalinfo',{starttime:String(Math.floor(start/1000)),endtime:String(Math.floor(end/1000)),new_cursor:cursor,size:100,filters});
   if(!Array.isArray(out.sp_no_list))throw Error('审批编号列表格式异常');
   const known=new Set([...this.getJobs().values()].map(j=>j.sp_no));
   for(const sp_no of out.sp_no_list){if(!/^\d{10,30}$/.test(sp_no))throw Error('审批编号格式异常');if(!known.has(sp_no)&&!this.state.pending[sp_no])this.state.pending[sp_no]={nextAt:0,failures:0};}
   // Applications outside the app visibility may produce a short page with a next cursor.
   const next=out.new_next_cursor!==undefined?out.new_next_cursor:out.next_cursor;
   if(!next||next==='0')return;
   const value=String(next);if(seen.has(value)||value===cursor)throw Error('审批列表分页游标重复');seen.add(value);cursor=value;
  }
  throw Error('审批列表页数过多，等待人工检查');
 }
 async refreshJob(job,info){
  if(job.source!=='template-discovery')return;
  if(info?.sp_no!==job.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||info.applyer?.userid!==job.hostUserid)throw Error('审批申请人或模板发生变化');
  const hash=fieldsHash(info);if(job.fieldsHash===hash)return;
  if(!this.template||this.templateUntil<this.now()){this.template=await this.api('oa/gettemplatedetail',{template_id:this.env.WECOM_TEMPLATE_ID});this.templateUntil=this.now()+300000;}
  const member=await this.api('user/get',{userid:job.hostUserid},'GET');
  const parsed=extractTemplateJob(info,this.template,member,this.now());
  for(const key of ['fieldsHash','email','applicantName','hostName','date','start','end','endDate','plate','firstVisitorPhone','carGateRequested','visitorCount'])job[key]=parsed[key];
  if(job.state==='disabled'&&job.email){job.state='waiting';job.nextAt=this.now();}
  if(parsed.emailError)job.emailError=parsed.emailError;else delete job.emailError;
  await this.saveJobs();
 }
 async tick(){
  if(this.env.TEMPLATE_DISCOVERY_ENABLED!=='true'||!this.state||this.busy)return;
  this.busy=true;
  try{
   const now=this.now();
   try{
    // Incremental discovery uses submission time, not approval time. Imported pending jobs keep monitoring afterwards.
    let windows=0;
    while(this.state.lastScanAt<now-1000&&windows++<3){const start=Math.max(this.state.activatedAt-300000,this.state.lastScanAt-300000),end=Math.min(now,start+30*86400000);await this.scan(start,end);this.state.lastScanAt=end;await this.save();}
    delete this.state.scanError;
   }catch{this.state.scanError='审批列表拉取失败，请核对应用审批权限';}
   let count=0;
   for(const [sp_no,task] of Object.entries(this.state.pending)){
    if(task.nextAt>now)continue;if(++count>30)break;
    if([...this.getJobs().values()].some(j=>j.sp_no===sp_no)){delete this.state.pending[sp_no];continue;}
    try{
     const info=(await this.api('oa/getapprovaldetail',{sp_no})).info;
     if(info?.sp_no!==sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID)throw Error('审批详情与模板不匹配');
     if(!Number.isFinite(Number(info.apply_time))||Number(info.apply_time)<=0)throw Error('审批提交时间无效');
     if(Number(info.apply_time)*1000<this.state.activatedAt){delete this.state.pending[sp_no];this.state.skipped++;continue;}
     // Let a concurrent H5 submit finish binding its number before external registration.
     if(Number(info.apply_time)*1000>now-15000){task.nextAt=now+30000;continue;}
     if(!this.template||this.templateUntil<now){this.template=await this.api('oa/gettemplatedetail',{template_id:this.env.WECOM_TEMPLATE_ID});this.templateUntil=now+300000;}
     const member=await this.api('user/get',{userid:info.applyer?.userid},'GET');
     const job=extractTemplateJob(info,this.template,member,now);
     if(![...this.getJobs().values()].some(j=>j.sp_no===sp_no)){this.getJobs().set(job.key,job);await this.saveJobs();this.state.imported++;}
     delete this.state.pending[sp_no];
    }catch(error){task.failures++;task.nextAt=now+Math.min(3600000,60000*2**Math.min(task.failures,5));task.error=['审批单中无可核验的访客手机号','审批预约起止时间缺失或无效','入校日期与预约开始日期不一致','审批申请人信息不完整','审批详情与模板不匹配','审批提交时间无效','审批访客明细不完整，不能替代第一位访客手机号'].includes(error.message)?error.message:'审批资料暂不可读取，待重试';}
   }
   this.state.lastRunAt=now;await this.save();
  }finally{this.busy=false;}
 }
}
