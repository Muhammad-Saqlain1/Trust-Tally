import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {once} from 'node:events';
import {createDatabase} from '../src/db.js';
import {createApp} from '../src/server.js';
import {hashSecret} from '../src/lib/security.js';
import {addKhataItem,monthlyKhata,createMonthlyBill} from '../src/khata.js';
import {balance,createBill,correctBill,today} from '../src/ledger.js';

test('MySQL: item entry, exact quantities, monthly collection, retry, returns and customer isolation', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const db=createDatabase(process.env.TEST_DATABASE_URL),rollback=new Error('ROLLBACK_KHATA_QA');
  const suffix=String(randomInt(100000000,999999999));let shopId;
  try{
    const engines=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('shops','users','customers','items','bills','bill_items','returns','monthly_bills','audit_logs','notifications')");
    assert.equal(engines.length,10);assert.ok(engines.every(table=>table.ENGINE==='InnoDB'));
    await db.transaction(async query=>{
      const shop=await query('INSERT INTO shops (owner_name,shop_name,phone) VALUES (?,?,?)',['Khata QA','Khata QA','+92'+suffix+'1']);shopId=shop.insertId;
      const owner=await query("INSERT INTO users (shop_id,role,phone,name,pin_hash) VALUES (?,'shopkeeper',?,'QA Owner',?)",[shopId,'+92'+suffix+'1',await hashSecret('648291')]);
      const first=await query("INSERT INTO customers (shop_id,customer_code,name,phone,credit_limit,consent_status) VALUES (?,'QA-1','QA Customer',?,'100000.00','accepted')",[shopId,'+92'+suffix+'2']);
      const second=await query("INSERT INTO customers (shop_id,customer_code,name,phone,credit_limit,consent_status) VALUES (?,'QA-2','Other Customer',?,'100000.00','accepted')",[shopId,'+92'+suffix+'3']);
      const user={user_id:owner.insertId,shop_id:shopId,role:'shopkeeper'},boundary={query,transaction:work=>work(query)};
      const inputs=[['Sugar','2','kg','170.00'],['Milk','3.5','liter','220.00'],['Tea','250','g','2.00']];
      const entries=[];
      for(const [name,qty,unit,price] of inputs)entries.push(await addKhataItem(boundary,user,{customerId:first.insertId,name,quantity:qty,unit,price,billDate:today(),clientKey:`khata-${suffix}-${name}`}));
      assert.equal(await balance(query,shopId,first.insertId),161000);
      const retry=await addKhataItem(boundary,user,{customerId:first.insertId,name:'Sugar',quantity:'2',unit:'kg',price:'170.00',billDate:today(),clientKey:`khata-${suffix}-Sugar`});
      assert.equal(retry.duplicate,true);assert.equal(retry.balance,'1610.00');
      const sugarChat=await query("SELECT text FROM chat_messages WHERE shop_id=? AND customer_id=? AND source_type='khata' AND source_id=?",[shopId,first.insertId,entries[0].billId]);
      assert.equal(sugarChat.length,1,'A retried khata entry must not duplicate its chat update');
      assert.equal(sugarChat[0].text,`Sugar: 2 kg · Rs. 340.00 · ${today()}`);
      const products=await query('SELECT item_id,name FROM items WHERE shop_id=? ORDER BY item_id',[shopId]);
      assert.equal(products.length,3,'Retries must not add duplicate catalogue products');
      const previous=new Date(today().slice(0,7)+'-01T12:00:00Z');previous.setUTCDate(0);
      await createBill(boundary,user,{customerId:first.insertId,billDate:previous.toISOString().slice(0,10),paidNow:'0',items:[{itemId:products[0].item_id,quantity:'9',price:'170.00'}],clientKey:`old-month-${suffix}`});
      await addKhataItem(boundary,user,{customerId:second.insertId,name:'Milk',quantity:'8',unit:'liter',price:'220.00',billDate:today(),clientKey:`other-customer-${suffix}`});
      let preview=await monthlyKhata(query,user,first.insertId);
      assert.equal(preview.total,'1610.00');assert.equal(preview.items.length,3);
      assert.deepEqual(preview.items.map(item=>[item.name,item.quantity,item.unit,item.amount]),[['Sugar','2.000','kg','340.00'],['Milk','3.500','liter','770.00'],['Tea','250.000','g','500.00']]);
      const before=await balance(query,shopId,first.insertId),saved=await createMonthlyBill(boundary,user,{customerId:first.insertId});
      const again=await createMonthlyBill(boundary,user,{customerId:first.insertId});
      assert.equal(String(again.monthlyBillId),String(saved.monthlyBillId));assert.equal(again.duplicate,true);
      assert.equal(await balance(query,shopId,first.insertId),before,'Creating or retrying a monthly bill cannot charge the customer again');
      const [sugar]=await query('SELECT bill_item_id FROM bill_items WHERE bill_id=?',[entries[0].billId]);
      await correctBill(boundary,user,entries[0].billId,{type:'return',billItemId:sugar.bill_item_id,quantity:'0.5',reason:'QA return',clientKey:`return-${suffix}`});
      preview=await monthlyKhata(query,user,first.insertId);assert.equal(preview.total,'1525.00');assert.equal(preview.returnsTotal,'85.00');
      const revised=await createMonthlyBill(boundary,user,{customerId:first.insertId});assert.notEqual(String(revised.monthlyBillId),String(saved.monthlyBillId));
      const [original]=await query('SELECT snapshot FROM monthly_bills WHERE monthly_bill_id=?',[saved.monthlyBillId]);
      assert.equal((typeof original.snapshot==='string'?JSON.parse(original.snapshot):original.snapshot).total,'1610.00');
      const colaBase={customerId:second.insertId,name:'Cola',unit:'liter',billDate:today()};
      await addKhataItem(boundary,user,{...colaBase,quantity:'1',pricingMode:'measured',price:'130.00',clientKey:`cola-loose-${suffix}`});
      const bottle15=await addKhataItem(boundary,user,{...colaBase,quantity:'1.5',pricingMode:'bottle',bottleCount:'1',price:'170.00',clientKey:`cola-15-${suffix}`});
      await addKhataItem(boundary,user,{...colaBase,quantity:'2',pricingMode:'bottle',bottleCount:'1',price:'210.00',clientKey:`cola-20-${suffix}`});
      const twoBottles=await addKhataItem(boundary,user,{...colaBase,quantity:'1.5',pricingMode:'bottle',bottleCount:'2',price:'170.00',clientKey:`cola-15-two-${suffix}`});
      await assert.rejects(addKhataItem(boundary,user,{...colaBase,quantity:'1.5',pricingMode:'bottle',bottleCount:'1',price:'195.00',clientKey:`cola-wrong-${suffix}`}),/saved original price/);
      const colaProducts=await query("SELECT pricing_mode,package_size,default_price FROM items WHERE shop_id=? AND name='Cola' ORDER BY pricing_mode,package_size",[shopId]);
      assert.deepEqual(colaProducts.map(row=>[row.pricing_mode,row.package_size,row.default_price]),[
        ['measured',null,'130.00'],['bottle','1.500','170.00'],['bottle','2.000','210.00']
      ]);
      const bottleLines=await query('SELECT bill_id,quantity,price,line_total,pricing_mode,package_size,package_count FROM bill_items WHERE bill_id IN (?,?) ORDER BY bill_id',[bottle15.billId,twoBottles.billId]);
      assert.deepEqual(bottleLines.map(row=>[row.quantity,row.price,row.line_total,row.pricing_mode,row.package_size,row.package_count]),[
        ['1.500','170.00','170.00','bottle','1.500',1],['3.000','170.00','340.00','bottle','1.500',2]
      ]);
      const bottleChat=await query("SELECT text FROM chat_messages WHERE shop_id=? AND source_type='khata' AND source_id=?",[shopId,twoBottles.billId]);
      assert.equal(bottleChat[0].text,`Cola: 2 × 1.5 L bottles · Rs. 340.00 · ${today()}`);
      const [twoBottleLine]=await query('SELECT bill_item_id FROM bill_items WHERE bill_id=?',[twoBottles.billId]);
      await assert.rejects(correctBill(boundary,user,twoBottles.billId,{type:'return',billItemId:twoBottleLine.bill_item_id,quantity:'0.5',reason:'Invalid partial bottle',clientKey:`cola-partial-${suffix}`}),/complete bottles/);
      const bottleReturn=await correctBill(boundary,user,twoBottles.billId,{type:'return',billItemId:twoBottleLine.bill_item_id,quantity:'1.5',reason:'One bottle returned',clientKey:`cola-return-${suffix}`});
      assert.equal(bottleReturn.amount,'170.00');
      const bottleMonth=await monthlyKhata(query,user,second.insertId);
      assert.equal(bottleMonth.total,'2440.00');
      const disconnected={transaction:boundary.transaction,query:async(sql,params)=>{
        if(sql.includes('chat_messages')){const error=new Error('QA chat unavailable');error.code='ECONNREFUSED';throw error;}
        return query(sql,params);
      }};
      const originalWarn=console.warn;console.warn=()=>{};
      let savedWithoutChat;
      try{savedWithoutChat=await addKhataItem(disconnected,user,{customerId:second.insertId,name:'Flour',quantity:'1',unit:'kg',price:'90.00',billDate:today(),clientKey:`chat-down-${suffix}`});}
      finally{console.warn=originalWarn;}
      assert.equal(savedWithoutChat.chatConnected,false);assert.equal(savedWithoutChat.message,'Saved, chat not connected');
      assert.equal(Number((await query('SELECT COUNT(*) AS count FROM bills WHERE bill_id=? AND shop_id=?',[savedWithoutChat.billId,shopId]))[0].count),1,'A chat failure must not roll back the saved bill');
      let actor={...user,role:'customer',customer_id:first.insertId,permissions:[]};
      const app=createApp({query:(sql,params)=>sql.includes('FROM sessions')?Promise.resolve([actor]):query(sql,params),transaction:boundary.transaction});
      const server=app.listen(0,'127.0.0.1');await once(server,'listening');
      try{
        const base=`http://127.0.0.1:${server.address().port}`,headers={Cookie:`tt_session=${'a'.repeat(64)}`};
        assert.equal((await fetch(base+`/api/monthly-bills/${saved.monthlyBillId}`,{headers})).status,200);
        const customerBills=await(await fetch(base+'/api/monthly-bills',{headers})).json();
        assert.deepEqual(customerBills.bills.map(row=>String(row.monthly_bill_id)),[String(revised.monthlyBillId),String(saved.monthlyBillId)],'New monthly bills must appear in the customer Bill section');
        const customerState=await(await fetch(base+'/api/state',{headers})).json();
        assert.ok(entries.every(entry=>customerState.bills.some(bill=>String(bill.bill_id)===String(entry.billId))),'Each saved item bill must appear in the customer bill history');
        actor={...actor,customer_id:second.insertId};
        assert.equal((await fetch(base+`/api/monthly-bills/${saved.monthlyBillId}`,{headers})).status,404);
        const list=await(await fetch(base+'/api/monthly-bills',{headers})).json();assert.equal(list.bills.length,0);
      }finally{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));}
      throw rollback;
    });
  }catch(error){if(error!==rollback)throw error;}
  finally{if(shopId)assert.equal((await db.query('SELECT shop_id FROM shops WHERE shop_id=?',[shopId])).length,0);await db.close();}
});
