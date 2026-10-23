import { ensure } from './lib/errors.js';
import { money, decimal, quantity, lineTotal, oldestFirst } from './lib/money.js';
import { digest, text } from './lib/security.js';

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function businessDay(value) {
  const result = value ?? today();
  ensure(typeof result === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result), 400, 'Use a valid bill or payment date.');
  const parsed = new Date(result + 'T12:00:00Z');
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === result && result >= '2000-01-01' && result <= today(), 400, 'Date must be a valid date on or before today.');
  return result;
}
export async function audit(query, user, action, entity, entityId, oldValue, newValue, reason = null) {
  await query('INSERT INTO audit_logs (shop_id,user_id,action,entity,entity_id,old_value,new_value,reason) VALUES (?,?,?,?,?,?,?,?)', [user.shop_id, user.user_id, action, entity, entityId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null, reason]);
}
export async function balance(query, shopId, customerId) {
  const rows = await query(`SELECT c.opening_balance,
    COALESCE((SELECT SUM(b.total) FROM bills b WHERE b.shop_id=c.shop_id AND b.customer_id=c.customer_id),0) AS billed,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.shop_id=c.shop_id AND p.customer_id=c.customer_id AND p.status='approved'),0) AS paid,
    COALESCE((SELECT SUM(r.amount) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id),0) AS returned
    FROM customers c WHERE c.shop_id=? AND c.customer_id=?`, [shopId, customerId]);
  ensure(rows[0], 404, 'Customer not found.');
  const row = rows[0];
  return money(row.opening_balance) + money(row.billed) - money(row.paid) - money(row.returned);
}
async function notify(query, user, customer, type, message) {
  await query("INSERT INTO notifications (user_id,shop_id,customer_id,channel,type,message,status,sent_at) VALUES (?,?,?,'in-app',?,?,'sent',UTC_TIMESTAMP(3))", [customer.user_id, user.shop_id, customer.customer_id, type, message]);
}
async function allocate(query, customer, paymentId, amount) {
  const opening = await query(`SELECT COALESCE(SUM(a.amount),0) AS allocated FROM payment_allocations a
    JOIN payments p ON p.payment_id=a.payment_id WHERE p.customer_id=? AND p.shop_id=? AND p.status='approved' AND a.bill_id IS NULL`, [customer.customer_id, customer.shop_id]);
  const debts = [{ billId: null, unpaid: Math.max(0, money(customer.opening_balance) - money(opening[0].allocated)) }];
  const bills = await query(`SELECT b.bill_id,b.total,
    COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.payment_id=a.payment_id WHERE a.bill_id=b.bill_id AND p.status='approved'),0) AS paid,
    COALESCE((SELECT SUM(r.amount) FROM returns r WHERE r.bill_id=b.bill_id),0) AS returned
    FROM bills b WHERE b.shop_id=? AND b.customer_id=? ORDER BY b.bill_date,b.bill_id`, [customer.shop_id, customer.customer_id]);
  for (const bill of bills) debts.push({ billId: bill.bill_id, unpaid: Math.max(0, money(bill.total) - money(bill.paid) - money(bill.returned)) });
  const result = oldestFirst(amount, debts);
  ensure(result.remaining === 0, 409, 'Payment allocation did not match the outstanding balance.');
  for (const allocation of result.allocations) await query('INSERT INTO payment_allocations (shop_id,customer_id,payment_id,bill_id,amount) VALUES (?,?,?,?,?)', [customer.shop_id,customer.customer_id,paymentId, allocation.billId, decimal(allocation.amount)]);
}
function requestIdentity(body) {
  const key = text(body.clientKey, 'Request identifier', 64);
  ensure(/^[a-zA-Z0-9-]{16,64}$/.test(key), 400, 'Invalid request identifier.');
  return { key, hash: digest(JSON.stringify(body)) };
}
async function lockCustomer(query, user, customerId) {
  const rows = await query("SELECT * FROM customers WHERE shop_id=? AND customer_id=? AND status='active' AND consent_status='accepted' FOR UPDATE", [user.shop_id, customerId]);
  ensure(rows[0], 400, 'Choose an active customer who has accepted the invitation.');
  return rows[0];
}
async function ensureStatementOpen(query, user, customerId, businessDate) {
  const rows=await query("SELECT statement_id FROM monthly_statements WHERE shop_id=? AND customer_id=? AND month=DATE_FORMAT(?,'%Y-%m-01')",[user.shop_id,customerId,businessDate]);
  ensure(!rows[0],409,'This month is closed. Record the correction in the current month.');
}
async function recordCash(query, user, customer, amount, billId, key, hash, paymentDate) {
  const payment = await query("INSERT INTO payments (shop_id,customer_id,bill_id,amount,payment_date,method,status,confirmed_by,confirmed_at,client_key,request_hash) VALUES (?,?,?,?,?,'cash','approved',?,UTC_TIMESTAMP(3),?,?)", [user.shop_id, customer.customer_id, billId, decimal(amount), paymentDate, user.user_id, key, hash]);
  await allocate(query, customer, payment.insertId, amount);
  await audit(query, user, 'create', 'payment', payment.insertId, null, { customer_id: customer.customer_id, amount: decimal(amount), method: 'cash', status: 'approved', bill_id: billId, payment_date: paymentDate });
  return payment.insertId;
}
export async function createBill(db, user, body) {
  const identity = requestIdentity(body);
  ensure(Number.isSafeInteger(Number(body.customerId)) && Number(body.customerId) > 0, 400, 'Choose a customer.');
  ensure(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 100, 400, 'Add between 1 and 100 items.');
  const paidNow = money(body.paidNow ?? '0', 'Paid now'), billDate = businessDay(body.billDate);
  return db.transaction(async query => {
    await query('SELECT shop_id FROM shops WHERE shop_id=? FOR UPDATE', [user.shop_id]);
    const saved = await query('SELECT bill_id,bill_no,request_hash FROM bills WHERE shop_id=? AND client_key=?', [user.shop_id, identity.key]);
    if (saved[0]) {
      ensure(saved[0].request_hash === identity.hash, 409, 'This request identifier was already used for different bill details.');
      return { billId: saved[0].bill_id, billNo: saved[0].bill_no, duplicate: true };
    }
    const customer = await lockCustomer(query, user, body.customerId);
    await ensureStatementOpen(query,user,customer.customer_id,billDate);
    const lines = [];
    let total = 0;
    for (const item of body.items) {
      ensure(Number.isSafeInteger(Number(item.itemId)) && Number(item.itemId) > 0, 400, 'Invalid catalogue item.');
      const catalogue = await query('SELECT item_id,name,unit,default_price,pricing_mode,package_size FROM items WHERE item_id=? AND shop_id=? AND active=TRUE', [item.itemId, user.shop_id]);
      ensure(catalogue[0], 400, 'A selected item is no longer available in your catalogue.');
      const savedItem = catalogue[0], price = money(item.price, 'Item price'), qty = quantity(item.quantity);
      ensure(savedItem.unit !== 'piece' || qty % 1000 === 0, 400, 'Items sold by piece need a whole-number quantity.');
      const bottled=savedItem.pricing_mode==='bottle',size=bottled?quantity(savedItem.package_size):null;
      ensure(!bottled||(savedItem.unit==='liter'&&qty%size===0),400,'Enter complete bottles of the saved size.');
      ensure(!bottled||price===money(savedItem.default_price),400,'Use the original final price saved for this bottle size.');
      const count=bottled?qty/size:null;
      const amount = lineTotal(price, bottled?count*1000:qty);
      total += amount;
      lines.push({ ...savedItem, pricing_mode:bottled?'bottle':'measured',package_size:bottled?savedItem.package_size:null,package_count:count,price: decimal(price), quantity: (qty / 1000).toFixed(3), line_total: decimal(amount) });
    }
    ensure(total > 0 && total <= 99999999999, 400, 'Bill total must be positive and within the supported limit.');
    ensure(paidNow <= total, 400, 'Paid now cannot exceed the bill total.');
    const oldBalance = await balance(query, user.shop_id, customer.customer_id), newBalance = oldBalance + total - paidNow;
    let reason = null;
    if (newBalance > money(customer.credit_limit)) reason = text(body.creditReason, 'A reason for exceeding the credit limit', 500);
    const bill = await query('INSERT INTO bills (shop_id,customer_id,bill_date,total,created_by,client_key,request_hash) VALUES (?,?,?,?,?,?,?)', [user.shop_id, customer.customer_id, billDate, decimal(total), user.user_id, identity.key, identity.hash]);
    const billNo = `BILL-${String(bill.insertId).padStart(6,'0')}`;
    await query('UPDATE bills SET bill_no=? WHERE bill_id=?', [billNo, bill.insertId]);
    for (const line of lines) {
      await query('INSERT INTO bill_items (shop_id,bill_id,item_id,name,quantity,unit,price,line_total,pricing_mode,package_size,package_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [user.shop_id,bill.insertId, line.item_id, line.name, line.quantity, line.unit, line.price, line.line_total,line.pricing_mode,line.package_size,line.package_count]);
      if (money(line.default_price) !== money(line.price)) await audit(query, user, 'price_override', 'bill', bill.insertId, { item_id: line.item_id, price: line.default_price }, { item_id: line.item_id, price: line.price });
    }
    await audit(query, user, 'create', 'bill', bill.insertId, null, { bill_no: billNo, customer_id: customer.customer_id, bill_date: billDate, total: decimal(total), paid_now: decimal(paidNow), items: lines }, reason);
    if (paidNow > 0) await recordCash(query, user, customer, paidNow, bill.insertId, digest(`bill-paid:${identity.key}`), identity.hash, billDate);
    await notify(query, user, customer, 'bill', `${billNo}: Rs. ${decimal(total)} billed, Rs. ${decimal(paidNow)} paid now. Your balance is Rs. ${decimal(newBalance)}.`);
    return { billId: bill.insertId, billNo, balance: decimal(newBalance) };
  });
}
export async function receiveCash(db, user, body) {
  const identity = requestIdentity(body), amount = money(body.amount), paymentDate = businessDay(body.paymentDate);
  ensure(amount > 0, 400, 'Payment must be greater than zero.');
  ensure(Number.isSafeInteger(Number(body.customerId)) && Number(body.customerId) > 0, 400, 'Choose a customer.');
  return db.transaction(async query => {
    await query('SELECT shop_id FROM shops WHERE shop_id=? FOR UPDATE', [user.shop_id]);
    const saved = await query('SELECT payment_id,request_hash FROM payments WHERE shop_id=? AND client_key=?', [user.shop_id, identity.key]);
    if (saved[0]) {
      ensure(saved[0].request_hash === identity.hash, 409, 'This request identifier was already used for different payment details.');
      return { paymentId: saved[0].payment_id, duplicate: true };
    }
    const customer = await lockCustomer(query, user, body.customerId), due = await balance(query, user.shop_id, customer.customer_id);
    await ensureStatementOpen(query,user,customer.customer_id,paymentDate);
    ensure(amount <= due, 400, 'Payment cannot exceed the customer’s outstanding balance.');
    const paymentId = await recordCash(query, user, customer, amount, null, identity.key, identity.hash, paymentDate);
    await notify(query, user, customer, 'payment', `Cash payment of Rs. ${decimal(amount)} received. Your remaining balance is Rs. ${decimal(due - amount)}.`);
    return { paymentId, balance: decimal(due - amount) };
  });
}
export async function correctBill(db, user, billId, body) {
  ensure(['return','cancel'].includes(body.type), 400, 'Choose Return item or Cancel bill.');
  const reason = text(body.reason, 'Correction reason', 500);
  ensure(Number.isSafeInteger(Number(billId)) && Number(billId) > 0, 400, 'Choose a bill.');
  const identity=requestIdentity(body), requestHash=digest(JSON.stringify({billId:String(billId),body}));
  return db.transaction(async query => {
    await query('SELECT shop_id FROM shops WHERE shop_id=? FOR UPDATE', [user.shop_id]);
    const earlier=await query('SELECT return_id,bill_id,amount,request_hash FROM returns WHERE shop_id=? AND client_key=?', [user.shop_id,identity.key]);
    if(earlier[0]){
      ensure(earlier[0].request_hash===requestHash,409,'This request identifier was already used for a different correction.');
      const previousBalance=await balance(query,user.shop_id,(await query('SELECT customer_id FROM bills WHERE bill_id=? AND shop_id=?',[billId,user.shop_id]))[0].customer_id);
      return {returnId:earlier[0].return_id,billId:Number(billId),amount:earlier[0].amount,balance:decimal(previousBalance),duplicate:true};
    }
    const bills = await query('SELECT bill_id,bill_no,customer_id,total,status FROM bills WHERE bill_id=? AND shop_id=? FOR UPDATE', [billId,user.shop_id]);
    const bill=bills[0];
    ensure(bill,404,'Bill not found.');
    ensure(bill.status==='active',409,'This bill has already been cancelled.');
    const previous=await query('SELECT COALESCE(SUM(amount),0) AS amount FROM returns WHERE bill_id=? AND shop_id=?', [billId,user.shop_id]);
    const remaining=money(bill.total)-money(previous[0].amount);
    ensure(remaining>0,409,'This bill has already been fully corrected.');
    let amount,returnQuantity=null,itemId=null;
    if(body.type==='cancel') {
      amount=remaining;
      await query("UPDATE bills SET status='cancelled' WHERE bill_id=? AND shop_id=?", [billId,user.shop_id]);
    } else {
      itemId=Number(body.billItemId);
      ensure(Number.isSafeInteger(itemId) && itemId>0,400,'Choose a billed item.');
      const rows=await query('SELECT bill_item_id,quantity,price,line_total,unit,pricing_mode,package_size FROM bill_items WHERE bill_item_id=? AND bill_id=? AND shop_id=? FOR UPDATE', [itemId,billId,user.shop_id]);
      const item=rows[0];
      ensure(item,404,'Billed item not found.');
      returnQuantity=quantity(body.quantity);
      const bottled=item.pricing_mode==='bottle',bottleSize=bottled?quantity(item.package_size):null;
      ensure(!bottled||returnQuantity%bottleSize===0,400,'Return complete bottles of the saved size.');
      ensure(item.unit!=='piece' || returnQuantity%1000===0,400,'A piece return needs a whole-number quantity.');
      const returned=await query('SELECT COALESCE(SUM(quantity),0) AS quantity,COALESCE(SUM(amount),0) AS amount FROM returns WHERE bill_id=? AND bill_item_id=? AND shop_id=?', [billId,itemId,user.shop_id]);
      const availableQuantity=quantity(item.quantity)-Math.round(Number(returned[0].quantity)*1000);
      ensure(returnQuantity<=availableQuantity,409,'Returned quantity exceeds the remaining billed quantity.');
      const availableAmount=money(item.line_total)-money(returned[0].amount);
      amount=returnQuantity===availableQuantity?availableAmount:lineTotal(money(item.price),bottled?(returnQuantity/bottleSize)*1000:returnQuantity);
      ensure(amount>=0 && amount<=availableAmount && amount<=remaining,409,'Return amount exceeds the remaining bill amount.');
    }
    const saved=await query('INSERT INTO returns (shop_id,bill_id,bill_item_id,quantity,amount,reason,created_by,client_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?)', [user.shop_id,billId,itemId,returnQuantity==null?null:(returnQuantity/1000).toFixed(3),decimal(amount),reason,user.user_id,identity.key,requestHash]);
    await audit(query,user,'correct','bill',billId,{status:bill.status,remaining:decimal(remaining)},{type:body.type,return_id:saved.insertId,bill_item_id:itemId,quantity:returnQuantity==null?null:(returnQuantity/1000).toFixed(3),amount:decimal(amount),status:body.type==='cancel'?'cancelled':'active'},reason);
    const newBalance=await balance(query,user.shop_id,bill.customer_id);
    const customers=await query('SELECT user_id,customer_id FROM customers WHERE customer_id=? AND shop_id=?', [bill.customer_id,user.shop_id]);
    await notify(query,user,customers[0],body.type==='cancel'?'bill_cancelled':'item_returned',`${bill.bill_no}: ${body.type==='cancel'?'bill cancelled':'item returned'}; Rs. ${decimal(amount)} credited. Your balance is Rs. ${decimal(newBalance)}.`);
    return {returnId:saved.insertId,billId,amount:decimal(amount),balance:decimal(newBalance),status:body.type==='cancel'?'cancelled':'active'};
  });
}
