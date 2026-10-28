import {identityPrivacy} from './identity-privacy.mjs';
import {ApprovalSms} from './aliyun-sms.mjs';
import {TemplateDiscovery} from './template-discovery.mjs';
import {visitWindow} from './gate-pass.mjs';
import {CarGate} from './car-gate.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resultLink} from './result-access.mjs';
export function notificationEmail(value){
 if(value===undefined||value==='')return '';
 if(typeof value!=='string')throw Error('请填写有效的结果通知邮箱');
 const email=value.trim();if(email.length>254||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email))throw Error('请填写有效的结果通知邮箱');return email;
}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function hostResultMessage(job,info,env,verifyCode='',directUrl){
 const labels={2:'审批已通过',3:'审批已驳回',4:'申请已撤销',6:'通过后已撤销',7:'申请已删除'},status=labels[info.sp_status];
 if(!status||!info.applyer?.userid||info.applyer.userid!==job.hostUserid)throw Error('审批结果接收人或最终状态不匹配');
 const base=(env.BASE_URL||'http://localhost:3000').replace(/\/$/,'');
 const lines=['外部申请人：'+(job.applicantName||'来访申请人'),'审批结果：'+status,'审批编号：'+job.sp_no,'入校日期：'+job.date+(job.endDate&&job.endDate!==job.date?' 至 '+job.endDate:''),'预约时段：'+job.start+' — '+job.end,'访客人数：'+job.visitorCount+'人'];
 if(info.sp_status===2){if(verifyCode)lines.push('来访核验码：'+verifyCode,'请通知访客使用申请时登记手机号和核验码打开临时入校卡。','入校核验：'+base+'/verify');else lines.push('请打开查询页面确认预约有效时间及入校核验码。');}
 else lines.push('此结果不允许凭原申请入校，请通知来访人员。');
 return {touser:info.applyer.userid,msgtype:'textcard',agentid:Number(env.WECOM_AGENT_ID),textcard:{title:'校外来访 · '+status,description:lines.map(line=>'<div class="normal">'+escape(line)+'</div>').join(''),url:directUrl||(base+'/query?sp_no='+encodeURIComponent(job.sp_no)),btntxt:'查看结果与核验码'},enable_duplicate_check:1,duplicate_check_interval:1800};
}
export function approvedMail(job,env={}){
 const base=(env.BASE_URL||'https://visitor.example.com').replace(/\/$/,'');
 const lines=[(job.applicantName||'来访申请人')+'：','您好，您发起的校外人员来访申请，已经通过审批，欢迎来到美丽的校园校园。','大门入校核验方法如下：','此次来访的验证码：'+job.verifyCode+'，请来宾打开链接：'+base+'/verify ，输入自己申请时的手机号和此验证码，即可打开临时入校卡，进校时出示此卡即可入校。','请通知对方按申请的时间准时入离校，有驾车来校的请停到指定的停车场。谢谢！','审批编号：'+job.sp_no,'审批结果及核验码查询：'+base+'/query','查询时请输入校内被访者姓名、访客姓名、访客手机号及申请的入校日期。','入校日期：'+job.date+(job.endDate&&job.endDate!==job.date?' 至 '+job.endDate:'')+'；预约时段：'+job.start+' — '+job.end,'验证码仅限本次申请登记的访客使用，预约结束后失效。请勿向无关人员泄露。'];
 return {to:[job.email],subject:'【校园访客】入校申请审批通过（'+job.sp_no+'）',text:lines.join('\n\n'),html:'<div>'+lines.map(x=>'<p>'+escape(x)+'</p>').join('')+'</div>',labels:['visitor-approved']};
}
export async function sendAgentMail(env,mail,fetcher=fetch){
 if(!env.AGENTMAIL_API_KEY||!env.AGENTMAIL_INBOX)throw Error('邮件发送配置未完成');
 if(env.AGENTMAIL_TRANSPORT==='smtp')return new Promise((resolve,reject)=>{
  const child=execFile(env.PYTHON_PATH||'python3',[fileURLToPath(new URL('./smtp-send.py',import.meta.url))],{env:{...process.env,AGENTMAIL_API_KEY:env.AGENTMAIL_API_KEY,AGENTMAIL_INBOX:env.AGENTMAIL_INBOX},timeout:50000,maxBuffer:8192,windowsHide:true},(err,stdout)=>{
   if(err){const error=Error('SMTP进程未确认发送结果');error.uncertain=true;return reject(error);}
   let result;try{result=JSON.parse(stdout);}catch{const error=Error('SMTP返回结果无效');error.uncertain=true;return reject(error);}
   if(result.message_id)return resolve(result);
   const error=Error(result.error||'SMTP发送失败');error.retryable=!!result.retryable;error.uncertain=!!result.uncertain;reject(error);
  });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(mail));
 });
 let response;try{response=await fetcher('https://api.agentmail.to/v0/inboxes/'+encodeURIComponent(env.AGENTMAIL_INBOX)+'/messages/send',{method:'POST',headers:{Authorization:'Bearer '+env.AGENTMAIL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(mail),signal:AbortSignal.timeout(25000)});}catch{const error=Error('邮件发送结果未确认');error.uncertain=true;throw error;}
 if(!response.ok){const error=Error('邮件服务返回 HTTP '+response.status);error.retryable=response.status===429;error.uncertain=response.status>=500;throw error;}
 let result;try{result=await response.json();}catch{const error=Error('邮件发送结果未确认');error.uncertain=true;throw error;}
 if(!result.message_id){const error=Error('邮件服务未返回发送编号');error.uncertain=true;throw error;}return result;
}
export class Notifications{
 constructor({env,api,send,gate,audit,now=Date.now}){this.audit=audit;this.env=env;this.api=api;this.gate=gate;this.sms=new ApprovalSms({env,api,gate,now,refreshJob:(job,info)=>this.discovery.refreshJob(job,info),onUpdate:()=>this.save()});this.carGate=new CarGate({env,api,now,refreshJob:(job,info)=>this.discovery.refreshJob(job,info)});this.send=send||((mail)=>sendAgentMail(env,mail));this.now=now;this.jobs=new Map();this.file=path.join(env.DATA_DIR||'private/runtime','approval-notifications.json');this.queue=Promise.resolve();this.busy=false;this.discovery=new TemplateDiscovery({env,api,getJobs:()=>this.jobs,saveJobs:()=>this.save(),now});}
 async init(){await this.carGate.init();await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{this.jobs=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}for(const j of this.jobs.values()){if(j.state==='sending'){j.state='uncertain';j.error='服务中断，发送结果需人工核实';}for(const delivery of Object.values(j.hostDeliveries||{}))if(delivery.state==='sending')delivery.state='uncertain';}await this.save();await this.discovery.init();await this.sms.init();}
 async save(){if(this.audit)for(const job of this.jobs.values())this.audit.job({...job,gateDelivery:this.carGate.records.get(job.sp_no),smsDelivery:this.sms.summary(job.sp_no,job.createdAt)});const content=JSON.stringify(identityPrivacy(this.env.DATA_DIR||'private/runtime').protect([...this.jobs]));const p=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',content,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=p;return p;}
 async prepare(key,hash,data){
  const email=notificationEmail(data.notificationEmail);if(email&&(!this.env.AGENTMAIL_API_KEY||!this.env.AGENTMAIL_INBOX))throw Error('邮件通知服务暂未配置，请稍后提交或不填写邮箱');
  this.jobs.set(key,{key,hash,email,applicantName:data.visitors[0]?.name,hostUserid:data.hostUserid,hostName:data.hostName,plate:typeof data.plate==='string'?data.plate.trim():'',firstVisitorPhone:data.visitors[0]?.phone,carGateRequested:!!data.plate?.trim(),hostNotifyEnabled:!!data.hostUserid,hostDeliveries:{},date:data.date,start:data.start,end:data.end,visitorCount:data.visitors.length,department:data.department||'',form:{applicantName:data.visitors[0]?.name,hostName:data.hostName,hostPhone:data.hostPhone,visitors:data.visitors,date:data.date,start:data.start,end:data.end,plate:data.plate,reason:data.reason,visitType:data.visitType,notificationEmail:data.notificationEmail},state:'submitting',createdAt:this.now()});await this.save();
 }
 async bind(key,sp_no){const j=this.jobs.get(key);for(const [otherKey,other] of this.jobs)if(otherKey!==key&&other.sp_no===sp_no&&other.source==='template-discovery'){j.hostDeliveries={...other.hostDeliveries,...j.hostDeliveries};this.jobs.delete(otherKey);}j.sp_no=sp_no;j.state=j.email?'waiting':'disabled';j.nextAt=this.now();await this.save();}
 async drain(){
  if(this.busy)return;this.busy=true;
  try{let count=0;for(const j of this.jobs.values()){
   if(j.state!=='waiting'||j.nextAt>this.now())continue;if(++count>100)break;
   let details;try{details=await this.api('oa/getapprovaldetail',{sp_no:j.sp_no});}catch{j.checkFailures=(j.checkFailures||0)+1;j.nextAt=this.now()+Math.min(3600000,60000*2**Math.min(j.checkFailures,6));await this.save();continue;}
   if(details.info?.sp_no!==j.sp_no){j.nextAt=this.now()+60000;await this.save();continue;}
   try{await this.discovery.refreshJob(j,details.info);}catch{j.error='审批资料已变化但暂无法解析';j.nextAt=this.now()+300000;await this.save();continue;}
   j.checkFailures=0;j.approvalStatus=details.info.sp_status;
   if([3,4,6,7].includes(j.approvalStatus)){j.state='closed';await this.save();continue;}
   if(j.approvalStatus!==2){j.nextAt=this.now()+60000;await this.save();continue;}
   let verifyCode='';if(this.gate){try{verifyCode=(await this.gate.issue(j,details.info)).verifyCode;}catch{j.error='入校核验凭证签发失败，待重试';j.nextAt=this.now()+300000;await this.save();console.error('核验凭证签发失败：'+j.sp_no);continue;}}
   j.state='sending';await this.save();
   try{const out=await this.send(approvedMail({...j,verifyCode},this.env));j.state='sent';j.messageId=out.message_id;j.sentAt=this.now();}
   catch(error){j.error=error.message;j.state=error.retryable?'waiting':error.uncertain?'uncertain':'failed';j.nextAt=this.now()+300000;console.error('审批邮件通知异常：'+j.sp_no+'，状态：'+j.state);}
   await this.save();
  }}finally{this.busy=false;}
 }
 async drainHost(){
  if(this.hostBusy)return;this.hostBusy=true;
  try{let count=0;for(const j of this.jobs.values()){
   if(!j.hostNotifyEnabled||!j.hostUserid||!j.sp_no||j.hostMonitoringClosed||j.hostNextAt>this.now())continue;if(++count>100)break;
   let result;try{result=await this.api('oa/getapprovaldetail',{sp_no:j.sp_no});}catch{j.hostNextAt=this.now()+300000;await this.save();continue;}
   const info=result.info;j.hostNextAt=this.now()+60000;
   if(info?.sp_no!==j.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||info.applyer?.userid!==j.hostUserid){j.hostError='审批身份或模板核对失败';await this.save();continue;}
   try{await this.discovery.refreshJob(j,info);}catch{j.hostError='审批资料已变化但暂无法解析';j.hostNextAt=this.now()+300000;await this.save();continue;}
   const status=info.sp_status;if(![2,3,4,6,7].includes(status)){await this.save();continue;}
   const deliveries=j.hostDeliveries||(j.hostDeliveries={}),previous=deliveries[status];
   if(previous&&['sent','uncertain','failed','sending'].includes(previous.state)){j.hostNextAt=this.now()+300000;if(status!==2)j.hostMonitoringClosed=true;await this.save();continue;}
   let code='';if(status===2&&this.gate&&visitWindow(j.date,j.start,j.end,j.endDate).endAt>this.now())try{code=(await this.gate.issue(j,info)).verifyCode;}catch{j.hostError='入校核验码暂不可用';j.hostNextAt=this.now()+300000;await this.save();continue;}
   const directUrl=resultLink(j,this.env,this.now());deliveries[status]={state:'sending',attemptAt:this.now()};await this.save();
   try{const out=await this.api('message/send',hostResultMessage(j,info,this.env,code,directUrl));if(out.invaliduser||out.unlicenseduser){const error=Error('接收人不在消息可达范围');error.code=81013;throw error;}deliveries[status]={state:'sent',messageId:out.msgid,sentAt:this.now()};}
   catch(error){deliveries[status]={state:error.code===45009?'retry':error.code?'failed':'uncertain',error:error.code||'发送结果未确认'};console.error('被访人结果消息异常：'+j.sp_no);}
   j.hostNextAt=this.now()+300000;if(status!==2&&deliveries[status].state==='sent')j.hostMonitoringClosed=true;await this.save();
  }}finally{this.hostBusy=false;}
 }
 async adoptPending(){
  let count=0;for(const j of this.jobs.values()){
   if(j.hostNotifyEnabled!==undefined||!j.sp_no||j.hostMigrationNextAt>this.now())continue;if(++count>100)break;
   try{const result=await this.api('oa/getapprovaldetail',{sp_no:j.sp_no}),info=result.info;
    j.hostNotifyEnabled=!!(info?.sp_no===j.sp_no&&info.template_id===this.env.WECOM_TEMPLATE_ID&&info.sp_status===1&&info.applyer?.userid);
    if(j.hostNotifyEnabled){j.hostUserid=info.applyer.userid;j.hostDeliveries={};j.hostNextAt=this.now();}
   }catch{j.hostMigrationNextAt=this.now()+300000;}await this.save();
  }
 }
 start(){const tick=async()=>{await this.discovery.tick().catch(()=>console.error('模板全入口审批发现任务异常'));await Promise.all([this.sms.drain(this.jobs).catch(()=>console.error('审批短信任务异常，请检查短信台账及配置')),this.carGate.drain(this.jobs).catch(()=>console.error('门禁推送任务异常，请检查私有存储及配置')),(async()=>{await this.adoptPending();await this.drain();await this.drainHost();})()]);await this.save();};const timer=setInterval(()=>tick().catch(()=>console.error('审批结果通知任务失败，请检查服务存储与接口连接')),60000);timer.unref();tick().catch(()=>console.error('审批结果通知初始检查失败'));}
}
