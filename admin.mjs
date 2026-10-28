import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export class AdminPortal {
 constructor({env,audit,freeVehicles,now=Date.now}){this.env=env;this.audit=audit;this.freeVehicles=freeVehicles;this.now=now;this.sessions=new Map();this.rates=new Map();this.username=env.ADMIN_USERNAME?.trim();this.hash=env.ADMIN_PASSWORD&&this.username?crypto.scryptSync(env.ADMIN_PASSWORD,'visitor-admin-v1',32):null;}
 async handle(req,res,url,ip){if(!url.pathname.startsWith('/admin')&&!url.pathname.startsWith('/api/admin/'))return false;
 res.setHeader('Cache-Control','no-store');if(!this.hash){send(res,503,{error:'管理入口尚未配置'});return true;}
 try{
 const now=this.now();for(const [k,v] of this.sessions)if(v.until<now)this.sessions.delete(k);for(const [k,v] of this.rates)if(v.until<now)this.rates.delete(k);
 const id=req.headers.cookie?.match(/(?:^|; )visitor_admin=([a-f0-9]{64})/)?.[1],session=this.sessions.get(id);
 const body=async()=>{let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>4096)throw Error('请求过大');}return JSON.parse(raw||'{}');};
 if(req.method==='POST'&&url.pathname==='/api/admin/login'){
  if(req.headers.origin!==new URL(this.env.BASE_URL||'http://localhost:'+(this.env.PORT||3000)).origin){send(res,403,{error:'请求来源无效'});return true;}
  const rate=this.rates.get(ip)||{n:0,until:now+900000};this.rates.set(ip,rate);if(++rate.n>8){send(res,429,{error:'登录尝试过多，请15分钟后重试'});return true;}
  const data=await body();const usernameHash=crypto.createHash('sha256').update(typeof data.username==='string'?data.username:'').digest(),expectedUsername=crypto.createHash('sha256').update(this.username).digest();if(typeof data.password!=='string'||data.password.length>256||!crypto.timingSafeEqual(crypto.scryptSync(data.password,'visitor-admin-v1',32),this.hash)||!crypto.timingSafeEqual(usernameHash,expectedUsername)){send(res,401,{error:'用户名或密码不正确'});return true;}
  const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');this.sessions.set(token,{until:now+8*3600000,csrf,username:this.username});this.rates.delete(ip);res.setHeader('Set-Cookie','visitor_admin='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'+(this.env.BASE_URL?.startsWith('https:')?'; Secure':''));send(res,200,{csrf});return true;
 }
 const assets={'/admin':'admin.html','/admin/dashboard':'admin.html','/admin/records':'admin.html','/admin/free-vehicles':'admin.html','/admin/app.js':'admin.js','/admin/style.css':'admin.css'};
 if(req.method==='GET'&&assets[url.pathname]){const name=assets[url.pathname];res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(await fs.readFile(new URL('./public/'+name,import.meta.url)));return true;}
 if(!session||session.until<=now){send(res,401,{error:'请先登录管理后台'});return true;}
 if(req.method!=='GET'&&(req.headers['x-csrf-token']!==session.csrf||req.headers.origin!==new URL(this.env.BASE_URL||'http://localhost:'+(this.env.PORT||3000)).origin)){send(res,403,{error:'管理会话校验失败，请刷新页面'});return true;}
 const filters=Object.fromEntries(url.searchParams);
 if(req.method==='GET'&&url.pathname==='/api/admin/session')send(res,200,{csrf:session.csrf,username:session.username});
 else if(req.method==='GET'&&url.pathname==='/api/admin/records')send(res,200,this.audit.list(filters));
 else if(req.method==='GET'&&url.pathname==='/api/admin/stats')send(res,200,this.audit.stats(filters));
 else if(req.method==='GET'&&url.pathname==='/api/admin/record')send(res,200,this.audit.record(filters.id));
 else if(req.method==='GET'&&url.pathname==='/api/admin/free/candidates'){if(!filters.name?.trim())throw Error('请输入来访者姓名或校内被访者姓名');send(res,200,this.audit.list({name:filters.name.trim(),status:'2',has_vehicle:'1',page:filters.page}));}
 else if(req.method==='GET'&&url.pathname==='/api/admin/free/logs')send(res,200,this.audit.feeLogs(filters));
 else if(req.method==='POST'&&url.pathname==='/api/admin/free'){const d=await body();if(d.action!=='request')throw Error('仅支持免费登记，不支持撤销');if(!this.freeVehicles)throw Error('免费车辆接口尚未配置');send(res,200,await this.freeVehicles.register(d.id,session.username));}
 else if(req.method==='POST'&&url.pathname==='/api/admin/logout'){this.sessions.delete(id);res.setHeader('Set-Cookie','visitor_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');send(res,200,{ok:true});}
 else send(res,404,{error:'未找到管理接口'});
 }catch(error){send(res,400,{error:error.message.startsWith('SQLite')?'数据库查询失败':error.message});}return true;
 }
}
