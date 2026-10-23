import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { hashSecret } from '../src/lib/security.js';

test('customer login requires only the registered phone and PIN',async t=>{
  const pinHash=await hashSecret('123456');
  const query=async(sql,parameters=[])=>{
    if(sql.includes('SELECT user_id,role,pin_hash FROM users'))return [{user_id:8,role:'customer',pin_hash:pinHash},{user_id:9,role:'shopkeeper',pin_hash:pinHash}];
    if(sql.startsWith('INSERT INTO sessions'))return {affectedRows:1};
    throw new Error(`Unexpected query: ${sql}`);
  };
  const db={query,transaction:async work=>work(query)},app=createApp(db),server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,headers={'Content-Type':'application/json','X-Requested-With':'TrustTally'};
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({phone:'0300 1234567',pin:'123456',accountRole:'customer'})});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/^tt_session=/);
  const shopkeeper=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({phone:'0300 1234567',pin:'123456',accountRole:'shopkeeper'})});
  assert.equal(shopkeeper.status,200);assert.match(shopkeeper.headers.get('set-cookie'),/^tt_session=/);
});

