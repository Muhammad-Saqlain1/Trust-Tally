import { Router } from 'express';
import { authenticate, ownerOnly, allow } from './auth.js';
import { ensure } from './lib/errors.js';
import { money, decimal } from './lib/money.js';
import { token, digest, text, phone, pin, hashSecret } from './lib/security.js';
import { audit, balance, createBill, correctBill, receiveCash, today } from './ledger.js';
import { addKhataItem, monthlyKhata, createMonthlyBill } from './khata.js';

const customerColumns = `c.customer_id,c.customer_code,c.name,c.phone,c.address,c.opening_balance,c.credit_limit,c.consent_status,c.status,
  (c.opening_balance + COALESCE((SELECT SUM(b.total) FROM bills b WHERE b.shop_id=c.shop_id AND b.customer_id=c.customer_id),0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.shop_id=c.shop_id AND p.customer_id=c.customer_id AND p.status='approved'),0)
  - COALESCE((SELECT SUM(r.amount) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id),0)) AS balance`;
const staffPermissions = new Set(['customers.read','bills.create','payments.cash','reports.read','items.manage','expenses.create']);
function selectedPermissions(value) {
  ensure(Array.isArray(value) && value.length > 0 && value.every(permission => staffPermissions.has(permission)), 400, 'Choose at least one valid staff permission.');
  return [...new Set(value)];
}
function reportDate(value) {
  ensure(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value),400,'Choose a valid report date.');
  const parsed=new Date(`${value}T12:00:00Z`);
  ensure(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===value,400,'Choose a valid report date.');
  return value;
}
function monthRange(value) {
  ensure(typeof value==='string' && /^\d{4}-\d{2}$/.test(value),400,'Choose a valid report month.');
  const start=`${value}-01`,parsed=new Date(`${start}T12:00:00Z`);
  ensure(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,7)===value,400,'Choose a valid report month.');
  parsed.setUTCMonth(parsed.getUTCMonth()+1);
  return {start,end:parsed.toISOString().slice(0,10)};
}
function canReport(user) {return user.role==='shopkeeper'||user.role==='customer'||(user.role==='staff'&&user.permissions.includes('reports.read'));}
function signedPaisa(value) {
  const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  ensure(match,500,'Invalid stored financial amount.');
  return (match[1]?-1:1)*(Number(match[2])*100+Number((match[3]||'').padEnd(2,'0')));
}
export function apiRoutes(db) {
  const router = Router();
  router.use(authenticate(db));
  router.get('/state', async (req, res) => {
    const user = req.user, shopId = user.shop_id;
    const isOwner = user.role === 'shopkeeper', isCustomer = user.role === 'customer', customerId = user.customer_id;
    const canReadCustomers = isOwner || user.permissions.includes('customers.read') || user.permissions.includes('bills.create') || user.permissions.includes('payments.cash');
    const canReadBills = isOwner || user.permissions.includes('bills.create');
    const canReadPayments = isOwner || user.permissions.includes('payments.cash');
    const canReadItems = isOwner || user.permissions.includes('items.manage') || user.permissions.includes('bills.create');
    const shopRows = await db.query('SELECT shop_id,shop_name,owner_name,phone,address,bank_name,bank_account,easypaisa_account,jazzcash_account FROM shops WHERE shop_id=?', [shopId]);
    const customers = canReadCustomers || isCustomer ? await db.query(`SELECT ${customerColumns} FROM customers c WHERE c.shop_id=? ${isCustomer ? 'AND c.customer_id=?' : ''} ORDER BY c.name`, isCustomer ? [shopId, customerId] : [shopId]) : [];
    const items = canReadItems ? await db.query('SELECT item_id,name,unit,default_price,active,pricing_mode,package_size FROM items WHERE shop_id=? ORDER BY name,package_size,item_id', [shopId]) : [];
    const bills = canReadBills || isCustomer ? await db.query(`SELECT b.bill_id,b.bill_no,b.bill_date,b.total,b.status,c.name,c.customer_id,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id=b.bill_id AND p.status='approved'),0) AS paid_now,
      COALESCE((SELECT SUM(r.amount) FROM returns r WHERE r.bill_id=b.bill_id AND r.shop_id=b.shop_id),0) AS returned,
      COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.payment_id=a.payment_id WHERE a.bill_id=b.bill_id AND p.status='approved'),0) AS allocated
      FROM bills b JOIN customers c ON c.customer_id=b.customer_id WHERE b.shop_id=? ${isCustomer ? 'AND b.customer_id=?' : ''} ORDER BY b.bill_id DESC LIMIT 100`, isCustomer ? [shopId, customerId] : [shopId]) : [];
    if (isCustomer && bills.length) {
      const lines = await db.query(`SELECT i.bill_id,i.bill_item_id,i.name,i.quantity,i.unit,i.pricing_mode,i.package_size,i.package_count
        FROM bill_items i JOIN bills b ON b.bill_id=i.bill_id AND b.shop_id=i.shop_id
        WHERE b.shop_id=? AND b.customer_id=? AND b.bill_id IN (${bills.map(() => '?').join(',')})
        ORDER BY i.bill_item_id`, [shopId, customerId, ...bills.map(bill => bill.bill_id)]);
      const byBill = new Map(bills.map(bill => [String(bill.bill_id), bill]));
      for (const bill of bills) bill.items = [];
      for (const line of lines) byBill.get(String(line.bill_id))?.items.push(line);
    }
    const payments = canReadPayments || isCustomer ? await db.query(`SELECT p.payment_id,p.amount,p.method,p.status,p.payment_date,p.created_at,c.name FROM payments p JOIN customers c ON c.customer_id=p.customer_id WHERE p.shop_id=? ${isCustomer ? 'AND p.customer_id=?' : ''} ORDER BY p.payment_id DESC LIMIT 100`, isCustomer ? [shopId, customerId] : [shopId]) : [];
    const notifications = await db.query('SELECT notification_id,type,message,sent_at FROM notifications WHERE user_id=? AND shop_id=? ORDER BY notification_id DESC LIMIT 10', [user.user_id, shopId]);
    const day = today();
    const totals = isOwner || user.permissions.includes('reports.read') ? await db.query(`SELECT
      (SELECT COALESCE(SUM(total),0) FROM bills WHERE shop_id=? AND bill_date=?) AS sales,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE shop_id=? AND method='cash' AND status='approved' AND payment_date=?) AS cash,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE shop_id=? AND method<>'cash' AND status='approved' AND payment_date=?) AS online,
      (SELECT COALESCE(SUM(b.total),0)-COALESCE(SUM((SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.bill_id=b.bill_id AND p.status='approved')),0) FROM bills b WHERE b.shop_id=? AND b.bill_date=?) AS credit,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE shop_id=? AND expense_date=?) AS expenses,
      (SELECT COUNT(*) FROM payments WHERE shop_id=? AND status IN ('pending','verified')) AS approvals`, [shopId,day,shopId,day,shopId,day,shopId,day,shopId,day,shopId]) : isCustomer ? await db.query(`SELECT
      (SELECT COALESCE(SUM(total),0) FROM bills WHERE shop_id=? AND customer_id=? AND bill_date>=?) AS month_bills,
      c.opening_balance + (SELECT COALESCE(SUM(total),0) FROM bills WHERE shop_id=c.shop_id AND customer_id=c.customer_id AND bill_date<?)
      - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE shop_id=c.shop_id AND customer_id=c.customer_id AND status='approved' AND payment_date<?)
      - (SELECT COALESCE(SUM(r.amount),0) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))<?) AS previous_balance
      FROM customers c WHERE c.shop_id=? AND c.customer_id=?`, [shopId,customerId,day.slice(0,7)+'-01',day.slice(0,7)+'-01',day.slice(0,7)+'-01',day.slice(0,7)+'-01',shopId,customerId]) : [];
    const shop = isOwner || isCustomer ? shopRows[0] : {
      shop_id: shopRows[0].shop_id, shop_name: shopRows[0].shop_name, owner_name: shopRows[0].owner_name,
      phone: shopRows[0].phone, address: shopRows[0].address
    };
    const overdue=(isOwner||user.permissions.includes('reports.read')) && Number(day.slice(-2))>10 ? customers.filter(row=>Number(row.balance)>0).map(row=>({customer_id:row.customer_id,name:row.name,balance:row.balance,due_date:`${day.slice(0,8)}10`})) : [];
    res.json({ user, shop, customers, items, bills, payments, notifications, totals: totals[0] || {}, overdue, businessDate: day });
  });
  router.get('/staff', ownerOnly, async (req, res) => {
    const rows = await db.query('SELECT u.user_id,u.name,u.phone,u.status,p.permission FROM users u LEFT JOIN staff_permissions p ON p.shop_id=u.shop_id AND p.user_id=u.user_id WHERE u.shop_id=? AND u.role=\'staff\' ORDER BY u.user_id DESC', [req.user.shop_id]);
    const people = new Map();
    for (const row of rows) {
      if (!people.has(row.user_id)) people.set(row.user_id, { userId: row.user_id, name: row.name, phone: row.phone, status: row.status, permissions: [] });
      if (row.permission) people.get(row.user_id).permissions.push(row.permission);
    }
    res.json({ staff: [...people.values()] });
  });
  router.post('/staff', ownerOnly, async (req, res) => {
    const name = text(req.body.name, 'Staff name'), normalized = phone(req.body.phone), permissions = selectedPermissions(req.body.permissions);
    const secret = await hashSecret(pin(req.body.pin));
    const userId = await db.transaction(async query => {
      const saved = await query("INSERT INTO users (shop_id,role,phone,name,pin_hash) VALUES (?,'staff',?,?,?)", [req.user.shop_id, normalized, name, secret]);
      for (const permission of permissions) await query('INSERT INTO staff_permissions (shop_id,user_id,permission) VALUES (?,?,?)', [req.user.shop_id, saved.insertId, permission]);
      await audit(query, req.user, 'create', 'staff', saved.insertId, null, { name, phone: normalized, permissions });
      return saved.insertId;
    });
    res.status(201).json({ userId, message: 'Staff account created. Share the assigned PIN privately and ask the staff member to change it with the shopkeeper.' });
  });
  router.patch('/staff/:id', ownerOnly, async (req, res) => {
    const permissions = selectedPermissions(req.body.permissions);
    ensure(['active','inactive'].includes(req.body.status), 400, 'Choose an active or inactive status.');
    await db.transaction(async query => {
      const rows = await query("SELECT name,phone,status FROM users WHERE user_id=? AND shop_id=? AND role='staff' FOR UPDATE", [req.params.id, req.user.shop_id]);
      ensure(rows[0], 404, 'Staff account not found.');
      const before = await query('SELECT permission FROM staff_permissions WHERE user_id=? AND shop_id=?', [req.params.id, req.user.shop_id]);
      await query('UPDATE users SET status=? WHERE user_id=? AND shop_id=?', [req.body.status, req.params.id, req.user.shop_id]);
      await query('DELETE FROM staff_permissions WHERE user_id=? AND shop_id=?', [req.params.id, req.user.shop_id]);
      for (const permission of permissions) await query('INSERT INTO staff_permissions (shop_id,user_id,permission) VALUES (?,?,?)', [req.user.shop_id, req.params.id, permission]);
      if (req.body.status === 'inactive') await query('DELETE FROM sessions WHERE user_id=?', [req.params.id]);
      await audit(query, req.user, 'update', 'staff', req.params.id, { ...rows[0], permissions: before.map(row => row.permission) }, { ...rows[0], status: req.body.status, permissions });
    });
    res.json({ message: 'Staff access updated.' });
  });
  router.post('/customers', ownerOnly, async (req, res) => {
    const name = text(req.body.name, 'Customer name'), normalized = phone(req.body.phone), address = text(req.body.address, 'Address', 500, false);
    const opening = money(req.body.openingBalance ?? '0', 'Opening balance'), credit = money(req.body.creditLimit ?? '0', 'Credit limit');
    const invite = token();
    const result = await db.transaction(async query => {
      const shops = await query('SELECT customer_sequence FROM shops WHERE shop_id=? FOR UPDATE', [req.user.shop_id]);
      const counts = await query('SELECT COUNT(*) AS n FROM customers WHERE shop_id=?', [req.user.shop_id]);
      ensure(Number(counts[0].n) < 500, 409, 'This shop has reached its maximum of 500 customers.');
      const sequence = Number(shops[0].customer_sequence) + 1, code = `CUS-${String(sequence).padStart(4,'0')}`;
      await query('UPDATE shops SET customer_sequence=? WHERE shop_id=?', [sequence, req.user.shop_id]);
      const customer = await query('INSERT INTO customers (shop_id,customer_code,name,phone,address,opening_balance,credit_limit,invite_hash,invite_expires_at) VALUES (?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))', [req.user.shop_id, code, name, normalized, address, decimal(opening), decimal(credit), digest(invite)]);
      await audit(query, req.user, 'create', 'customer', customer.insertId, null, { customer_code: code, name, phone: normalized, address, opening_balance: decimal(opening), credit_limit: decimal(credit), consent_status: 'invited' });
      // External delivery is not claimed: pending provider approval, the invitation stays queued.
      await query("INSERT INTO notifications (shop_id,customer_id,channel,type,message) VALUES (?,?,'sms','invite',?)", [req.user.shop_id, customer.insertId, 'Customer invitation awaiting an owner-approved delivery provider.']);
      return { customerId: customer.insertId, customerCode: code };
    });
    res.status(201).json({ ...result, invitePath: `/accept-invite.html?invite=${invite}`, message: 'Customer saved. Share the private invitation link with the customer.' });
  });
  router.patch('/customers/:id', ownerOnly, async (req, res) => {
    const name = text(req.body.name, 'Customer name'), normalized = phone(req.body.phone), address = text(req.body.address, 'Address', 500, false), creditLimit = decimal(money(req.body.creditLimit, 'Credit limit'));
    const openingBalance = decimal(money(req.body.openingBalance, 'Opening balance'));
    ensure(['active','inactive'].includes(req.body.status), 400, 'Invalid customer status.');
    let invite = null;
    await db.transaction(async query => {
      const rows = await query('SELECT name,phone,address,opening_balance,credit_limit,status,consent_status,user_id FROM customers WHERE customer_id=? AND shop_id=? FOR UPDATE', [req.params.id, req.user.shop_id]);
      ensure(rows[0], 404, 'Customer not found.');
      const phoneChanged=normalized!==rows[0].phone, openingChanged=openingBalance!==decimal(money(rows[0].opening_balance));
      ensure((!phoneChanged && !openingChanged) || rows[0].consent_status==='invited',409,'Accepted accounts need verified phone recovery and a correction entry for opening balances.');
      if(phoneChanged)invite=token();
      const next = { name, phone: normalized, address, opening_balance: openingBalance, credit_limit: creditLimit, status: req.body.status };
      await query('UPDATE customers SET name=?,phone=?,address=?,opening_balance=?,credit_limit=?,status=?,invite_hash=COALESCE(?,invite_hash),invite_expires_at=IF(? IS NULL,invite_expires_at,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY)) WHERE customer_id=? AND shop_id=?', [name,normalized,address,openingBalance,creditLimit,next.status,invite?digest(invite):null,invite,req.params.id,req.user.shop_id]);
      if(rows[0].user_id)await query('UPDATE users SET name=? WHERE user_id=? AND shop_id=?',[name,rows[0].user_id,req.user.shop_id]);
      await audit(query, req.user, 'update', 'customer', req.params.id, rows[0], next);
    });
    res.json({ message: invite?'Customer updated. The previous invitation is no longer valid. Share the new private invitation link.':'Customer updated.', ...(invite?{invitePath:`/accept-invite.html?invite=${invite}`}:{}) });
  });
  router.post('/customers/:id/invite',ownerOnly,async(req,res)=>{
    const invite=token();
    await db.transaction(async query=>{
      const rows=await query("SELECT customer_id,consent_status FROM customers WHERE customer_id=? AND shop_id=? AND status='active' FOR UPDATE",[req.params.id,req.user.shop_id]);
      ensure(rows[0],404,'Active customer not found.');
      ensure(rows[0].consent_status==='invited',409,'This customer has already accepted their invitation.');
      await query('UPDATE customers SET invite_hash=?,invite_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY) WHERE customer_id=? AND shop_id=?',[digest(invite),req.params.id,req.user.shop_id]);
      await audit(query,req.user,'update','customer',req.params.id,{invitation:'previous link'},{invitation:'renewed for seven days'});
    });
    res.json({invitePath:`/accept-invite.html?invite=${invite}`,message:'A new invitation is ready. The previous link is no longer valid.'});
  });
  router.get('/customers/:id/ledger', async (req, res) => {
    const id = req.user.role === 'customer' ? req.user.customer_id : req.params.id;
    ensure(req.user.role === 'shopkeeper' || (req.user.role === 'staff' && req.user.permissions.includes('customers.read')) || (req.user.role === 'customer' && String(req.params.id) === String(id)), 403, 'You can view only an authorized ledger.');
    const offset = Math.max(0, Math.min(1000000, Number.parseInt(req.query.offset,10) || 0));
    const currentBalance = await balance(db.query.bind(db), req.user.shop_id, id);
    const rows = await db.query(`SELECT * FROM (
      SELECT 0 AS entry_id,'opening' AS type,'Opening balance' AS reference,c.opening_balance AS amount,CAST(c.created_at AS DATETIME) AS occurred_at FROM customers c WHERE c.shop_id=? AND c.customer_id=?
      UNION ALL
      SELECT b.bill_id AS entry_id,'bill' AS type,b.bill_no AS reference,b.total AS amount,CAST(b.bill_date AS DATETIME) AS occurred_at FROM bills b WHERE b.shop_id=? AND b.customer_id=?
      UNION ALL SELECT p.payment_id,'payment',CONCAT('PAY-',p.payment_id),p.amount,CAST(p.payment_date AS DATETIME) FROM payments p WHERE p.shop_id=? AND p.customer_id=? AND p.status='approved'
      UNION ALL SELECT r.return_id,'return',CONCAT('RET-',r.return_id),r.amount,r.created_at FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=? AND b.customer_id=?
      ) e ORDER BY occurred_at DESC,type,entry_id DESC LIMIT 101 OFFSET ${offset}`, [req.user.shop_id,id,req.user.shop_id,id,req.user.shop_id,id,req.user.shop_id,id]);
    res.json({ balance: decimal(currentBalance), entries: rows.slice(0,100), hasMore: rows.length > 100, offset });
  });
  router.get('/items/purchased', async (req, res) => {
    ensure(req.user.role === 'customer', 403, 'Sign in as a customer to view your purchased items.');
    const before = req.query.before;
    const view=String(req.query.view||'new');
    ensure(['new','old'].includes(view),400,'Choose New or Old items.');
    ensure(before === undefined || (typeof before === 'string' && /^[1-9]\d{0,19}$/.test(before)), 400, 'Invalid item page.');
    const monthStart=today().slice(0,7)+'-01';
    const rows = await db.query(`SELECT i.bill_item_id,i.name,i.quantity,i.unit,i.price,i.line_total,i.customer_status,i.pricing_mode,i.package_size,i.package_count,
      b.bill_id,b.bill_no,b.bill_date,b.status AS bill_status,
      COALESCE((SELECT SUM(r.quantity) FROM returns r WHERE r.shop_id=i.shop_id AND r.bill_id=i.bill_id AND r.bill_item_id=i.bill_item_id),0) AS returned_quantity
      FROM bill_items i JOIN bills b ON b.bill_id=i.bill_id AND b.shop_id=i.shop_id
      WHERE b.shop_id=? AND b.customer_id=? ${view==='new'?'AND b.bill_date>=?':'AND b.bill_date<?'} ${before ? 'AND i.bill_item_id<?' : ''}
      ORDER BY i.bill_item_id DESC LIMIT 51`, [req.user.shop_id,req.user.customer_id,monthStart,...(before?[before]:[])]);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  router.post('/items', allow('items.manage'), async (req, res) => {
    const name = text(req.body.name, 'Item name', 160), price = decimal(money(req.body.price,'Price'));
    ensure(['kg','g','liter','piece'].includes(req.body.unit),400,'Choose kg, g, L, or piece.');
    const result = await db.transaction(async query => {
      const saved = await query('INSERT INTO items (shop_id,name,unit,default_price) VALUES (?,?,?,?)', [req.user.shop_id,name,req.body.unit,price]);
      await audit(query,req.user,'create','item',saved.insertId,null,{name,unit:req.body.unit,default_price:price});
      return saved;
    });
    res.status(201).json({ itemId: result.insertId });
  });
  router.patch('/items/:id', allow('items.manage'), async (req,res) => {
    const name=text(req.body.name,'Item name',160), price=decimal(money(req.body.price,'Price'));
    ensure(['kg','g','liter','piece'].includes(req.body.unit) && typeof req.body.active === 'boolean',400,'Invalid item unit or status.');
    await db.transaction(async query => {
      const rows=await query('SELECT name,unit,default_price,active,pricing_mode,package_size FROM items WHERE item_id=? AND shop_id=? FOR UPDATE',[req.params.id,req.user.shop_id]);
      ensure(rows[0],404,'Item not found.');
      ensure(rows[0].pricing_mode!=='bottle'||req.body.unit==='liter',400,'A bottle product must stay in liters.');
      const next={name,unit:req.body.unit,default_price:price,active:req.body.active,pricing_mode:rows[0].pricing_mode,package_size:rows[0].package_size};
      await query('UPDATE items SET name=?,unit=?,default_price=?,active=? WHERE item_id=? AND shop_id=?',[name,next.unit,price,next.active,req.params.id,req.user.shop_id]);
      await audit(query,req.user,'update','item',req.params.id,rows[0],next);
    });res.json({message:'Item updated.'});
  });
  router.post('/khata/items',allow('bills.create'),async(req,res)=>res.status(201).json(await addKhataItem(db,req.user,req.body)));
  router.get('/khata/monthly',allow('bills.create'),async(req,res)=>res.json(await monthlyKhata(db.query.bind(db),req.user,req.query.customerId)));
  router.post('/monthly-bills',allow('bills.create'),async(req,res)=>res.status(201).json(await createMonthlyBill(db,req.user,req.body)));
  router.get('/monthly-bills',async(req,res)=>{
    ensure(req.user.role==='shopkeeper'||req.user.role==='customer'||req.user.permissions.includes('bills.create'),403,'Your account cannot view monthly bills.');
    const customer=req.user.role==='customer';
    const rows=await db.query(`SELECT m.monthly_bill_id,m.bill_no,m.month,m.total,m.created_at,c.name,c.customer_code
      FROM monthly_bills m JOIN customers c ON c.customer_id=m.customer_id AND c.shop_id=m.shop_id
      WHERE m.shop_id=? ${customer?'AND m.customer_id=?':''} ORDER BY m.monthly_bill_id DESC LIMIT 100`,customer?[req.user.shop_id,req.user.customer_id]:[req.user.shop_id]);
    res.json({bills:rows});
  });
  router.get('/monthly-bills/:id',async(req,res)=>{
    ensure(req.user.role==='shopkeeper'||req.user.role==='customer'||req.user.permissions.includes('bills.create'),403,'Your account cannot view monthly bills.');
    const customer=req.user.role==='customer';
    const rows=await db.query(`SELECT monthly_bill_id,bill_no,month,snapshot,created_at FROM monthly_bills WHERE monthly_bill_id=? AND shop_id=? ${customer?'AND customer_id=?':''}`,customer?[req.params.id,req.user.shop_id,req.user.customer_id]:[req.params.id,req.user.shop_id]);
    ensure(rows[0],404,'Monthly bill not found.');
    res.json({...rows[0],snapshot:typeof rows[0].snapshot==='string'?JSON.parse(rows[0].snapshot):rows[0].snapshot});
  });
  router.post('/bills', allow('bills.create'), async (req, res) => res.status(201).json(await createBill(db,req.user,req.body)));
  router.post('/bills/:id/corrections', ownerOnly, async (req,res) => res.status(201).json(await correctBill(db,req.user,req.params.id,req.body)));
  router.post('/payments/cash', allow('payments.cash'), async (req, res) => res.status(201).json(await receiveCash(db,req.user,req.body)));
  router.get('/payments/:id', async (req,res) => {
    ensure(req.user.role !== 'staff' || req.user.permissions.includes('payments.cash'),403,'Your account cannot view payments.');
    const parameters=req.user.role==='customer'?[req.params.id,req.user.shop_id,req.user.customer_id]:[req.params.id,req.user.shop_id];
    const rows=await db.query(`SELECT p.payment_id,p.customer_id,p.amount,p.method,p.status,p.payment_date,p.transaction_ref,p.confirmed_at,c.name,c.customer_code
      FROM payments p JOIN customers c ON c.customer_id=p.customer_id AND c.shop_id=p.shop_id
      WHERE p.payment_id=? AND p.shop_id=? ${req.user.role==='customer'?'AND p.customer_id=?':''}`,parameters);
    ensure(rows[0],404,'Payment not found.');
    const allocations=await db.query(`SELECT a.amount,a.bill_id,COALESCE(b.bill_no,'Opening balance') AS reference
      FROM payment_allocations a LEFT JOIN bills b ON b.bill_id=a.bill_id AND b.shop_id=a.shop_id
      WHERE a.payment_id=? AND a.shop_id=? AND a.customer_id=? ORDER BY a.allocation_id`,[rows[0].payment_id,req.user.shop_id,rows[0].customer_id]);
    res.json({payment:rows[0],allocations});
  });
  router.get('/reports/daily', async (req,res) => {
    ensure(canReport(req.user),403,'Your account cannot view reports.');
    const day=reportDate(req.query.date),requested=Number(req.query.customerId||0);
    const customerId=req.user.role==='customer'?req.user.customer_id:(Number.isSafeInteger(requested)&&requested>0?requested:null);
    const method=String(req.query.method||'');ensure(!method||['cash','bank','easypaisa','jazzcash','raast','qr'].includes(method),400,'Choose a valid payment method.');
    const rows=await db.query(`SELECT b.bill_id,b.bill_no,b.bill_date,b.status AS bill_status,c.customer_id,c.name,i.bill_item_id,i.name AS item,i.quantity,i.unit,i.price,i.line_total,i.pricing_mode,i.package_size,i.package_count,
      CASE WHEN b.status='cancelled' THEN i.line_total ELSE COALESCE((SELECT SUM(r.amount) FROM returns r WHERE r.shop_id=i.shop_id AND r.bill_item_id=i.bill_item_id),0) END AS returned,
      COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.payment_id=a.payment_id AND p.shop_id=a.shop_id WHERE a.bill_id=b.bill_id AND p.status='approved' ${method?'AND p.method=?':''}),0) AS allocated
      FROM bills b JOIN customers c ON c.customer_id=b.customer_id AND c.shop_id=b.shop_id JOIN bill_items i ON i.bill_id=b.bill_id AND i.shop_id=b.shop_id
      WHERE b.shop_id=? AND b.bill_date=? ${customerId?'AND b.customer_id=?':''} ORDER BY c.name,b.bill_id,i.bill_item_id`,[...(method?[method]:[]),req.user.shop_id,day,...(customerId?[customerId]:[])]);
    const paidByBill=new Map();
    const result=rows.map(row=>{const available=paidByBill.has(String(row.bill_id))?paidByBill.get(String(row.bill_id)):Number(row.allocated),net=Math.max(0,Number(row.line_total)-Number(row.returned)),paid=Math.min(net,available);paidByBill.set(String(row.bill_id),available-paid);return {...row,paid:paid.toFixed(2),remaining:(net-paid).toFixed(2)};});
    const summary={billed:result.reduce((sum,row)=>sum+Number(row.line_total),0).toFixed(2),paid:result.reduce((sum,row)=>sum+Number(row.paid),0).toFixed(2),remaining:result.reduce((sum,row)=>sum+Number(row.remaining),0).toFixed(2),returns:result.reduce((sum,row)=>sum+Number(row.returned),0).toFixed(2)};
    if(req.user.role!=='customer'){
      const expenses=await db.query('SELECT COALESCE(SUM(amount),0) AS amount FROM expenses WHERE shop_id=? AND expense_date=?',[req.user.shop_id,day]);
      summary.expenses=expenses[0].amount;
    }
    res.json({date:day,rows:result,summary});
  });
  router.get('/reports/monthly', async (req,res) => {
    ensure(canReport(req.user),403,'Your account cannot view reports.');
    const {start,end}=monthRange(req.query.month),requested=Number(req.query.customerId||0);
    const customerId=req.user.role==='customer'?req.user.customer_id:(Number.isSafeInteger(requested)&&requested>0?requested:null);
    const method=String(req.query.method||'');ensure(!method||['cash','bank','easypaisa','jazzcash','raast','qr'].includes(method),400,'Choose a valid payment method.');
    let sql=`SELECT c.customer_id,c.customer_code,c.name,
      c.opening_balance+COALESCE((SELECT SUM(b.total) FROM bills b WHERE b.shop_id=c.shop_id AND b.customer_id=c.customer_id AND b.bill_date<?),0)-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.shop_id=c.shop_id AND p.customer_id=c.customer_id AND p.status='approved' AND p.payment_date<?),0)-COALESCE((SELECT SUM(r.amount) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))<?),0) AS previous_balance,
      COALESCE((SELECT SUM(b.total) FROM bills b WHERE b.shop_id=c.shop_id AND b.customer_id=c.customer_id AND b.bill_date>=? AND b.bill_date<?),0) AS bills_total,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.shop_id=c.shop_id AND p.customer_id=c.customer_id AND p.status='approved' AND p.payment_date>=? AND p.payment_date<? ${method?'AND p.method=?':''}),0) AS payments_total,
      COALESCE((SELECT SUM(r.amount) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))>=? AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))<?),0) AS returns_total
      FROM customers c WHERE c.shop_id=?`;
    const queryParams=[start,start,start,start,end,start,end,...(method?[method]:[]),start,end,req.user.shop_id];
    if(customerId){sql+=' AND c.customer_id=?';queryParams.push(customerId);}sql+=' ORDER BY c.name';
    const rows=await db.query(sql,queryParams);
    let statements=rows.map(row=>({...row,closing_balance:decimal(signedPaisa(row.previous_balance)+money(row.bills_total)-money(row.payments_total)-money(row.returns_total))}));
    if(!method && start.slice(0,7)<today().slice(0,7)){
      for(const row of statements)await db.query('INSERT IGNORE INTO monthly_statements (shop_id,customer_id,month,previous_balance,bills_total,payments_total,returns_total,closing_balance) VALUES (?,?,?,?,?,?,?,?)',[req.user.shop_id,row.customer_id,start,row.previous_balance,row.bills_total,row.payments_total,row.returns_total,row.closing_balance]);
      const snapshots=await db.query('SELECT customer_id,previous_balance,bills_total,payments_total,returns_total,closing_balance FROM monthly_statements WHERE shop_id=? AND month=?',[req.user.shop_id,start]);
      const byId=new Map(snapshots.map(row=>[String(row.customer_id),row]));statements=statements.map(row=>({...row,...byId.get(String(row.customer_id))}));
    }
    const status=String(req.query.status||'');ensure(!status||['paid','unpaid'].includes(status),400,'Choose a valid balance status.');
    const filtered=statements.filter(row=>!status||(status==='paid'?Number(row.closing_balance)<=0:Number(row.closing_balance)>0));
    res.json({month:start.slice(0,7),rows:filtered,summary:{previous:decimal(filtered.reduce((sum,row)=>sum+signedPaisa(row.previous_balance),0)),billed:decimal(filtered.reduce((sum,row)=>sum+money(row.bills_total),0)),paid:decimal(filtered.reduce((sum,row)=>sum+money(row.payments_total),0)),returns:decimal(filtered.reduce((sum,row)=>sum+money(row.returns_total),0)),closing:decimal(filtered.reduce((sum,row)=>sum+signedPaisa(row.closing_balance),0))}});
  });
  router.get('/reports/monthly/items', async (req,res) => {
    ensure(canReport(req.user),403,'Your account cannot view reports.');
    const {start,end}=monthRange(req.query.month),requested=Number(req.query.customerId||0);
    const customerId=req.user.role==='customer'?req.user.customer_id:(Number.isSafeInteger(requested)&&requested>0?requested:null);
    const params=[req.user.shop_id,start,end];
    let customerClause='';
    if(customerId){customerClause=' AND b.customer_id=?';params.push(customerId);}
    const rows=await db.query(`SELECT c.customer_id,c.name AS customer_name,bi.name AS item,bi.unit,bi.pricing_mode,bi.package_size,
      SUM(bi.quantity) AS quantity,SUM(bi.package_count) AS package_count,SUM(bi.line_total) AS billed_amount,
      SUM(CASE WHEN b.status='cancelled' THEN bi.quantity ELSE COALESCE(ret.returned_quantity,0) END) AS returned_quantity,
      SUM(CASE WHEN b.status='cancelled' THEN bi.line_total ELSE COALESCE(ret.returned_amount,0) END) AS returned_amount,
      GREATEST(0,SUM(bi.quantity)-SUM(CASE WHEN b.status='cancelled' THEN bi.quantity ELSE COALESCE(ret.returned_quantity,0) END)) AS net_quantity,
      GREATEST(0,SUM(bi.line_total)-SUM(CASE WHEN b.status='cancelled' THEN bi.line_total ELSE COALESCE(ret.returned_amount,0) END)) AS net_amount,
      COUNT(DISTINCT b.bill_id) AS bill_count
      FROM bills b JOIN customers c ON c.customer_id=b.customer_id AND c.shop_id=b.shop_id
      JOIN bill_items bi ON bi.bill_id=b.bill_id AND bi.shop_id=b.shop_id
      LEFT JOIN (SELECT bill_item_id,shop_id,SUM(COALESCE(quantity,0)) AS returned_quantity,SUM(amount) AS returned_amount
        FROM returns WHERE bill_item_id IS NOT NULL GROUP BY shop_id,bill_item_id) ret
        ON ret.shop_id=bi.shop_id AND ret.bill_item_id=bi.bill_item_id
      WHERE b.shop_id=? AND b.bill_date>=? AND b.bill_date<?${customerClause}
      GROUP BY c.customer_id,c.name,bi.name,bi.unit,bi.pricing_mode,bi.package_size ORDER BY c.name,bi.name,bi.unit,bi.package_size`,params);
    res.json({month:start.slice(0,7),rows});
  });
  router.get('/statements/:month', async (req,res) => {
    ensure(req.user.role==='customer',403,'Only customers can view their statement here.');
    const {start,end}=monthRange(req.params.month),id=req.user.customer_id;
    const reportRows=await db.query(`SELECT c.opening_balance+COALESCE((SELECT SUM(total) FROM bills WHERE shop_id=c.shop_id AND customer_id=c.customer_id AND bill_date<?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE shop_id=c.shop_id AND customer_id=c.customer_id AND status='approved' AND payment_date<?),0)-COALESCE((SELECT SUM(r.amount) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=c.shop_id AND b.customer_id=c.customer_id AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))<?),0) AS previous_balance FROM customers c WHERE c.shop_id=? AND c.customer_id=?`,[start,start,start,req.user.shop_id,id]);
    const entries=await db.query(`SELECT * FROM (SELECT b.bill_id AS entry_id,'bill' AS type,b.bill_no AS reference,b.total AS amount,b.bill_date AS occurred_at FROM bills b WHERE b.shop_id=? AND b.customer_id=? AND b.bill_date>=? AND b.bill_date<? UNION ALL SELECT p.payment_id,'payment',CONCAT('PAY-',p.payment_id),p.amount,p.payment_date FROM payments p WHERE p.shop_id=? AND p.customer_id=? AND p.status='approved' AND p.payment_date>=? AND p.payment_date<? UNION ALL SELECT r.return_id,'return',CONCAT('RET-',r.return_id),r.amount,DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00')) FROM returns r JOIN bills b ON b.bill_id=r.bill_id WHERE r.shop_id=? AND b.customer_id=? AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))>=? AND DATE(CONVERT_TZ(r.created_at,'+00:00','+05:00'))<?) e ORDER BY occurred_at,type,entry_id`,[req.user.shop_id,id,start,end,req.user.shop_id,id,start,end,req.user.shop_id,id,start,end]);
    ensure(reportRows[0],404,'Statement account not found.');
    let running=signedPaisa(reportRows[0].previous_balance);const detailed=entries.map(row=>{running+=row.type==='bill'?money(row.amount):-money(row.amount);return {...row,balance:decimal(running)};});
    const bills=detailed.filter(row=>row.type==='bill').reduce((sum,row)=>sum+money(row.amount),0),payments=detailed.filter(row=>row.type==='payment').reduce((sum,row)=>sum+money(row.amount),0),returns=detailed.filter(row=>row.type==='return').reduce((sum,row)=>sum+money(row.amount),0);
    let summary={previousBalance:reportRows[0].previous_balance,bills:decimal(bills),payments:decimal(payments),returns:decimal(returns),closingBalance:decimal(running)};
    if(req.params.month<today().slice(0,7)){
      await db.query('INSERT IGNORE INTO monthly_statements (shop_id,customer_id,month,previous_balance,bills_total,payments_total,returns_total,closing_balance) VALUES (?,?,?,?,?,?,?,?)',[req.user.shop_id,id,start,summary.previousBalance,summary.bills,summary.payments,summary.returns,summary.closingBalance]);
      const snapshots=await db.query('SELECT previous_balance,bills_total,payments_total,returns_total,closing_balance FROM monthly_statements WHERE shop_id=? AND customer_id=? AND month=?',[req.user.shop_id,id,start]);
      const snapshot=snapshots[0];summary={previousBalance:snapshot.previous_balance,bills:snapshot.bills_total,payments:snapshot.payments_total,returns:snapshot.returns_total,closingBalance:snapshot.closing_balance};
    }
    res.json({month:req.params.month,...summary,entries:detailed});
  });
  router.get('/bills/:id', async (req, res) => {
    ensure(req.user.role !== 'staff' || req.user.permissions.includes('bills.create'), 403, 'Your account cannot view bills.');
    const rows = await db.query(`SELECT b.*,c.name,c.phone,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id=b.bill_id AND p.status='approved'),0) AS paid_now,
      COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.payment_id=a.payment_id WHERE a.bill_id=b.bill_id AND p.status='approved'),0) AS allocated
      FROM bills b JOIN customers c ON c.customer_id=b.customer_id WHERE b.bill_id=? AND b.shop_id=? ${req.user.role === 'customer' ? 'AND b.customer_id=?' : ''}`, req.user.role === 'customer' ? [req.params.id,req.user.shop_id,req.user.customer_id] : [req.params.id,req.user.shop_id]);
    ensure(rows[0],404,'Bill not found.');
    const items = await db.query('SELECT i.bill_item_id,i.name,i.quantity,i.unit,i.price,i.line_total,i.customer_status,i.pricing_mode,i.package_size,i.package_count,COALESCE((SELECT SUM(r.quantity) FROM returns r WHERE r.bill_id=i.bill_id AND r.bill_item_id=i.bill_item_id),0) AS returned_quantity FROM bill_items i WHERE i.bill_id=? ORDER BY i.bill_item_id',[rows[0].bill_id]);
    const corrections = await db.query('SELECT return_id,bill_item_id,quantity,amount,reason,created_at FROM returns WHERE bill_id=? AND shop_id=? ORDER BY return_id', [rows[0].bill_id,req.user.shop_id]);
    res.json({ bill: rows[0], items, corrections });
  });
  router.post('/bill-items/:id/ok', async (req, res) => {
    ensure(req.user.role === 'customer',403,'Only the customer can confirm their own item.');
    await db.transaction(async query => {
      const rows=await query('SELECT i.bill_item_id,i.customer_status FROM bill_items i JOIN bills b ON b.bill_id=i.bill_id WHERE i.bill_item_id=? AND b.shop_id=? AND b.customer_id=? FOR UPDATE',[req.params.id,req.user.shop_id,req.user.customer_id]);
      ensure(rows[0],404,'Item not found.');
      ensure(rows[0].customer_status !== 'disputed',409,'A disputed item must be resolved by the shopkeeper.');
      if(rows[0].customer_status === 'ok')return;
      await query("UPDATE bill_items SET customer_status='ok' WHERE bill_item_id=?",[req.params.id]);
      await audit(query,req.user,'approve','bill_item',req.params.id,{customer_status:rows[0].customer_status},{customer_status:'ok'});
    });res.json({message:'Item confirmed.'});
  });
  router.get('/audit', ownerOnly, async (req,res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows=await db.query('SELECT a.*,u.name AS actor FROM audit_logs a JOIN users u ON u.user_id=a.user_id WHERE a.shop_id=? AND a.log_id<? ORDER BY a.log_id DESC LIMIT 101',[req.user.shop_id,before]);
    res.json({entries:rows.slice(0,100),hasMore:rows.length>100});
  });
  router.patch('/shop', ownerOnly, async (req,res) => {
    const fields={owner_name:text(req.body.ownerName,'Owner name'),shop_name:text(req.body.shopName,'Shop name',160),address:text(req.body.address,'Address',500,false),bank_name:text(req.body.bankName,'Bank name',120,false),bank_account:text(req.body.bankAccount,'Bank account',120,false),easypaisa_account:text(req.body.easypaisaAccount,'Easypaisa account',30,false),jazzcash_account:text(req.body.jazzcashAccount,'JazzCash account',30,false)};
    await db.transaction(async query => {
      const rows=await query('SELECT owner_name,shop_name,address,bank_name,bank_account,easypaisa_account,jazzcash_account FROM shops WHERE shop_id=? FOR UPDATE',[req.user.shop_id]);
      await query('UPDATE shops SET owner_name=?,shop_name=?,address=?,bank_name=?,bank_account=?,easypaisa_account=?,jazzcash_account=? WHERE shop_id=?',[...Object.values(fields),req.user.shop_id]);
      await query('UPDATE users SET name=? WHERE user_id=?',[fields.owner_name,req.user.user_id]);
      await audit(query,req.user,'update','shop',req.user.shop_id,rows[0],fields);
    });res.json({message:'Shop details updated.'});
  });
  return router;
}
