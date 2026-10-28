import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export function visitWindow(date,start,end,endDate=date){const a=+new Date(date+'T'+start+':00+08:00'),b=+new Date(endDate+'T'+end+':00+08:00');if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw Error('预约时段无效');return {startAt:a,endAt:b};}
export function windowStatus(record,now=Date.now()){return now<record.startAt?'upcoming':now>=record.endAt?'expired':'active';}
const title=c=>c.property?.title?.find(t=>t.lang==='zh_CN')?.text||c.property?.title?.[0]?.text||'';
export function extractVisitors(info,template){
 const rows=[];
 for(const table of template.template_content?.controls||[]){if(table.property.control!=='Table')continue;const children=table.config?.table?.children||[],name=children.find(c=>title(c)==='姓名')?.property.id,phone=children.find(c=>['手机号码','手机号'].includes(title(c)))?.property.id;if(!name||!phone)continue;
  const value=info.apply_data?.contents?.find(c=>c.id===table.property.id)?.value;
  for(const row of value?.children||[]){const n=row.list?.find(c=>c.id===name)?.value?.text,p=row.list?.find(c=>c.id===phone)?.value?.text?.trim();if(typeof n==='string'&&/^1[3-9]\d{9}$/.test(p))rows.push({name:n,phone:p});}
 }
 if(!rows.length)throw Error('审批单中无可核验的访客手机号');return rows;
}
export class GatePass{
 constructor({env,api,now=Date.now}){this.env=env;this.api=api;this.now=now;this.records=new Map();this.issuing=new Map();this.queue=Promise.resolve();this.file=path.join(env.DATA_DIR||'private/runtime','gate-passes.json');this.key=env.GATE_PASS_SECRET?Buffer.from(env.GATE_PASS_SECRET,'hex'):null;}
 hash(value){if(this.key?.length!==32)throw Error('核验服务密钥未配置');return crypto.createHmac('sha256',this.key).update(value).digest('hex');}
 encrypt(code){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv),text=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),text]).toString('base64');}
 decrypt(value){const b=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
 async init(){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{this.records=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(){const snapshot=JSON.stringify([...this.records]);const p=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',snapshot,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=p;return p;}
 async issue(job,info){
  if(info.sp_no!==job.sp_no||info.sp_status!==2||info.template_id!==this.env.WECOM_TEMPLATE_ID)throw Error('审批未通过，不能签发临时入校卡');
  if(this.issuing.has(job.sp_no))return this.issuing.get(job.sp_no);
  const work=this.issueRecord(job,info);this.issuing.set(job.sp_no,work);try{return await work;}finally{this.issuing.delete(job.sp_no);}
 }
 async issueRecord(job,info){
  if(this.records.has(job.sp_no)){const r=this.records.get(job.sp_no);return {verifyCode:this.decrypt(r.codeCipher)};}
  const template=await this.api('oa/gettemplatedetail',{template_id:this.env.WECOM_TEMPLATE_ID}),visitors=extractVisitors(info,template),window=visitWindow(job.date,job.start,job.end,job.endDate);
  const phones=new Set(visitors.map(v=>this.hash('phone:'+v.phone)));let code,tries=0;
  do{if(++tries>10000)throw Error('核验码暂无法分配，请稍后重试');code=String(crypto.randomInt(0,10000)).padStart(4,'0');}while([...this.records.values()].some(r=>r.endAt>this.now()&&r.codeHash===this.hash('code:'+code)&&r.visitors.some(v=>phones.has(v.phoneHash))));
  const record={sp_no:job.sp_no,templateId:info.template_id,codeHash:this.hash('code:'+code),codeCipher:this.encrypt(code),date:job.date,start:job.start,end:job.end,endDate:job.endDate||job.date,...window,visitors:visitors.map(v=>({name:v.name,phoneHash:this.hash('phone:'+v.phone)})),createdAt:this.now()};
  this.records.set(job.sp_no,record);await this.save();return {verifyCode:code};
 }
 async verify(phone,code){
  if(typeof phone!=='string'||!/^1[3-9]\d{9}$/.test(phone)||typeof code!=='string'||! /^(\d{4}|\d{8})$/.test(code))throw Error('手机号或验证码不正确，或入校卡已失效');
  const codeHash=this.hash('code:'+code),phoneHash=this.hash('phone:'+phone);
  for(const record of this.records.values()){if(record.codeHash!==codeHash)continue;const visitor=record.visitors.find(v=>v.phoneHash===phoneHash);if(!visitor||this.now()>=record.endAt)continue;
   await this.check(record);return {record,visitor,phoneHash};
  }throw Error('手机号或验证码不正确，或入校卡已失效');
 }
 async check(record){
  const result=await this.api('oa/getapprovaldetail',{sp_no:record.sp_no});if(result.info?.sp_no!==record.sp_no||result.info?.template_id!==record.templateId||result.info?.sp_status!==2)throw Error('此申请已非审批通过状态，临时入校卡无效');return true;
 }
 async card(sp_no,phoneHash){const r=this.records.get(sp_no),v=r?.visitors.find(v=>v.phoneHash===phoneHash);if(!r||!v)throw Error('核验会话已失效，请重新核验');await this.check(r);return {name:v.name,sp_no:r.sp_no,date:r.endDate&&r.endDate!==r.date?r.date+' 至 '+r.endDate:r.date,start:r.start,end:r.end,status:windowStatus(r,this.now()),serverTime:this.now(),startAt:r.startAt,endAt:r.endAt};}
}
