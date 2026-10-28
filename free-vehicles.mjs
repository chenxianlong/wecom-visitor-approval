import {validatePlate} from './plate.mjs';
export class FreeVehicles {
 constructor({env,audit,api,fetcher=fetch}){this.env=env;this.audit=audit;this.api=api;this.fetcher=fetcher;
  for(const row of audit.db.prepare("SELECT id FROM applications WHERE free_state='sending'").all())audit.transaction(()=>audit.feeOutcome(row.id,'uncertain','system','发送期间服务中断，请人工核实，禁止重复登记'));
 }
 async register(id,actor){
  if(!this.env.CAR_GATE_TOKEN||!this.env.CAR_FREE_URL)throw Error('免费车辆接口令牌未配置');
  let row=this.audit.record(id);
  if(['sending','response_received','uncertain'].includes(row.free_state))throw Error('该申请已提交或结果待核实，请勿重复登记');
  if(row.status!==2)throw Error('仅可登记审批已通过的车辆');
  const plate=validatePlate(row.plate);if(!plate)throw Error('申请没有有效车牌');
  const info=(await this.api('oa/getapprovaldetail',{sp_no:row.sp_no})).info;
  if(info?.sp_no!==row.sp_no||info.template_id!==this.env.WECOM_TEMPLATE_ID||info.applyer?.userid!==row.host_userid||info.sp_status!==2)throw Error('企业微信审批状态或身份核对未通过，不能登记免费车辆');
  this.audit.transaction(()=>{row=this.audit.record(id);if(['sending','response_received','uncertain'].includes(row.free_state))throw Error('该申请已提交或结果待核实，请勿重复登记');if(row.status!==2||validatePlate(row.plate)!==plate)throw Error('申请资料已变化，请刷新后再试');this.audit.feeOutcome(id,'sending',actor,'管理员点击免费登记，开始提交',undefined,plate);});
  const url=new URL(this.env.CAR_FREE_URL);url.search=new URLSearchParams({token:this.env.CAR_GATE_TOKEN,plate:plate}).toString();
  let state='uncertain',note='请求结果未确认，请人工核实，禁止重复登记',httpStatus;
  try{const response=await this.fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'application/json, text/plain, */*','Cache-Control':'no-store'},signal:AbortSignal.timeout(15000)});httpStatus=response.status;if(response.ok){state='response_received';note='免费接口已收到请求并返回HTTP成功响应；请以停车系统实际结果为准';}else note='免费接口返回异常，请人工核实，禁止重复登记';if(response.body)await response.body.cancel();}catch{ /* Never log the token-bearing URL or retry an uncertain mutation. */ }
  this.audit.transaction(()=>this.audit.feeOutcome(id,state,actor,note,httpStatus,plate));return {state,message:note};
 }
}
