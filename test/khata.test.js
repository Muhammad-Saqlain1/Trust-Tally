import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server.js';
import {addKhataItem,deliverKhataChat} from '../src/khata.js';
test('khata entry rejects invalid quantities, units and zero rates before writing',async()=>{
  const db={transaction:async()=>{throw new Error('No database write expected');}},body={name:'Sugar',unit:'kg',quantity:'2',price:'170'};
  for(const change of [{quantity:'0'},{quantity:'1.0001'},{unit:'piece'},{unit:'ml'},{price:'0'},{price:'-1'}])await assert.rejects(()=>addKhataItem(db,{}, {...body,...change}),error=>error.status===400);
});
test('bill permission alone cannot create new catalogue products through khata entry',async()=>{
  const db={transaction:work=>work(async sql=>{assert.match(sql,/^SELECT/);return [];})};
  await assert.rejects(()=>addKhataItem(db,{shop_id:3,role:'staff',permissions:['bills.create']},{customerId:4,name:'New product',unit:'kg',quantity:'2',price:'170'}),error=>error.status===403);
});
test('chat delivery is separate and reports disconnection without throwing',async()=>{
  const user={shop_id:3,user_id:9};let saved;
  assert.equal(await deliverKhataChat({query:async(sql,params)=>{saved={sql,params};}},user,{customerId:4,billId:12,message:'Rice: 5 kg'}),true);
  assert.match(saved.sql,/INSERT IGNORE INTO chat_messages/);assert.deepEqual(saved.params,[3,4,9,'Rice: 5 kg',12]);
  const warn=console.warn;console.warn=()=>{};
  try{assert.equal(await deliverKhataChat({query:async()=>{const error=new Error('down');error.code='ECONNREFUSED';throw error;}},user,{customerId:4,billId:12,message:'Rice: 5 kg'}),false);}
  finally{console.warn=warn;}
});
test('customers and unauthorized staff cannot add khata items or create monthly bills',async t=>{
  let role='customer';
  const app=createApp({query:async sql=>sql.includes('FROM sessions')?[{user_id:2,shop_id:3,role,customer_id:4}]:[]});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={Cookie:`tt_session=${'a'.repeat(64)}`,'Content-Type':'application/json','X-Requested-With':'TrustTally'};
  for(const next of ['customer','staff']){role=next;for(const path of ['/api/khata/items','/api/monthly-bills'])assert.equal((await fetch(base+path,{method:'POST',headers,body:'{}'})).status,403);}
  assert.equal((await fetch(base+'/api/monthly-bills')).status,401);
});
