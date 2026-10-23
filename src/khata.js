import { ensure } from './lib/errors.js';
import { money, decimal, quantity, lineTotal } from './lib/money.js';
import { text, digest } from './lib/security.js';
import { createBill, audit, balance, today } from './ledger.js';

export async function deliverKhataChat(db,user,{customerId,billId,message}){
  try{
    await db.query(`INSERT IGNORE INTO chat_messages (shop_id,customer_id,sender_id,text,source_type,source_id)
      VALUES (?,?,?,?,'khata',?)`,[user.shop_id,customerId,user.user_id,message,billId]);
    return true;
  }catch(error){
    console.warn('Khata entry saved, but chat delivery is unavailable:',error.code||error.name);
    return false;
  }
}

export async function addKhataItem(db, user, body) {
  const name=text(body.name,'Item name',160),unit=body.unit;
  ensure(['kg','g','liter'].includes(unit),400,'Choose kg, gram, or liter.');
  const mode=body.pricingMode??'measured';
  ensure(['measured','bottle'].includes(mode),400,'Choose a valid pricing method.');
  ensure(mode!=='bottle'||unit==='liter',400,'Bottle sizes must be entered in liters.');
  const size=quantity(body.quantity),packageSize=mode==='bottle'?(size/1000).toFixed(3):null;
  const count=mode==='bottle'?String(body.bottleCount??'1'):null;
  ensure(mode!=='bottle'||(/^[1-9]\d{0,5}$/.test(count)&&size*Number(count)<=999999999),400,'Enter a whole number of bottles within the supported quantity limit.');
  const price=decimal(money(body.price,'Rate'));
  ensure(money(price)>0,400,'Enter a rate greater than zero.');
  const saved=await db.transaction(async query=>{
    await query('SELECT shop_id FROM shops WHERE shop_id=? FOR UPDATE',[user.shop_id]);
    // The shop lock serializes entries; a product-range lock would block unrelated shops.
    const matches=await query(`SELECT item_id,name,unit,default_price FROM items WHERE shop_id=? AND name=? AND unit=? AND pricing_mode=? ${mode==='bottle'?'AND package_size=?':''} AND active=TRUE ORDER BY item_id LIMIT 1`,[user.shop_id,name,unit,mode,...(mode==='bottle'?[packageSize]:[])]);
    let item=matches[0];
    if(item&&mode==='bottle')ensure(price===decimal(money(item.default_price)),409,'Use the saved original price for this bottle size. Update the catalogue product first if its original price has changed.');
    if(!item){
      ensure(user.role==='shopkeeper'||user.permissions?.includes('items.manage'),403,'Your account can add only existing catalogue products.');
      const saved=await query('INSERT INTO items (shop_id,name,unit,default_price,pricing_mode,package_size) VALUES (?,?,?,?,?,?)',[user.shop_id,name,unit,price,mode,packageSize]);
      item={item_id:saved.insertId};
      await audit(query,user,'create','item',saved.insertId,null,{name,unit,default_price:price,pricing_mode:mode,package_size:packageSize});
    }
    const saved=await createBill({transaction:work=>work(query)},user,{
      customerId:String(body.customerId),billDate:body.billDate,paidNow:'0',creditReason:String(body.creditReason||'').trim(),
      items:[{itemId:String(item.item_id),quantity:((mode==='bottle'?size*Number(count):size)/1000).toFixed(3),price}],clientKey:body.clientKey
    });
    return {...saved,balance:decimal(await balance(query,user.shop_id,body.customerId))};
  });
  const amount=lineTotal(money(price),mode==='bottle'?Number(count)*1000:size);
  const compact=value=>String(Number(value));
  const itemQuantity=mode==='bottle'
    ? (Number(count)===1?`${compact(packageSize)} L bottle`:`${count} × ${compact(packageSize)} L bottles`)
    : `${compact(size/1000)} ${unit==='liter'?'L':unit}`;
  const chatConnected=await deliverKhataChat(db,user,{customerId:body.customerId,billId:saved.billId,message:`${name}: ${itemQuantity} · Rs. ${decimal(amount)} · ${body.billDate??today()}`});
  return {...saved,chatConnected,message:chatConnected?'Saved and sent to chat.':'Saved, chat not connected'};
}

export async function monthlyKhata(query, user, customerId) {
  ensure(/^[1-9]\d{0,19}$/.test(String(customerId)),400,'Choose a customer by ID or name.');
  if(user.role==='customer')ensure(String(customerId)===String(user.customer_id),403,'You can view only your own khata.');
  const customers=await query('SELECT customer_id,customer_code,name,phone FROM customers WHERE shop_id=? AND customer_id=? AND status=\'active\' AND consent_status=\'accepted\'',[user.shop_id,customerId]);
  ensure(customers[0],404,'Choose an active customer who has accepted their invitation.');
  const month=today().slice(0,7),start=month+'-01';
  const next=new Date(start+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
  const items=await query(`SELECT i.bill_item_id,i.name,i.quantity,i.unit,i.price,i.line_total,i.pricing_mode,i.package_size,i.package_count,
    b.bill_id,b.bill_no,b.bill_date,b.status AS bill_status,
    CASE WHEN b.status='cancelled' THEN i.quantity ELSE COALESCE((SELECT SUM(r.quantity) FROM returns r WHERE r.shop_id=i.shop_id AND r.bill_id=i.bill_id AND r.bill_item_id=i.bill_item_id),0) END AS returned_quantity,
    CASE WHEN b.status='cancelled' THEN i.line_total ELSE COALESCE((SELECT SUM(r.amount) FROM returns r WHERE r.shop_id=i.shop_id AND r.bill_id=i.bill_id AND r.bill_item_id=i.bill_item_id),0) END AS returned_amount
    FROM bills b JOIN bill_items i ON i.bill_id=b.bill_id AND i.shop_id=b.shop_id
    WHERE b.shop_id=? AND b.customer_id=? AND b.bill_date>=? AND b.bill_date<?
    ORDER BY b.bill_date,i.bill_item_id`,[user.shop_id,customerId,start,next.toISOString().slice(0,10)]);
  let original=0,returned=0;
  for(const item of items){
    original+=money(item.line_total);returned+=money(item.returned_amount);
    item.amount=decimal(money(item.line_total)-money(item.returned_amount));
  }
  ensure(original<=99999999999,400,'The monthly bill exceeds the supported amount.');
  return {customer:customers[0],month,items,originalTotal:decimal(original),returnsTotal:decimal(returned),total:decimal(original-returned),currentBalance:decimal(await balance(query,user.shop_id,customerId))};
}

export async function createMonthlyBill(db,user,body){
  return db.transaction(async query=>{
    // Match credit-entry lock order so a monthly snapshot cannot omit a concurrent item.
    await query('SELECT shop_id FROM shops WHERE shop_id=? FOR UPDATE',[user.shop_id]);
    const snapshot=await monthlyKhata(query,user,body.customerId);
    ensure(snapshot.items.length,400,'This customer has no items recorded for the current month.');
    const hash=digest(JSON.stringify(snapshot));
    const existing=await query('SELECT monthly_bill_id,bill_no FROM monthly_bills WHERE shop_id=? AND customer_id=? AND month=? AND content_hash=?',[user.shop_id,body.customerId,snapshot.month+'-01',hash]);
    if(existing[0])return {monthlyBillId:existing[0].monthly_bill_id,billNo:existing[0].bill_no,duplicate:true};
    const saved=await query('INSERT INTO monthly_bills (shop_id,customer_id,month,total,content_hash,snapshot,created_by) VALUES (?,?,?,?,?,?,?)',[user.shop_id,body.customerId,snapshot.month+'-01',snapshot.total,hash,JSON.stringify(snapshot),user.user_id]);
    const billNo=`MONTH-${snapshot.month.replace('-','')}-${String(saved.insertId).padStart(6,'0')}`;
    await query('UPDATE monthly_bills SET bill_no=? WHERE monthly_bill_id=? AND shop_id=?',[billNo,saved.insertId,user.shop_id]);
    await audit(query,user,'create','monthly_bill',saved.insertId,null,{bill_no:billNo,customer_id:body.customerId,month:snapshot.month,total:snapshot.total,source_bill_items:snapshot.items.map(item=>item.bill_item_id)});
    return {monthlyBillId:saved.insertId,billNo};
  });
}
