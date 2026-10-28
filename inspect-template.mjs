import fs from 'node:fs';
for(const line of fs.readFileSync('.env','utf8').split(/\r?\n/)){const i=line.indexOf('=');if(i>0)process.env[line.slice(0,i).trim()]=line.slice(i+1).trim()}
const e=process.env;
try { const t=await (await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${e.WECOM_CORP_ID}&corpsecret=${e.WECOM_SECRET}`)).json();
if(t.errcode) console.log(JSON.stringify({stage:'token',code:t.errcode,message:t.errmsg}));
else {const r=await(await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${t.access_token}`,{method:'POST',body:JSON.stringify({template_id:e.WECOM_TEMPLATE_ID})})).json();fs.mkdirSync('private',{recursive:true});fs.writeFileSync('private/template.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r));}}
catch { console.log('Connection failed'); }
