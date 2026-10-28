import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveHost} from '../host.mjs';
const d={hostName:'测试教职工',hostPhone:'13800138000'};
test('输入姓名含连字符时直接拒绝，不调用通讯录',async()=>{
 await assert.rejects(resolveHost({...d,hostName:'测试-教职工'},async()=>{assert.fail('不应调用通讯录');}),{message:'不符合申请条件',statusCode:403});
});
test('通讯录真实姓名含连字符时拒绝，省略连字符不能绕过',async()=>{
 for(const withDepartment of [false,true])await assert.rejects(resolveHost(d,async path=>path==='user/getuserid'?{userid:'u'}:{userid:'u',name:'测试-教职工',status:1,department:[9]},withDepartment),{message:'不符合申请条件',statusCode:403});
});
test('多个同级机关教辅部门使用稳定部门ID排序展示',async()=>{
 const details=await resolveHost(d,async(path,body)=>{
  if(path==='user/getuserid')return {userid:'u'};
  if(path==='user/get')return {userid:'u',name:d.hostName,status:1,department:[9,2],main_department:2};
  return {department:{id:body.id,name:'机关教辅第'+body.id+'部门',parentid:0}};
 },true);assert.deepEqual(details,{userid:'u',departmentId:2,departmentIds:[2,9],departmentName:'机关教辅第2部门'});
});
test('部门路径包含所有上级，按根部门到当前部门排列',async()=>{
 const map={9:{id:9,name:'办公室',parentid:2},2:{id:2,name:'图书馆',parentid:1},1:{id:1,name:'机关教辅',parentid:0}};
 const result=await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[9]}:{department:map[body.id]},true);
 assert.equal(result.departmentName,'机关教辅 / 图书馆 / 办公室');
});
test('部门路径异常仅影响展示，不作为申请资格拦截',async()=>{const out=await resolveHost(d,async(path)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[9]}:{department:{id:9,name:'循环部门',parentid:9}},true);assert.equal(out.userid,'u');assert.equal(out.departmentIncomplete,true);});

test('上级部门无权限时明确标识路径不完整，保留已核实部门',async()=>{
 const result=await resolveHost(d,async(path,body)=>{
  if(path==='user/getuserid')return {userid:'u'};
  if(path==='user/get')return {userid:'u',name:d.hostName,status:1,department:[9]};
  if(body.id===9)return {department:{id:9,name:'机关教辅图书馆',parentid:1}};
  const e=Error('permission');e.code=60011;throw e;
 },true);assert.equal(result.departmentName,'机关教辅图书馆');assert.equal(result.departmentIncomplete,true);
});
test('缺少部门或无读取权限不再阻止姓名身份已核实的成员',async()=>{for(const departments of [[],[9]]){const out=await resolveHost(d,async(path)=>{if(path==='user/getuserid')return {userid:'u'};if(path==='user/get')return {userid:'u',name:d.hostName,status:1,department:departments};throw Error('permission');},true);assert.equal(out.userid,'u');assert.equal(out.departmentIncomplete,true);}});

test('服务端通过手机号查账号并精确核对姓名及激活状态',async()=>{
 const calls=[];const id=await resolveHost(d,async(path,body,method)=>{calls.push({path,body,method});return path==='user/getuserid'?{userid:'employee-1'}:{userid:'employee-1',name:d.hostName,status:1};});
 assert.equal(id,'employee-1');assert.deepEqual(calls[0].body,{mobile:d.hostPhone});assert.equal(calls[1].method,'GET');
});
test('错误姓名、停用或缺少姓名的账号不能代申请',async()=>{
 for(const member of [{name:'其他人',status:1},{name:d.hostName,status:2},{status:1}])await assert.rejects(resolveHost(d,async path=>path==='user/getuserid'?{userid:'u'}:{userid:'u',...member}),/无法核实/);
});
test('权限错误和无匹配不会泄露通讯录或回退固定申请人',async()=>{
 await assert.rejects(resolveHost(d,async()=>{const e=Error('sensitive upstream');e.code=48002;throw e;}),/权限/);
 await assert.rejects(resolveHost(d,async()=>({})),/无法核实/);
 await assert.rejects(resolveHost({...d,hostPhone:'123'},async()=>{throw Error('不应调用');}),/11位/);
});

test('所有部门均可申请，学校领导或机关教辅仅用于展示优选',async()=>{
 for(const rootName of ['学校领导','机关教辅','二级学院']){
  const api=async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[9]}:{department:body.id===9?{id:9,name:'办公室',parentid:2}:{id:2,name:rootName,parentid:0}};
  assert.equal((await resolveHost(d,api,true)).departmentName,rootName+' / 办公室');
 }
});
test('首个部门不在试点范围时，其他所属部门符合仍通过',async()=>{
 assert.equal((await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[9,2]}:{department:{id:body.id,name:body.id===9?'二级学院':'机关教辅',parentid:0}},true)).departmentId,2);
});

test('被访人核对使用稳定UserID和部门ID，名称路径变化不误拦截，仅真实身份变化必须重核',async()=>{const {sameVerifiedHost}=await import('../host.mjs');const before={userid:'teacher',departmentId:12,departmentName:'机关教辅 / 信息中心'};assert.equal(sameVerifiedHost(before,{...before,departmentName:'学校 / 机关教辅 / 信息中心'}),true);assert.equal(sameVerifiedHost(before,{...before,departmentName:'机关教辅 / 信息技术中心',departmentIncomplete:true}),true);assert.equal(sameVerifiedHost(before,{...before,departmentId:13}),true);assert.equal(sameVerifiedHost(before,{...before,userid:'other'}),false);assert.equal(sameVerifiedHost(null,before),false);});

test('多部门顺序改变不能误判为调动，部门集合变化不拦截但UserID变化仍拒绝',async()=>{const {sameVerifiedHost}=await import('../host.mjs');const before={userid:'teacher',departmentId:251,departmentIds:[251,140,2822,2183,2]};assert.equal(sameVerifiedHost(before,{userid:'teacher',departmentId:2,departmentIds:[2,251,2183,140,2822]}),true);assert.equal(sameVerifiedHost(before,{userid:'teacher',departmentId:251,departmentIds:[251,2]}),true);assert.equal(sameVerifiedHost(before,{userid:'other',departmentId:251,departmentIds:before.departmentIds}),false);});

test('真实核对链路两次返回不同首部门但集合相同，仍允许提交复核',async()=>{const {resolveHost,sameVerifiedHost}=await import('../host.mjs');let count=0;const api=async(path,body)=>{if(path==='user/getuserid')return {userid:'teacher'};if(path==='user/get')return {userid:'teacher',name:'测试教师',status:1,department:++count===1?[251,2]:[2,251]};if(path==='department/get')return {department:{id:body.id,name:'机关教辅',parentid:0}};throw Error('unexpected API');};const first=await resolveHost({hostName:'测试教师',hostPhone:'13800138000'},api,true),second=await resolveHost({hostName:'测试教师',hostPhone:'13800138000'},api,true);assert.equal(first.departmentId,second.departmentId);assert.equal(sameVerifiedHost(first,second),true);});

test('住宅或学生部门排在前面，后续机关教辅部门仍能通过',async()=>{const map={2827:{id:2827,name:'教师公寓住宅',parentid:0},5563:{id:5563,name:'学生部门',parentid:0},144:{id:144,name:'实验教学服务中心',parentid:140},140:{id:140,name:'信息化与实验中心',parentid:1663},1663:{id:1663,name:'机关教辅',parentid:0}};for(const ids of [[2827,5563,144],[144,5563,2827]]){const result=await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:ids}:{department:map[body.id]},true);assert.equal(result.departmentId,144);assert.equal(result.departmentName,'机关教辅 / 信息化与实验中心 / 实验教学服务中心');assert.deepEqual(result.departmentIds,[144,2827,5563]);}});
test('首个部门无法读取时继续核对其他部门，其他正常部门也允许申请',async()=>{const api=async(path,body)=>{if(path==='user/getuserid')return {userid:'u'};if(path==='user/get')return {userid:'u',name:d.hostName,status:1,department:[10,20]};if(body.id===10)throw Object.assign(Error('no access'),{code:60011});return {department:{id:20,name:'学校领导',parentid:0}};};assert.equal((await resolveHost(d,api,true)).departmentId,20);assert.equal((await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[10,20]}:{department:{id:body.id,name:'其他部门',parentid:0}},true)).userid,'u');});

test('机关教辅和学校领导同级优先于其他部门，更完整的下属身份优先且结果稳定',async()=>{const map={1:{id:1,name:'机关教辅',parentid:0},2:{id:2,name:'学校领导',parentid:0},10:{id:10,name:'图书馆',parentid:1},11:{id:11,name:'部门领导',parentid:10},20:{id:20,name:'学校领导岗位',parentid:2},30:{id:30,name:'教师公寓住宅',parentid:0}};for(const ids of [[30,20,10,11],[11,10,20,30]]){const result=await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:ids}:{department:map[body.id]},true);assert.equal(result.departmentId,11);assert.equal(result.departmentName,'机关教辅 / 图书馆 / 部门领导');}const result=await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:[30,20]}:{department:map[body.id]},true);assert.equal(result.departmentId,20);assert.equal(result.departmentName,'学校领导 / 学校领导岗位');});

test('学校领导与机关教辅并列，不能因机关教辅分类而覆盖更完整的学校领导岗位',async()=>{const map={1:{id:1,name:'机关教辅',parentid:0},2:{id:2,name:'学校领导',parentid:0},20:{id:20,name:'分管领导',parentid:2},21:{id:21,name:'具体岗位',parentid:20},30:{id:30,name:'住宅部门',parentid:0}};for(const ids of [[1,30,21],[21,30,1]]){const result=await resolveHost(d,async(path,body)=>path==='user/getuserid'?{userid:'u'}:path==='user/get'?{userid:'u',name:d.hostName,status:1,department:ids}:{department:map[body.id]},true);assert.equal(result.departmentId,21);assert.equal(result.departmentName,'学校领导 / 分管领导 / 具体岗位');}});
