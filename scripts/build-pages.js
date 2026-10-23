// Plain HTML screen source. Run `npm run pages:build` after editing these templates.
import { mkdir, writeFile } from 'node:fs/promises';
import { itemUnits, measurementColumns } from '../public/units.js';
import {khataWorkspace,monthlyBillList} from '../public/khata.js';

const measurementHeadings = measurementColumns.map(([, heading]) => heading);

const icons = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 7m5 10v-3a5 5 0 0 0-4-5"/>',
  book: '<path d="M4 3h12a4 4 0 0 1 4 4v14H7a3 3 0 0 1-3-3V3Zm4 0v18m4-13h4m-4 5h4"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m-6 4h6m-6 3h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  report: '<path d="M4 3v18h17M8 16v-4m5 4V7m5 9v-6"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H5l-3 2V11a9 9 0 0 1 19 0Z"/><path d="M7 10h10m-10 4h6"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Zm9 5v10l-9 5-9-5V8m9 5v10M7 5.8l9 5"/>',
  shield: '<path d="m12 3 9 4v6c0 4-5 7-9 9-4-2-9-5-9-9V7l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  phone: '<path d="m7 3 3 5-2 2a15 15 0 0 0 6 6l2-2 5 3-1 4C10 22 2 14 3 4l4-1Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  print: '<path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v8H6Zm11-2h1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
function input(name, label, type = 'text', attrs = '', help = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${attrs}>${help ? `<small>${help}</small>` : ''}</label>`;
}
function passwordInput(name,label,attrs='') {
  return `<label class="field"><span>${label}</span><span class="password-control"><input name="${name}" type="password" ${attrs}><button type="button" class="password-toggle" data-page-action="toggle-password" aria-label="Show ${label}">${icon('eye')}</button></span></label>`;
}
function select(name, label, options, attrs = '') {
  return `<label class="field"><span>${label}</span><select name="${name}" ${attrs}>${options.map(([value, text]) => `<option value="${e(value)}">${text}</option>`).join('')}</select></label>`;
}
const customer = (name = 'customerId', label = 'Customer', optional = false) => select(name, label, [['', optional ? 'All customers' : 'Choose a customer']], `data-customers ${optional ? '' : 'required'}`);
const textarea = (name, label, attrs = '') => `<label class="field"><span>${label}</span><textarea name="${name}" ${attrs}></textarea></label>`;
const moneyInput = (name, label, attrs = '') => input(name, label, 'number', `${attrs.includes('min=')?'':'min="0"'} max="999999999.99" step="0.01" inputmode="decimal" ${attrs}`);
const date = (name = 'date', label = 'Date') => input(name, label, 'date', 'data-today required');
const action = (label, name, symbol = 'plus', secondary = false, attrs = '') => `<button class="button ${secondary ? 'secondary' : ''}" type="button" data-page-action="${name}" ${attrs}>${icon(symbol)}${label}</button>`;
const link = (label, href, symbol = 'arrow', secondary = false) => `<a class="button ${secondary ? 'secondary' : ''}" href="${href}">${icon(symbol)}${label}</a>`;
const submit = label => `<button type="submit" class="button">${icon('check')}${label}</button>`;
const error = '<div class="form-error" data-feedback role="status" aria-live="polite" hidden></div>';
const form = (kind, content, label, attrs = '') => `<form method="post" action="#" data-form="${kind}" ${attrs}>${error}${content}<div class="form-actions">${submit(label)}</div></form>`;
function panel(title, content, subtitle = '', extra = '') {
  return `<section class="panel ${extra}"><div class="panel-header"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div>${content}</section>`;
}
function profileHero(role) {
  const owner = role === 'shopkeeper';
  return `<section class="profile-hero" aria-label="Account identity"><span class="profile-hero-mark" aria-hidden="true">${icon(owner ? 'box' : 'user')}</span><div><p class="eyebrow">${owner ? 'SHOPKEEPER ACCOUNT' : 'PRIVATE CUSTOMER ACCOUNT'}</p><h2 data-bind="${owner ? 'shop.shop_name' : 'user.name'}">${owner ? 'Your shop' : 'Your account'}</h2><p>${owner ? 'Managed by <span data-bind="shop.owner_name">your shopkeeper</span>' : 'Linked to <span data-bind="shop.shop_name">your shop</span>'}</p></div></section>`;
}
function table(name, columns, title = 'No records loaded', message = 'Sign in to load your account records.') {
  return `<div class="table-wrap"><table${name==='purchased-items'?' class="purchased-items"':''}><thead><tr>${columns.map(col => `<th scope="col">${col}</th>`).join('')}</tr></thead><tbody data-table="${name}"><tr><td colspan="${columns.length}"><div class="empty"><div class="empty-icon">${icon('book')}</div><h3>${title}</h3><p>${message}</p></div></td></tr></tbody></table></div>`;
}
const search = placeholder => `<label class="search">${icon('search')}<input type="search" data-search placeholder="${placeholder}" aria-label="${placeholder}"></label>`;
const stat = (label, key, detail, symbol = 'book') => `<article class="stat"><div class="stat-header"><span>${label}</span><span class="stat-icon">${icon(symbol)}</span></div><div class="stat-value" data-value="${key}">—</div><div class="stat-foot">${detail}</div></article>`;
const stats = (...rows) => `<section class="stats" aria-label="Account summary">${rows.join('')}</section>`;
function modal(id, title, content) {
  return `<dialog id="${id}" aria-labelledby="${id}-title"><div class="dialog-header"><h2 id="${id}-title">${title}</h2><button type="button" class="icon-button" data-page-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${content}</div></dialog>`;
}
const open = (label, id, symbol = 'plus', secondary = false) => action(label, 'open-dialog', symbol, secondary, `data-dialog="${id}"`);
const methods = [['cash','Cash'],['bank','Bank'],['easypaisa','Easypaisa'],['jazzcash','JazzCash'],['raast','Raast'],['qr','QR']];
const customerFields = `<div class="form-grid">${input('name','Full name','text','required maxlength="120" autocomplete="name"')}${input('phone','Phone number','tel','required autocomplete="tel" placeholder="0300 1234567"')}${input('address','Address','text','maxlength="500"')}${moneyInput('openingBalance','Opening balance (Rs.)','required value="0"')}${moneyInput('creditLimit','Credit limit (Rs.)','required value="0"')}</div><p class="setup-note">The customer must accept their invitation before billing starts.</p>`;
const cashFields = customer() + `<div class="form-grid">${moneyInput('amount','Cash received (Rs.)','required min="0.01"')}${date('paymentDate','Payment date')}</div><p class="summary-note">Confirmed cash payments are applied to the oldest unpaid balance first.</p>`;
const itemFields = `<div class="form-grid">${input('name','Item name','text','required maxlength="160" placeholder="For example, Basmati rice"')}${select('unit','Measured unit',itemUnits)}${moneyInput('price','Price per measured unit (Rs.)','required')}${input('picture','Item picture (optional)','file','accept="image/png,image/jpeg,image/webp" data-image-input')}</div><img class="item-picture-preview" data-image-preview alt="Selected item picture" hidden><p class="summary-note">Use the khata form on this page to add a packaged bottle with its size and original final price.</p>`;
const billLine = `<div class="bill-line"><label class="field item-field"><span>Item</span><select name="itemId" data-items required><option value="">Choose an item</option></select></label><label class="field quantity-field"><span data-quantity-label>Quantity</span><input name="quantity" type="number" value="1" min="0.001" max="999999.999" step="0.001" required></label><label class="field price-field"><span data-price-label>Price (Rs.)</span><input name="price" type="number" min="0" max="999999999.99" step="0.01" required></label><output class="line-amount" data-line-total>Rs. 0.00</output><button class="icon-button remove-line" type="button" data-page-action="remove-line" aria-label="Remove item">${icon('close')}</button></div>`;
const correctionModal = modal('correction-dialog','Return an item or cancel a bill',form('correction',`<label class="field"><span>Bill</span><select name="billId" data-correction-bills required><option value="">Choose a bill</option></select></label>${select('type','Correction',[['return','Return item'],['cancel','Cancel bill']],'data-correction-type')}<label class="field" data-return-only><span>Billed item</span><select name="billItemId" data-correction-items required><option value="">Choose an item</option></select></label><label class="field" data-return-only><span>Returned quantity</span><input name="quantity" type="number" min="0.001" step="0.001" required></label>${textarea('reason','Reason','required maxlength="500"')}<p class="setup-note">A correction reduces the balance and stays alongside the original bill. A paid portion becomes account credit.</p>`,'Record correction'));
const disputeModal = modal('dispute-dialog','Dispute an item',form('unavailable',`${input('billReference','Bill number','text','required')}${input('itemReference','Item name / ID','text','required')}${textarea('reason','What is wrong with this item?','required maxlength="500"')}`,'Submit dispute','data-service="Disputes"'));
const exportActions = action('PDF','unavailable','download',true,'data-service="PDF export"') + action('Excel','unavailable','download',true,'data-service="Excel export"');

const ownerNav = [
  ['dashboard','Dashboard','dashboard'],['customers','Customers','users'],['new-bill','New Bill','plus'],['bills','Bills','bill'],
  ['payments','Payments and Approvals','wallet'],['daily-report','Daily Report','report'],['monthly-reports','Monthly Reports','report'],
  ['expenses','Expenses','wallet'],['suppliers','Suppliers','box'],['item-catalogue','Item Catalogue','box'],['chat','Chat','chat'],
  ['account-details','Account Details','wallet'],['staff','Staff','users'],['audit-log','Audit Log','shield'],['profile','Profile and Settings','user']
];
const customerNav = [
  ['dashboard','Dashboard','dashboard'],['my-bills','My Bills','bill'],['item-catalogue','Item Catalogue','box'],['pay','Pay','wallet'],['my-payments','My Payments','wallet'],
  ['monthly-statements','Monthly Statements','report'],['daily-report','Daily Report','report'],['monthly-report','Monthly Report','report'],
  ['chat','Chat','chat'],['shopkeeper-contact','Shopkeeper Contact','phone'],['profile','Profile','user']
];
const pages = [];
function add(role, slug, title, description, body, actions = '') { pages.push({role,slug,title,description,body,actions}); }

add('shopkeeper','dashboard','Dashboard','A clear view of your shop, every day.',
  `<section class="welcome-banner"><div><div class="eyebrow" data-bind="shop.shop_name">YOUR SHOP</div><h2>Good business begins with a clear khata.</h2><p>Record your sales, keep track of payments, and give every customer a clear account.</p></div>${link('Your customers','customers.html','users')}</section>` +
  stats(stat('Today’s sales','sales','Total billed today','bill'),stat('Cash received','cash','Confirmed cash received today','wallet'),stat('Online received','online','Confirmed online receipts only','wallet'),stat('Credit given today','credit','Today’s sales less paid-now amounts','book'),stat('Total outstanding','outstanding','All customer balances','book'),stat('Awaiting approval','approvals','Online payments to check','clock'),stat('Expenses today','expenses','Recorded shop expenses','wallet'),stat('Customers','customers','Maximum 500 per shop','users')) +
  `<div class="dashboard-grid">${panel('Recent bills',table('bills',['Customer','Bill','Date','Total','Status','Details']),'Latest 100 bills; complete histories are in customer ledgers')}<aside>${panel('At the counter',`<div class="panel-body page-quick-links">${link('Create a bill','new-bill.html','plus')}${open('Receive cash','cash-dialog','wallet',true)}${link('Review payments','payments.html','wallet',true)}</div>`)}${panel('Overdue customers',table('overdue',['Customer','Unpaid balance','Due date'],'No overdue report loaded','Overdue balances are determined after the payment window closes.'))}</aside></div>` + modal('cash-dialog','Receive cash',form('cash',cashFields,'Confirm cash received'))+correctionModal,
  open('Receive cash','cash-dialog','wallet',true)+link('New bill','new-bill.html','plus'));

add('shopkeeper','customers','Customers','Every customer has a separate, private khata.',
  panel('Your customers',`<div class="toolbar">${search('Search name, phone or customer ID')}<span class="table-count" data-value="customers">— / 500 customers</span></div>`+table('customers',['Customer','Phone','Opening balance','Outstanding','Consent','Details']))+
  modal('customer-dialog','Add customer',form('customer',customerFields,'Save and invite customer')),open('Add customer','customer-dialog','users'));

add('shopkeeper','customer-ledger','Customer Ledger','The full history behind a customer’s balance.',
  `<section class="panel"><div class="panel-body"><div class="form-grid">${customer('ledgerCustomer','Choose customer')}<div class="ledger-balance"><span>Current outstanding</span><strong data-value="ledgerBalance">—</strong></div></div></div>${table('ledger',['Date','Reference','Entry type','Amount'],'Choose a customer','Opening balance, bills, confirmed payments, and returns appear here. Select a payment to see its oldest-first allocation.')}<div class="panel-body pager"><button class="button secondary small" type="button" data-page-action="ledger-newer" disabled>Newer entries</button><span data-ledger-page>Page 1</span><button class="button secondary small" type="button" data-page-action="ledger-older" disabled>Older entries</button></div></section>`+correctionModal,
  open('Return / cancel','correction-dialog','bill',true)+exportActions);

add('shopkeeper','new-bill','New Bill','Choose a customer. Every item recorded this month is included automatically.',khataWorkspace('monthly'));

add('shopkeeper','bills','Bills','Original bills remain on record. Corrections are recorded separately.',
  panel('Your bills',`<div class="toolbar">${search('Search bill number or customer')}<span class="table-count">Latest 100 bills</span></div>`+table('bills',['Customer','Bill','Date','Total','Status','Details']))+monthlyBillList()+correctionModal,
  open('Return / cancel','correction-dialog','bill',true)+link('New bill','new-bill.html','plus'));

add('shopkeeper','payments','Payments and Approvals','Check online receipts before confirming them against a balance.',
  `<div class="tabs" role="group" aria-label="Payment filters"><button type="button" class="tab active" data-filter="all" aria-pressed="true">All payments</button><button type="button" class="tab" data-filter="pending" aria-pressed="false">Pending approval</button><button type="button" class="tab" data-filter="verified" aria-pressed="false">Verified, awaiting confirmation</button><button type="button" class="tab" data-filter="approved" aria-pressed="false">Approved</button><button type="button" class="tab" data-filter="rejected" aria-pressed="false">Rejected</button></div>`+
  panel('Payment history',table('payments',['Customer','Reference','Date','Method','Amount','Status','Details']))+
  modal('cash-dialog','Receive cash',form('cash',cashFields,'Confirm cash received'))+
  modal('approval-dialog','Review an online payment',form('unavailable',`${input('paymentReference','Payment reference','text','required')}${select('decision','Decision',[['approve','Approve / confirm receipt'],['reject','Reject']])}${textarea('reason','Review note / rejection reason','required maxlength="500"')}<p class="setup-note">Provider verification does not change a balance. Only the shopkeeper’s confirmation applies the payment.</p>`,'Save decision','data-service="Online payment approvals"')),
  open('Review payment','approval-dialog','shield',true)+open('Receive cash','cash-dialog','wallet'));

function report(role, monthly) {
  const slug=monthly?(role==='shopkeeper'?'monthly-reports':'monthly-report'):'daily-report';
  const filters=`<div class="report-filters">${monthly?input('period','Month','month','data-current-month required'):date('reportDate','Report date')}${role==='shopkeeper'?customer('reportCustomer','Customer',true):''}${select('method','Payment method',[['','All methods'],...methods])}${monthly?select('paymentStatus','Balance status',[['','All balances'],['paid','Paid'],['unpaid','Unpaid']]):''}<button class="button" type="submit">${icon('report')}View report</button></div>`;
  add(role,slug,monthly?'Monthly Reports':'Daily Report',role==='shopkeeper'?'Review sales, payments, and remaining amounts by customer.':'Only your own bills, payments, and remaining balance appear in this report.',
    panel('Report period',`<div class="panel-body"><form method="post" action="#" data-form="report">${error}${filters}</form></div>`)+
    stats(stat(monthly?'Previous balance':role==='customer'?'Returns / cancellations':'Expenses','reportPrevious',monthly?'Balance entering the selected month':role==='customer'?'Corrections to your selected bills':'Shop expenses on the selected date'),stat('Billed','reportBilled','Original item amounts before corrections','bill'),stat('Paid','reportPaid','Confirmed payments only','wallet'),stat(monthly?'Closing balance':'Remaining','reportRemaining',monthly?'Balance carried forward':'Unpaid amount after corrections','book'))+
    panel(monthly?'Customer statement detail':'Daily item detail',table('report',monthly?['Customer','Previous balance','Bills','Payments','Returns','Closing balance']:['Date','Customer','Item Name',...measurementHeadings,'Price per unit','Total Cost','Returns / cancellations','Paid','Remaining'],'Choose a reporting period','Load the report to see its complete figures.'))+
    (monthly?panel('Monthly item summary',table('monthly-items',['Customer','Item Name',...measurementHeadings,'Returned / cancelled quantity','Net quantity','Total Cost','Returns / cancellations','Net cost','Bills'],'Choose a reporting period','Item quantities and costs will appear for the selected month.')+'<p class="summary-note panel-body">Quantities stay in their original units. Returns and cancellations reduce the net quantity and cost. The statement above shows the balance carried into the next month.</p>'):''),
    action('Print','print','print',true)+exportActions);
}
report('shopkeeper',false);report('shopkeeper',true);

add('shopkeeper','expenses','Expenses','Keep a clear record of what the shop spends.',
  stats(stat('Today’s expenses','expenseToday','All categories','wallet'),stat('This month','expenseMonth','Current calendar month','wallet'),stat('Selected period','expensePeriod','Use the date filters','report'),stat('Entries','expenseCount','Recorded expenses','book'))+
  panel('Expense records',`<div class="panel-body"><form method="post" action="#" data-form="report"><div class="report-filters">${date('from','From')}${date('to','To')}${select('category','Category',[['','All categories'],['rent','Rent'],['utilities','Utilities'],['transport','Transport'],['supplies','Shop supplies'],['other','Other']])}<button type="submit" class="button">Apply filters</button></div>${error}</form></div>`+table('expenses',['Date','Category','Note','Amount'],'No expense records loaded','Recorded expenses will appear in daily and monthly reports.'))+
  modal('expense-dialog','Record an expense',form('unavailable',`<div class="form-grid">${select('category','Category',[['rent','Rent'],['utilities','Utilities'],['transport','Transport'],['supplies','Shop supplies'],['other','Other']])}${moneyInput('amount','Amount (Rs.)','required min="0.01"')}${date('expenseDate','Expense date')}</div>${textarea('note','Note','maxlength="500"')}`,'Save expense','data-service="Expenses"')),
  exportActions+open('Add expense','expense-dialog','plus'));

add('shopkeeper','suppliers','Suppliers','Purchases on credit, payments made, and the balance you owe.',
  panel('Supplier khata',`<div class="toolbar">${search('Search suppliers')}</div>`+table('suppliers',['Supplier','Phone','Credit purchases','Payments','Balance owed','Ledger'],'No suppliers loaded','Your suppliers and their account balances appear here.'))+
  modal('supplier-dialog','Add supplier',form('unavailable',`${input('name','Supplier name','text','required maxlength="120"')}${input('phone','Contact number','tel','required')}`,'Save supplier','data-service="Suppliers"'))+
  modal('supplier-entry-dialog','Supplier transaction',form('unavailable',`${input('supplierId','Supplier ID','text','required')}${select('type','Transaction type',[['purchase','Purchase on credit'],['payment','Payment made']])}${moneyInput('amount','Amount (Rs.)','required min="0.01"')}${date()}${textarea('note','Note','maxlength="500"')}`,'Record transaction','data-service="Supplier transactions"')),
  open('Record transaction','supplier-entry-dialog','wallet',true)+open('Add supplier','supplier-dialog','users'));

add('shopkeeper','item-catalogue','Item Catalogue','Record the items given to each customer, with quantity, unit, and rate.',
  khataWorkspace('entry')+panel('Saved catalogue products',`<div class="toolbar">${search('Search items')}</div>`+table('items',['Item','Unit / size','Original price','Status','Details']))+
  modal('item-dialog','Add catalogue product',form('item',itemFields,'Save product')),open('Add catalogue product','item-dialog','box',true));

function chat(role) {
  add(role,'chat','Chat',role==='shopkeeper'?'Talk directly with each customer about their khata.':'A private conversation with your shopkeeper.',
    `<section class="panel chat-layout"><aside class="chat-contacts"><div class="panel-header"><h2>${role==='shopkeeper'?'Customers':'Your shop'}</h2></div><div class="chat-search">${search('Search conversations')}</div><div data-chat-contacts><div class="empty"><p>Sign in to load your conversations.</p></div></div></aside><div class="chat-thread"><div class="panel-header"><div><h2 data-chat-title>${role==='shopkeeper'?'Select a customer':'Your shopkeeper'}</h2><p>Only the account participants can see these messages</p></div></div><div class="chat-messages" role="log" aria-live="polite"><div class="empty"><div class="empty-icon">${icon('chat')}</div><h3>Your conversation belongs here.</h3><p>Messages and account updates will appear in this thread.</p></div></div><form method="post" action="#" class="chat-composer" data-form="unavailable" data-service="Chat"><label class="field"><span>Message</span><textarea name="message" required maxlength="1000" placeholder="Write a message…"></textarea></label><button class="button" type="submit">Send ${icon('arrow')}</button>${error}</form></div></section>`);
}
chat('shopkeeper');

const accountFields=`<div class="form-grid">${input('bankName','Bank name','text','maxlength="120" data-shop-field="bank_name"')}${input('bankAccount','Account number / IBAN','text','maxlength="120" data-shop-field="bank_account"')}${input('easypaisaAccount','Easypaisa account','tel','maxlength="30" data-shop-field="easypaisa_account"')}${input('jazzcashAccount','JazzCash account','tel','maxlength="30" data-shop-field="jazzcash_account"')}</div>`;
add('shopkeeper','account-details','Account Details','Customers see these accounts on their Pay screen.',
  panel('Payment accounts',`<div class="panel-body">${form('accounts',accountFields,'Save account details')}<p class="summary-note">Add receiving account details only. Never enter a card number, CVV, PIN, or password here.</p></div>`)+
  panel('Gateway and QR payments',`<div class="panel-body"><p class="setup-note">Raast, Easypaisa and JazzCash verification needs an active merchant connection. A verified payment still needs your confirmation.</p><div class="form-grid">${select('provider','Provider',[['raast','Raast'],['easypaisa','Easypaisa'],['jazzcash','JazzCash']])}<div class="qr-placeholder">${icon('wallet')}<span>A provider-issued QR will appear here once configured.</span></div></div>${action('View payment setup','unavailable','shield',true,'data-service="Gateway merchant connection"')}</div>`));

const permissions=[['customers.read','View customers'],['bills.create','Create bills'],['payments.cash','Record cash payments'],['reports.read','View reports'],['items.manage','Manage catalogue'],['expenses.create','Record expenses']];
add('shopkeeper','staff','Staff','Separate logins and only the permissions you allow.',
  panel('Munshi accounts',table('staff',['Staff member','Phone','Permissions','Status','Details'],'No staff accounts loaded','Each staff action is attributed to that person in your audit history.'))+
  modal('staff-dialog','Add staff account',form('staff',`${input('name','Staff name','text','required maxlength="120"')}${input('phone','Phone number','tel','required')}${passwordInput('pin','Temporary six-digit PIN','required pattern="[0-9]{6}" minlength="6" maxlength="6" inputmode="numeric" autocomplete="new-password"')}<fieldset class="permission-grid"><legend>Allowed actions</legend>${permissions.map(([value,label])=>`<label class="check-field"><input type="checkbox" name="permissions" value="${value}"><span>${label}</span></label>`).join('')}</fieldset><p class="setup-note">Share the temporary PIN privately. The audit log remains shopkeeper-only.</p>`,'Create staff account')),open('Add staff','staff-dialog','users'));

add('shopkeeper','audit-log','Audit Log','Every create, update and approval, with who changed what and when.',
  panel('Permanent audit history',`<div class="toolbar">${search('Search action, person or record')}</div>`+table('audit',['Action','Record','Changed by','When','Old / new values'],'No audit entries loaded','Audit records are append-only and visible only to the shopkeeper.'))+`<div class="pager">${action('Newer entries','audit-newer','arrow',true)}${action('Older entries','audit-older','arrow',true)}</div>`);

add('shopkeeper','profile','Profile and Settings','Your shop’s identity, contact details, and preferences.',
  profileHero('shopkeeper')+panel('Shop profile',`<div class="panel-body">${form('profile',`<div class="form-grid">${input('ownerName','Shopkeeper name','text','required maxlength="120" data-shop-field="owner_name"')}${input('shopName','Shop name','text','required maxlength="160" data-shop-field="shop_name"')}${input('shopId','Shopkeeper ID','text','readonly data-bind-input="shopId"')}${input('phone','Verified phone','tel','readonly data-shop-field="phone"')}${input('address','Shop address','text','maxlength="500" data-shop-field="address"')}${input('logo','Shop photo / logo','file','accept="image/png,image/jpeg,image/webp" data-image-input')}</div><img class="item-picture-preview" data-image-preview alt="Selected shop logo" hidden>`,'Save profile')}</div>`)+
  `<div class="contact-grid section-gap">${panel('Preferences',`<div class="panel-body">${select('language','App language',[['en','English (default)'],['ur','Urdu']],'data-language')}<p class="summary-note">Attention alerts respect your device’s reduced-motion setting.</p>${action('Install app','install','download',true)}</div>`)}${panel('Backup and export',`<div class="panel-body"><p class="summary-note">Keep daily backups and retain account records for at least five years.</p>${action('Backup status','unavailable','shield',true,'data-service="Automatic backups"')}<div class="page-quick-links">${exportActions}</div><p class="summary-note">Contact the system administrator if account access is lost.</p></div>`)}</div>`);

add('customer','dashboard','Dashboard','Your private account with your shopkeeper.',
  `<section class="welcome-banner"><div><div class="eyebrow" data-bind="shop.shop_name">YOUR PERSONAL KHATA</div><h2>Every bill. Every payment. All clear.</h2><p>Your latest balance and the records behind it, in one place.</p></div>${link('My bills','my-bills.html','bill')}</section>`+
  `<aside class="payment-window" data-payment-window hidden><strong>Payment window · 5th–10th</strong><span>Clear your oldest unpaid balance during this month’s payment window.</span>${link('Pay now','pay.html','wallet',true)}</aside>`+
  stats(stat('Total remaining','outstanding','Confirmed payments reflected here'),stat('Previous month balance','previous','Balance carried into this month'),stat('This month’s bills','monthBills','All bills this calendar month','bill'),stat('Last payment','lastPayment','Latest confirmed payment','wallet'))+
  `<div class="dashboard-grid">${panel('My recent bills',table('bills',['Bill and items taken','Date','Total','Paid now','Status','Details']))}${panel('Account updates','<div class="panel-body" data-notifications><div class="empty"><p>Your bill and payment updates will appear here.</p></div></div>')}</div>`,link('Pay','pay.html','wallet'));

add('customer','my-bills','My Bills','Open a bill to check each item, then choose OK or Dispute.',
  monthlyBillList({customer:true})+panel('My itemized bill history',`<div class="toolbar">${search('Search bill number or date')}</div>`+table('bills',['Bill and items taken','Date','Total','Paid now','Status','Details']))+disputeModal,
  open('Dispute an item','dispute-dialog','bill',true));

add('customer','item-catalogue','Item Catalogue','Your purchased items, quantities, and original costs recorded by your shopkeeper.',
  panel('My items',`<div class="panel-body view-switch-row"><p data-items-view-label>Current month's bill items</p><div class="view-switch" aria-label="Choose bill items"><button class="button small" type="button" data-page-action="items-view" data-view="new" aria-pressed="true">New</button><button class="button secondary small" type="button" data-page-action="items-view" data-view="old" aria-pressed="false">Old</button></div></div>`+table('purchased-items',['Date','Item Name',...measurementHeadings,'Total Cost','Bill','Details'])+
    `<div class="panel-body pager"><button class="button secondary small" type="button" data-page-action="items-newer" disabled>Newer items</button><span data-items-page aria-live="polite">Page 1</span><button class="button secondary small" type="button" data-page-action="items-older" disabled>Older items</button></div>`)+
  `<p class="summary-note">Each quantity appears in its own kg, g, liter, or pieces column. Quantities and total costs stay as billed; returns and cancelled bills are labeled alongside the original items. Your shopkeeper manages these records.</p>`+disputeModal,action('Refresh','refresh-items','report',true));

function paymentAccount(label,key) {
  return `<div class="payment-account"><div><span class="eyebrow muted">${label}</span><strong data-bind="shop.${key}">Not loaded</strong></div><button type="button" class="icon-button" data-page-action="copy-account" data-account="${key}" aria-label="Copy ${label}">${icon('copy')}</button></div>`;
}
add('customer','pay','Pay','Send money to your shopkeeper, then submit your payment proof.',
  `<div class="contact-grid"><section class="panel"><div class="panel-header"><h2>Shopkeeper’s receiving accounts</h2></div><div class="panel-body"><p class="muted" data-bind="shop.shop_name">Your shop</p>${paymentAccount('Bank','bank_name')}${paymentAccount('Account / IBAN','bank_account')}${paymentAccount('Easypaisa','easypaisa_account')}${paymentAccount('JazzCash','jazzcash_account')}<p class="setup-note">Your balance changes only after the shopkeeper checks and confirms the payment.</p></div></section>${panel('Submit payment proof',`<div class="panel-body">${form('unavailable',`${moneyInput('amount','Amount sent (Rs.)','required min="0.01"')}${select('method','Payment method',methods.filter(([key])=>key!=='cash'&&key!=='qr'))}${input('transactionRef','Transaction ID / reference','text','required maxlength="160"')}${input('proof','Payment screenshot','file','required accept="image/png,image/jpeg,image/webp" data-image-input')}<img class="item-picture-preview" data-image-preview alt="Selected payment proof" hidden>`,'Submit for approval','data-service="Online payment proof"')}</div>`)}</div>`+
  panel('Pay online or scan a QR',`<div class="panel-body"><div class="gateway-options">${['Raast','Easypaisa','JazzCash'].map(provider=>action(provider,'unavailable','wallet',true,`data-service="${provider} payments"`)).join('')}</div><div class="qr-placeholder">${icon('wallet')}<strong>Shop payment QR</strong><span>A provider-issued QR is shown after merchant setup.</span></div><p class="summary-note">Provider verification is followed by the shopkeeper’s confirmation.</p></div>`));

add('customer','my-payments','My Payments','Track submitted, approved and rejected payments.',
  `<div class="tabs" role="group" aria-label="Payment status"><button type="button" class="tab active" data-filter="all" aria-pressed="true">All</button><button type="button" class="tab" data-filter="pending" aria-pressed="false">Pending</button><button type="button" class="tab" data-filter="approved" aria-pressed="false">Approved</button><button type="button" class="tab" data-filter="rejected" aria-pressed="false">Rejected</button></div>`+
  panel('My payment history',table('payments',['Reference','Date','Method','Amount','Status','Details'])),link('Submit payment proof','pay.html','wallet'));

add('customer','monthly-statements','Monthly Statements','Previous balances, confirmed payments, and what carries forward.',
  panel('Choose statement',`<div class="panel-body"><form method="post" action="#" data-form="report">${error}<div class="report-filters">${input('month','Statement month','month','data-current-month required')}<button type="submit" class="button">View statement</button></div></form></div>`)+
  stats(stat('Previous balance','statementPrevious','Carried from the previous month'),stat('Bills','statementBills','This month’s item totals','bill'),stat('Payments','statementPayments','Confirmed payments','wallet'),stat('Closing balance','statementClosing','Becomes next month’s previous balance'))+
  panel('Statement entries',table('statements',['Date','Reference','Bill amount','Payment','Return','Remaining'],'No statement loaded','Choose a month to load the issued statement.'))+
  `<p class="setup-note">Payments apply to the oldest unpaid balance first. Amounts still unpaid after the 10th are marked overdue and carried forward.</p>`,
  action('Print','print','print',true)+action('Download PDF','unavailable','download',true,'data-service="Statement PDF"'));

chat('customer');
add('customer','shopkeeper-contact','Shopkeeper Contact','Your shopkeeper’s name, address and phone number.',
  `<div class="contact-grid">${panel('Your shop',`<div class="panel-body"><div class="contact-emblem">${icon('box')}</div><h2 data-bind="shop.shop_name">Your shop</h2><dl class="detail-list"><div><dt>Shopkeeper</dt><dd data-bind="shop.owner_name">—</dd></div><div><dt>Contact number</dt><dd data-bind="shop.phone">—</dd></div><div><dt>Address</dt><dd data-bind="shop.address">—</dd></div></dl><a class="button secondary" data-phone-link href="login.html">${icon('phone')}Call shopkeeper</a></div>`)}${panel('Keep your account clear',`<div class="panel-body"><a class="quick-link" href="my-bills.html">${icon('bill')}Review my bills ${icon('arrow')}</a><a class="quick-link" href="pay.html">${icon('wallet')}View payment accounts ${icon('arrow')}</a><a class="quick-link" href="chat.html">${icon('chat')}Chat with shopkeeper ${icon('arrow')}</a><p class="summary-note">Your bills, payments, and conversations are private to your account.</p></div>`)}</div>`);

add('customer','profile','Profile','Your customer identity and the shop linked to your khata.',
  profileHero('customer')+panel('My profile',`<div class="panel-body"><dl class="detail-list"><div><dt>Name</dt><dd data-bind="user.name">—</dd></div><div><dt>Customer ID</dt><dd data-bind="customer.customer_code">—</dd></div><div><dt>Registered phone</dt><dd data-bind="user.phone">—</dd></div><div><dt>Shop</dt><dd data-bind="shop.shop_name">—</dd></div><div><dt>Shopkeeper</dt><dd data-bind="shop.owner_name">—</dd></div></dl><div class="form-grid section-gap">${select('language','App language',[['en','English (default)'],['ur','Urdu']],'data-language')}</div><div class="form-actions">${action('Install app','install','download',true)}</div></div>`));
report('customer',false);report('customer',true);

function head(title, prefix='..') {
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#D32F2F"><meta name="description" content="${e(title)} — Trust-Tally digital khata"><link rel="manifest" href="${prefix}/manifest.webmanifest"><link rel="icon" href="${prefix}/assets/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="${prefix}/assets/icon-192.png"><link rel="stylesheet" href="${prefix}/styles.css"><link rel="stylesheet" href="${prefix}/pages.css"><link rel="stylesheet" href="${prefix}/ui.css"><title>${title} · Trust-Tally</title>`;
}
function brand(prefix='..',href='dashboard.html') {return `<a class="brand" href="${href}"><img src="${prefix}/assets/icon.svg" alt=""><span>Trust-Tally<small>Your digital khata</small></span></a>`;}
function shell(page) {
  const nav=page.role==='shopkeeper'?ownerNav:customerNav;
  return `<!doctype html>\n<html lang="en">\n<head>${head(page.title)}</head>\n<body data-role="${page.role}" data-page="${page.slug}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="app-layout">
  <aside class="sidebar" aria-label="Main navigation">${brand()}<div class="shop-switcher">${icon('box')}<div><strong data-bind="shop.shop_name">${page.role==='shopkeeper'?'Your shop':'My shop account'}</strong><small>${page.role==='shopkeeper'?'Shopkeeper workspace':'Private customer account'}</small></div></div><p class="nav-label">YOUR KHATA</p><nav class="nav">${nav.map(([slug,title,symbol])=>`<a href="${slug}.html" ${slug===page.slug?'class="active" aria-current="page"':''}>${icon(symbol)}${title}</a>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><a href="login.html" data-page-action="sign-out">${icon('arrow')}Sign out</a></nav><div class="sidebar-foot">Made for everyday trust</div></div></aside>
  <button class="mobile-overlay" type="button" data-page-action="close-menu" aria-label="Close navigation"></button>
  <div class="workspace"><header class="topbar"><button class="icon-button menu-button" type="button" data-page-action="menu" aria-label="Open navigation" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb"><span class="muted">${page.role==='shopkeeper'?'My workspace':'My account'}</span><span class="separator">/</span><strong>${page.title}</strong></div><div class="topbar-right"><span class="connection" data-connection>Connecting</span><time class="topbar-date" data-current-date></time><a class="avatar" href="profile.html" aria-label="Open profile" data-avatar>TT</a></div></header>
  <div class="sync-banner page-status" data-page-status role="status" hidden></div>
  <main id="main" class="page" tabindex="-1"><div class="page-heading"><div><div class="eyebrow muted">${page.role==='shopkeeper'?'YOUR EVERYDAY ACCOUNTS':'YOUR PRIVATE KHATA'}</div><h1>${page.title}</h1><p>${page.description}</p></div><div class="page-actions">${page.actions}</div></div>${page.body}</main></div>
</div>
<dialog id="record-dialog" aria-labelledby="record-dialog-title"></dialog>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<noscript><p class="setup-note">Enable JavaScript to sign in, load private data, or submit forms.</p></noscript>
<script type="module" src="../pages.js"></script>
</body>\n</html>\n`;
}
function authPage(role, mode, prefix) {
  const login=mode==='login',register=mode==='register';
  const title=login?(role==='customer'?'Customer Login':'Shopkeeper / Staff Login'):register?'Create Shop Account':'Accept Customer Invitation';
  const description=login?'Sign in with your registered phone number and six-digit PIN.':register?'Create your shop with a phone number and secure PIN.':'Use your private invitation link, confirm the invited phone, and choose a PIN.';
  const phoneField=input('phone','Phone number','tel','required autocomplete="tel" placeholder="0300 1234567"');
  const pinField=passwordInput('pin',login?'Six-digit PIN':'Set a six-digit PIN',`required pattern="[0-9]{6}" minlength="6" maxlength="6" inputmode="numeric" autocomplete="${login?'current-password':'new-password'}"`);
  const fields=register?input('ownerName','Your name','text','required maxlength="120" autocomplete="name"')+input('shopName','Shop name','text','required maxlength="160" autocomplete="organization"')+phoneField+pinField:login?phoneField+pinField:phoneField+pinField+'<label class="check-field"><input type="checkbox" name="accept" required><span>I accept this shop’s invitation to maintain my customer khata.</span></label>';
  const loginHref=prefix==='..'?'login.html':'shopkeeper/login.html';
  return `<!doctype html>\n<html lang="en"><head>${head(title,prefix)}</head><body data-role="${role}" data-page="${mode}"><a class="skip-link" href="#main">Skip to content</a><div class="auth-layout"><aside class="auth-story">${brand(prefix,loginHref)}<div class="story-copy"><div class="story-tag">Built on trust. Kept in tally.</div><h1>Every account.<br>Every rupee.<br>All in one place.</h1><p>Clear bills, clear payments, and a khata you and your customers can trust.</p></div><div class="ledger-art" aria-hidden="true"><div class="art-book"><div class="art-top"><span>THE EVERYDAY KHATA</span><span>Rs.</span></div><div class="art-lines"><div class="art-line"></div><div class="art-line"></div><div class="art-line"></div></div></div><div class="art-stamp">${icon('shield')}A record you can trust</div></div><div class="story-footer">${icon('shield')}Private accounts. Lasting trust.</div></aside><section class="auth-panel">${brand(prefix,loginHref)}<main id="main" class="auth-form-wrap"><div class="eyebrow">${role==='customer'?'MY CUSTOMER ACCOUNT':'YOUR SHOP STARTS HERE'}</div><h2>${title}</h2><p class="auth-intro muted">${description}</p>${mode==='consent'?'<div data-invite-info class="setup-note">Open the private invitation provided by your shopkeeper.</div>':''}<form method="post" action="${prefix}/api/auth/${mode}" data-form="auth" data-auth-mode="${mode}">${error}${fields}<button class="button full" type="submit">${login?'Sign in':register?'Create shop':'Accept invitation'}${icon('arrow')}</button></form><div class="auth-inline">${login?`<a class="button secondary" href="../register.html">${role==='shopkeeper'?'Sign up':'Sign up as shopkeeper'}</a>`:`<a class="link-button" href="${loginHref}">Back to sign in</a>`}</div>${login?`<p class="auth-footer"><a href="../${role==='shopkeeper'?'customer':'shopkeeper'}/login.html">${role==='shopkeeper'?'Customer sign in':'Shopkeeper sign in'}</a></p>`:''}<p class="auth-footer muted">Your account is private.<br>Customers see only their own khata.</p></main></section></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div><noscript><p>Enable JavaScript to sign in securely.</p></noscript><script type="module" src="${prefix}/pages.js"></script></body></html>\n`;
}
for(const role of ['shopkeeper','customer'])await mkdir(new URL(`../public/${role}/`,import.meta.url),{recursive:true});
for(const page of pages)await writeFile(new URL(`../public/${page.role}/${page.slug}.html`,import.meta.url),shell(page));
for(const role of ['shopkeeper','customer'])await writeFile(new URL(`../public/${role}/login.html`,import.meta.url),authPage(role,'login','..'));
for(const mode of ['register','consent'])await writeFile(new URL(`../public/${mode==='consent'?'accept-invite':mode}.html`,import.meta.url),authPage(mode==='consent'?'customer':'shopkeeper',mode,'.'));
const catalog=[...pages.map(({role,slug,title})=>({role,path:`/${role}/${slug}.html`,title})),...['shopkeeper','customer'].map(role=>({role,path:`/${role}/login.html`,title:'Login'})),...['register','accept-invite'].map(slug=>({role:'shared',path:`/${slug}.html`,title:slug}))];
await writeFile(new URL('../public/page-catalog.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
console.log(`Created ${catalog.length} HTML pages: 17 shopkeeper, 12 customer (including catalogue and daily/monthly reports), and 2 shared authentication pages.`);
