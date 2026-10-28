import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {extractVisitors,visitWindow} from './gate-pass.mjs';
const endpoint='https://dysmsapi.aliyuncs.com/';
const encode=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function signedSmsBody(env,action,parameters,{now=Date.now(),nonce=crypto.randomUUID()}={}){
 if(!['SendSms','GetSmsTemplate','QuerySmsSignList','QuerySendDetails'].includes(action))throw Error('不支持的短信操作');
 if(!env.ALIYUN_SMS_ACCESS_KEY_ID||!env.ALIYUN_SMS_ACCESS_KEY_SECRET)throw Error('短信凭证未配置');
 const p={...parameters,AccessKeyId:env.ALIYUN_SMS_ACCESS_KEY_ID,Action:action,Format:'JSON',RegionId:'cn-hangzhou',SignatureMethod:'HMAC-SHA1',SignatureNonce:nonce,SignatureVersion:'1.0',Timestamp:new Date(now).toISOString().replace(/\.\d{3}Z$/,'Z'),Version:'2017-05-25'};
 const canonical=Object.keys(p).sort().map(k=>encode(k)+'='+encode(p[k])).join('&');
 p.Signature=crypto.createHmac('sha1',env.ALIYUN_SMS_ACCESS_KEY_SECRET+'&').update('POST&%2F&'+encode(canonical)).digest('base64');return new URLSearchParams(p).toString();
}
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:^-]{1,160}$/.test(value)?value:undefined;
export async function smsRpc(env,action,parameters,fetcher=fetch){
 const body=signedSmsBody(env,action,parameters);let response;
 try{response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded','Cache-Control':'no-store'},body,signal:AbortSignal.timeout(20000)});}catch{const e=Error('短信请求结果未确认');e.uncertain=true;throw e;}
 let result;try{result=await response.json();}catch{const e=Error('短信响应结果未确认');e.uncertain=true;throw e;}
 if(!response.ok||result.Code!=='OK'){
  const e=Error('阿里云短信接口未接受请求');e.code=safeId(result.Code)||'unknown';e.requestId=safeId(result.RequestId);
  e.uncertain=response.status>=500||(!result.Code);e.retryable=!e.uncertain&&['isv.BUSINESS_LIMIT_CONTROL','Throttling','Throttling.User'].includes(result.Code);throw e;
 }
 return result;
}
export async function sendVisitorSms(env,{phone,name,sp_no,code,outId},fetcher=fetch){
 if(!/^1[3-9]\d{9}$/.test(phone)||typeof name!=='string'||!name.trim()||name.length>50||!/^\d{10,30}$/.test(sp_no)||!/^\d{4}$/.test(code))throw Error('短信收件人或模板资料无效');
 if(!env.ALIYUN_SMS_SIGN_NAME||!/^SMS_\d+$/.test(env.ALIYUN_SMS_TEMPLATE_CODE||''))throw Error('短信签名或模板未配置');
 const result=await smsRpc(env,'SendSms',{PhoneNumbers:phone,SignName:env.ALIYUN_SMS_SIGN_NAME,TemplateCode:env.ALIYUN_SMS_TEMPLATE_CODE,TemplateParam:JSON.stringify({visitor_name:name.trim(),request_number:sp_no,verify_code:code}),OutId:outId},fetcher);
 const bizId=safeId(result.BizId);if(!bizId){const e=Error('短信受理编号未确认');e.uncertain=true;throw e;}return {bizId,requestId:safeId(result.RequestId)};
}
export class ApprovalSms {
 constructor({env,api,gate,now=Date.now,send,refreshJob=async()=>{},onUpdate=async()=>{}}){this.env=env;this.api=api;this.gate=gate;this.now=now;this.send=send||((data)=>sendVisitorSms(env,data));this.refreshJob=refreshJob;this.onUpdate=onUpdate;this.file=path.join(env.DATA_DIR||'private/runtime','approval-sms-deliveries.json');this.state={version:1,applications:{}};this.queue=Promise.resolve();this.busy=false;}
 enabled(){return this.env.ALIYUN_SMS_ENABLED==='true';}
 configValid(){return !!(this.env.ALIYUN_SMS_ACCESS_KEY_ID&&this.env.ALIYUN_SMS_ACCESS_KEY_SECRET&&this.env.ALIYUN_SMS_SIGN_NAME&&/^SMS_\d+$/.test(this.env.ALIYUN_SMS_TEMPLATE_CODE||'')&&/^[a-f0-9]{64}$/i.test(this.env.GATE_PASS_SECRET||''));}
 async init(){
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(this.state.version!==1||!this.state.applications||typeof this.state.applications!=='object')throw Error('短信台账格式无效');
  if(!this.enabled())return;if(!this.configValid()){console.error('短信配置不完整，短信任务未启动');return;}
  if(!this.state.activatedAt)this.state.activatedAt=Math.floor(this.now()/1000)*1000;
  for(const app of Object.values(this.state.applications))for(const d of Object.values(app.deliveries||{}))if(d.state==='sending'){d.state='uncertain';d.error='服务中断，发送结果需人工核实';}
  await this.save();
 }
 eligible(job){return !!(this.enabled()&&this.configValid()&&this.state.activatedAt&&job.sp_no&&Number.isFinite(job.createdAt)&&job.createdAt>=this.state.activatedAt);}
 summary(sp_no,createdAt){if(this.enabled()&&this.state.activatedAt&&Number.isFinite(createdAt)&&createdAt<this.state.activatedAt)return {state:'excluded_history'};const a=this.state.applications[sp_no];if(!a)return this.enabled()?{state:'not_scheduled'}:{state:'disabled'};return {state:a.state,status:a.status,error:a.error,checkedAt:a.checkedAt,deliveries:a.deliveries};}
 async save(){const content=JSON.stringify(this.state);const task=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',content,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=task;await task;await this.onUpdate();}
 recipientId(sp_no,phone){return crypto.createHmac('sha256',this.env.GATE_PASS_SECRET).update(sp_no+':'+phone).digest('hex');}
 async drain(jobs){
  if(!this.enabled()||!this.configValid()||!this.state.activatedAt||this.busy)return;this.busy=true;
  try{let count=0;for(const job of jobs.values()){
   if(!this.eligible(job))continue;
   let app=this.state.applications[job.sp_no];if(app?.closed||app?.nextAt>this.now())continue;if(++count>50)break;
   app ||= this.state.applications[job.sp_no]={state:'waiting',deliveries:{}};
   app.checkedAt=this.now();app.nextAt=this.now()+60000;
   let info;try{info=(await this.api('oa/getapprovaldetail',{sp_no:job.sp_no})).info;}catch{app.error='审批状态读取失败';await this.save();continue;}
   if(info?.sp_no!==job.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||!job.hostUserid||info.applyer?.userid!==job.hostUserid){app.state='blocked';app.error='审批模板或申请人身份核对失败';app.nextAt=this.now()+300000;await this.save();continue;}
   app.status=info.sp_status;
   if([3,4,6,7].includes(info.sp_status)){app.state='not_applicable';app.closed=true;app.error='当前模板仅适用于审批通过通知';await this.save();continue;}
   if(info.sp_status!==2){app.state='waiting';await this.save();continue;}
   let visitors,code;
   try{
    await this.refreshJob(job,info);const window=visitWindow(job.date,job.start,job.end,job.endDate);
    if(window.endAt<=this.now()){app.state='expired';app.closed=true;await this.save();continue;}
    const template=await this.api('oa/gettemplatedetail',{template_id:this.env.WECOM_TEMPLATE_ID});visitors=extractVisitors(info,template);
    code=(await this.gate.issue(job,info)).verifyCode;if(!/^\d{4}$/.test(code))throw Error('核验码无效');
   }catch{app.state='blocked';app.error='短信所需访客资料或核验码暂不可用';app.nextAt=this.now()+300000;await this.save();continue;}
   const unique=new Map();for(const visitor of visitors)if(!unique.has(visitor.phone))unique.set(visitor.phone,visitor);
   delete app.error;
   for(const visitor of unique.values()){
    const id=this.recipientId(job.sp_no,visitor.phone),previous=app.deliveries[id];
    if(previous&&['accepted','uncertain','failed','sending'].includes(previous.state))continue;
    if(previous?.nextAt>this.now())continue;
    const d=app.deliveries[id]={state:'sending',phoneMasked:visitor.phone.slice(0,3)+'****'+visitor.phone.slice(-4),visitorName:visitor.name,templateCode:this.env.ALIYUN_SMS_TEMPLATE_CODE,signName:this.env.ALIYUN_SMS_SIGN_NAME,attemptAt:this.now(),attempts:(previous?.attempts||0)+1};
    app.state='processing';await this.save();
    try{const result=await this.send({phone:visitor.phone,name:visitor.name,sp_no:job.sp_no,code,outId:id.slice(0,32)});if(!result?.bizId){const e=Error('未确认受理编号');e.uncertain=true;throw e;}Object.assign(d,{state:'accepted',bizId:result.bizId,requestId:result.requestId,acceptedAt:this.now()});}
    catch(error){d.state=error.uncertain?'uncertain':error.retryable&&d.attempts<6?'retry':'failed';d.error=safeId(error.code)|| (error.uncertain?'发送结果未确认，禁止自动重发':'短信未受理，请检查配置或资料');d.requestId=safeId(error.requestId);if(d.state==='retry')d.nextAt=this.now()+300000;}
    await this.save();
   }
   const states=Object.values(app.deliveries).map(d=>d.state);app.state=states.includes('retry')?'retry':states.every(s=>s==='accepted')?'accepted':states.includes('uncertain')?'uncertain':'failed';app.closed=!states.includes('retry');await this.save();
  }}finally{this.busy=false;}
 }
}
