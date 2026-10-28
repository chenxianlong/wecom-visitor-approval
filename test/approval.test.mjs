import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate,buildPayload,validId} from '../approval.mjs';
const data=()=>({visitType:'a',reason:'来访交流',date:'2099-01-01',start:'09:00',end:'11:00',visitors:[{name:'测试访客',phone:'13800138000',id:'11010519491231002X'}]});
const field=(id,control,text,config={})=>({property:{id,control,require:1,title:[{text,lang:'zh_CN'}]},config});
test('身份证校验码和手机号校验',()=>{assert.equal(validId('11010519491231002X'),true);assert.equal(validId('110105194912310021'),false);const d=data();d.visitors[0].phone='123';assert.throws(()=>validate(d),/手机号/);});
test('阻止反向时间及空访客',()=>{let d=data();d.end='08:00';assert.throws(()=>validate(d),/晚于/);d=data();d.visitors=[];assert.throws(()=>validate(d),/人数/);});
test('模板控件ID、选择项key、多访客及模板审批流',()=>{const d=data();d.visitors.push({...d.visitors[0],name:'同行人'});const t={template_content:{controls:[field('selector','Selector','访问类型',{selector:{type:'single',options:[{key:'a'}]}}),field('table','Table','访客',{table:{children:[field('name','Text','姓名'),field('id','Text','身份证号码'),field('phone','Text','手机号码')]}})]}};const p=buildPayload(d,t,'employee','template');assert.equal(p.use_template_approver,1);assert.equal(p.creator_userid,'employee');assert.equal(p.apply_data.contents[0].value.selector.options[0].key,'a');assert.equal(p.apply_data.contents[1].value.children.length,2);});
test('未知必填控件阻止误提交',()=>{assert.throws(()=>buildPayload(data(),{template_content:{controls:[field('x','Contact','所在部门')]}},'u','t'),/尚未适配/);});
test('模拟模板：全天和半天映射，不向企业微信提交',()=>{
 const t={template_content:{controls:[field('range','DateRange','入校时间段',{date_range:{type:'halfday'}})]}};
 const d=data();d.start='00:00';d.end='24:00';
 const payload=buildPayload(d,t,'test-only-user','test-only-template');
 const range=payload.apply_data.contents.find(c=>c.control==='DateRange').value.date_range;
 assert.equal(range.type,'halfday');assert.equal(range.new_duration,86400);assert.equal(range.new_end-range.new_begin,86400);
 d.start='12:00';const half=buildPayload(d,t,'test-only-user','test-only-template').apply_data.contents.find(c=>c.control==='DateRange').value.date_range;assert.equal(half.new_duration,43200);
 d.start='09:00';assert.throws(()=>buildPayload(d,t,'u','t'),/半天/);
});


test('H5结果通知邮箱写入企业微信新增控件，空值保持选填',()=>{
 const template={template_content:{controls:[field('email-field','Text','结果通知邮箱')]}};
 const d=data();d.notificationEmail='visitor@example.com';let value=buildPayload(d,template,'host','t').apply_data.contents[0].value;assert.equal(value.text,'visitor@example.com');
 d.notificationEmail='';value=buildPayload(d,template,'host','t').apply_data.contents[0].value;assert.equal(value.text,'');
});
