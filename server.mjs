import {PhoneVerification} from './phone-verification.mjs';
import {AuditStore} from './audit-store.mjs';
import {FreeVehicles} from './free-vehicles.mjs';
import {AdminPortal} from './admin.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {buildPayload,visitOptions,validate} from './approval.mjs';
import {resolveHost,validateHost,sameVerifiedHost} from './host.mjs';
import {Notifications,notificationEmail} from './notifications.mjs';
import {GatePass} from './gate-pass.mjs';
import {ApprovalQuery} from './approval-query.mjs';
import {resultJob} from './result-access.mjs';
import {TemplateScope} from './template-scope.mjs';
const e=process.env,port=Number(e.PORT||3000);
const audit=new AuditStore({dir:e.DATA_DIR||'private/runtime'});
const admin=new AdminPortal({env:e,audit,freeVehicles:new FreeVehicles({env:e,audit,api})});
let cached,expires=0;
async function api(path,body,method='POST'){
 if(!cached||Date.now()>expires){const r=await(await fetch('https://qyapi.weixin.qq.com/cgi-bin/gettoken?'+new URLSearchParams({corpid:e.WECOM_CORP_ID||'',corpsecret:e.WECOM_SECRET||''}),{signal:AbortSignal.timeout(15000)})).json();if(r.errcode)throw Error('企业微信凭证获取失败（'+r.errcode+'）');cached=r.access_token;expires=Date.now()+(r.expires_in-120)*1000;}
 const query=new URLSearchParams({access_token:cached,...(method==='GET'?body:{})});
 const r=await(await fetch('https://qyapi.weixin.qq.com/cgi-bin/'+path+'?'+query,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})).json();
 if(r.errcode){if([40014,42001].includes(r.errcode))expires=0;const err=Error('企业微信接口返回 '+r.errcode+'；请管理员核对模板、应用权限和可信 IP');err.code=r.errcode;throw err;}if(path==='oa/getapprovaldetail'&&r.info?.template_id===e.WECOM_TEMPLATE_ID){try{audit.detail(r.info);}catch{console.error('SQLite审批日志写入失败，请检查磁盘');}}return r;
}
const phoneVerification=new PhoneVerification({db:audit.db,env:e});
const sessions=new Map(),rates=new Map(),attempts=new Map();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function session(req){const id=req.headers.cookie?.match(/(?:^|; )visitor_session=([a-f0-9]+)/)?.[1],s=sessions.get(id);return s&&s.until>Date.now()?s:null;}
const hostHash=data=>crypto.createHash('sha256').update(JSON.stringify(validateHost(data))).digest('hex');
const gate=new GatePass({env:e,api});await gate.init();
const gateSessions=new Map(),gateRates=new Map(),gatePhoneFailures=new Map();
function gateSession(req){const id=req.headers.cookie?.match(/(?:^|; )gate_session=([a-f0-9]+)/)?.[1],s=gateSessions.get(id);return s&&s.until>Date.now()?s:null;}
const notifications=new Notifications({env:e,api,gate,audit});await notifications.init();
const approvalQuery=new ApprovalQuery({env:e,api,gate,jobs:notifications.jobs,findCandidates:async(hostName,date)=>{const d=notifications.discovery;if(d.state&&e.TEMPLATE_DISCOVERY_ENABLED==='true'){const now=Date.now();for(let start=d.state.activatedAt;start<now;start+=30*86400000)await d.scan(start,Math.min(now,start+30*86400000));await d.save();}const rows=audit.db.prepare('SELECT sp_no FROM applications WHERE visit_date=? AND sp_no IS NOT NULL').all(date);return [...new Set([...rows.map(r=>r.sp_no),...Object.keys(d.state?.pending||{})])];}});
const templateScope=new TemplateScope({env:e,api});
const server=http.createServer(async(req,res)=>{
 const peer=req.socket.remoteAddress?.replace(/^::ffff:/,'');
 if(e.TRUSTED_PROXY_IP&&![e.TRUSTED_PROXY_IP,'127.0.0.1','::1'].includes(peer))return json(res,403,{error:'请通过学校公开域名访问'});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{const url=new URL(req.url,'http://localhost');
 if(await admin.handle(req,res,url,peer===e.TRUSTED_PROXY_IP?(req.headers['x-real-ip']||peer):peer))return;
 if(req.method==='GET'&&['/verify','/query','/result'].includes(url.pathname)&&!gateSession(req)){
  const id=crypto.randomBytes(32).toString('hex');gateSessions.set(id,{csrf:crypto.randomBytes(32).toString('hex'),until:Date.now()+7200000});res.setHeader('Set-Cookie','gate_session='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200'+(e.BASE_URL?.startsWith('https:')?'; Secure':''));
 }
 if(req.method==='GET'&&url.pathname==='/api/gate/config'){const s=gateSession(req);return s?json(res,200,{csrf:s.csrf}):json(res,403,{error:'请刷新核验页面'});}
 if(req.method==='POST'&&['/api/gate/verify','/api/approval/query','/api/approval/result'].includes(url.pathname)){
  const s=gateSession(req);if(!s||req.headers['x-csrf-token']!==s.csrf||req.headers.origin!==new URL(e.BASE_URL||'http://localhost:'+port).origin)return json(res,403,{error:'核验会话已失效，请刷新页面'});
  const ip=peer===e.TRUSTED_PROXY_IP?(req.headers['x-real-ip']||peer):peer,rate=gateRates.get(ip)||{count:0,until:Date.now()+60000};if(rate.until<Date.now()){rate.count=0;rate.until=Date.now()+60000;}gateRates.set(ip,rate);if(++rate.count>6)return json(res,429,{error:'尝试次数过多，请一分钟后再试'});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return json(res,413,{error:'核验请求过大'});}
  const data=JSON.parse(raw);
  if(url.pathname==='/api/approval/query')return json(res,200,await approvalQuery.lookup(data.hostName,data.visitorName,data.phone,data.date));
  if(url.pathname==='/api/approval/result'){
   const job=resultJob(data.token,notifications.jobs,e),detail=await api('oa/getapprovaldetail',{sp_no:job.sp_no});
   if(detail.info?.applyer?.userid!==job.hostUserid)throw Error('审批申请人身份已变化，此链接不可用');
   return json(res,200,await approvalQuery.result(job,detail.info));
  }
  const phoneKey=typeof data.phone==='string'?gate.hash('verify-failures:'+data.phone):null,failed=phoneKey?gatePhoneFailures.get(phoneKey):null;
  if(failed&&failed.until>Date.now()&&failed.count>=6)return json(res,429,{error:'该手机号核验失败次数过多，请15分钟后再试'});
  delete s.sp_no;delete s.phoneHash;let result;
  try{result=await gate.verify(data.phone,data.code);}catch(err){if(phoneKey){const f=failed&&failed.until>Date.now()?failed:{count:0,until:Date.now()+900000};f.count++;gatePhoneFailures.set(phoneKey,f);}throw err;}
  if(phoneKey)gatePhoneFailures.delete(phoneKey);s.sp_no=result.record.sp_no;s.phoneHash=result.phoneHash;s.cardUntil=Date.now()+600000;
  return json(res,200,await gate.card(s.sp_no,s.phoneHash));
 }
 if(req.method==='GET'&&url.pathname==='/api/gate/card'){
  const s=gateSession(req);if(!s?.sp_no||s.cardUntil<Date.now())return json(res,403,{error:'核验会话已过期，请重新输入手机号和验证码'});
  return json(res,200,await gate.card(s.sp_no,s.phoneHash));
 }
 if(url.pathname.startsWith('/host-review')||url.pathname==='/api/host-review'||url.pathname==='/api/host/status'||url.pathname==='/api/host/confirm')return json(res,410,{error:'已切换为企业微信原生审批，请刷新表单。完整填写提交后，由被访人在企业微信审批中处理。'});
 if(req.method==='GET'&&url.pathname==='/'&&e.PUBLIC_FORM_ENABLED==='true'&&!session(req)){
  const id=crypto.randomBytes(32).toString('hex');sessions.set(id,{csrf:crypto.randomBytes(32).toString('hex'),until:Date.now()+7200000});res.setHeader('Set-Cookie','visitor_session='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200'+(e.BASE_URL?.startsWith('https:')?'; Secure':''));
 }
 if(req.method==='GET'&&url.pathname==='/api/config'){
  const s=session(req);let options=[],problem='';
  if(e.PUBLIC_FORM_ENABLED!=='true'&&!e.VISITOR_INVITE_TOKEN)problem='管理员尚未配置访客入口，当前仅可预览。';
  else if(!s)problem='请使用学校提供的完整邀请链接打开表单。';
  let rangeType;
  try{const template=await api('oa/gettemplatedetail',{template_id:e.WECOM_TEMPLATE_ID});options=visitOptions(template);rangeType=template.template_content?.controls?.find(c=>c.property.control==='DateRange')?.config?.date_range?.type;if(!options.length)problem='模板访问类型选项尚未适配';}catch(err){problem=err.message;}
  return json(res,200,{ready:!!s&&!problem,options,rangeType,problem,csrf:s?.csrf,workflow:'native-applicant-first-v1',requiresHostPreApproval:false,phoneVerificationRequired:true,phoneVerificationReady:phoneVerification.ready(),smsEnabled:notifications.sms.enabled()&&notifications.sms.configValid()&&!!notifications.sms.state.activatedAt});
 }
 if(req.method==='POST'&&['/api/submit','/api/host/verify','/api/phone/send','/api/phone/verify'].includes(url.pathname)){
  const s=session(req);if(!s||req.headers['x-csrf-token']!==s.csrf)return json(res,403,{error:'填报会话已失效，请重新打开表单'});
  const origin=req.headers.origin;if((origin||url.pathname.startsWith('/api/phone/'))&&origin!==new URL(e.BASE_URL||'http://localhost:'+port).origin)return json(res,403,{error:'请求来源不被允许'});
  const ip=peer===e.TRUSTED_PROXY_IP?(req.headers['x-real-ip']||peer):peer,rate=rates.get(ip)||{count:0,until:Date.now()+60000};if(rate.until<Date.now()){rate.count=0;rate.until=Date.now()+60000;}rates.set(ip,rate);if(++rate.count>10)return json(res,429,{error:'提交过于频繁，请稍后再试'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)return json(res,413,{error:'表单内容过大'});}
  let data;try{data=JSON.parse(raw);}catch{return json(res,400,{error:'表单格式错误'});}
  if(url.pathname==='/api/host/verify'){
   const hash=hostHash(data);
   s.host=null;
   const details=await resolveHost(data,api,true);if(e.TEMPLATE_SCOPE_FILE)await templateScope.assertEligible(details.userid);const token=crypto.randomBytes(32).toString('hex');
   s.host={hash,token,userid:details.userid,confirmed:true,departmentId:details.departmentId,departmentIds:details.departmentIds,departmentName:details.departmentName,departmentIncomplete:!!details.departmentIncomplete,until:Date.now()+7200000};
   return json(res,200,{verified:true,departmentName:details.departmentName,departmentIncomplete:!!details.departmentIncomplete,verificationToken:token,workflow:'native-applicant-first-v1',message:'被访人核对通过，可以填写入校信息。完整提交后，由被访人在企业微信审批中处理。'});
  }
  if(!s.host?.confirmed||s.host.until<Date.now()||s.host.hash!==hostHash(data)||data.verificationToken!==s.host.token)return json(res,409,{error:'请先核对并确认校内被访人的所属部门'});
  if(url.pathname==='/api/phone/send')return json(res,200,await phoneVerification.request(s.csrf,ip,data.visitor));
  if(url.pathname==='/api/phone/verify')return json(res,200,phoneVerification.verify(s.csrf,ip,data.visitor,data.challengeId,data.code));
  const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[a-f0-9-]{36}$/.test(key))return json(res,400,{error:'缺少有效提交标识'});
  const hash=crypto.createHash('sha256').update(raw).digest('hex'),old=attempts.get(key);if(old){if(old.hash!==hash)return json(res,409,{error:'请勿修改已经提交的请求'});if(old.result)return json(res,200,old.result);return json(res,409,{error:'申请已发送或正在处理，请先联系学校确认，避免重复申请'});}
  const persisted=notifications.jobs.get(key);if(persisted){if(persisted.hash!==hash)return json(res,409,{error:'提交标识已使用，请先核实原申请'});if(persisted.sp_no)return json(res,200,{sp_no:persisted.sp_no,emailNotification:persisted.email?'scheduled':'not_requested',smsNotification:notifications.sms.eligible(persisted)?'scheduled':'not_requested'});return json(res,409,{error:'该提交已登记，请联系学校核实结果，勿重复提交'});}
  validate(data);
  notificationEmail(data.notificationEmail);
  phoneVerification.require(s.csrf,data.visitors[0],data.phoneChallengeId,key,hash);
  attempts.set(key,{hash,until:Date.now()+86400000});
  let payload;
  try{const details=await resolveHost(data,api,true);if(e.TEMPLATE_SCOPE_FILE)await templateScope.assertEligible(details.userid);if(!sameVerifiedHost(s.host,details)){console.error(JSON.stringify({event:'host-verification-changed',previousDepartmentId:s.host?.departmentId,currentDepartmentId:details.departmentId,previousDepartmentIds:s.host?.departmentIds,currentDepartmentIds:details.departmentIds,identityChanged:s.host?.userid!==details.userid}));s.host=null;const err=Error('校内被访人的身份已变化，请重新点击“核对被访人信息”后提交');err.requiresHostVerification=true;throw err;}const template=await api('oa/gettemplatedetail',{template_id:e.WECOM_TEMPLATE_ID});payload=buildPayload(data,template,details.userid,e.WECOM_TEMPLATE_ID);phoneVerification.consume(s.csrf,data.visitors[0],data.phoneChallengeId,key,hash);await notifications.prepare(key,hash,{...data,department:details.departmentName,hostUserid:details.userid});}catch(err){attempts.delete(key);throw err;}
  try{const result=await api('oa/applyevent',payload);if(!result.sp_no)throw Error('接口未返回审批编号，请联系学校确认');await notifications.bind(key,result.sp_no);const out={sp_no:result.sp_no,emailNotification:notificationEmail(data.notificationEmail)?'scheduled':'not_requested',smsNotification:notifications.sms.eligible(notifications.jobs.get(key))?'scheduled':'not_requested'};attempts.set(key,{hash,result:out,until:Date.now()+86400000});return json(res,200,out);}catch{return json(res,502,{error:'审批提交结果尚未确认，请联系学校核实，勿重复提交'});}
 }
 if(req.method==='GET'&&url.pathname==='/'){
  const invite=url.searchParams.get('invite');if(invite&&e.VISITOR_INVITE_TOKEN){const a=Buffer.from(invite),b=Buffer.from(e.VISITOR_INVITE_TOKEN);if(a.length===b.length&&crypto.timingSafeEqual(a,b)){const id=crypto.randomBytes(32).toString('hex');sessions.set(id,{csrf:crypto.randomBytes(32).toString('hex'),until:Date.now()+7200000});res.setHeader('Set-Cookie','visitor_session='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200'+(e.BASE_URL?.startsWith('https:')?'; Secure':''));res.writeHead(303,{Location:'/'});return res.end();}}
 }
 const files={'/plate-rules.mjs':['../plate.mjs','text/javascript; charset=utf-8'],'/plate-keyboard.js':['plate-keyboard.js','text/javascript; charset=utf-8'],'/plate-keyboard.css':['plate-keyboard.css','text/css; charset=utf-8'],'/result':['result.html','text/html; charset=utf-8'],'/result.js':['result.js','text/javascript; charset=utf-8'],'/logo.svg':['logo.svg','image/svg+xml'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/verify':['verify.html','text/html; charset=utf-8'],'/verify.js':['verify.js','text/javascript; charset=utf-8'],'/verify.css':['verify.css','text/css; charset=utf-8'],'/query':['query.html','text/html; charset=utf-8'],'/query.js':['query.js','text/javascript; charset=utf-8']},file=files[url.pathname];
 if(req.method!=='GET'||!file)return json(res,404,{error:'未找到'});
 res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});res.end(await fs.readFile(new URL('./public/'+file[0],import.meta.url)));
 }catch(err){json(res,err.statusCode||400,{error:err.name==='TimeoutError'?'企业微信连接超时，请稍后重试':err.message,...(err.requiresHostVerification?{requiresHostVerification:true}:{})});}
});
setInterval(()=>{for(const map of [sessions,rates,attempts,gateSessions,gateRates,gatePhoneFailures])for(const [k,v]of map)if(v.until<Date.now())map.delete(k);},60000).unref();
server.listen(port,e.BIND_HOST||'0.0.0.0',()=>console.log('访客申请服务已启动，端口：'+port));
notifications.start();
audit.syncPending(api).catch(()=>console.error('后台审批状态独立同步失败'));
setInterval(()=>audit.syncPending(api).catch(()=>console.error('后台审批状态独立同步失败')),60000).unref();
audit.hydrate(api).then(()=>audit.enrich(api)).catch(()=>console.error('日志部门资料补充失败'));
setInterval(()=>audit.hydrate(api).then(()=>audit.enrich(api)).catch(()=>console.error('日志部门资料补充失败')),300000).unref();
