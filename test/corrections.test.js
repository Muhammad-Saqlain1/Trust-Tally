import test from 'node:test';
import assert from 'node:assert/strict';
import { correctBill } from '../src/ledger.js';

test('partial return, retry, and cancellation preserve the bill and carry paid value as credit', async () => {
  const saved=[],notifications=[],bill={bill_id:12,bill_no:'BILL-000012',customer_id:7,total:'100.00',status:'active'};
  const query=async (sql,params=[]) => {
    if(sql.startsWith('SELECT shop_id FROM shops'))return [{shop_id:3}];
    if(sql.startsWith('SELECT return_id,bill_id,amount,request_hash'))return saved.filter(row=>row.clientKey===params[1]).map(row=>({return_id:row.id,bill_id:12,amount:row.amount,request_hash:row.requestHash}));
    if(sql.startsWith('SELECT customer_id FROM bills'))return [{customer_id:7}];
    if(sql.startsWith('SELECT bill_id,bill_no,customer_id'))return [{...bill}];
    if(sql.startsWith('SELECT COALESCE(SUM(amount),0) AS amount FROM returns'))return [{amount:saved.reduce((sum,row)=>sum+Number(row.amount),0).toFixed(2)}];
    if(sql.startsWith('SELECT bill_item_id,quantity'))return [{bill_item_id:5,quantity:'1.000',price:'100.00',line_total:'100.00',unit:'kg'}];
    if(sql.startsWith('SELECT COALESCE(SUM(quantity),0)'))return [{quantity:saved.reduce((sum,row)=>sum+Number(row.quantity||0),0).toFixed(3),amount:saved.filter(row=>row.itemId).reduce((sum,row)=>sum+Number(row.amount),0).toFixed(2)}];
    if(sql.startsWith('UPDATE bills SET status')){bill.status='cancelled';return {affectedRows:1};}
    if(sql.startsWith('INSERT INTO returns')){const id=saved.length+1;saved.push({id,itemId:params[2],quantity:params[3],amount:params[4],clientKey:params[7],requestHash:params[8]});return {insertId:id};}
    if(sql.startsWith('SELECT c.opening_balance'))return [{opening_balance:'0.00',billed:'100.00',paid:'100.00',returned:saved.reduce((sum,row)=>sum+Number(row.amount),0).toFixed(2)}];
    if(sql.startsWith('SELECT user_id,customer_id FROM customers')){assert.deepEqual(params,[7,3]);return [{user_id:8,customer_id:7}];}
    if(sql.startsWith('INSERT INTO notifications')){assert.equal(params[0],8);assert.equal(params[2],7);assert.ok(params.every(value=>value!==undefined));notifications.push(params);return {affectedRows:1};}
    if(sql.startsWith('INSERT INTO audit_logs'))return {affectedRows:1};
    throw new Error(`Unexpected query: ${sql}`);
  };
  const db={transaction:work=>work(query)},user={shop_id:3,user_id:2};
  const partial={type:'return',billItemId:5,quantity:'0.300',reason:'Returned goods',clientKey:'partial-return-001'};
  const first=await correctBill(db,user,12,partial);
  assert.equal(first.amount,'30.00');assert.equal(first.balance,'-30.00');assert.equal(saved.length,1);
  const replay=await correctBill(db,user,12,partial);
  assert.equal(replay.duplicate,true);assert.equal(saved.length,1);
  await assert.rejects(()=>correctBill(db,user,12,{...partial,quantity:'0.800',clientKey:'over-return-0001'}),/exceeds/);
  assert.equal(saved.length,1);
  const cancelled=await correctBill(db,user,12,{type:'cancel',reason:'Sale cancelled',clientKey:'cancel-bill-0001'});
  assert.equal(cancelled.amount,'70.00');assert.equal(cancelled.balance,'-100.00');assert.equal(bill.total,'100.00');assert.equal(bill.status,'cancelled');
  assert.equal(saved.length,2);
  assert.equal(notifications.length,2);
});
