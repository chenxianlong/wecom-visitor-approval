import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carExitDate,carGateUrl} from '../car-gate.mjs';
test('门禁出校日期为入校日期加一个自然日，覆盖月末年末和闰年',()=>{
 for(const [entry,exit] of [['2026-10-22','2026-10-23'],['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01'],['2028-02-28','2028-02-29'],['2028-02-29','2028-03-01']])assert.equal(carExitDate(entry),exit);
 assert.throws(()=>carExitDate('2026-02-30'));
 const u=carGateUrl({plate:'粤 S·a1234',date:'2026-12-31',hostName:'模拟被访人',hostUserid:'test-host',firstVisitorPhone:'13800138000'},'test-token');
 assert.equal(u.searchParams.get('validFrom'),'2026-12-31');assert.equal(u.searchParams.get('validUntil'),'2027-01-01');assert.equal(u.searchParams.get('plate'),'粤SA1234');
});
