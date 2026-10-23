import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';

async function running(t,query=async()=>[]){
  const app=createApp(typeof query==='function'?{query}:query),server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
const cookie={Cookie:`tt_session=${'a'.repeat(64)}`};
test('app shell and install manifest are served with security headers',async t=>{
  const base=await running(t),response=await fetch(base);
  assert.equal(response.status,200);assert.ok((await response.text()).includes('Your digital khata'));
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.equal((await fetch(base+icon.src)).status,200);
});
test('unauthenticated requests cannot read application data',async t=>{
  let queries=0;const base=await running(t,async()=>{queries++;return [];});
  for(const route of ['/api/state','/api/audit','/api/bills/1','/api/payments/1','/api/customers/1/ledger'])assert.equal((await fetch(base+route)).status,401);
  assert.equal(queries,0);
});
test('customers cannot read audit logs or another customer’s ledger',async t=>{
  const base=await running(t,async sql=>{assert.ok(sql.includes('FROM sessions'));return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];});
  assert.equal((await fetch(base+'/api/audit',{headers:cookie})).status,403);
  assert.equal((await fetch(base+'/api/customers/12/ledger',{headers:cookie})).status,403);
});
test('customer state and bill detail stay within the signed-in shop and customer',async t=>{
  const base=await running(t,async (sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11,name:'Customer'}];
    if(sql.includes('FROM shops'))return [{shop_id:3,shop_name:'Shop'}];
    if(sql.includes('SELECT b.*,c.name,c.phone')){assert.deepEqual(parameters,['99',3,11]);return [];}
    if(sql.includes('AS month_bills')){assert.equal(parameters.at(-2),3);assert.equal(parameters.at(-1),11);return [{}];}
    if(sql.includes('FROM customers c')){assert.deepEqual(parameters,[3,11]);return [];}
    if(sql.includes('FROM bills b JOIN customers')){assert.deepEqual(parameters,[3,11]);return [];}
    if(sql.includes('FROM payments p JOIN customers')){assert.deepEqual(parameters,[3,11]);return [];}
    if(sql.includes('FROM notifications')){assert.deepEqual(parameters,[7,3]);return [];}
    throw new Error(`Unexpected query: ${sql}`);
  });
  assert.equal((await fetch(base+'/api/state',{headers:cookie})).status,200);
  assert.equal((await fetch(base+'/api/bills/99',{headers:cookie})).status,404);
});
test('payment receipts and allocations stay within the signed-in customer account',async t=>{
  let allocationQueries=0;
  const base=await running(t,async (sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11,name:'Customer'}];
    if(sql.includes('FROM payments p JOIN customers')){
      assert.deepEqual(parameters,['19',3,11]);
      return sql.includes('p.payment_id=?')?[{payment_id:19,customer_id:11,amount:'500.00',method:'cash',status:'approved',payment_date:'2026-10-19',name:'Customer',customer_code:'CUS-0011'}]:[];
    }
    if(sql.includes('FROM payment_allocations')){allocationQueries++;assert.deepEqual(parameters,[19,3,11]);return [{amount:'500.00',bill_id:null,reference:'Opening balance'}];}
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response=await fetch(base+'/api/payments/19',{headers:cookie});
  assert.equal(response.status,200);assert.equal((await response.json()).allocations[0].reference,'Opening balance');assert.equal(allocationQueries,1);
});
test('customer monthly reports are scoped to their account and carry the closing balance',async t=>{
  const base=await running(t,async (sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11,name:'Customer'}];
    if(sql.includes('AS previous_balance')&&sql.includes('AS bills_total')){
      assert.equal(parameters.at(-2),3);assert.equal(parameters.at(-1),11);
      return [{customer_id:11,customer_code:'CUS-0011',name:'Customer',previous_balance:'3000.00',bills_total:'8500.00',payments_total:'4000.00',returns_total:'0.00'}];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response=await fetch(base+'/api/reports/monthly?month=2026-10',{headers:cookie});
  assert.equal(response.status,200);const report=await response.json();assert.equal(report.rows.length,1);assert.equal(report.rows[0].closing_balance,'7500.00');assert.equal(report.summary.closing,'7500.00');
});
test('monthly item report returns quantities and amounts only for the signed-in customer',async t=>{
  const base=await running(t,async (sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11,name:'Customer'}];
    if(sql.includes('SUM(bi.quantity) AS quantity')){
      assert.deepEqual(parameters,[3,'2026-10-01','2026-11-01',11]);
      assert.ok(sql.includes('b.shop_id=?'));
      return [{customer_id:11,customer_name:'Customer',item:'Rice',unit:'kg',quantity:'5.000',billed_amount:'1400.00',returned_quantity:'0.000',returned_amount:'0.00',net_quantity:'5.000',net_amount:'1400.00',bill_count:1}];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response=await fetch(base+'/api/reports/monthly/items?month=2026-10',{headers:cookie});
  assert.equal(response.status,200);const report=await response.json();
  assert.equal(report.rows.length,1);assert.equal(report.rows[0].item,'Rice');assert.equal(report.rows[0].quantity,'5.000');
});

test('customers and staff cannot create financial records',async t=>{
  for(const role of ['customer','staff']){
    const base=await running(t,async()=>[{user_id:7,shop_id:3,role,customer_id:11}]);
    for(const route of ['/api/bills','/api/payments/cash']){
      const response=await fetch(base+route,{method:'POST',headers:{...cookie,'Content-Type':'application/json','X-Requested-With':'TrustTally'},body:'{}'});
      assert.equal(response.status,403);
    }
  }
});
test('staff permissions are loaded per request and gate bill access',async t=>{
  let granted=false,billQueries=0;
  const base=await running(t,async sql=>{
    if(sql.includes('FROM sessions'))return [{user_id:9,shop_id:3,role:'staff',name:'Munshi'}];
    if(sql.includes('FROM staff_permissions'))return granted?[{permission:'bills.create'}]:[];
    if(sql.includes('FROM bills b JOIN customers')){billQueries++;assert.ok(sql.includes('b.shop_id=?'));return [{bill_id:17,shop_id:3,name:'Customer'}];}
    if(sql.includes('FROM bill_items'))return [];
    if(sql.includes('FROM returns'))return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  assert.equal((await fetch(base+'/api/bills/17',{headers:cookie})).status,403);
  assert.equal(billQueries,0);
  granted=true;
  assert.equal((await fetch(base+'/api/bills/17',{headers:cookie})).status,200);
  assert.equal(billQueries,1);
  granted=false;
  assert.equal((await fetch(base+'/api/bills/17',{headers:cookie})).status,403);
  assert.equal(billQueries,1);
});
test('staff without record permissions receive no customer or financial rows',async t=>{
  const queries=[];
  const base=await running(t,async sql=>{
    queries.push(sql);
    if(sql.includes('FROM sessions'))return [{user_id:9,shop_id:3,role:'staff',name:'Munshi'}];
    if(sql.includes('FROM staff_permissions'))return [{permission:'items.manage'}];
    if(sql.includes('FROM shops'))return [{shop_id:3,shop_name:'Shop',owner_name:'Owner',phone:'+923001234567',bank_account:'private'}];
    if(sql.includes('FROM items'))return [];
    if(sql.includes('FROM notifications'))return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response=await fetch(base+'/api/state',{headers:cookie});
  assert.equal(response.status,200);
  const state=await response.json();
  assert.deepEqual(state.customers,[]);assert.deepEqual(state.bills,[]);assert.deepEqual(state.payments,[]);
  assert.equal(state.shop.bank_account,undefined);
  assert.ok(!queries.some(sql=>sql.includes('FROM customers c')||sql.includes('FROM bills b')||sql.includes('FROM payments p')));
});
test('shopkeeper provisions a staff account with a temporary PIN',async t=>{
  const granted=[];
  const query=async (sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:2,shop_id:3,role:'shopkeeper',name:'Owner'}];
    if(sql.includes('INSERT INTO users')){assert.match(parameters[3],/^[a-f0-9]{32}:[a-f0-9]{128}$/);return {insertId:41};}
    if(sql.includes('INSERT INTO staff_permissions')){granted.push(parameters);return {affectedRows:1};}
    if(sql.includes('INSERT INTO audit_logs'))return {affectedRows:1};
    throw new Error(`Unexpected query: ${sql}`);
  };
  const base=await running(t,{query,transaction:async work=>work(query)});
  const response=await fetch(base+'/api/staff',{method:'POST',headers:{...cookie,'Content-Type':'application/json','X-Requested-With':'TrustTally'},body:JSON.stringify({name:'Munshi',phone:'03001234567',pin:'654321',permissions:['bills.create','payments.cash']})});
  assert.equal(response.status,201);
  assert.equal((await response.json()).userId,41);
  assert.deepEqual(granted,[[3,41,'bills.create'],[3,41,'payments.cash']]);
});
test('cross-site writes are rejected before authentication or database access',async t=>{
  const base=await running(t,async()=>{throw new Error('Database must not be called');});
  const first=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(first.status,403);
  const second=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'TrustTally',Origin:'https://other.example'},body:'{}'});assert.equal(second.status,403);
});
test('malformed JSON errors never echo submitted secrets',async t=>{
  const base=await running(t),response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'TrustTally'},body:'{"pin":"912345",BROKEN'});
  assert.equal(response.status,400);assert.ok(!(await response.text()).includes('912345'));
});
test('health reports a disconnected database without leaking connection details',async t=>{
  const base=await running(t,async()=>{throw new Error('mysql://private:password@example');});
  const response=await fetch(base+'/api/health');assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.database,'unavailable');assert.ok(!JSON.stringify(body).includes('password'));
});
test('empty and array request bodies are rejected as validation errors',async t=>{
  const base=await running(t);
  for(const body of ['', '[]']){
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'TrustTally'},body});
    assert.equal(response.status,400);
  }
});
