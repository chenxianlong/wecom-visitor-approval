import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {approvedMail,hostResultMessage} from '../notifications.mjs';
import {PhoneVerification} from '../phone-verification.mjs';
import {CarGate} from '../car-gate.mjs';

test('通知中的查询与核验链接使用部署方 BASE_URL，支持路径前缀且不出现示例域名',()=>{
 const env={BASE_URL:'https://campus.example.org/visitor/',WECOM_AGENT_ID:'1000001'};
 const job={sp_no:'209901010001',hostUserid:'teacher',date:'2099-01-01',start:'09:00',end:'11:00',email:'guest@example.org',verifyCode:'0042'};
 const mail=approvedMail(job,env);
 assert.ok(mail.text.includes('https://campus.example.org/visitor/verify'));
 assert.ok(mail.text.includes('https://campus.example.org/visitor/query'));
 assert.ok(!mail.text.includes('visitor.example.com'));
 const message=hostResultMessage(job,{sp_status:2,applyer:{userid:'teacher'}},env,'0042');
 assert.ok(message.textcard.description.includes('https://campus.example.org/visitor/verify'));
 assert.ok(message.textcard.url.startsWith('https://campus.example.org/visitor/query?'));
});

test('缺少独立手机验证码模板时，不允许发送验证码',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;
 try{
  const service=new PhoneVerification({db,env:{ALIYUN_SMS_ACCESS_KEY_ID:'fake',ALIYUN_SMS_ACCESS_KEY_SECRET:'fake',ALIYUN_SMS_SIGN_NAME:'示例',GATE_PASS_SECRET:'a'.repeat(64)},send:async()=>{calls++;return {BizId:'fake'};}});
  assert.equal(service.ready(),false);
  await assert.rejects(service.request('session','ip',{name:'测试访客',phone:'13800138000',id:'11010519491231002X'}),/暂不可用/);
  assert.equal(calls,0);
 }finally{db.close();}
});

test('启用车辆推送但没有配置接口地址时启动失败，不访问任何默认接口',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'visitor-gate-config-'));
 try{
  const service=new CarGate({env:{DATA_DIR:dir,CAR_GATE_ENABLED:'true',CAR_GATE_TOKEN:'test-token'},api:async()=>assert.fail('must not call API'),fetcher:async()=>assert.fail('must not send')});
  await assert.rejects(service.init(),/未配置/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
