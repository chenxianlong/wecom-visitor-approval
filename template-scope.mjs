import fs from 'node:fs/promises';
const configError=()=>{const e=Error('模板申请权限配置暂不可核实，请联系管理员');e.statusCode=503;return e;};
export class TemplateScope{
 constructor({env,api,readPolicy}){this.env=env;this.api=api;this.readPolicy=readPolicy||(()=>fs.readFile(env.TEMPLATE_SCOPE_FILE,'utf8').then(JSON.parse));}
 async assertEligible(userid){
  let p;try{p=await this.readPolicy();}catch{throw configError();}
  if(!p||p.templateId!==this.env.WECOM_TEMPLATE_ID||typeof p.allowAll!=='boolean'||typeof p.includeSubDepartments!=='boolean')throw configError();
  for(const k of ['userids','excludedUserids'])if(!Array.isArray(p[k])||p[k].some(x=>typeof x!=='string'||!x))throw configError();
  for(const k of ['departmentIds','tagIds','excludedDepartmentIds'])if(!Array.isArray(p[k])||p[k].some(x=>!Number.isInteger(x)||x<=0))throw configError();
  const denied=()=>{const e=Error('不符合申请条件：被访人不在该审批模板的可见范围内');e.statusCode=403;e.code='TEMPLATE_SCOPE_DENIED';return e;};
  if(p.excludedUserids.includes(userid))throw denied();
  let member;
  const departments=async()=>{if(!member)try{member=await this.api('user/get',{userid},'GET');}catch{throw configError();}if(member.userid!==userid||!Array.isArray(member.department)||!member.department.length)throw configError();return member.department;};
  const matchesDepartment=async(ids)=>{
   if(!ids.length)return false;const allowed=new Set(ids),cache=new Map();
   const memberDepartments=await departments();if(memberDepartments.some(id=>allowed.has(id)))return true;
   for(const id of memberDepartments){
    let current=id;const seen=new Set();while(current!==0){if(allowed.has(current))return true;if(!p.includeSubDepartments||current===1)break;if(seen.has(current)||seen.size>=30)throw configError();seen.add(current);
     let d=cache.get(current);if(!d){try{d=(await this.api('department/get',{id:current},'GET')).department;}catch{throw configError();}if(d?.id!==current||!Number.isInteger(d.parentid)||d.parentid<0)throw configError();cache.set(current,d);}current=d.parentid;
    }
   }return false;
  };
  if(await matchesDepartment(p.excludedDepartmentIds))throw denied();
  if(p.allowAll||p.userids.includes(userid))return true;
  if(await matchesDepartment(p.departmentIds))return true;
  for(const tagid of p.tagIds){let tag;try{tag=await this.api('tag/get',{tagid},'GET');}catch{throw configError();}
   if(!Array.isArray(tag.userlist)||!Array.isArray(tag.partylist))throw configError();
   if(tag.userlist.some(u=>u.userid===userid)||await matchesDepartment(tag.partylist))return true;
  }
  throw denied();
 }
}
