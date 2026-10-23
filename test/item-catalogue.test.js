import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { today } from '../src/ledger.js';
import { formatQuantity, formatItemQuantity, catalogueUnit, priceUnit, unitLabel, measurementValues } from '../public/units.js';
import { billItemSummary } from '../public/item-display.js';

const cookie={Cookie:`tt_session=${'a'.repeat(64)}`};
async function running(t,query) {
  const app=createApp({query,transaction:work=>work(query)}),server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('purchased quantities retain exact decimals and display kg, g and L',()=>{
  for(const [value,unit,expected] of [
    ['5.000','kg','5 kg'],['500.000','g','500 g'],['2.000','liter','2 L'],
    ['0.125','kg','0.125 kg'],['1.010','liter','1.01 L'],['500','g','500 g'],['3.000','piece','3 piece']
  ])assert.equal(formatQuantity(value,unit),expected);
  assert.equal(unitLabel('liter'),'Liter (L)');
  assert.equal(unitLabel('g'),'Gram (g)');
});

test('measurement columns preserve the saved unit and never count a quantity twice',()=>{
  assert.deepEqual(measurementValues('5.000','kg'),['5 kg','—','—','—']);
  assert.deepEqual(measurementValues('500.000','g'),['—','500 g','—','—']);
  assert.deepEqual(measurementValues('1.010','liter'),['—','—','1.01 L','—']);
  assert.deepEqual(measurementValues('3.000','piece'),['—','—','—','3 piece']);
  assert.deepEqual(measurementValues('0.125','kg'),['0.125 kg','—','—','—']);
});

test('bottle size and count display separately from the final bottle price',()=>{
  const one={pricing_mode:'bottle',quantity:'1.500',unit:'liter',package_size:'1.500',package_count:1};
  const two={...one,quantity:'3.000',package_count:2};
  assert.equal(formatItemQuantity(one),'1.5 L bottle');
  assert.equal(formatItemQuantity(two),'2 × 1.5 L bottles');
  assert.equal(catalogueUnit(one),'1.5 L bottle');
  assert.equal(priceUnit(one),'bottle');
  assert.equal(priceUnit({unit:'liter',pricing_mode:'measured'}),'L');
});

test('inline bill item names remain text, including names containing HTML',()=>{
  const summary=billItemSummary([{name:'<img src=x onerror=alert(1)>',quantity:'500.000',unit:'g'}]);
  assert.doesNotMatch(summary,/<img/);
  assert.ok(summary.includes('&lt;img'));
  assert.ok(summary.includes('500 g'));
});

test('customer catalog uses bill snapshots and session scope, ignoring supplied customer IDs',async t=>{
  const items=[
    {bill_item_id:3,name:'Rice',quantity:'5.000',unit:'kg',price:'280.00',line_total:'1400.00',bill_date:'2026-10-19',bill_id:7,bill_no:'BILL-7',bill_status:'active',returned_quantity:'1.000'},
    {bill_item_id:2,name:'Tea',quantity:'500.000',unit:'g',price:'2.00',line_total:'1000.00',bill_date:'2026-10-19',bill_id:7,bill_no:'BILL-7',bill_status:'active',returned_quantity:'0.000'},
    {bill_item_id:1,name:'Oil',quantity:'2.000',unit:'liter',price:'520.00',line_total:'1040.00',bill_date:'2026-10-18',bill_id:6,bill_no:'BILL-6',bill_status:'cancelled',returned_quantity:'0.000'}
  ];
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];
    assert.match(sql,/FROM bill_items i JOIN bills b ON b.bill_id=i.bill_id AND b.shop_id=i.shop_id/);
    assert.match(sql,/WHERE b.shop_id=\? AND b.customer_id=\?/);
    assert.match(sql,/r.shop_id=i.shop_id/);
    assert.match(sql,/i\.price,i\.line_total/);
    assert.match(sql,/b\.bill_date/);
    assert.doesNotMatch(sql,/JOIN items /); // Catalogue edits must not rewrite purchased quantities or units.
    assert.deepEqual(parameters,[3,11,today().slice(0,7)+'-01']);
    return items;
  });
  const response=await fetch(base+'/api/items/purchased?customerId=99&shopId=100',{headers:cookie});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{items,hasMore:false});
});

test('purchased items paginate beyond the latest 50 without losing ID precision',async t=>{
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];
    assert.match(sql,/ORDER BY i.bill_item_id DESC LIMIT 51/);
    if(parameters.length===4){
      assert.deepEqual(parameters,[3,11,today().slice(0,7)+'-01','9007199254740993']);
      assert.match(sql,/AND i.bill_item_id<\?/);
      return [{bill_item_id:'9007199254740992',name:'Older rice',quantity:'0.250',unit:'kg'}];
    }
    assert.deepEqual(parameters,[3,11,today().slice(0,7)+'-01']);
    return Array.from({length:51},(_,index)=>({bill_item_id:100-index}));
  });
  let response=await fetch(base+'/api/items/purchased',{headers:cookie}),result=await response.json();
  assert.equal(result.items.length,50);assert.equal(result.hasMore,true);assert.equal(result.items.at(-1).bill_item_id,51);
  response=await fetch(base+'/api/items/purchased?before=9007199254740993',{headers:cookie});result=await response.json();
  assert.equal(result.items[0].bill_item_id,'9007199254740992');assert.equal(result.hasMore,false);
  for(const before of ['0','-1','1 OR 1=1','1.5'])assert.equal((await fetch(base+`/api/items/purchased?before=${encodeURIComponent(before)}`,{headers:cookie})).status,400);
  assert.equal((await fetch(base+'/api/items/purchased?view=everything',{headers:cookie})).status,400);
});

test('New and Old item views split the current month from previous bills',async t=>{
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11}];
    assert.deepEqual(parameters,[3,11,today().slice(0,7)+'-01']);
    if(sql.includes('b.bill_date>=?'))return [{bill_item_id:2,name:'New rice',quantity:'5.000',unit:'kg',line_total:'1400.00'}];
    assert.match(sql,/b\.bill_date<\?/);
    return [{bill_item_id:1,name:'Old milk',quantity:'2.000',unit:'liter',line_total:'500.00'}];
  });
  const current=await(await fetch(base+'/api/items/purchased?view=new',{headers:cookie})).json();
  const old=await(await fetch(base+'/api/items/purchased?view=old',{headers:cookie})).json();
  assert.equal(current.items[0].name,'New rice');assert.equal(old.items[0].name,'Old milk');
});

test('purchased catalog requires a customer session',async t=>{
  let role='shopkeeper';
  const base=await running(t,async sql=>{
    assert.match(sql,/FROM sessions|FROM staff_permissions/);
    return sql.includes('FROM sessions')?[{user_id:7,shop_id:3,role}]:[];
  });
  assert.equal((await fetch(base+'/api/items/purchased')).status,401);
  assert.equal((await fetch(base+'/api/items/purchased',{headers:cookie})).status,403);
  role='staff';assert.equal((await fetch(base+'/api/items/purchased',{headers:cookie})).status,403);
});

test('customer bill lists include the saved item names and quantities for their own khata',async t=>{
  const lines=[
    {bill_id:7,bill_item_id:1,name:'Rice',quantity:'5.000',unit:'kg'},
    {bill_id:7,bill_item_id:2,name:'Tea',quantity:'500.000',unit:'g'},
    {bill_id:8,bill_item_id:3,name:'Oil',quantity:'2.000',unit:'liter'}
  ];
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:7,shop_id:3,role:'customer',customer_id:11,name:'Customer'}];
    if(sql.includes('FROM shops'))return [{shop_id:3,shop_name:'Shop'}];
    if(sql.includes('AS month_bills'))return [{}];
    if(sql.includes('FROM customers c'))return [{customer_id:11,balance:'3440.00'}];
    if(sql.includes('FROM bills b JOIN customers')){assert.deepEqual(parameters,[3,11]);return [{bill_id:7},{bill_id:8}];}
    if(sql.includes('FROM bill_items i JOIN bills b')){
      assert.deepEqual(parameters,[3,11,7,8]);
      assert.match(sql,/WHERE b.shop_id=\? AND b.customer_id=\? AND b.bill_id IN \(\?,\?\)/);
      assert.doesNotMatch(sql,/JOIN items /);
      return lines;
    }
    if(sql.includes('FROM payments p JOIN customers')||sql.includes('FROM notifications'))return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response=await fetch(base+'/api/state?customerId=99',{headers:cookie});
  assert.equal(response.status,200);
  const state=await response.json();
  assert.deepEqual(state.bills[0].items,lines.slice(0,2));
  assert.deepEqual(state.bills[1].items,lines.slice(2));
  assert.deepEqual(state.items,[],'Customers must not receive the shop inventory in place of their purchases');
});

test('shopkeeper can create and edit gram items while saving price and audit history',async t=>{
  const writes=[];
  const base=await running(t,async(sql,parameters)=>{
    if(sql.includes('FROM sessions'))return [{user_id:2,shop_id:3,role:'shopkeeper'}];
    if(sql.startsWith('SELECT name,unit'))return [{name:'Tea',unit:'kg',default_price:'2.00',active:1}];
    if(sql.startsWith('INSERT INTO items')||sql.startsWith('UPDATE items')){writes.push(parameters);return {insertId:21};}
    assert.match(sql,/INSERT INTO audit_logs/);return {affectedRows:1};
  });
  const headers={...cookie,'Content-Type':'application/json','X-Requested-With':'TrustTally'};
  const body=JSON.stringify({name:'Tea',unit:'g',price:'2.00',active:true});
  assert.equal((await fetch(base+'/api/items',{method:'POST',headers,body})).status,201);
  assert.equal((await fetch(base+'/api/items/21',{method:'PATCH',headers,body})).status,200);
  assert.deepEqual(writes,[[3,'Tea','g','2.00'],['Tea','g','2.00',true,'21',3]]);
});
