import {extractTemplateJob} from './template-discovery.mjs';
import {extractVisitors,visitWindow} from './gate-pass.mjs';
export class ApprovalQuery{
 constructor({env,api,gate,jobs,findCandidates=async()=>[],now=Date.now}){this.env=env;this.api=api;this.gate=gate;this.jobs=jobs;this.findCandidates=findCandidates;this.now=now;}
 async lookup(hostName,visitorName,phone,date){
  const invalid=()=>Error('被访者姓名、访客姓名、访客手机号或来访日期不正确，或暂无匹配申请');
  if(typeof hostName!=='string'||!hostName.trim()||hostName.trim().length>50||typeof visitorName!=='string'||!visitorName.trim()||visitorName.trim().length>50||typeof phone!=='string'||!/^1[3-9]\d{9}$/.test(phone)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw invalid();
  const parsed=new Date(date+'T00:00:00Z');if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==date)throw invalid();
  const expectedName=hostName.trim().normalize('NFC'),members=new Map();
  const local=[...this.jobs.values()].filter(j=>j.sp_no&&j.date===date).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||b.sp_no.localeCompare(a.sp_no));
  const additional=await this.findCandidates(expectedName,date);const candidates=[...new Map([...local,...additional.map(sp_no=>local.find(j=>j.sp_no===sp_no)||{sp_no})].map(j=>[j.sp_no,j])).values()];
  if(!candidates.length)throw invalid();
  const template=await this.api('oa/gettemplatedetail',{template_id:this.env.WECOM_TEMPLATE_ID});
  const dateControl=template.template_content?.controls?.find(c=>c.property?.control==='Date'&&(c.property.title||[]).some(t=>t.text==='入校日期'));
  const results=[];let failures=0;
  for(let offset=0;offset<candidates.length;offset+=4){const group=await Promise.all(candidates.slice(offset,offset+4).map(async job=>{
   try{const info=(await this.api('oa/getapprovaldetail',{sp_no:job.sp_no})).info;
    if(info?.sp_no!==job.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||!info.applyer?.userid)return null;
    if(!members.has(info.applyer.userid))members.set(info.applyer.userid,this.api('user/get',{userid:info.applyer.userid},'GET'));
    const member=await members.get(info.applyer.userid);if(member.userid!==info.applyer.userid||typeof member.name!=='string'||member.name.trim().normalize('NFC')!==expectedName)return null;
    if(!dateControl&&!job.date)return null;
    if(dateControl){const timestamp=Number(info.apply_data?.contents?.find(c=>c.id===dateControl.property.id)?.value?.date?.s_timestamp);if(!Number.isFinite(timestamp)||new Date(timestamp*1000+28800000).toISOString().slice(0,10)!==date)return null;}
    const visitors=extractVisitors(info,template);if(!visitors.some(v=>v.phone===phone&&v.name.trim().normalize('NFC')===visitorName.trim().normalize('NFC')))return null;
    let current=job;
    if(!job.date){try{current=extractTemplateJob(info,template,member,this.now());}catch{if(info.sp_status===2)throw Error('预约资料暂不可用');current={sp_no:job.sp_no,date,start:'待确认',end:'待确认'};}}
    return await this.result(current,info);
   }catch{failures++;return null;}
  }));results.push(...group.filter(Boolean));}
  if(!results.length){if(failures)throw Error('审批查询服务暂不可用，请稍后重试');throw invalid();}
  return {results,partial:failures>0};
 }
 async result(job,info){
  const sp_no=job.sp_no;if(info?.sp_no!==sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID)throw Error('审批结果不匹配');
  const labels={0:'待提交',1:'审批中',2:'审批已通过',3:'审批已驳回',4:'申请已撤销',6:'通过后已撤销',7:'申请已删除',10:'已支付'};
  const out={sp_no,status:info.sp_status,statusText:labels[info.sp_status]||'状态待确认',date:job.endDate&&job.endDate!==job.date?job.date+' 至 '+job.endDate:job.date,start:job.start,end:job.end,verifyUrl:'/verify',verifyCode:null};
  if(job.testNoGatePass===true){out.testOnly=true;out.note='接口联调测试单，没有有效访客手机号，不签发入校码，不作为入校凭证。';return out;}
  if(info.sp_status===2){const window=visitWindow(job.date,job.start,job.end,job.endDate);if(this.now()>=window.endAt)out.note='预约已过期，入校卡已失效';else{out.verifyCode=(await this.gate.issue(job,info)).verifyCode;out.note='请使用登记手机号和下方验证码打开临时入校卡，按预约时段入离校。';}}
  else out.note='只有全部审批通过后才会显示入校核验码。';
  return out;
 }
}
