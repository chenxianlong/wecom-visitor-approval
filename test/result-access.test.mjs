import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resultLink,resultJob} from '../result-access.mjs';
const env={GATE_PASS_SECRET:'ab'.repeat(32),BASE_URL:'https://visitor.example.com'};
test('专属链接直接定位一张申请，不需要手机号；令牌不进入请求查询串',()=>{const job={sp_no:'202610200001',hostUserid:'host'},jobs=new Map([['k',job]]),url=new URL(resultLink(job,env,1000000000000));assert.equal(url.pathname,'/result');assert.equal(url.search,'');const token=new URLSearchParams(url.hash.slice(1)).get('token');assert.equal(resultJob(token,jobs,env,1000000000001),job);});
test('篡改编号、签名、有效期或申请人，均不能读取结果',()=>{const job={sp_no:'202610200001',hostUserid:'host'},jobs=new Map([['k',job]]),token=new URL(resultLink(job,env,1000000000000)).hash.slice(7);for(const changed of [token.replace('202610200001','202610200002'),token.replace(/.$/,token.endsWith('a')?'b':'a'),token.replace('.1000604800000.','.9999999999999.')])assert.throws(()=>resultJob(changed,jobs,env,1000000000001));assert.throws(()=>resultJob(token,jobs,env,1000000000000+8*86400000));job.hostUserid='other';assert.throws(()=>resultJob(token,jobs,env,1000000000001));});
