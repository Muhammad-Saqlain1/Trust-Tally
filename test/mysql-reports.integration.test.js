import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';
import { createBill, correctBill, today } from '../src/ledger.js';
import { hashSecret } from '../src/lib/security.js';

test('MySQL: measured item costs, returns, cancelled reports, and customer privacy', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const db=createDatabase(process.env.TEST_DATABASE_URL),rollback=new Error('ROLLBACK_TEST_FIXTURES');
  const suffix=String(randomInt(100000000,999999999));
  let shopId;
  try {
    const tables=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('shops','users','customers','items','bills','bill_items','returns','payments','audit_logs','notifications')");
    assert.equal(tables.length,10);
    assert.ok(tables.every(table=>table.ENGINE==='InnoDB'),'Fixtures require transactional tables');
    await db.transaction(async query=>{
      const shop=await query('INSERT INTO shops (owner_name,shop_name,phone) VALUES (?,?,?)',['Report Test','Report Test Shop','+92'+suffix+'1']);
      shopId=shop.insertId;
      const owner=await query("INSERT INTO users (shop_id,role,phone,name,pin_hash) VALUES (?,'shopkeeper',?,'Report Test',?)",[shopId,'+92'+suffix+'1',await hashSecret('648291')]);
      const customer=await query("INSERT INTO customers (shop_id,customer_code,name,phone,opening_balance,credit_limit,consent_status) VALUES (?,'CUS-0001','Report Customer',?,'0.00','10000.00','accepted')",[shopId,'+92'+suffix+'2']);
      const user={user_id:owner.insertId,shop_id:shopId,role:'shopkeeper'},items=[];
      for(const [name,unit,price,quantity] of [['Rice','kg','280.00','5'],['Tea','g','2.00','500'],['Oil','liter','520.00','2']]){
        const saved=await query('INSERT INTO items (shop_id,name,unit,default_price) VALUES (?,?,?,?)',[shopId,name,unit,price]);
        items.push({itemId:saved.insertId,quantity,price});
      }
      // All domain writes and report reads share the outer transaction, which always rolls back.
      const boundary={query,transaction:work=>work(query)};
      const bill=await createBill(boundary,user,{customerId:customer.insertId,billDate:today(),paidNow:'0',items,clientKey:'measured-bill-'+suffix});
      const [firstItem]=await query('SELECT bill_item_id FROM bill_items WHERE bill_id=? ORDER BY bill_item_id',[bill.billId]);
      await correctBill(boundary,user,bill.billId,{type:'return',billItemId:firstItem.bill_item_id,quantity:'1',reason:'Test partial return',clientKey:'measured-return-'+suffix});
      let role='customer';
      const app=createApp({query:(sql,params)=>sql.includes('FROM sessions')?Promise.resolve([{...user,role,customer_id:customer.insertId}]):query(sql,params)});
      const server=app.listen(0,'127.0.0.1');await once(server,'listening');
      const origin=`http://127.0.0.1:${server.address().port}`,headers={Cookie:`tt_session=${'a'.repeat(64)}`};
      async function get(path){
        const response=await fetch(origin+'/api'+path,{headers}),body=await response.json();
        assert.equal(response.status,200,JSON.stringify(body));return body;
      }
      try {
        const purchased=await get('/items/purchased');
        assert.equal(purchased.items.length,3);
        const grams=purchased.items.find(item=>item.unit==='g');
        assert.ok(grams,'Apply migration 007_item_measurements before recording grams');
        assert.equal(grams.line_total,'1000.00');assert.equal(grams.quantity,'500.000');
        assert.equal(purchased.items.find(item=>item.unit==='liter').bill_date,today());
        // Later catalogue changes must not change the recorded cost or unit.
        await query('UPDATE items SET default_price=? WHERE item_id=? AND shop_id=?',['3.00',items[1].itemId,shopId]);
        assert.equal((await get('/items/purchased')).items.find(item=>item.unit==='g').line_total,'1000.00');
        let daily=await get('/reports/daily?date='+today());
        assert.equal(daily.summary.remaining,'3160.00');assert.equal(daily.summary.returns,'280.00');
        assert.equal('expenses' in daily.summary,false);
        await correctBill(boundary,user,bill.billId,{type:'cancel',reason:'Test cancellation after return',clientKey:'measured-cancel-'+suffix});
        daily=await get('/reports/daily?date='+today());
        assert.equal(daily.summary.billed,'3440.00');assert.equal(daily.summary.returns,'3440.00');assert.equal(daily.summary.remaining,'0.00');
        const monthly=await get('/reports/monthly/items?month='+today().slice(0,7));
        assert.equal(monthly.rows.length,3);
        for(const row of monthly.rows){assert.equal(Number(row.net_quantity),0);assert.equal(Number(row.net_amount),0);}
        assert.equal((await get('/reports/monthly?month='+today().slice(0,7))).rows[0].closing_balance,'0.00');
        const notifications=await query("SELECT customer_id FROM notifications WHERE shop_id=? AND type IN ('item_returned','bill_cancelled')",[shopId]);
        assert.equal(notifications.length,2);
        assert.ok(notifications.every(row=>String(row.customer_id)===String(customer.insertId)));
        role='shopkeeper';assert.equal((await get('/reports/daily?date='+today())).summary.expenses,'0.00');
      } finally {app.locals.cleanup();await new Promise(resolve=>server.close(resolve));}
      throw rollback;
    });
  } catch(error){if(error!==rollback)throw error;}
  finally {
    try {if(shopId)assert.equal((await db.query('SELECT shop_id FROM shops WHERE shop_id=?',[shopId])).length,0,'Test records must not persist');}
    finally {await db.close();}
  }
});
