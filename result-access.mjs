import crypto from 'node:crypto';
function signature(job,expires,env){const key=Buffer.from(env.GATE_PASS_SECRET||'','hex');if(key.length!==32||!job.hostUserid)throw Error('结果通知链接配置未完成');return crypto.createHmac('sha256',key).update('result-v1:'+job.sp_no+':'+job.hostUserid+':'+expires).digest('hex');}
export function resultLink(job,env,now=Date.now()){
 if(!job.resultLinkExpiresAt||job.resultLinkExpiresAt<now)job.resultLinkExpiresAt=now+7*86400000;
 const token=job.sp_no+'.'+job.resultLinkExpiresAt+'.'+signature(job,job.resultLinkExpiresAt,env);
 return (env.BASE_URL||'https://visitor.example.com')+'/result#token='+token;
}
export function resultJob(token,jobs,env,now=Date.now()){
 const invalid=()=>Error('结果链接无效或已过期，请通过申请状态查询页查询');
 if(typeof token!=='string')throw invalid();const m=token.match(/^(\d{10,30})\.(\d{13})\.([a-f0-9]{64})$/);if(!m)throw invalid();
 const job=[...jobs.values()].find(j=>j.sp_no===m[1]);if(!job||Number(m[2])<now||job.resultLinkExpiresAt!==Number(m[2]))throw invalid();
 const expected=signature(job,Number(m[2]),env);if(!crypto.timingSafeEqual(Buffer.from(m[3],'hex'),Buffer.from(expected,'hex')))throw invalid();return job;
}
