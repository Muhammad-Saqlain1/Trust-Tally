import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createDatabase } from '../src/db.js';
import { createBill, correctBill, receiveCash, balance } from '../src/ledger.js';
import { hashSecret } from '../src/lib/security.js';

test('MySQL: transactional billing, FIFO allocations, isolation, idempotency, and append-only history', { skip: !process.env.TEST_DATABASE_URL }, async t=>{
  // Use a separate, migrated, disposable database. Fixtures remain so the no-delete policy is tested honestly.
  const db=createDatabase(process.env.TEST_DATABASE_URL);t.after(()=>db.close());
  const suffix=String(randomInt(100000000,999999999)),phone='+92'+suffix+'1';
  const fixture=await db.transaction(async query=>{
    const shop=await query('INSERT INTO shops (owner_name,shop_name,phone) VALUES (?,?,?)',['Integration Owner','Integration Shop',phone]);
    const owner=await query("INSERT INTO users (shop_id,role,phone,name,pin_hash) VALUES (?,'shopkeeper',?,'Integration Owner',?)",[shop.insertId,phone,await hashSecret('123456')]);
    const customer=await query("INSERT INTO customers (shop_id,customer_code,name,phone,opening_balance,credit_limit,consent_status) VALUES (?,'CUS-0001','Integration Customer',?,'3000.00','20000.00','accepted')",[shop.insertId,'+92'+suffix+'2']);
    const item=await query("INSERT INTO items (shop_id,name,unit,default_price) VALUES (?,'Rice','kg','280.00')",[shop.insertId]);
    return { user:{shop_id:shop.insertId,user_id:owner.insertId,role:'shopkeeper'},customerId:customer.insertId,itemId:item.insertId };
  });
  const body={clientKey:`integration-${suffix}-bill`,customerId:fixture.customerId,items:[{itemId:fixture.itemId,quantity:'5',price:'280.00'}],paidNow:'1000.00'};
  const first=await createBill(db,fixture.user,body),replayed=await createBill(db,fixture.user,body);
  assert.equal(String(first.billId),String(replayed.billId));assert.equal(replayed.duplicate,true);
  assert.equal(await balance(db.query.bind(db),fixture.user.shop_id,fixture.customerId),340000);
  const alloc=await db.query('SELECT a.bill_id,a.amount FROM payment_allocations a JOIN payments p ON p.payment_id=a.payment_id WHERE p.shop_id=?',[fixture.user.shop_id]);
  assert.equal(alloc.length,1);assert.equal(alloc[0].bill_id,null);assert.equal(alloc[0].amount,'1000.00');
  const cash={clientKey:`integration-${suffix}-cash`,customerId:fixture.customerId,amount:'2500.00'};
  await receiveCash(db,fixture.user,cash);await receiveCash(db,fixture.user,cash);
  assert.equal(await balance(db.query.bind(db),fixture.user.shop_id,fixture.customerId),90000);
  await assert.rejects(()=>createBill(db,fixture.user,{...body,paidNow:'0'}),/already used/);
  await assert.rejects(()=>receiveCash(db,fixture.user,{...cash,clientKey:`integration-${suffix}-over`,amount:'1000'}),/cannot exceed/);
  await assert.rejects(()=>createBill(db,fixture.user,{...body,clientKey:`integration-${suffix}-foreign`,customerId:999999999}),/active customer/);
  const [billItem]=await db.query('SELECT bill_item_id FROM bill_items WHERE bill_id=?',[first.billId]);
  const correction={type:'return',billItemId:billItem.bill_item_id,quantity:'1',reason:'Returned rice',clientKey:`integration-${suffix}-return`};
  const returned=await correctBill(db,fixture.user,first.billId,correction);
  assert.equal(returned.amount,'280.00');assert.equal(await balance(db.query.bind(db),fixture.user.shop_id,fixture.customerId),62000);
  assert.equal((await correctBill(db,fixture.user,first.billId,correction)).duplicate,true);
  assert.equal((await correctBill(db,fixture.user,first.billId,{type:'cancel',reason:'Cancel remaining sale',clientKey:`integration-${suffix}-cancel`})).status,'cancelled');
  assert.equal(await balance(db.query.bind(db),fixture.user.shop_id,fixture.customerId),-50000);
  const log=await db.query('SELECT log_id FROM audit_logs WHERE shop_id=? LIMIT 1',[fixture.user.shop_id]);
  await assert.rejects(()=>db.query('UPDATE audit_logs SET action=? WHERE log_id=?',['tamper',log[0].log_id]),/append-only/);
  await assert.rejects(()=>db.query('DELETE FROM bills WHERE bill_id=?',[first.billId]),/reversal/);
  await assert.rejects(()=>db.query('DELETE FROM payments WHERE shop_id=?',[fixture.user.shop_id]),/reversal/);
  const placeholders=Array.from({length:499},()=>'(?,?,?,?,?)').join(',');
  const values=[];for(let n=1;n<=499;n++)values.push(fixture.user.shop_id,`CAP-${n}`,`Capacity ${n}`,`+92${suffix}${n+10}`,'0.00');
  await db.query(`INSERT INTO customers (shop_id,customer_code,name,phone,opening_balance) VALUES ${placeholders}`,values);
  await assert.rejects(()=>db.query("INSERT INTO customers (shop_id,customer_code,name,phone) VALUES (?,'CAP-501','Rejected','+92999999999999')",[fixture.user.shop_id]),/limit of 500/);
  const count=await db.query('SELECT customer_count FROM shops WHERE shop_id=?',[fixture.user.shop_id]);assert.equal(count[0].customer_count,500);
});
