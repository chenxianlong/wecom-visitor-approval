import {visitWindow} from './gate-pass.mjs';
import {validatePlate} from './plate.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';


export function carExitDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('门禁入校日期无效');
 const value=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(+value)||value.toISOString().slice(0,10)!==date)throw Error('门禁入校日期无效');
 value.setUTCDate(value.getUTCDate()+1);
 return value.toISOString().slice(0,10);
}
export function carGateUrl(job,token,endpoint='https://gate.example.com/vehicle-access'){
 if(!token||/[\r\n]/.test(token))throw Error('门禁接口令牌未配置');
 const plate=validatePlate(job.plate);
 if(!plate||!job.hostName||!job.hostUserid||!/^1[3-9]\d{9}$/.test(job.firstVisitorPhone||'')||!/^\d{4}-\d{2}-\d{2}$/.test(job.date||''))throw Error('门禁推送资料不完整');
 const url=new URL(endpoint);
 url.search=new URLSearchParams({token:token,plate:plate,validFrom:job.date,validUntil:carExitDate(job.date),hostName:job.hostName,hostId:job.hostUserid,visitorPhone:job.firstVisitorPhone}).toString();
 return url;
}
// Independent durable delivery ledger. HTTP acknowledgement is not business acceptance.
export class CarGate{
 constructor({env,api,now=Date.now,fetcher=fetch,refreshJob=async()=>{}}){this.env=env;this.api=api;this.now=now;this.refreshJob=refreshJob;this.fetcher=fetcher;this.records=new Map();this.file=path.join(env.DATA_DIR||'private/runtime','car-gate-deliveries.json');this.queue=Promise.resolve();this.busy=false;}
 async init(){
  if(this.env.CAR_GATE_ENABLED==='true'&&(!this.env.CAR_GATE_TOKEN||!this.env.CAR_GATE_URL))throw Error('已启用门禁推送但未配置令牌');
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
  try{this.records=new Map(JSON.parse(await fs.readFile(this.file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const record of this.records.values())if(record.state==='sending'){record.state='uncertain';record.note='发送期间服务中断，需人工核实，禁止自动重发';}
  await this.save();
 }
 async save(){const content=JSON.stringify([...this.records]);const task=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',content,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});this.queue=task;await task;}
 async drain(jobs){
  if(this.env.CAR_GATE_ENABLED!=='true'||this.busy)return;
  this.busy=true;
  try{let count=0;for(const job of jobs.values()){
   // Do not backfill historical applications lacking an explicit delivery request.
   if(job.carGateRequested!==true||!job.sp_no||this.records.has(job.sp_no)||job.carGateNextAt>this.now())continue;
   if(++count>100)break;
   let info;try{info=(await this.api('oa/getapprovaldetail',{sp_no:job.sp_no})).info;}catch{job.carGateNextAt=this.now()+300000;continue;}
   if(info?.sp_no!==job.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||info.applyer?.userid!==job.hostUserid){this.records.set(job.sp_no,{state:'invalid',at:this.now(),note:'审批编号、模板或申请人核对失败'});await this.save();continue;}
   if([3,4,6,7].includes(info.sp_status)){this.records.set(job.sp_no,{state:'closed',at:this.now()});await this.save();continue;}
   if(info.sp_status!==2){job.carGateNextAt=this.now()+60000;continue;}
   try{await this.refreshJob(job,info);}catch{job.carGateNextAt=this.now()+300000;continue;}
   if(!job.plate){this.records.set(job.sp_no,{state:'no_vehicle',at:this.now()});await this.save();continue;}
   let url;try{url=carGateUrl(job,this.env.CAR_GATE_TOKEN,this.env.CAR_GATE_URL);}catch(error){this.records.set(job.sp_no,{state:'invalid',at:this.now(),note:error.message?.includes('车牌')?'车牌格式不正确，未向门禁发送；请核对原审批单车牌':'门禁推送配置或资料不完整'});await this.save();continue;}
   let window;try{window=visitWindow(job.date,job.start,job.end,job.endDate);}catch{this.records.set(job.sp_no,{state:'invalid',at:this.now(),note:'预约时间无效'});await this.save();continue;}
   if(window.endAt<=this.now()){this.records.set(job.sp_no,{state:'expired',at:this.now()});await this.save();continue;}
   const record={state:'sending',at:this.now()};this.records.set(job.sp_no,record);await this.save();
   try{
    // This GET changes gate access; never follow redirects or retry an uncertain delivery.
    const response=await this.fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'application/json, text/plain, */*','Cache-Control':'no-store'},signal:AbortSignal.timeout(15000)});
    record.httpStatus=response.status;
    record.state=response.ok?'response_received':'uncertain';
    record.note=response.ok?'HTTP响应已收到；业务成功格式尚未约定，不能据此认定车辆已授权':'接口返回异常，需人工核实，禁止自动重发';
    // Store neither the token-bearing URL nor a body that could echo personal data.
    if(response.body)await response.body.cancel();
   }catch{record.state='uncertain';record.note='请求结果未确认，需人工核实，禁止自动重发';}
   record.finishedAt=this.now();await this.save();
  }}finally{this.busy=false;}
 }
}
