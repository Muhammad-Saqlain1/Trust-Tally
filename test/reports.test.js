import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';

const headers={Cookie:`tt_session=${'a'.repeat(64)}`};
async function running(t,query){
  const app=createApp({query}),server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('daily customer report preserves item costs, allocates payments once, and hides shop expenses',async t=>{
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];
    assert.match(sql,/WHERE b.shop_id=\? AND b.bill_date=\? AND b.customer_id=\?/);
    assert.deepEqual(parameters,[3,'2026-10-19',11]);
    assert.match(sql,/b.bill_date,b.status AS bill_status/);
    assert.match(sql,/i.shop_id=b.shop_id/);
    assert.match(sql,/CASE WHEN b.status='cancelled' THEN i.line_total/);
    return [
      {bill_id:1,item:'Rice',quantity:'5.000',unit:'kg',price:'280.00',line_total:'1400.00',returned:'280.00',allocated:'1200.00'},
      {bill_id:1,item:'Tea',quantity:'500.000',unit:'g',price:'2.00',line_total:'1000.00',returned:'0.00',allocated:'1200.00'},
      {bill_id:2,item:'Oil',quantity:'2.000',unit:'liter',price:'520.00',line_total:'1040.00',returned:'1040.00',allocated:'0.00',bill_status:'cancelled'}
    ];
  });
  const response=await fetch(base+'/api/reports/daily?date=2026-10-19&customerId=999&shopId=999',{headers});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.rows[0].paid,'1120.00');
  assert.equal(result.rows[1].paid,'80.00');
  assert.equal(result.rows[1].remaining,'920.00');
  assert.equal(result.rows[2].remaining,'0.00');
  assert.equal(result.rows[2].line_total,'1040.00');
  assert.deepEqual(result.summary,{billed:'3440.00',paid:'1200.00',remaining:'920.00',returns:'1320.00'});
  assert.equal('expenses' in result.summary,false);
});

test('shopkeeper daily report retains the shop expense total and selected customer filter',async t=>{
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:2,shop_id:3,role:'shopkeeper'}];
    if(sql.includes('FROM expenses')){
      assert.deepEqual(parameters,[3,'2026-10-19']);return [{amount:'75.50'}];
    }
    assert.deepEqual(parameters,['cash',3,'2026-10-19',12]);
    return [];
  });
  const response=await fetch(base+'/api/reports/daily?date=2026-10-19&customerId=12&method=cash',{headers});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).summary,{billed:'0.00',paid:'0.00',remaining:'0.00',returns:'0.00',expenses:'75.50'});
});

test('monthly item summary groups units separately and counts cancellations as corrections',async t=>{
  const rows=[
    {item:'Rice',unit:'kg',quantity:'5.000',returned_quantity:'5.000',net_quantity:'0.000',billed_amount:'1400.00',returned_amount:'1400.00',net_amount:'0.00'},
    {item:'Rice',unit:'g',quantity:'500.000',returned_quantity:'0.000',net_quantity:'500.000',billed_amount:'150.00',returned_amount:'0.00',net_amount:'150.00'}
  ];
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];
    assert.deepEqual(parameters,[3,'2026-10-01','2026-11-01',11]);
    assert.match(sql,/GROUP BY c.customer_id,c.name,bi.name,bi.unit/);
    assert.match(sql,/CASE WHEN b.status='cancelled' THEN bi.quantity/);
    assert.match(sql,/CASE WHEN b.status='cancelled' THEN bi.line_total/);
    return rows;
  });
  const response=await fetch(base+'/api/reports/monthly/items?month=2026-10&customerId=999',{headers});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{month:'2026-10',rows});
});

test('reports require authentication and staff report permission',async t=>{
  const base=await running(t,async sql=>{
    if(sql.includes('FROM sessions'))return [{user_id:9,shop_id:3,role:'staff'}];
    assert.match(sql,/FROM staff_permissions/);return [];
  });
  for(const route of ['/api/reports/daily','/api/reports/monthly','/api/reports/monthly/items']){
    assert.equal((await fetch(base+route)).status,401);
    assert.equal((await fetch(base+route,{headers})).status,403);
  }
});
