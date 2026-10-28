import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TemplateScope} from '../template-scope.mjs';
const base={templateId:'t',allowAll:false,includeSubDepartments:true,userids:[],departmentIds:[],tagIds:[],excludedUserids:[],excludedDepartmentIds:[]};
function scope(policy,api=async()=>{throw Error('unexpected API');}){return new TemplateScope({env:{WECOM_TEMPLATE_ID:'t'},api,readPolicy:async()=>({...base,...policy})});}
test('允许人员名单，名单外直接返回不符合申请条件',async()=>{assert.equal(await scope({userids:['a']}).assertEligible('a'),true);await assert.rejects(scope({userids:['a']}).assertEligible('b'),e=>e.statusCode===403&&/不符合申请条件/.test(e.message));});
test('排除人员优先于允许全部或显式允许人员',async()=>{await assert.rejects(scope({allowAll:true,userids:['a'],excludedUserids:['a']}).assertEligible('a'),/不符合申请条件/);});
test('部门范围支持子部门，未开启子部门时不放行',async()=>{const api=async path=>path==='user/get'?{userid:'a',department:[9]}:{department:{id:9,parentid:2}};assert.equal(await scope({departmentIds:[2]},api).assertEligible('a'),true);await assert.rejects(scope({departmentIds:[2],includeSubDepartments:false},api).assertEligible('a'),/不符合申请条件/);});
test('检查所有所属部门，不只检查第一个部门',async()=>{assert.equal(await scope({departmentIds:[2]},async()=>({userid:'a',department:[9,2]})).assertEligible('a'),true);});
test('标签可通过成员或标签关联部门命中',async()=>{assert.equal(await scope({tagIds:[8]},async()=>({userlist:[{userid:'a'}],partylist:[]})).assertEligible('a'),true);});
test('错误模板、缺少配置或接口无权限时不冒充权限通过',async()=>{await assert.rejects(scope({templateId:'other'}).assertEligible('a'),e=>e.statusCode===503);await assert.rejects(scope({departmentIds:[2]},async()=>{throw Error('denied');}).assertEligible('a'),e=>e.statusCode===503);});
