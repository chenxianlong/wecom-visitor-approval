import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HostReview,decision,applicant} from '../host-review.mjs';
test('访客不能绕过被访人同意，拒绝后不可改为同意',()=>{
 const r={userid:'host',status:'pending',until:Date.now()+100000};
 assert.throws(()=>decision(r,'other','approve'),/本人/);assert.equal(r.status,'pending');
 decision(r,'host','reject');assert.equal(r.status,'rejected');assert.throws(()=>decision(r,'host','approve'),/已处理/);
});
test('同意及过期状态严格校验',()=>{
 const reviews=new HostReview({env:{},api:()=>{},json:()=>{}}),r={userid:'host',status:'pending',hash:'bound-fields',until:Date.now()+100000};reviews.records.set('id',r);
 assert.throws(()=>reviews.assertApproved('id','bound-fields'),/被访人/);
 decision(r,'host','approve');assert.equal(reviews.assertApproved('id','bound-fields'),r);assert.throws(()=>reviews.assertApproved('id','changed-applicant'),/被访人/);
 r.until=0;assert.throws(()=>reviews.assertApproved('id','bound-fields'),/被访人/);
});
test('外部申请人单位姓名及访问类型为必填',()=>{
 assert.throws(()=>applicant({}),/单位/);assert.throws(()=>applicant({applicantOrg:'单位',applicantName:'',visitType:'a'}),/姓名/);
});
test('请求向正确被访人发送消息并持久化，发送失败不解锁',async()=>{
 const sent=[],review=new HostReview({env:{BASE_URL:'https://visitor.example.com',WECOM_AGENT_ID:'1000001'},api:async(p,b)=>{sent.push({p,b});return {};},json:()=>{}});let saves=0;review.save=async()=>saves++;
 const id=await review.request({userid:'host'},{applicantOrg:'测试单位',applicantName:'测试申请人',visitType:'a'},'hash');
 assert.equal(review.status(id),'pending');assert.equal(sent[0].b.touser,'host');assert.equal(sent[0].b.agentid,1000001);assert.match(sent[0].b.textcard.url,/https:\/\/visitor.example.com\/host-review\?ticket=/);assert.equal(saves,2);
 await assert.rejects(review.request({userid:'host'},{applicantOrg:'单位',applicantName:'申请人',visitType:'a'},'hash'),/重复/);
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,headers){this.code=code;Object.assign(this.headers,headers);},end(){}};}
test('真实路由模拟：OAuth身份验证成功才允许本人同意',async()=>{
 const review=new HostReview({env:{BASE_URL:'https://visitor.example.com'},api:async()=>({userid:'host'}),json:(res,code,data)=>{res.code=code;res.data=data;}});review.save=async()=>{};
 review.records.set('request',{id:'request',userid:'host',status:'pending',until:Date.now()+100000,hash:'fields'});review.states.set('state',{id:'request',until:Date.now()+100000});
 const res=response();await review.handle({method:'GET',headers:{cookie:'host_review_oauth=state'}},res,new URL('https://visitor.example.com/host-review/callback?code=test&state=state')).then(()=>assert.fail('非法state cookie应被拒绝'),()=>{});
 const state='a'.repeat(64);review.states.set(state,{id:'request',until:Date.now()+100000});
 const loginResponse=response();await review.handle({method:'GET',headers:{cookie:'host_review_oauth='+state}},loginResponse,new URL('https://visitor.example.com/host-review/callback?code=test&state='+state));assert.equal(loginResponse.code,303);
 const loginId=loginResponse.headers['Set-Cookie'][0].match(/host_review_session=([a-f0-9]+)/)[1],login=review.logins.get(loginId);
 const req={method:'POST',headers:{cookie:'host_review_session='+loginId,origin:'https://visitor.example.com','x-csrf-token':login.csrf},async *[Symbol.asyncIterator](){yield '{"action":"approve"}';}},out=response();
 await review.handle(req,out,new URL('https://visitor.example.com/api/host-review'));assert.equal(out.data.status,'approved');assert.equal(review.assertApproved('request','fields').userid,'host');
});
test('转发链接给其他企业成员不能获取处理会话',async()=>{
 const review=new HostReview({env:{},api:async()=>({userid:'other'}),json:()=>{}}),state='b'.repeat(64);review.records.set('r',{userid:'host'});review.states.set(state,{id:'r',until:Date.now()+100000});
 await assert.rejects(review.handle({method:'GET',headers:{cookie:'host_review_oauth='+state}},response(),new URL('https://visitor.example.com/host-review/callback?state='+state+'&code=test')),/本人/);
});
