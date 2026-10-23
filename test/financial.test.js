import test from 'node:test';
import assert from 'node:assert/strict';
import { money, decimal, quantity, lineTotal, oldestFirst } from '../src/lib/money.js';
import { businessDay, today } from '../src/ledger.js';

test('PRD bill example totals exactly Rs. 2,950 with Rs. 1,950 pending',()=>{
  const total=lineTotal(money('280'),quantity('5'))+lineTotal(money('520'),quantity('2'))+lineTotal(money('170'),quantity('3'));
  assert.equal(decimal(total),'2950.00');assert.equal(decimal(total-money('1000')),'1950.00');
});
test('fractional quantities round once to the nearest paisa',()=>{
  assert.equal(decimal(lineTotal(money('17.35'),quantity('0.333'))),'5.78');
  assert.equal(decimal(lineTotal(money('0.01'),quantity('0.5'))),'0.01');
  assert.equal(money('0.10')+money('0.20'),money('0.30'));
});
test('invalid financial input never becomes an accepted zero or float',()=>{
  for(const value of ['-1','1.001','1e4','NaN',null,'','1,000','9999999999'])assert.throws(()=>money(value));
  for(const value of ['0','-1','0.0001','1e3'])assert.throws(()=>quantity(value));
});
test('payments settle opening debt, then oldest bills, without losing any amount',()=>{
  const result=oldestFirst(500000,[{billId:null,unpaid:300000},{billId:10,unpaid:450000},{billId:11,unpaid:320000}]);
  assert.deepEqual(result,{allocations:[{billId:null,amount:300000},{billId:10,amount:200000}],remaining:0});
});
test('PRD monthly example preserves the remaining October debt and November balance',()=>{
  const october=money('3000')+money('8500')-money('4000');
  assert.equal(decimal(october),'7500.00');
  const result=oldestFirst(money('5000'),[{billId:10,unpaid:october},{billId:11,unpaid:money('3200')}]);
  assert.equal(decimal(october-result.allocations[0].amount),'2500.00');
  assert.equal(decimal(october+money('3200')-money('5000')),'5700.00');
});
test('offline business dates survive syncing while impossible and future dates fail',()=>{
  assert.equal(businessDay('2024-02-29'),'2024-02-29');assert.equal(businessDay(),today());
  for(const value of ['2023-02-29','2024-13-01','2999-01-01','2024-1-1','1999-12-31'])assert.throws(()=>businessDay(value));
});
