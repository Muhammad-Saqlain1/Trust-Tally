import { Router } from 'express';
import { ensure } from './lib/errors.js';
import { token, digest, hashSecret, verifySecret, phone, pin, text } from './lib/security.js';

export function authRoutes(db, { secure = false } = {}) {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 };
  async function session(query, userId, res) {
    const raw = token();
    await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR))', [digest(raw), userId]);
    res.cookie('tt_session', raw, cookieOptions);
  }
  router.post('/register', async (req, res) => {
    const normalized=phone(req.body.phone),ownerName = text(req.body.ownerName, 'Owner name'), shopName = text(req.body.shopName, 'Shop name', 160);
    const encoded = await hashSecret(pin(req.body.pin));
    await db.transaction(async query => {
      const shop = await query('INSERT INTO shops (owner_name, shop_name, phone) VALUES (?, ?, ?)', [ownerName, shopName, normalized]);
      const user = await query("INSERT INTO users (shop_id, role, phone, name, pin_hash) VALUES (?, 'shopkeeper', ?, ?, ?)", [shop.insertId, normalized, ownerName, encoded]);
      await query("INSERT INTO audit_logs (shop_id, user_id, action, entity, entity_id, new_value) VALUES (?, ?, 'create', 'shop', ?, ?)", [shop.insertId, user.insertId, shop.insertId, JSON.stringify({ ownerName, shopName, phone: normalized })]);
      await session(query, user.insertId, res);
    });
    res.status(201).json({ message: 'Your shop is ready.' });
  });
  router.post('/consent', async (req, res) => {
    ensure(req.body.accept === true, 400, 'Accept the shop invitation to continue.');
    const normalized=phone(req.body.phone),invite=text(req.body.invite,'Invitation',64);
    ensure(/^[a-f0-9]{64}$/.test(invite),400,'This invitation is invalid.');
    const encoded = await hashSecret(pin(req.body.pin));
    await db.transaction(async query => {
      const customers = await query("SELECT * FROM customers WHERE invite_hash = ? AND phone = ? AND consent_status = 'invited' AND status = 'active' AND invite_expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [digest(invite), normalized]);
      const customer = customers[0];
      ensure(customer, 400, 'This invitation is no longer available.');
      const user = await query("INSERT INTO users (shop_id,role,phone,name,pin_hash) VALUES (?,'customer',?,?,?)", [customer.shop_id, normalized, customer.name, encoded]);
      await query("UPDATE customers SET user_id = ?, consent_status = 'accepted', invite_hash = NULL WHERE customer_id = ?", [user.insertId, customer.customer_id]);
      await query("INSERT INTO audit_logs (shop_id,user_id,action,entity,entity_id,new_value) VALUES (?,?,'consent','customer',?,?)", [customer.shop_id, user.insertId, customer.customer_id, JSON.stringify({ consent_status: 'accepted' })]);
      await session(query, user.insertId, res);
    });
    res.status(201).json({ message: 'Invitation accepted. Your account is ready.' });
  });
  router.post('/login', async (req, res) => {
    const normalized = phone(req.body.phone), enteredPin = pin(req.body.pin);
    ensure(['shopkeeper','customer'].includes(req.body.accountRole),400,'Choose a valid account type.');
    const users = await db.query("SELECT user_id,role,pin_hash FROM users WHERE phone = ? AND status = 'active'", [normalized]);
    const user=users.find(row=>req.body.accountRole==='customer'?row.role==='customer':['shopkeeper','staff'].includes(row.role));
    // Always run scrypt, including unknown phones, to reduce account enumeration by timing.
    const fallback = '00000000000000000000000000000000:' + '0'.repeat(128);
    const correct = await verifySecret(enteredPin, user?.pin_hash || fallback);
    ensure(user && correct, 401, 'Phone number or PIN is incorrect.');
    await db.transaction(query=>session(query,user.user_id,res));
    res.json({ message: 'Signed in.' });
  });
  router.post('/logout', async (req, res) => {
    const raw = /(?:^|;\s*)tt_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (raw) await db.query('DELETE FROM sessions WHERE token_hash = ?', [digest(raw)]);
    res.clearCookie('tt_session', { httpOnly: true, secure, sameSite: 'strict', path: '/' });
    res.json({ message: 'Signed out.' });
  });
  return router;
}

export function authenticate(db) {
  return async (req, res, next) => {
    const raw = /(?:^|;\s*)tt_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    ensure(raw, 401, 'Sign in to continue.');
    const rows = await db.query("SELECT u.user_id,u.shop_id,u.role,u.name,u.phone,s.shop_name,s.owner_name,c.customer_id FROM sessions t JOIN users u ON u.user_id=t.user_id JOIN shops s ON s.shop_id=u.shop_id LEFT JOIN customers c ON c.user_id=u.user_id AND c.status='active' AND c.consent_status='accepted' WHERE t.token_hash=? AND t.expires_at>UTC_TIMESTAMP(3) AND u.status='active'", [digest(raw)]);
    ensure(rows[0] && (rows[0].role !== 'customer' || rows[0].customer_id), 401, 'Your session expired. Sign in again.');
    req.user = rows[0];
    req.user.permissions = req.user.role === 'staff'
      ? (await db.query('SELECT permission FROM staff_permissions WHERE shop_id=? AND user_id=?', [req.user.shop_id, req.user.user_id])).map(row => row.permission)
      : [];
    next();
  };
}
export function allow(...permissions) {
  return (req, res, next) => {
    ensure(req.user.role === 'shopkeeper' || (req.user.role === 'staff' && permissions.some(permission => req.user.permissions.includes(permission))), 403, 'Your account does not have permission for this action.');
    next();
  };
}
export function ownerOnly(req, res, next) {
  ensure(req.user.role === 'shopkeeper', 403, 'Only the shopkeeper can perform this action.');
  next();
}
