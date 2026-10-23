import { enqueue, queued, decrypt, remove } from './offline.js';
import { itemUnits, unitSymbol, formatQuantity, formatItemQuantity, catalogueUnit, priceUnit, measurementValues } from './units.js';
import { billItemSummary, purchasedItemRows } from './item-display.js';
import {mountKhata,loadMonthlyBillList} from './khata.js';

const $ = (query, root = document) => root.querySelector(query);
const $$ = (query, root = document) => [...root.querySelectorAll(query)];
const role = document.body.dataset.role;
const page = document.body.dataset.page;
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money = value => `Rs. ${new Intl.NumberFormat('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value || 0))}`;
const measurementCells = (value, unit) => measurementValues(value, unit).map(label => `<td class="right">${escape(label)}</td>`).join('');
const cents = value => {const match=/^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(String(value));return match?(match[1]?-1:1)*(Number(match[2])*100+Number((match[3]||'').padEnd(2,'0'))):0;};
const today = () => {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');
};
function dateLabel(value) {
  if(!value)return '—';
  const raw=String(value), iso=raw.length===10?`${raw}T12:00:00+05:00`:raw.includes('T')?raw:raw.replace(' ','T')+'Z';
  const parsed=new Date(iso);
  return Number.isNaN(parsed.getTime())?'—':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(parsed);
}
let state=null, staffRows=[], toastTimer, installPrompt, syncing=false, ledgerOffset=0, ledgerMore=false;
let auditBefore=null, auditMore=false, auditLast=null, auditHistory=[];
let itemsView='new',itemsBefore=null, itemsMore=false, itemsLast=null, itemsHistory=[], itemsLoading=false;
const inviteToken=new URLSearchParams(location.search).get('invite');
if(inviteToken&&page==='consent')history.replaceState(null,'',location.pathname);

async function request(path,{method='GET',body}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Requested-With':'TrustTally'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||'Unable to complete the request.');error.status=response.status;throw error;}
    return result;
  } catch(error) {
    if(!error.status)error.message='Connection unavailable. Check your connection and try again.';
    throw error;
  } finally {clearTimeout(timer);}
}
function toast(message) {
  const target=$('#toast');if(!target)return;
  target.textContent=message;target.hidden=false;clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{target.hidden=true;},6500);
}
function feedback(form,message) {
  const target=$('[data-feedback]',form);
  if(target){target.textContent=message;target.hidden=false;target.scrollIntoView({block:'nearest'});}else toast(message);
}
function status(message,signin=false) {
  const target=$('[data-page-status]');if(!target)return;
  target.replaceChildren();target.hidden=!message;if(!message)return;
  const span=document.createElement('span');span.textContent=message;target.append(span);
  if(signin){const a=document.createElement('a');a.href=`/${role}/login.html`;a.className='button secondary small';a.textContent='Sign in';target.append(a);}
}
function requireAccount() {
  if(!state)throw new Error('Sign in to your account before saving or loading private records.');
}
const owner = () => state?.user.role==='shopkeeper' || state?.user.role==='staff';
const shopOwner = () => state?.user.role==='shopkeeper';
const can = permission => shopOwner() || (state?.user.role==='staff' && state.user.permissions.includes(permission));
const staffPermissionLabels = {'customers.read':'View customers','bills.create':'Create bills','payments.cash':'Record cash payments','reports.read':'View reports','items.manage':'Manage catalogue','expenses.create':'Record expenses'};
const pagePermission = {'customers':'customers.read','customer-ledger':'customers.read','new-bill':'bills.create','bills':'bills.create','payments':'payments.cash','daily-report':'reports.read','monthly-reports':'reports.read','expenses':'expenses.create','item-catalogue':'items.manage'};
function applyStaffAccess() {
  if(state.user.role!=='staff')return;
  if(page!=='dashboard' && !pagePermission[page])throw new Error('This screen is reserved for the shopkeeper.');
  if(pagePermission[page] && !can(pagePermission[page]))throw new Error('Your account does not have permission for this screen.');
  $$('.sidebar .nav a').forEach(link=>{
    const slug=link.getAttribute('href')?.replace('.html','');
    if(slug==='login')return;
    link.hidden=slug!=='dashboard' && (!pagePermission[slug] || !can(pagePermission[slug]));
  });
  $$('.topbar .avatar').forEach(link=>link.hidden=true);
  $$('main a[href$=".html"]').forEach(link=>{
    const slug=link.getAttribute('href')?.replace('.html','');
    if(pagePermission[slug] && !can(pagePermission[slug]))link.hidden=true;
  });
  if(page==='dashboard'){
    if(!can('reports.read'))$('.stats')?.setAttribute('hidden','');
    if(!can('bills.create'))$$('[href="new-bill.html"], [href="bills.html"]').forEach(target=>target.hidden=true);
    if(!can('customers.read'))$$('[href="customers.html"]').forEach(target=>target.hidden=true);
    if(!can('payments.cash'))$$('[data-dialog="cash-dialog"]').forEach(target=>target.hidden=true);
    if(!can('bills.create'))$('.dashboard-grid > .panel')?.setAttribute('hidden','');
    if(!can('customers.read'))$('.dashboard-grid > aside .panel:last-child')?.setAttribute('hidden','');
  }
  if(page==='customers')$$('[data-dialog="customer-dialog"], [data-page-action="edit-customer"], [data-page-action="renew-invite"]').forEach(target=>target.hidden=true);
}
function badge(value) {
  const labels={pending:'Pending',approved:'Approved',rejected:'Rejected',verified:'Verified, awaiting confirmation',ok:'OK',disputed:'Disputed',accepted:'Accepted',invited:'Awaiting consent',active:'Active',inactive:'Inactive',cancelled:'Cancelled'};
  const mark=['approved','accepted','ok','active'].includes(value)?'✓':'◷';
  return `<span class="badge ${['pending','disputed','invited','rejected'].includes(value)?'outline':''}">${mark} ${escape(labels[value]||value)}</span>`;
}
function emptyRows(target,columns,title='No records yet',description='New records will appear here.') {
  target.innerHTML=`<tr><td colspan="${columns}"><div class="empty"><h3>${title}</h3><p>${description}</p></div></td></tr>`;
}
function setValue(key,value) {$$(`[data-value="${key}"]`).forEach(target=>{target.textContent=value;});}
function resolveBind(path) {
  const data={...state,customer:state?.customers[0]};
  return path.split('.').reduce((value,key)=>value?.[key],data);
}
function populateOptions() {
  $$('[data-customers]').forEach(select=>{
    const previous=select.value, optional=!select.required;
    const rows=select.name==='ledgerCustomer'?state.customers:state.customers.filter(row=>optional||(row.status==='active'&&row.consent_status==='accepted'));
    select.innerHTML=`<option value="">${optional?'All customers':'Choose a customer'}</option>`+rows.map(row=>`<option value="${row.customer_id}">${escape(row.name)} · ${escape(row.customer_code)}</option>`).join('');
    select.value=previous;
  });
  $$('[data-items]').forEach(select=>{
    const previous=select.value;
    select.innerHTML='<option value="">Choose an item</option>'+state.items.filter(row=>row.active).map(row=>`<option value="${row.item_id}">${escape(row.name)} · ${escape(unitSymbol(row.unit))}</option>`).join('');
    select.value=previous;
  });
}
function populateCorrectionBills() {
  const select=$('[data-correction-bills]');if(!select||!state)return;
  const previous=select.value;
  select.innerHTML='<option value="">Choose a bill</option>'+state.bills.filter(row=>row.status==='active').map(row=>`<option value="${row.bill_id}">${escape(row.bill_no)} · ${escape(row.name)}</option>`).join('');
  select.value=previous;
}
function renderTables() {
  $$('[data-table]').forEach(target=>{
    const kind=target.dataset.table,columns=target.closest('table').querySelectorAll('th').length;
    if(kind==='customers') {
      if(!state.customers.length)return emptyRows(target,columns,'No customers yet','Add a customer and invite them to accept their khata.');
      target.innerHTML=state.customers.map(row=>`<tr><td><strong>${escape(row.name)}</strong><small>${escape(row.customer_code)}</small></td><td>${escape(row.phone)}</td><td>${money(row.opening_balance)}</td><td>${money(row.balance)}</td><td>${badge(row.status==='inactive'?'inactive':row.consent_status)}</td><td><a class="button secondary small" href="customer-ledger.html?customer=${row.customer_id}">Ledger</a> <button type="button" class="button secondary small" data-page-action="edit-customer" data-id="${row.customer_id}">Edit</button></td></tr>`).join('');
    } else if(kind==='items') {
      if(!state.items.length)return emptyRows(target,columns,'Your catalogue is empty','Add the items you sell, with their unit and default price.');
      target.innerHTML=state.items.map(row=>`<tr><td><strong>${escape(row.name)}</strong></td><td>${escape(catalogueUnit(row))}</td><td>${money(row.default_price)} / ${escape(priceUnit(row))}</td><td>${badge(row.active?'active':'inactive')}</td><td><button type="button" class="button secondary small" data-page-action="edit-item" data-id="${row.item_id}">Edit</button></td></tr>`).join('');
    } else if(kind==='bills') {
      if(!state.bills.length)return emptyRows(target,columns,'No bills yet',owner()?'Create a bill after your customer accepts the invitation.':'Bills from your shopkeeper will appear here.');
      target.innerHTML=state.bills.map(row=>`<tr>${owner()?`<td><strong>${escape(row.name)}</strong></td>`:''}<td><strong>${escape(row.bill_no)}</strong>${!owner()?billItemSummary(row.items):''}</td><td>${dateLabel(row.bill_date)}</td><td>${money(row.total)}</td>${owner()?'':`<td>${money(row.paid_now)}</td>`}<td>${badge(row.status==='cancelled'?'cancelled':Number(row.total)-Number(row.returned)<=Number(row.allocated)?'approved':'pending')}</td><td><button type="button" class="button secondary small" data-page-action="view-bill" data-id="${row.bill_id}">View</button></td></tr>`).join('');
    } else if(kind==='payments') {
      if(!state.payments.length)return emptyRows(target,columns,'No payments yet','Confirmed payments and submitted proofs will appear in this history.');
      target.innerHTML=state.payments.map(row=>`<tr data-payment-status="${escape(row.status)}">${owner()?`<td>${escape(row.name)}</td>`:''}<td>PAY-${row.payment_id}</td><td>${dateLabel(row.payment_date)}</td><td>${escape(row.method)}</td><td>${money(row.amount)}</td><td>${badge(row.status)}</td><td><button type="button" class="button secondary small" data-page-action="payment-detail" data-id="${row.payment_id}">View</button></td></tr>`).join('');
    } else if(kind==='staff') {
      if(!staffRows.length)return emptyRows(target,columns,'No staff accounts yet','Add a staff member and choose their permissions.');
      target.innerHTML=staffRows.map(row=>`<tr><td><strong>${escape(row.name)}</strong></td><td>${escape(row.phone)}</td><td>${row.permissions.map(permission=>escape(staffPermissionLabels[permission]||permission)).join(', ')}</td><td>${badge(row.status)}</td><td><button type="button" class="button secondary small" data-page-action="edit-staff" data-id="${row.userId}">Manage</button></td></tr>`).join('');
    }
  });
}
function populate() {
  $$('[data-bind]').forEach(target=>{target.textContent=resolveBind(target.dataset.bind)||'Not added';});
  $$('[data-shop-field]').forEach(target=>{target.value=state.shop[target.dataset.shopField]||'';});
  $$('[data-bind-input="shopId"]').forEach(target=>{target.value=`SHOP-${String(state.shop.shop_id).padStart(4,'0')}`;});
  if($('[data-avatar]'))$('[data-avatar]').textContent=state.user.name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase();
  if($('[data-phone-link]'))$('[data-phone-link]').href=`tel:${state.shop.phone}`;
  const outstanding=owner()?state.customers.reduce((sum,row)=>sum+Math.max(0,Number(row.balance)),0):Number(state.customers[0]?.balance||0);
  setValue('sales',money(state.totals.sales));setValue('cash',money(state.totals.cash));setValue('online',money(state.totals.online));setValue('credit',money(state.totals.credit));setValue('expenses',money(state.totals.expenses));setValue('outstanding',money(outstanding));
  if(!owner()&&outstanding<0){const card=$('[data-value="outstanding"]')?.closest('.stat');if(card){card.querySelector('.stat-header > span:first-child').textContent='Credit on account';card.querySelector('.stat-foot').textContent='This credit carries forward to future bills.';card.querySelector('[data-value="outstanding"]').textContent=money(-outstanding);}}
  if(!owner()&&outstanding>=0){const card=$('[data-value="outstanding"]')?.closest('.stat');if(card){card.querySelector('.stat-header > span:first-child').textContent='Total remaining';card.querySelector('.stat-foot').textContent='Confirmed payments reflected here';}}
  setValue('customers',`${state.customers.length} / 500`);setValue('approvals',String(state.totals.approvals??0));
  const overdue=$('[data-table="overdue"]');
  if(overdue){const rows=state.overdue||[];if(rows.length)overdue.innerHTML=rows.map(row=>`<tr><td><a href="customer-ledger.html?customer=${row.customer_id}">${escape(row.name)}</a></td><td>${money(row.balance)}</td><td>${dateLabel(row.due_date)}</td></tr>`).join('');else emptyRows(overdue,3,'No overdue balances','Positive balances are marked overdue after the 10th.');}
  if(!owner()){
    setValue('previous',money(state.totals.previous_balance));setValue('monthBills',money(state.totals.month_bills));
    setValue('lastPayment',money(state.payments.find(row=>row.status==='approved')?.amount||0));
  }
  const windowBanner=$('[data-payment-window]'),day=Number(today().slice(-2));
  if(windowBanner){windowBanner.hidden=day<5||day>10;windowBanner.classList.toggle('blink-attention',!windowBanner.hidden);}
  const notifications=$('[data-notifications]');
  if(notifications)notifications.innerHTML=state.notifications.length?state.notifications.map(row=>`<div class="activity-item">${escape(row.message)}<small>${dateLabel(row.sent_at)}</small></div>`).join(''):'<div class="empty"><h3>You’re up to date.</h3><p>Account updates will appear here.</p></div>';
  const conversations=$('[data-chat-contacts]');
  if(conversations)conversations.innerHTML=(owner()?state.customers:[{name:state.shop.owner_name,customer_code:state.shop.shop_name,customer_id:state.user.customer_id}]).map(row=>`<button class="chat-contact" type="button" data-page-action="chat-contact" data-name="${escape(row.name)}"><strong>${escape(row.name)}</strong><small>${escape(row.customer_code)}</small></button>`).join('')||'<div class="empty"><p>No customers yet.</p></div>';
  populateOptions();populateCorrectionBills();renderTables();updateBill();
}
async function loadState() {
  const data=await request('/state');
  if(data.user.role!==role && !(role==='shopkeeper' && data.user.role==='staff'))throw new Error(`This page is for ${role==='shopkeeper'?'the shopkeeper or authorized staff':'a customer'}. Sign in with the matching account.`);
  state=data;applyStaffAccess();populate();applyStaffAccess();status('');
  mountKhata({state,request,onSaved:async saved=>{await loadState();toast(saved.message||'Item added to the customer’s khata.');},showRecord,saveFinancial:financial});
  if(page==='bills'||page==='my-bills')await loadMonthlyBillList(request,showRecord);
  if(page==='staff'){staffRows=(await request('/staff')).staff;renderTables();}
  if(page==='audit-log')await loadAudit();
  if(page==='item-catalogue' && role==='customer'){
    try{await loadPurchasedItems();}catch(error){
      const target=$('[data-table="purchased-items"]');
      target.innerHTML=`<tr><td colspan="9"><div class="empty"><h3>Items could not be loaded</h3><p>${escape(error.message)}</p><button type="button" class="button secondary" data-page-action="refresh-items">Try again</button></div></td></tr>`;
    }
  }
  if(page==='customer-ledger'){
    const selected=$('[name="ledgerCustomer"]'),id=new URLSearchParams(location.search).get('customer');
    if(id&&state.customers.some(row=>String(row.customer_id)===id))selected.value=id;
    if(selected.value)await loadLedger();
  }
}
async function loadPurchasedItems() {
  requireAccount();
  const target=$('[data-table="purchased-items"]');
  const query=new URLSearchParams({view:itemsView});if(itemsBefore)query.set('before',itemsBefore);
  const result=await request(`/items/purchased?${query}`);
  itemsMore=result.hasMore;itemsLast=result.items.at(-1)?.bill_item_id;
  if(!result.items.length)emptyRows(target,9,itemsView==='new'?'No new items yet':'No old items yet',itemsView==='new'?"This month's bill items will appear here.":'Items from previous months will appear here.');
  else target.innerHTML=purchasedItemRows(result.items,{dateLabel,money,badge});
  $('[data-page-action="items-newer"]').disabled=!itemsHistory.length;
  $('[data-page-action="items-older"]').disabled=!itemsMore;
  $('[data-items-page]').textContent=`Page ${itemsHistory.length+1}`;
}
async function changeItemsPage(older) {
  if(itemsLoading || (older ? !itemsMore : !itemsHistory.length))return;
  const previousBefore=itemsBefore,previousHistory=[...itemsHistory];
  itemsLoading=true;
  if(older){itemsHistory.push(itemsBefore);itemsBefore=itemsLast;}
  else itemsBefore=itemsHistory.pop();
  try{await loadPurchasedItems();}catch(error){itemsBefore=previousBefore;itemsHistory=previousHistory;throw error;}finally{itemsLoading=false;}
}
async function changeItemsView(view){
  itemsView=view;itemsBefore=null;itemsLast=null;itemsMore=false;itemsHistory=[];
  $$('[data-page-action="items-view"]').forEach(button=>{const active=button.dataset.view===view;button.setAttribute('aria-pressed',String(active));button.classList.toggle('secondary',!active);});
  const label=$('[data-items-view-label]');if(label)label.textContent=view==='new'?"Current month's bill items":'Items from previous bills';
  await loadPurchasedItems();
}
function showRecord(title,content) {
  const dialog=$('#record-dialog');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="record-dialog-title">${escape(title)}</h2><button type="button" class="icon-button" data-page-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${content}</div>`;
  if(!dialog.open)dialog.showModal();
}
async function viewBill(id) {
  requireAccount();const {bill,items,corrections}=await request(`/bills/${id}`);
  const corrected=corrections.reduce((sum,row)=>sum+Number(row.amount),0),pending=Math.max(0,Number(bill.total)-corrected-Number(bill.allocated));
  showRecord(bill.bill_no,`<article class="receipt"><h3>${escape(state.shop.shop_name)}</h3><div class="dialog-meta"><div><strong>${escape(bill.name)}</strong><small>${escape(bill.phone)}</small></div><div>${dateLabel(bill.bill_date)}</div></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>Price</th><th>Amount</th><th>Status</th></tr></thead><tbody>${items.map(row=>`<tr><td>${escape(row.name)}${Number(row.returned_quantity)>0?`<small>${escape(formatQuantity(row.returned_quantity,row.unit))} returned</small>`:''}</td><td>${escape(formatItemQuantity(row))}</td><td>${money(row.price)} / ${escape(priceUnit(row))}</td><td>${money(row.line_total)}</td><td>${badge(row.customer_status)}${!owner()&&row.customer_status==='pending'&&bill.status==='active'?` <button type="button" class="button secondary small" data-page-action="item-ok" data-id="${row.bill_item_id}" data-bill="${bill.bill_id}">OK</button> <button type="button" class="button secondary small" data-page-action="item-dispute" data-reference="${escape(bill.bill_no)}" data-item="${escape(row.name)}">Dispute</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="summary-row"><span>Original bill total</span><strong>${money(bill.total)}</strong></div><div class="summary-row"><span>Paid now</span><strong>${money(bill.paid_now)}</strong></div><div class="summary-row"><span>Corrections</span><strong>− ${money(corrected)}</strong></div><div class="summary-row total"><span>Remaining on this bill</span><strong>${money(pending)}</strong></div>${corrections.length?`<h4>Correction history</h4><ul>${corrections.map(row=>`<li>${row.bill_item_id?'Item return':'Bill cancellation'} · ${money(row.amount)} · ${escape(row.reason)}</li>`).join('')}</ul>`:''}<p class="summary-note">The original bill remains on record. Payments allocated to older debt may differ from Paid now.</p></article><div class="receipt-actions">${shopOwner()&&bill.status==='active'?`<button type="button" class="button secondary" data-page-action="correct-bill" data-id="${bill.bill_id}">Return / cancel</button>`:''}<button type="button" class="button secondary" data-page-action="print-record">Print receipt</button></div>`);
}
function toggleCorrectionType() {
  const form=$('[data-form="correction"]');if(!form)return;
  const returning=form.elements.type.value==='return';
  $$('[data-return-only]',form).forEach(field=>field.hidden=!returning);
  form.elements.billItemId.required=returning;
  form.elements.quantity.required=returning;
}
async function loadCorrectionItems(id) {
  const form=$('[data-form="correction"]');if(!form)return;
  const select=form.elements.billItemId;
  select.innerHTML='<option value="">Choose an item</option>';
  if(!id)return;
  const {bill,items}=await request(`/bills/${id}`);
  if(bill.status!=='active')throw new Error('This bill has already been cancelled.');
  const billSelect=form.elements.billId;
  if(![...billSelect.options].some(option=>option.value===String(id)))billSelect.add(new Option(`${bill.bill_no} · ${bill.name}`,String(id)));
  billSelect.value=String(id);
  select.innerHTML+=items.filter(item=>Number(item.quantity)>Number(item.returned_quantity)).map(item=>`<option value="${item.bill_item_id}" data-remaining="${Number(item.quantity)-Number(item.returned_quantity)}" data-unit="${escape(item.unit)}">${escape(item.name)} · ${Number(item.quantity)-Number(item.returned_quantity)} ${escape(item.unit)} remaining</option>`).join('');
}
async function prepareCorrection(id) {
  const dialog=$('#correction-dialog');if(!dialog)throw new Error('Open the Bills or Customer Ledger screen to record a correction.');
  populateCorrectionBills();
  await loadCorrectionItems(id);
  toggleCorrectionType();
  const record=$('#record-dialog');if(record?.open)record.close();
  dialog.showModal();
}
async function loadLedger() {
  const select=$('[name="ledgerCustomer"]');if(!select?.value)return;
  const result=await request(`/customers/${select.value}/ledger?offset=${ledgerOffset}`),target=$('[data-table="ledger"]');
  setValue('ledgerBalance',money(Math.abs(Number(result.balance))));ledgerMore=result.hasMore;
  const balanceLabel=$('.ledger-balance > span');if(balanceLabel)balanceLabel.textContent=Number(result.balance)<0?'Current credit':'Current outstanding';
  if(result.entries.length)target.innerHTML=result.entries.map(row=>`<tr><td>${dateLabel(row.occurred_at)}</td><td>${row.type==='bill'?`<button type="button" class="link-button" data-page-action="view-bill" data-id="${row.entry_id}">${escape(row.reference)}</button>`:row.type==='payment'?`<button type="button" class="link-button" data-page-action="payment-detail" data-id="${row.entry_id}">${escape(row.reference)}</button>`:escape(row.reference)}</td><td>${escape(row.type)}</td><td>${['bill','opening'].includes(row.type)?'+':'−'} ${money(row.amount)}</td></tr>`).join('');
  else emptyRows(target,4,'No transactions yet','The customer’s opening balance is included in their outstanding total.');
  $('[data-ledger-page]').textContent=`Page ${Math.floor(ledgerOffset/100)+1}`;
  $('[data-page-action="ledger-newer"]').disabled=ledgerOffset===0;
  $('[data-page-action="ledger-older"]').disabled=!ledgerMore;
}
async function viewPayment(id) {
  const {payment,allocations}=await request(`/payments/${id}`);
  const allocationRows=allocations.length?`<h4>Applied oldest first</h4><ul>${allocations.map(row=>`<li>${escape(row.reference)} · ${money(row.amount)}</li>`).join('')}</ul>`:'<p class="summary-note">This payment has not been applied to the balance.</p>';
  showRecord(`PAY-${payment.payment_id}`,`<article class="receipt"><h3>${escape(state.shop.shop_name)}</h3><p><strong>${escape(payment.name)}</strong><br>${escape(payment.customer_code)} · ${dateLabel(payment.payment_date)}</p><div class="summary-row"><span>Payment method</span><strong>${escape(payment.method)}</strong></div><div class="summary-row total"><span>Amount received</span><strong>${money(payment.amount)}</strong></div>${badge(payment.status)}${allocationRows}<p class="summary-note">Only approved payments reduce the account balance.</p></article><div class="receipt-actions"><button type="button" class="button secondary" data-page-action="print-record">Print receipt</button></div>`);
}
async function loadReport(form,data) {
  const target=$('[data-table="report"]')||$('[data-table="statements"]');
  if(page==='monthly-statements'){
    const result=await request(`/statements/${encodeURIComponent(data.month)}`);
    setValue('statementPrevious',money(result.previousBalance));setValue('statementBills',money(result.bills));setValue('statementPayments',money(result.payments));setValue('statementClosing',money(result.closingBalance));
    if(result.entries.length)target.innerHTML=result.entries.map(row=>`<tr><td>${dateLabel(row.occurred_at)}</td><td>${escape(row.reference)}</td><td>${row.type==='bill'?money(row.amount):'—'}</td><td>${row.type==='payment'?money(row.amount):'—'}</td><td>${row.type==='return'?money(row.amount):'—'}</td><td>${money(row.balance)}</td></tr>`).join('');
    else emptyRows(target,6,'No entries this month','The previous balance still carries into the closing balance.');
    return;
  }
  const monthly=page==='monthly-reports'||page==='monthly-report';
  const query=new URLSearchParams(monthly?{month:data.period||today().slice(0,7)}:{date:data.reportDate||today()});
  if(data.reportCustomer)query.set('customerId',data.reportCustomer);if(data.method)query.set('method',data.method);if(data.paymentStatus)query.set('status',data.paymentStatus);
  const result=await request(`/reports/${monthly?'monthly':'daily'}?${query}`);
  setValue('reportPrevious',money(monthly?result.summary.previous:role==='customer'?result.summary.returns:result.summary.expenses));setValue('reportBilled',money(result.summary.billed));setValue('reportPaid',money(result.summary.paid));setValue('reportRemaining',money(monthly?result.summary.closing:result.summary.remaining));
  if(result.rows.length)target.innerHTML=monthly?result.rows.map(row=>`<tr><td>${escape(row.name)}</td><td>${money(row.previous_balance)}</td><td>${money(row.bills_total)}</td><td>${money(row.payments_total)}</td><td>${money(row.returns_total)}</td><td>${money(row.closing_balance)}</td></tr>`).join(''):result.rows.map(row=>`<tr><td>${dateLabel(row.bill_date||result.date)}</td><td>${escape(row.name)}</td><td><strong>${escape(row.item)}</strong>${row.bill_status==='cancelled'?`<small>${badge('cancelled')}</small>`:''}</td>${measurementCells(row.quantity,row.unit)}<td>${money(row.price)}</td><td>${money(row.line_total)}</td><td>${money(row.returned)}</td><td>${money(row.paid)}</td><td>${money(row.remaining)}</td></tr>`).join('');
  else emptyRows(target,monthly?6:12,'No report entries','No matching financial records were found.');
  if(monthly){
    const itemQuery=new URLSearchParams({month:data.period||today().slice(0,7)});if(data.reportCustomer)itemQuery.set('customerId',data.reportCustomer);
    const itemResult=await request(`/reports/monthly/items?${itemQuery}`),itemTarget=$('[data-table="monthly-items"]');
    if(itemTarget){
      if(itemResult.rows.length)itemTarget.innerHTML=itemResult.rows.map(row=>`<tr><td>${escape(row.customer_name)}</td><td>${escape(row.item)}</td>${measurementCells(row.quantity,row.unit)}<td>${escape(formatQuantity(row.returned_quantity,row.unit))}</td><td>${escape(formatQuantity(row.net_quantity,row.unit))}</td><td>${money(row.billed_amount)}</td><td>${money(row.returned_amount)}</td><td>${money(row.net_amount)}</td><td>${Number(row.bill_count)}</td></tr>`).join('');
      else emptyRows(itemTarget,12,'No item details','No item records were found for this month and customer.');
    }
  }
}
async function loadAudit() {
  const result=await request(`/audit${auditBefore?`?before=${auditBefore}`:''}`),target=$('[data-table="audit"]');
  auditMore=result.hasMore;auditLast=result.entries.at(-1)?.log_id;
  if(result.entries.length)target.innerHTML=result.entries.map(row=>`<tr><td>${escape(row.action)}</td><td>${escape(row.entity)} #${row.entity_id}</td><td>${escape(row.actor)}</td><td>${dateLabel(row.created_at)}</td><td><details><summary>View changes</summary><pre class="audit-details">${escape(JSON.stringify({before:row.old_value,after:row.new_value,reason:row.reason},null,2))}</pre></details></td></tr>`).join('');
  else emptyRows(target,5,'No audit entries yet','Your create, update and approval actions are recorded automatically.');
  $('[data-page-action="audit-newer"]').disabled=!auditHistory.length;
  $('[data-page-action="audit-older"]').disabled=!auditMore;
}
function updateBill() {
  const form=$('[data-form="bill"]');if(!form)return;
  let total=0;
  $$('.bill-line',form).forEach(row=>{
    const item=state?.items.find(item=>String(item.item_id)===$('[name="itemId"]',row).value);
    $('[data-quantity-label]',row).textContent=item?`Quantity (${unitSymbol(item.unit)})`:'Quantity';
    $('[data-price-label]',row).textContent=item?`Rs. per ${unitSymbol(item.unit)}`:'Price (Rs.)';
    const value=Math.round(cents($('[name="price"]',row).value)*Math.round(Number($('[name="quantity"]',row).value||0)*1000)/1000);
    $('[data-line-total]',row).textContent=money(value/100);total+=value;
  });
  const selected=state?.customers.find(row=>String(row.customer_id)===form.elements.customerId.value),balance=cents(selected?.balance||'0'),paid=cents(form.elements.paidNow.value);
  setValue('billTotal',money(total/100));setValue('billPending',money((total-paid)/100));
  setValue('currentBalance',selected?money(balance/100):'—');setValue('newBalance',selected?money((balance+total-paid)/100):'—');
  const over=Boolean(selected&&balance+total-paid>cents(selected.credit_limit));
  $('[data-credit-warning]',form).hidden=!over;form.elements.creditReason.required=over;form.elements.paidNow.max=(total/100).toFixed(2);
}
async function syncPending() {
  if(syncing||!state||!owner()||!navigator.onLine)return;
  syncing=true;
  try {
    const fresh=await request('/state');
    if(String(fresh.user.user_id)!==String(state.user.user_id)||String(fresh.user.shop_id)!==String(state.user.shop_id))throw new Error('Sign in with the account that saved these offline entries.');
    const rows=await queued(state.user);
    for(const row of rows){const entry=await decrypt(row);await request(entry.path,{method:'POST',body:entry.payload});await remove(row.id);}
    if(rows.length){await loadState();toast('Saved offline entries are synced.');}
    status('');
  }catch(error){status(`Sync paused: ${error.message}`);}finally{syncing=false;}
}
async function financial(path,payload) {
  await enqueue(state.user,path,payload);
  if(navigator.onLine){
    try {const result=await request(path,{method:'POST',body:payload});await remove(payload.clientKey);return result;}
    catch(error){if(error.status&&error.status<500&&error.status!==401){await remove(payload.clientKey);throw error;}}
  }
  status('Saved on this device, awaiting sync. Balances update after confirmation by the server.');
  return {queued:true};
}
function values(form) {return Object.fromEntries(new FormData(form));}
function profilePayload(changes) {
  const s=state.shop;
  return {ownerName:s.owner_name,shopName:s.shop_name,address:s.address,bankName:s.bank_name,bankAccount:s.bank_account,easypaisaAccount:s.easypaisa_account,jazzcashAccount:s.jazzcash_account,...changes};
}
function showInvitation(result) {
  showRecord('Customer invitation',`<p class="setup-note">${escape(result.message)}</p><p class="summary-note">This invitation expires after seven days. Only the invited phone can accept it.</p><label class="field"><span>Secure invitation</span><input readonly value="${escape(new URL(result.invitePath,location.origin).href)}"></label>`);
}
async function submitAuth(form,data) {
  const mode=form.dataset.authMode;
  await request(`/auth/${mode}`,{method:'POST',body:{...data,accountRole:role,invite:inviteToken,accept:data.accept==='on'}});
  const account=await request('/state');
  location.assign(`/${account.user.role==='staff'?'shopkeeper':account.user.role}/dashboard.html`);
}
async function submitForm(form) {
  const kind=form.dataset.form,data=values(form);
  if(kind==='auth')return submitAuth(form,data);
  requireAccount();
  let result;
  if(kind==='staff'){
    data.permissions=$$('[name="permissions"]:checked',form).map(input=>input.value);
    if(!data.permissions.length)throw new Error('Choose at least one staff permission.');
    result=await request('/staff',{method:'POST',body:data});
    form.reset();form.closest('dialog')?.close();staffRows=(await request('/staff')).staff;renderTables();toast(result.message);return;
  }
  if(kind==='staff-edit'){
    data.permissions=$$('[name="permissions"]:checked',form).map(input=>input.value);
    if(!data.permissions.length)throw new Error('Choose at least one staff permission.');
    result=await request(`/staff/${form.dataset.id}`,{method:'PATCH',body:data});
    form.closest('dialog')?.close();staffRows=(await request('/staff')).staff;renderTables();toast(result.message);return;
  }
  if(kind==='correction'){
    result=await request(`/bills/${data.billId}/corrections`,{method:'POST',body:{type:data.type,billItemId:data.billItemId,quantity:data.quantity,reason:data.reason,clientKey:form.dataset.key||=crypto.randomUUID()}});
    form.closest('dialog')?.close();form.reset();form.dataset.key=crypto.randomUUID();await loadState();
    if(page==='customer-ledger')await loadLedger();
    toast(`Correction recorded. ${money(result.amount)} credited to the account.`);return;
  }
  if(kind==='report'){await loadReport(form,data);return;}
  if(kind==='unavailable')throw new Error(`${form.dataset.service||'This service'} is not connected yet. Your entry has not been saved.`);
  if($('input[type="file"]',form)?.files.length)throw new Error('Image uploads are not connected yet. Remove the selected image to save the other details.');
  if(kind==='customer')result=await request('/customers',{method:'POST',body:data});
  if(kind==='customer-edit')result=await request(`/customers/${form.dataset.id}`,{method:'PATCH',body:data});
  if(kind==='item')result=await request('/items',{method:'POST',body:data});
  if(kind==='item-edit')result=await request(`/items/${form.dataset.id}`,{method:'PATCH',body:{...data,active:data.active==='on'}});
  if(kind==='profile'||kind==='accounts')result=await request('/shop',{method:'PATCH',body:profilePayload(data)});
  if(kind==='bill'){
    const items=$$('.bill-line',form).map(row=>({itemId:$('[name="itemId"]',row).value,quantity:$('[name="quantity"]',row).value,price:$('[name="price"]',row).value}));
    if(!items.length)throw new Error('Add at least one item.');
    result=await financial('/bills',{...data,items,clientKey:form.dataset.key||=crypto.randomUUID()});
  }
  if(kind==='cash')result=await financial('/payments/cash',{...data,clientKey:form.dataset.key||=crypto.randomUUID()});
  if(result?.queued){toast('Saved on this device. Reconnect to sync.');form.dataset.key=crypto.randomUUID();if(kind==='bill'){form.reset();populateOptions();updateBill();}else{form.reset();form.closest('dialog')?.close();}return;}
  form.closest('dialog')?.close();
  if(['cash','customer','item'].includes(kind)){form.reset();form.dataset.key=crypto.randomUUID();}
  await loadState();
  if(kind==='customer'||result?.invitePath)showInvitation(result);
  else if(kind==='bill'){form.reset();form.dataset.key=crypto.randomUUID();populateOptions();updateBill();toast(`${result.billNo} saved.`);}
  else if(kind==='cash')await viewPayment(result.paymentId);
  else toast(result?.message||'Saved successfully.');
}

document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;
  event.preventDefault();const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
  try{await submitForm(form);}catch(error){feedback(form,error.message);}finally{if(submit?.isConnected)submit.disabled=false;}
});
function editCustomer(id) {
  const row=state.customers.find(row=>String(row.customer_id)===id);if(!row)return;
  showRecord('Edit customer',`<form method="post" action="#" data-form="customer-edit" data-id="${id}"><div class="form-error" data-feedback role="status" hidden></div><label class="field"><span>Name</span><input name="name" value="${escape(row.name)}" required maxlength="120"></label><label class="field"><span>Phone number</span><input name="phone" type="tel" value="${escape(row.phone)}" required ${row.consent_status==='accepted'?'readonly':''}></label><label class="field"><span>Address</span><input name="address" value="${escape(row.address)}" maxlength="500"></label><label class="field"><span>Opening balance (Rs.)</span><input name="openingBalance" type="number" min="0" step="0.01" value="${escape(row.opening_balance)}" required ${row.consent_status==='accepted'?'readonly':''}></label><label class="field"><span>Credit limit (Rs.)</span><input name="creditLimit" type="number" min="0" step="0.01" value="${escape(row.credit_limit)}" required></label><label class="field"><span>Status</span><select name="status"><option value="active" ${row.status==='active'?'selected':''}>Active</option><option value="inactive" ${row.status==='inactive'?'selected':''}>Inactive</option></select></label><p class="summary-note">${row.consent_status==='accepted'?'Phone and opening balance are locked after consent to preserve the verified account and ledger history.':'Changing the invited phone creates a new invitation and invalidates the old link.'}</p><div class="form-actions">${row.consent_status==='invited'?`<button type="button" class="button secondary" data-page-action="renew-invite" data-id="${id}">Create new invitation</button>`:''}<button class="button" type="submit">Save customer</button></div></form>`);
}
function editItem(id) {
  const row=state.items.find(row=>String(row.item_id)===id);if(!row)return;
  const bottle=row.pricing_mode==='bottle';
  showRecord('Edit catalogue item',`<form method="post" action="#" data-form="item-edit" data-id="${id}"><div class="form-error" data-feedback role="status" hidden></div><label class="field"><span>Name</span><input name="name" value="${escape(row.name)}" required maxlength="160"></label><label class="field"><span>Unit</span><select name="unit">${(bottle?[['liter','Liter (L)']]:itemUnits).map(([unit,label])=>`<option value="${unit}" ${unit===row.unit?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>${bottle?'Original final price per bottle':'Default price'} (Rs.)</span><input name="price" type="number" min="0" step="0.01" value="${escape(row.default_price)}" required></label>${bottle?`<p class="summary-note">Bottle size: ${escape(formatQuantity(row.package_size,'liter'))}. This price is used directly; no per-liter amount is added.</p>`:''}<label class="check-field"><input type="checkbox" name="active" ${row.active?'checked':''}><span>Available for new bills</span></label><div class="form-actions"><button class="button" type="submit">Save item</button></div></form>`);
}
function editStaff(id) {
  const row=staffRows.find(person=>String(person.userId)===id);if(!row)return;
  showRecord('Manage staff access',`<form method="post" action="#" data-form="staff-edit" data-id="${id}"><div class="form-error" data-feedback role="status" hidden></div><p class="summary-note"><strong>${escape(row.name)}</strong><br>${escape(row.phone)}</p><fieldset class="permission-grid"><legend>Allowed actions</legend>${Object.entries(staffPermissionLabels).map(([value,label])=>`<label class="check-field"><input type="checkbox" name="permissions" value="${value}" ${row.permissions.includes(value)?'checked':''}><span>${label}</span></label>`).join('')}</fieldset><label class="field section-gap"><span>Account status</span><select name="status"><option value="active" ${row.status==='active'?'selected':''}>Active</option><option value="inactive" ${row.status==='inactive'?'selected':''}>Inactive</option></select></label><div class="form-actions"><button class="button" type="submit">Save access</button></div></form>`);
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-page-action]');if(!target)return;
  event.preventDefault();
  try {
    switch(target.dataset.pageAction){
      case 'menu':$('.sidebar').classList.add('open');$('.mobile-overlay').classList.add('show');target.setAttribute('aria-expanded','true');break;
      case 'close-menu':$('.sidebar').classList.remove('open');$('.mobile-overlay').classList.remove('show');$('[data-page-action="menu"]').setAttribute('aria-expanded','false');break;
      case 'open-dialog':if(target.dataset.dialog==='correction-dialog'){populateCorrectionBills();toggleCorrectionType();}document.getElementById(target.dataset.dialog).showModal();break;
      case 'close-dialog':target.closest('dialog').close();break;
      case 'unavailable':toast(`${target.dataset.service||'This service'} is not connected yet.`);break;
      case 'toggle-password':{
        const input=target.closest('.password-control').querySelector('input'),show=input.type==='password';input.type=show?'text':'password';target.setAttribute('aria-label',`${show?'Hide':'Show'} ${input.name==='pin'?'PIN':'password'}`);break;
      }
      case 'copy-account':requireAccount();if(!state.shop[target.dataset.account])throw new Error('The shopkeeper has not added this account.');await navigator.clipboard.writeText(state.shop[target.dataset.account]);toast('Account details copied.');break;
      case 'add-line':$('[data-bill-lines]').append($('#bill-line-template').content.cloneNode(true));if(state)populateOptions();updateBill();break;
      case 'remove-line':if($$('.bill-line').length===1)throw new Error('Keep at least one bill item.');target.closest('.bill-line').remove();updateBill();break;
      case 'view-bill':await viewBill(target.dataset.id);break;
      case 'correct-bill':await prepareCorrection(target.dataset.id);break;
      case 'item-ok':await request(`/bill-items/${target.dataset.id}/ok`,{method:'POST',body:{}});await viewBill(target.dataset.bill);break;
      case 'item-dispute':$('#record-dialog').close();$('#dispute-dialog').showModal();$('#dispute-dialog [name="billReference"]').value=target.dataset.reference;$('#dispute-dialog [name="itemReference"]').value=target.dataset.item;break;
      case 'edit-customer':editCustomer(target.dataset.id);break;
      case 'edit-item':editItem(target.dataset.id);break;
      case 'edit-staff':editStaff(target.dataset.id);break;
      case 'renew-invite':showInvitation(await request(`/customers/${target.dataset.id}/invite`,{method:'POST',body:{}}));break;
      case 'ledger-older':if(ledgerMore){ledgerOffset+=100;await loadLedger();}break;
      case 'ledger-newer':ledgerOffset=Math.max(0,ledgerOffset-100);await loadLedger();break;
      case 'items-older':await changeItemsPage(true);break;
      case 'items-newer':await changeItemsPage(false);break;
      case 'items-view':await changeItemsView(target.dataset.view);break;
      case 'refresh-items':await loadState();break;
      case 'audit-older':if(auditMore){auditHistory.push(auditBefore);auditBefore=auditLast;await loadAudit();}break;
      case 'audit-newer':if(auditHistory.length){auditBefore=auditHistory.pop();await loadAudit();}break;
      case 'payment-detail':await viewPayment(target.dataset.id);break;
      case 'print-record':document.body.classList.add('printing-record');window.print();break;
      case 'print':window.print();break;
      case 'chat-contact':$$('.chat-contact').forEach(button=>button.classList.toggle('active',button===target));$('[data-chat-title]').textContent=target.dataset.name;break;
      case 'install':if(installPrompt){await installPrompt.prompt();installPrompt=null;}else toast('Use your browser’s Install app or Add to Home Screen option.');break;
      case 'sign-out':if(state){if((await queued(state.user)).length)throw new Error('Reconnect and sync your pending entries before signing out.');await request('/auth/logout',{method:'POST',body:{}});}location.assign(`/${role}/login.html`);break;
    }
  }catch(error){toast(error.message);}
});
document.addEventListener('input',event=>{
  if(event.target.matches('[data-search]')){
    const term=event.target.value.toLowerCase(),scope=event.target.closest('.panel')||document;
    $$('tbody tr,.chat-contact',scope).forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(term);});
  }
  if(event.target.closest('[data-form="bill"]'))updateBill();
});
document.addEventListener('change',event=>{
  if(event.target.matches('[data-correction-bills]'))loadCorrectionItems(event.target.value).catch(error=>toast(error.message));
  if(event.target.matches('[data-correction-type]'))toggleCorrectionType();
  if(event.target.matches('[data-correction-items]')){
    const option=event.target.selectedOptions[0],quantity=event.target.form.elements.quantity;
    quantity.max=option?.dataset.remaining||'';quantity.step=option?.dataset.unit==='piece'?'1':'0.001';
  }
  if(event.target.matches('[data-items]')&&state){
    const item=state.items.find(row=>String(row.item_id)===event.target.value),line=event.target.closest('.bill-line');
    $('[name="price"]',line).value=item?.default_price||'';$('[name="quantity"]',line).step=item?.unit==='piece'?'1':'0.001';$('[name="quantity"]',line).min=item?.unit==='piece'?'1':'0.001';updateBill();
  }
  if(event.target.name==='ledgerCustomer'){ledgerOffset=0;loadLedger().catch(error=>toast(error.message));}
  if(event.target.matches('[data-image-input]')){
    const preview=$('[data-image-preview]',event.target.closest('form')),file=event.target.files[0];
    preview.hidden=true;preview.removeAttribute('src');
    if(file){
      // Data URLs are permitted by the existing CSP; blob URLs are deliberately not.
      const reader=new FileReader();
      reader.onload=()=>{preview.src=reader.result;preview.hidden=false;};
      reader.onerror=()=>toast('This image could not be previewed. Choose another file.');
      reader.readAsDataURL(file);
    }
  }
  if(event.target.matches('[data-language]')&&event.target.value==='ur'){event.target.value='en';toast('The Urdu translation is not connected yet.');}
});
document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-filter]');if(!tab)return;
  $$('[data-filter]').forEach(button=>{button.classList.toggle('active',button===tab);button.setAttribute('aria-pressed',String(button===tab));});
  $$('[data-payment-status]').forEach(row=>{row.hidden=tab.dataset.filter!=='all'&&row.dataset.paymentStatus!==tab.dataset.filter;});
});
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-record'));
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
window.addEventListener('online',()=>{updateConnection();if(state)syncPending();else if(!['login','register','consent'].includes(page))initialize();});
window.addEventListener('offline',()=>{updateConnection();if(state)status('Offline. Bills and cash payments can be saved in this open page and synced when you reconnect.');});
function updateConnection(){const target=$('[data-connection]');if(target){target.textContent=navigator.onLine?'Connected':'Offline';target.classList.toggle('offline',!navigator.onLine);}}
async function initialize() {
  $$('[data-today]').forEach(input=>{input.defaultValue=today();input.value=today();input.max=today();});
  $$('[data-current-month]').forEach(input=>{input.value=today().slice(0,7);});
  if($('[data-current-date]'))$('[data-current-date]').textContent=dateLabel(today());
  updateConnection();
  if(['login','register','consent'].includes(page)){
    if(page==='consent'&&inviteToken){try{const invite=await request(`/auth/invite?token=${encodeURIComponent(inviteToken)}`);$('[data-invite-info]').textContent=`${invite.shopName} invited you. Confirm the phone ending ${invite.phoneHint.slice(-4)}.`;}catch(error){feedback($('form'),error.message);}}
    return;
  }
  try {await loadState();await syncPending();}catch(error){state=null;if(error.status===401){location.replace(`/${role==='customer'?'customer':'shopkeeper'}/login.html`);return;}status(error.message,true);}
}
let customerRefreshing=false,lastCustomerRefresh=0;
async function refreshCustomerRecords(){
  if(!state || role!=='customer' || !['dashboard','my-bills','item-catalogue'].includes(page) || customerRefreshing || itemsLoading || !navigator.onLine || document.visibilityState!=='visible' || $('dialog[open]') || Date.now()-lastCustomerRefresh<5000)return;
  customerRefreshing=true;lastCustomerRefresh=Date.now();
  try{await loadState();}catch{/* Keep the last confirmed records visible during a connection failure. */}finally{customerRefreshing=false;}
}
window.addEventListener('focus',refreshCustomerRecords);
document.addEventListener('visibilitychange',refreshCustomerRecords);
setInterval(refreshCustomerRecords,5000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});
setInterval(()=>{if(state&&owner())syncPending();},30000);
initialize();
