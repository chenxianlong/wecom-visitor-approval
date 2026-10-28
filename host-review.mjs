import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const token=()=>crypto.randomBytes(32).toString('hex');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function applicant(data){
 for(const [key,label,max] of [['applicantOrg','外部申请人单位',120],['applicantName','外部申请人姓名',50],['visitType','访问类型',100]])if(typeof data?.[key]!=='string'||!data[key].trim()||data[key].length>max)throw Error('请正确填写'+label);
 return {applicantOrg:data.applicantOrg.trim(),applicantName:data.applicantName.trim(),visitType:data.visitType};
}
export function decision(record,userid,action,now=Date.now()){
 if(!record||record.until<now)throw Error('请求已过期，请让申请人重新发起');
 if(userid!==record.userid)throw Error('仅被访人本人可以处理此请求');
 if(!['approve','reject'].includes(action))throw Error('无效操作');
 const status=action==='approve'?'approved':'rejected';
 if(record.status===status)return;
 if(record.status!=='pending')throw Error('请求已处理或已失效');
 record.status=status;record.decidedAt=now;
}
export class HostReview{
 constructor({api,env,json}){this.api=api;this.env=env;this.json=json;this.records=new Map();this.states=new Map();this.logins=new Map();this.queue=Promise.resolve();this.file=path.join(env.DATA_DIR||'private/runtime','host-reviews.json');}
 async init(){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{this.records=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}}
 async save(){const snapshot=JSON.stringify([...this.records]);const work=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',snapshot,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=work;return work;}
 status(id){const r=this.records.get(id);return !r?'missing':r.until<Date.now()?'expired':r.status;}
 assertApproved(id,hash){const r=this.records.get(id);if(!r||r.hash!==hash||this.status(id)!=='approved')throw Error('须被访人在企业微信中同意后，才能填写并提交入校信息');return r;}
 async request(details,data,hash){
  if(!this.env.BASE_URL?.startsWith('https://'))throw Error('请从学校已部署的HTTPS地址发起被访人确认请求');
  const a=applicant(data),now=Date.now();
  for(const r of this.records.values())if(r.userid===details.userid&&now-r.createdAt<120000)throw Error('已向该被访人发送过请求，请等待回复，2分钟内请勿重复发送');
  const ticket=token(),id=token(),r={id,hash,userid:details.userid,...a,ticketHash:digest(ticket),createdAt:now,until:now+7200000,status:'sending'};
  for(const [key,old]of this.records)if(old.until<now-86400000)this.records.delete(key);
  this.records.set(id,r);await this.save();
  const url=this.env.BASE_URL+'/host-review?ticket='+ticket;
  try{const result=await this.api('message/send',{touser:details.userid,msgtype:'textcard',agentid:Number(this.env.WECOM_AGENT_ID),textcard:{title:'校外来访 · 被访人确认',description:'<div class="normal">申请人：'+escape(a.applicantName)+'</div><div class="normal">单位：'+escape(a.applicantOrg)+'</div><div class="gray">请确认是否同意对方继续填写入校申请。本次确认不代替学校最终审批。请求2小时内有效。</div>',url,btntxt:'查看并处理'},enable_duplicate_check:1,duplicate_check_interval:120});if(result.invaliduser||result.unlicenseduser)throw Error('被访人不在消息可达范围');r.status='pending';await this.save();return id;}catch(err){r.status='send_failed';await this.save();throw Error('被访人确认消息未成功送达，请检查应用消息权限或稍后重试（'+(err.code||'发送结果未确认')+'）');}
 }
 async cancel(id){const r=this.records.get(id);if(r&&['pending','approved'].includes(r.status)){r.status='cancelled';await this.save();}}
 async submitted(id){const r=this.records.get(id);if(r){r.status='submitted';await this.save();}}
 cookie(name,value,age){return name+'='+value+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+age+(this.env.BASE_URL?.startsWith('https:')?'; Secure':'');}
 login(req){const id=req.headers.cookie?.match(/(?:^|; )host_review_session=([a-f0-9]+)/)?.[1],s=this.logins.get(id);return s&&s.until>Date.now()?s:null;}
 async handle(req,res,url){
  if(req.method==='GET'&&url.pathname==='/host-review'){
   const ticket=url.searchParams.get('ticket')||'';if(!/^[a-f0-9]{64}$/.test(ticket))throw Error('无效确认链接');
   const r=[...this.records.values()].find(r=>r.ticketHash===digest(ticket));if(!r||r.until<Date.now())throw Error('确认链接已过期');
   const state=token();this.states.set(state,{id:r.id,until:Date.now()+600000});res.setHeader('Set-Cookie',this.cookie('host_review_oauth',state,600));
   const q=new URLSearchParams({appid:this.env.WECOM_CORP_ID,redirect_uri:this.env.BASE_URL+'/host-review/callback',response_type:'code',scope:'snsapi_base',state,agentid:this.env.WECOM_AGENT_ID});
   res.writeHead(302,{Location:'https://open.weixin.qq.com/connect/oauth2/authorize?'+q+'#wechat_redirect','Cache-Control':'no-store'});res.end();return true;
  }
  if(req.method==='GET'&&url.pathname==='/host-review/callback'){
   const state=url.searchParams.get('state'),browser=req.headers.cookie?.match(/(?:^|; )host_review_oauth=([a-f0-9]+)/)?.[1],s=this.states.get(state);this.states.delete(state);
   if(!s||state!==browser||s.until<Date.now())throw Error('身份验证已失效，请从企业微信消息重新打开');
   const auth=await this.api('auth/getuserinfo',{code:url.searchParams.get('code')||''},'GET');const userid=auth.userid||auth.UserId,r=this.records.get(s.id);
   if(!userid||userid!==r?.userid)throw Error('仅被访人本人可处理，请使用收到消息的企业微信账号打开');
   const id=token();this.logins.set(id,{id:r.id,userid,csrf:token(),until:Date.now()+1800000});res.setHeader('Set-Cookie',[this.cookie('host_review_session',id,1800),this.cookie('host_review_oauth','',0)]);res.writeHead(303,{Location:'/host-review/view','Cache-Control':'no-store'});res.end();return true;
  }
  if(url.pathname==='/api/host-review'){
   const login=this.login(req);if(!login)return this.json(res,403,{error:'请在企业微信中重新打开确认消息'}),true;
   const r=this.records.get(login.id);if(!r||r.userid!==login.userid)throw Error('无权处理');
   if(req.method==='GET'){this.json(res,200,{applicantName:r.applicantName,applicantOrg:r.applicantOrg,status:this.status(r.id),csrf:login.csrf});return true;}
   if(req.method==='POST'){
    if(req.headers['x-csrf-token']!==login.csrf||req.headers.origin!==this.env.BASE_URL)throw Error('请求校验失败');
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)throw Error('请求过大');}
    decision(r,login.userid,JSON.parse(raw).action);await this.save();this.json(res,200,{status:r.status});return true;
   }
  }
  return false;
 }
}
