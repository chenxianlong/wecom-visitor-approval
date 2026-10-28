function assertHostNameEligible(name){
 if(typeof name==='string'&&name.includes('-')){const error=Error('不符合申请条件');error.statusCode=403;throw error;}
}
export function validateHost(data){
 if(typeof data?.hostName!=='string'||!data.hostName.trim()||data.hostName.trim().length>50)throw Error('请填写被访人姓名');
 assertHostNameEligible(data.hostName);
 if(typeof data.hostPhone!=='string'||!/^1[3-9]\d{9}$/.test(data.hostPhone))throw Error('请填写被访人在学校通讯录登记的11位手机号');
 return {name:data.hostName.trim().normalize('NFC'),phone:data.hostPhone};
}
export async function resolveHost(data,api,withDepartment=false){
 const {name,phone}=validateHost(data);
 let found,member;
 try{
  found=await api('user/getuserid',{mobile:phone});
  if(!found.userid)throw Error('no member');
  member=await api('user/get',{userid:found.userid},'GET');
 }catch(err){
  if([48002,48009,60011,60020,40014,42001].includes(err.code))throw Error('学校通讯录查询权限或服务配置异常，请联系学校');
  throw Error('被访人信息暂无法核实，请核对姓名及学校登记手机号，或联系学校');
 }
 assertHostNameEligible(member.name);
 if(!member.name||member.name.trim().normalize('NFC')!==name||member.userid!==found.userid||member.status!==1)throw Error('被访人信息暂无法核实，请核对姓名及学校登记手机号，或联系学校');
 if(!withDepartment)return found.userid;
 const departmentIds=[...new Set(member.department||[])];
 if(departmentIds.some(id=>!Number.isInteger(id)||id<=0))throw Error('所属部门数据无效，请联系学校');
 let readError;const cache=new Map(),matches=[];
 for(const first of departmentIds){
  const names=[],visited=new Set();let current=first,departmentIncomplete=false;
  try{
   while(current!==0){
    if(visited.has(current)||visited.size>=30)throw Error('被访人部门层级异常，请联系学校');
    visited.add(current);
    let result;try{if(!cache.has(current))cache.set(current,api('department/get',{id:current},'GET'));result=await cache.get(current);}catch(err){if(names.length&&err.code===60011){departmentIncomplete=true;break;}throw Error('无法读取被访人完整部门层级，请联系学校检查上级部门查看权限');}
    const department=result.department;
    if(department?.id!==current||!department.name||!Number.isInteger(department.parentid)||department.parentid<0)throw Error('无法读取被访人完整部门层级，请联系学校');
    names.unshift(department.name);current=department.parentid;
   }
   const priority=names.some(name=>name.includes('机关教辅')||name.includes('学校领导'))?0:2;
   matches.push({priority,depth:names.length,details:{userid:found.userid,departmentId:first,departmentIds:[...departmentIds].sort((a,b)=>a-b),departmentName:names.join(' / '),...(departmentIncomplete?{departmentIncomplete:true}:{})}});
   if(departmentIncomplete)readError=Error('部分所属部门的上级信息无查看权限，暂无法确认申请资格，请联系学校');
  }catch(error){readError=error;}
 }
 if(matches.length){matches.sort((a,b)=>a.priority-b.priority||b.depth-a.depth||a.details.departmentId-b.details.departmentId);return matches[0].details;}
 return {userid:found.userid,departmentId:departmentIds[0]||null,departmentIds:[...departmentIds].sort((a,b)=>a-b),departmentName:readError?'部门信息暂不可读取':'未登记所属部门',departmentIncomplete:true};
}

// Department membership and display paths do not determine application eligibility.
export function sameVerifiedHost(verified,current){return !!verified&&!!current&&verified.userid===current.userid;}
