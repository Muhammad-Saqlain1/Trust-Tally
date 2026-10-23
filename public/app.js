import { enqueue, queued, decrypt, remove } from './offline.js';
import { itemUnits, unitSymbol, formatQuantity, formatItemQuantity, catalogueUnit, priceUnit } from './units.js';
import { billItemSummary, purchasedItemRows, purchasedItemHeadings } from './item-display.js';
import {khataWorkspace,mountKhata,monthlyBillList,loadMonthlyBillList} from './khata.js';

const $ = (selector,root=document) => root.querySelector(selector);
const $$ = (selector,root=document) => [...root.querySelectorAll(selector)];
const app=$('#app'), dialog=$('#dialog');
const escape = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths={
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', book:'<path d="M4 4h12a4 4 0 0 1 4 4v13H7a3 3 0 0 1-3-3V4Zm4 0v17m4-12h4m-4 4h4"/>',
  bill:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/>', wallet:'<path d="M20 8V5H5a3 3 0 0 0 0 6h16v9H5a3 3 0 0 1-3-3V8m14 6h5"/><circle cx="16" cy="15.5" r=".5"/>',
  box:'<path d="m12 3 9 5-9 5-9-5 9-5Zm9 5v10l-9 5-9-5V8m9 5v10M7.5 5.5l9 5"/>', shield:'<path d="M12 3 3 7v6c0 4 5 7 9 9 4-2 9-5 9-9V7l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', down:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  store:'<path d="M3 9 5 3h14l2 6M3 9v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9H3Zm2 6v6h14v-6m-9 6v-5h4v5"/>',
  logout:'<path d="M9 4H4v16h5m5-12 4 4-4 4m-5-4h13"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', check:'<path d="m5 12 4 4L19 6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sync:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  phone:'<path d="m7 3 3 5-2 2a15 15 0 0 0 6 6l2-2 5 3-1 4C10 22 2 14 3 4l4-1Z"/>', edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>', copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>'
};
const icon=(name,extra='')=>`<svg class="icon ${extra}" aria-hidden="true" viewBox="0 0 24 24">${paths[name]||paths.book}</svg>`;
const brand=()=>'<a class="brand" href="#/dashboard"><img src="/assets/icon.svg" alt=""><span>Trust-Tally<small>Your digital khata</small></span></a>';
const rupees=value=>new Intl.NumberFormat('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));
const amount=value=>`Rs. ${rupees(value)}`;
const day=value=>value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(new Date(String(value).length===10?`${value}T12:00:00+05:00`:String(value).replace(' ','T')+(String(value).endsWith('Z')?'':'Z'))):'—';
const businessDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');};
const cents=value=>{const match=/^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(String(value));return match?(match[1]?-1:1)*(Number(match[2])*100+Number((match[3]||'').padEnd(2,'0'))):0;};
const badge=status=>{const labels={active:'Active',inactive:'Inactive',accepted:'Accepted',invited:'Awaiting consent',approved:'Approved',pending:'Pending',ok:'OK',disputed:'Disputed',cancelled:'Cancelled',rejected:'Rejected',verified:'Verified'};return `<span class="badge ${['pending','invited','disputed','rejected'].includes(status)?'outline':''}">${icon(['ok','accepted','approved','active'].includes(status)?'check':'clock')}${labels[status]||escape(status)}</span>`;};
const field=(name,label,options={})=>`<label class="field ${options.className||''}"><span>${label}</span><input name="${name}" type="${options.type||'text'}" value="${escape(options.value)}" ${options.required===false?'':'required'} ${options.attrs||''} placeholder="${escape(options.placeholder||'')}">${options.help?`<small>${options.help}</small>`:''}</label>`;
const button=(label,action,iconName='plus',secondary=false)=>`<button type="button" class="button ${secondary?'secondary':''}" data-action="${action}">${icon(iconName)}${label}</button>`;
const empty=(title,description,iconName='book',label='',action='')=>`<div class="empty"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${description}</p>${label?button(label,action):''}</div>`;
let state=null,health=null,currentPage='dashboard',authMode='login',invite=null;
let syncBusy=false,syncMessage='',pendingCount=0,installPrompt=null,toastTimer=null,viewVersion=0;
const invitation=new URLSearchParams(location.search).get('invite');
if(invitation){authMode='consent';history.replaceState(null,'',location.pathname+location.hash);}

async function request(path,{method='GET',body,timeout=15000}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Requested-With':'TrustTally'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'Unable to complete your request.');error.status=response.status;throw error;}
    return data;
  }catch(error){if(!error.status)error.message='Connection unavailable. Check your internet connection and try again.';throw error;}finally{clearTimeout(timer);}
}
function toast(message){const element=$('#toast');element.textContent=message;element.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{element.hidden=true;},6500);}
function formError(form,message){const target=$('[data-form-error]',form);if(target){target.textContent=message;target.hidden=false;target.scrollIntoView({block:'nearest'});}else toast(message);}
function formValues(form){return Object.fromEntries(new FormData(form));}
function showDialog(title,body){dialog.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;if(!dialog.open)dialog.showModal();}
function showInvitation(result){
  const link=new URL(result.invitePath,location.origin).href;
  showDialog('Customer saved. Consent is next.',`<p class="setup-note">${escape(result.message)} This link expires after seven days.</p><p class="summary-note">Only the invited phone number can verify and accept this account.</p>${field('inviteLink','Secure invitation link',{value:link,attrs:'readonly',required:false})}<div class="form-actions">${button('Copy invitation link','copy','copy')}</div>`);
  $('[data-action="copy"]',dialog).dataset.value=link;
}
function showAuth(){
  state=null;
  const registering=authMode==='register',accepting=authMode==='consent';
  const content=authMode==='login'?['Good to have you back.','Sign in with your registered phone number and PIN.']:registering?['A fresh start for your khata.','Create your shop account and choose a secure PIN.']:['Your khata, made clear.',invite?`${escape(invite.shopName)} has invited you to view your account.`:'Open the private invitation supplied by your shopkeeper.'];
  let inputs='';
  if(authMode==='login')inputs+='<label class="field"><span>Account type</span><select name="accountRole" required><option value="shopkeeper">Shopkeeper / Staff</option><option value="customer">Customer</option></select></label>';
  if(registering)inputs+=field('ownerName','Your name',{placeholder:'Full name',attrs:'autocomplete="name" maxlength="120"'})+field('shopName','Shop name',{placeholder:'Your general store',attrs:'autocomplete="organization" maxlength="160"'});
  inputs+=field('phone','Phone number',{type:'tel',placeholder:accepting&&invite?`Invited number ending ${escape(invite.phoneHint.slice(-4))}`:'0300 1234567',attrs:'autocomplete="tel" inputmode="tel"'});
  inputs+=field('pin',authMode==='login'?'Six-digit PIN':'Set a six-digit PIN',{type:'password',placeholder:authMode==='login'?'Enter your PIN':'Choose a PIN',attrs:`autocomplete="${authMode==='login'?'current-password':'new-password'}" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6"`});
  if(accepting)inputs+='<label class="check-field"><input type="checkbox" name="accept" required><span>I accept this shop’s invitation to maintain my customer account and show my bills and payments.</span></label>';
  app.innerHTML=`<div class="auth-layout"><aside class="auth-story">${brand()}<div class="story-copy"><div class="story-tag">Built on trust. Kept in tally.</div><h1>Every account.<br>Every rupee.<br>All in one place.</h1><p>From the first bill to the last payment, keep a clear khata for your shop and your customers.</p></div><div class="ledger-art" aria-hidden="true"><div class="art-book"><div class="art-top"><span>THE EVERYDAY KHATA</span><span>Rs.</span></div><div class="art-lines"><div class="art-line"></div><div class="art-line"></div><div class="art-line"></div></div></div><div class="art-stamp">${icon('shield')}A record you can trust</div></div><div class="story-footer">${icon('shield')}Private accounts. Clear records. Lasting trust.</div></aside><section class="auth-panel">${brand()}<main id="main" class="auth-form-wrap"><div class="eyebrow">${authMode==='login'?'Your shop starts here':'Welcome to Trust-Tally'}</div><h2>${content[0]}</h2><p class="auth-intro muted">${content[1]}</p>${health?.database!=='connected'?'<div class="setup-note">The application is ready for setup. Connect MySQL and apply the schema before signing in.</div>':''}<form id="auth-form"><div class="form-error" data-form-error role="alert" hidden></div>${inputs}<button class="button full" type="submit">${authMode==='login'?'Sign in':registering?'Create my shop':'Accept invitation'}${icon('arrow')}</button></form><div class="auth-inline">${authMode==='login'?'<button class="link-button" data-action="auth-register">Create a shop account</button>':'<button class="link-button" data-action="auth-login">Back to sign in</button>'}</div><p class="auth-footer muted">Your account is private. Customers see their own khata.<br>Shop records stay with the shopkeeper.</p><div class="auth-inline"><a class="link-button" href="/shopkeeper/login.html">Shopkeeper login</a><a class="link-button" href="/customer/login.html">Customer login</a></div></main></section></div>`;
}const ownerNavigation=[['dashboard','Dashboard','dashboard'],['customers','Customers','users'],['new-bill','New Bill','plus'],['bills','Bills','bill'],['payments','Payments and Approvals','wallet'],['daily-report','Daily Report','book'],['monthly-reports','Monthly Reports','book'],['expenses','Expenses','wallet'],['suppliers','Suppliers','box'],['catalogue','Item Catalogue','box'],['chat','Chat','book'],['staff','Staff','users']];
const customerNavigation=[['dashboard','Dashboard','dashboard'],['bills','My Bills','bill'],['item-catalogue','Item Catalogue','box'],['pay','Pay','wallet'],['payments','My Payments','wallet'],['monthly-statements','Monthly Statements','book'],['daily-report','Daily Report','book'],['monthly-report','Monthly Report','book'],['chat','Chat','book'],['contact','Shopkeeper Contact','phone']];
const pagePaths={catalogue:'item-catalogue',accounts:'account-details',audit:'audit-log'};
function htmlPage(id){const slug=isOwner()?(pagePaths[id]||id):({bills:'my-bills',payments:'my-payments',contact:'shopkeeper-contact'}[id]||id);return `/${isOwner()?'shopkeeper':'customer'}/${slug}.html`;}
const titles={dashboard:'Dashboard',customers:'Customers','new-bill':'New Bill',bills:'Bills',payments:'Cash Payments',catalogue:'Item Catalogue','item-catalogue':'Item Catalogue',audit:'Audit Log',profile:'Profile and Settings',accounts:'Account Details',contact:'Shopkeeper Contact'};
function isOwner(){return state?.user.role==='shopkeeper';}
function render(){
  if(!state)return showAuth();
  const khataCustomer=$('.khata-workspace [name="customer"]')?.value||'';
  const requestedRoute=location.hash.replace('#/','').split('?')[0]||'dashboard';
  const route=!isOwner()&&requestedRoute==='catalogue'?'item-catalogue':requestedRoute,allowed=isOwner()?[...ownerNavigation.map(row=>row[0]),'audit','profile','accounts']:[...customerNavigation.map(row=>row[0]),'profile'];
  currentPage=allowed.includes(route)?route:'dashboard';viewVersion++;
  const title=(!isOwner()&&currentPage==='bills')?'My Bills':(!isOwner()&&currentPage==='payments')?'My Payments':titles[currentPage];
  const nav=rows=>rows.map(([id,label,name])=>`<a href="${htmlPage(id)}" ${currentPage===id?'class="active" aria-current="page"':''}>${icon(name)}${label}</a>`).join('');
  const initials=state.user.name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase();
  document.title=`${title} · Trust-Tally`;
  app.innerHTML=`<div class="app-layout"><aside class="sidebar" aria-label="Main navigation">${brand()}<div class="shop-switcher">${icon('store')}<div><strong>${escape(state.shop.shop_name)}</strong><small>${isOwner()?'Shopkeeper workspace':'My customer account'}</small></div></div><p class="nav-label">YOUR KHATA</p><nav class="nav">${nav(isOwner()?ownerNavigation:customerNavigation)}</nav><div class="sidebar-bottom"><nav class="nav">${isOwner()?nav([['accounts','Account Details','wallet'],['audit','Audit Log','shield']]):''}${nav([['profile',isOwner()?'Profile and Settings':'My Profile','user']])}<a href="#" data-action="logout">${icon('logout')}Sign out</a></nav><div class="sidebar-foot">Made for everyday trust</div></div></aside><div class="mobile-overlay" data-action="close-menu"></div><div class="workspace"><header class="topbar"><button class="icon-button menu-button" data-action="menu" aria-label="Open navigation" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb"><span class="muted">My workspace</span><span class="separator">/</span><strong>${title}</strong></div><div class="topbar-right"><span class="connection ${navigator.onLine?'':'offline'}">${navigator.onLine?'Connected':'Offline'}</span><span class="topbar-date">${day(state.businessDate)}</span><button class="avatar" data-action="open-profile" aria-label="Open your profile">${escape(initials)}</button></div></header><div id="sync-banner" class="sync-banner" role="status" hidden></div><main id="main" class="page" tabindex="-1">${pageContent()}</main></div></div>`;
  updateSyncBanner();
  const khataInput=$('.khata-workspace [name="customer"]');if(khataInput)khataInput.value=khataCustomer;
  mountKhata({state,request,onSaved:async saved=>{await refresh();toast(saved.message||'Item added to the customer’s khata.');},showRecord:showDialog,saveFinancial});
  if(currentPage==='bills')loadMonthlyBillList(request,showDialog);
  if(currentPage==='audit')loadAudit();
  if(currentPage==='new-bill')updateBill();
  if(currentPage==='item-catalogue'&&!isOwner())loadPurchasedCatalogue().catch(()=>{});
}
let purchasedView='new',purchasedBefore=null,purchasedLast=null,purchasedMore=false,purchasedHistory=[],purchasedLoading=false,purchasedRequest=0;
function customerCataloguePage(){
  return heading('Item Catalogue','Items taken on your khata, with the exact quantity recorded on each bill.',button('Refresh','refresh-items','sync',true))+
    `<section class="panel"><div class="panel-header"><div><h2>My items</h2><p>${purchasedView==='new'?"Current month's bill items":'Items from previous bills'}</p></div><div class="view-switch" aria-label="Choose bill items"><button class="button small ${purchasedView==='new'?'':'secondary'}" type="button" data-action="items-view" data-view="new" aria-pressed="${purchasedView==='new'}">New</button><button class="button small ${purchasedView==='old'?'':'secondary'}" type="button" data-action="items-view" data-view="old" aria-pressed="${purchasedView==='old'}">Old</button></div></div><div class="table-wrap"><table class="purchased-items"><thead><tr>${purchasedItemHeadings.map(label=>`<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody id="purchased-items"><tr><td colspan="9"><div class="empty" role="status">Loading your items…</div></td></tr></tbody></table></div><div class="panel-body pager"><button class="button secondary small" type="button" data-action="items-newer" disabled>Newer items</button><span data-items-page aria-live="polite">Page 1</span><button class="button secondary small" type="button" data-action="items-older" disabled>Older items</button></div></section>`;
}
async function loadPurchasedCatalogue(){
  const version=viewVersion,requestId=++purchasedRequest;purchasedLoading=true;
  try{
    const query=new URLSearchParams({view:purchasedView});if(purchasedBefore)query.set('before',purchasedBefore);
    const result=await request(`/items/purchased?${query}`);
    if(version!==viewVersion||requestId!==purchasedRequest)return;
    const target=$('#purchased-items');if(!target)return;
    target.innerHTML=result.items.length?purchasedItemRows(result.items,{dateLabel:day,money:amount,badge,actionAttribute:'data-action'}):`<tr><td colspan="9">${empty(purchasedView==='new'?'No new items yet.':'No old items yet.',purchasedView==='new'?"This month's items will appear here.":'Items from previous months will appear here.','box')}</td></tr>`;
    purchasedMore=result.hasMore;purchasedLast=result.items.at(-1)?.bill_item_id;
    $('[data-action="items-newer"]').disabled=!purchasedHistory.length;
    $('[data-action="items-older"]').disabled=!purchasedMore;
    $('[data-items-page]').textContent=`Page ${purchasedHistory.length+1}`;
  }catch(error){
    if(version===viewVersion&&requestId===purchasedRequest&&$('#purchased-items'))$('#purchased-items').innerHTML=`<tr><td colspan="9">${empty('Items could not be loaded',escape(error.message),'info','Try again','refresh-items')}</td></tr>`;
    throw error;
  }finally{if(requestId===purchasedRequest)purchasedLoading=false;}
}
async function changePurchasedPage(older){
  if(purchasedLoading||(older?!purchasedMore:!purchasedHistory.length))return;
  const before=purchasedBefore,history=[...purchasedHistory];
  if(older){purchasedHistory.push(purchasedBefore);purchasedBefore=purchasedLast;}else purchasedBefore=purchasedHistory.pop();
  try{await loadPurchasedCatalogue();}catch(error){purchasedBefore=before;purchasedHistory=history;throw error;}
}
function heading(title,description,actions='',eyebrow='YOUR EVERYDAY ACCOUNTS'){return `<div class="page-heading"><div><div class="eyebrow muted">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;}
function stat(label,value,description,name,currency=true){if(label==='Total remaining'&&Number(value)<0){label='Credit on account';value=-Number(value);description='This credit carries forward to future bills.';}return `<article class="stat"><div class="stat-header"><span>${label}</span><span class="stat-icon">${icon(name)}</span></div><div class="stat-value">${currency?`<small>Rs.</small> ${rupees(value)}`:escape(value)}</div><div class="stat-foot">${description}</div></article>`;}
function dashboard(){
  if(!isOwner())return customerDashboard();
  const total=state.customers.reduce((sum,row)=>sum+Math.max(0,Number(row.balance)),0),accepted=state.customers.filter(row=>row.consent_status==='accepted').length;
  return heading('A clear view of your shop.','Your daily business, accounted for.',button('Receive cash','receive-payment','wallet',true)+button('New bill','new-bill'))+`<section class="welcome-banner"><div><div class="eyebrow">${escape(state.shop.shop_name)}</div><h2>Good business begins with a clear khata.</h2><p>Record what goes out, keep track of what comes in, and give every customer a clear account.</p></div><a class="button" href="#/customers">Your customers ${icon('arrow')}</a></section><section class="stats" aria-label="Shop totals">${stat('Today’s sales',state.totals.sales,'Total billed today','bill')}${stat('Cash received today',state.totals.cash,'Confirmed cash payments','wallet')}${stat('Total outstanding',total,'Opening balances + bills − payments − returns','book')}${stat('Customers',`${state.customers.length} / 500`,`${accepted} accepted · ${state.customers.length-accepted} awaiting consent`,'users',false)}</section><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Recent bills</h2><p>The latest entries in your shop’s khata</p></div><a href="#/bills">View bills ${icon('arrow')}</a></div>${billsTable(state.bills.slice(0,5),true)}</section><aside class="dashboard-aside"><section class="panel"><div class="panel-header"><h2>At the counter</h2></div><div class="panel-body"><a class="quick-link" href="#/new-bill"><span class="stat-icon">${icon('plus')}</span><span>Create a bill<small>Add items. Keep a clear record.</small></span>${icon('arrow')}</a><a class="quick-link" href="#" data-action="receive-payment"><span class="stat-icon">${icon('wallet')}</span><span>Receive cash<small>Apply it to the oldest balance.</small></span>${icon('arrow')}</a><a class="quick-link" href="#/customers"><span class="stat-icon">${icon('users')}</span><span>Your customers<small>Every khata, in one place.</small></span>${icon('arrow')}</a></div></section><section class="capacity"><h3>Room for your regulars</h3><div class="capacity-count">${state.customers.length} <small>/ 500 customers</small></div><div class="capacity-track"><progress value="${state.customers.length}" max="500" aria-label="Customer capacity"></progress></div><p>Each customer gets a private account.<br>A little clarity goes a long way.</p></section></aside></div>`;
}
function customerDashboard(){
  const customer=state.customers[0];
  return heading(`Welcome, ${escape(state.user.name.split(' ')[0])}.`,`Your account with ${escape(state.shop.shop_name)}.`,button('View my ledger','my-ledger','book'))+`<section class="welcome-banner"><div><div class="eyebrow">YOUR PERSONAL KHATA</div><h2>Every bill. Every payment. All clear.</h2><p>Your latest balance and the records behind it, always in one place.</p></div><a class="button" href="#/bills">My bills ${icon('arrow')}</a></section><section class="stats">${stat('Total remaining',customer?.balance||0,'Confirmed payments are reflected here','book')}${stat('Previous month balance',state.totals.previous_balance,'Balance carried into this calendar month','bill')}${stat('This month’s bills',state.totals.month_bills,'All bills recorded this calendar month','bill')}${stat('Last payment',state.payments.find(row=>row.status==='approved')?.amount||0,'Latest confirmed payment','wallet')}</section><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>My recent bills</h2><p>Open a bill to check your items</p></div><a href="#/bills">View bills ${icon('arrow')}</a></div>${billsTable(state.bills.slice(0,5))}</section><section class="panel"><div class="panel-header"><h2>Account updates</h2></div><div class="panel-body">${state.notifications.length?state.notifications.map(row=>`<div class="activity-item">${escape(row.message)}<small>${day(row.sent_at)}</small></div>`).join(''):empty('You’re up to date','New bills and confirmed payments will appear here.','check')}</div></section></div>`;
}
function billsTable(rows,compact=false){
  if(!rows.length)return empty(isOwner()?'Your next bill starts here.':'No bills yet.',isOwner()?'Add your items and customers, then record your first sale.':'Bills from your shopkeeper will appear here.','bill',isOwner()?'Create a bill':'',isOwner()?'new-bill':'');
  return `<div class="table-wrap"><table><thead><tr><th>${isOwner()?'Customer':'Bill and items taken'}</th><th>Date</th><th class="right">Total</th>${compact?'':'<th class="right">Paid now</th>'}<th>Status</th><th><span class="muted">Details</span></th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escape(isOwner()?row.name:row.bill_no)}</strong><small>${escape(isOwner()?row.bill_no:'')}</small>${!isOwner()?billItemSummary(row.items):''}</td><td>${day(row.bill_date)}</td><td class="right"><strong>${amount(row.total)}</strong></td>${compact?'':`<td class="right">${amount(row.paid_now)}</td>`}<td>${badge(row.status==='cancelled'?'cancelled':Number(row.total)-Number(row.returned)<=Number(row.allocated)?'approved':'pending')}</td><td><button class="button secondary small" data-action="view-bill" data-id="${row.bill_id}">View</button></td></tr>`).join('')}</tbody></table></div>`;
}
function customersPage(){return heading('People behind every khata.','Manage your customers and their individual accounts.',button('Add customer','add-customer','users'))+`<section class="panel"><div class="toolbar"><label class="search">${icon('search')}<input id="customer-search" type="search" placeholder="Search name, phone or customer ID" aria-label="Search customers"></label><span class="table-count">${state.customers.length} of 500 customers</span></div><div id="customer-results">${customerTable(state.customers)}</div></section>`;}
function customerTable(rows){if(!rows.length)return empty('Your regulars belong here.','Add a customer and invite them to accept their private khata.','users','Add customer','add-customer');return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th class="right">Outstanding</th><th>Account</th><th>Details</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escape(row.name)}</strong><small>${escape(row.customer_code)}</small></td><td>${escape(row.phone)}</td><td class="right"><strong>${amount(row.balance)}</strong></td><td>${badge(row.status==='inactive'?'inactive':row.consent_status)}</td><td><button class="button secondary small" data-action="ledger" data-id="${row.customer_id}">Ledger</button> <button class="icon-button" data-action="edit-customer" data-id="${row.customer_id}" aria-label="Edit ${escape(row.name)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div>`;}
function customerForm(customer={}){
  const editing=Boolean(customer.customer_id);
  showDialog(editing?'Customer details':'Add a customer',`<form id="customer-form" data-id="${customer.customer_id||''}"><div class="form-error" data-form-error role="alert" hidden></div><div class="form-grid">${field('name','Full name',{value:customer.name,attrs:'maxlength="120" autocomplete="name"'})}${field('phone','Phone number',{type:'tel',value:customer.phone,placeholder:'0300 1234567',attrs:editing?'readonly':'autocomplete="tel"'})}${field('address','Address',{value:customer.address,required:false,className:'span-2',attrs:'maxlength="500"'})}${field('openingBalance','Opening balance (Rs.)',{type:'number',value:customer.opening_balance||'0',attrs:`min="0" max="999999999.99" step="0.01" ${editing?'readonly':''}`,help:editing?'Saved opening balances are preserved for financial integrity.':'Unpaid balance carried over from your paper khata.'})}${field('creditLimit','Credit limit (Rs.)',{type:'number',value:customer.credit_limit||'0',attrs:'min="0" max="999999999.99" step="0.01"',help:'Bills above this limit need your confirmation and a reason.'})}${editing?`<label class="field"><span>Account status</span><select name="status"><option value="active" ${customer.status==='active'?'selected':''}>Active</option><option value="inactive" ${customer.status==='inactive'?'selected':''}>Inactive</option></select></label>`:''}</div>${editing?'':'<p class="setup-note">The customer must accept an invitation before you can add bills or receive payments.</p>'}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit">${editing?'Save details':'Save customer'}</button></div></form>`);
  if(editing&&customer.consent_status==='invited'){
    $('[name="phone"]',dialog).readOnly=false;
    $('[name="openingBalance"]',dialog).readOnly=false;
    $('[name="openingBalance"]',dialog).closest('.field').querySelector('small').textContent='You can edit this balance until the customer accepts the invitation.';
  }
  if(editing&&customer.consent_status==='invited'&&customer.status==='active')$('.form-actions',dialog).insertAdjacentHTML('afterbegin',`<button type="button" class="button secondary" data-action="renew-invite" data-id="${customer.customer_id}">Create new invitation</button>`);
}
function cataloguePage(){return heading('Item Catalogue','Record the items given to a customer?s khata.',button('Add catalogue product','add-item','box',true))+khataWorkspace('entry')+`<section class="panel"><div class="panel-header"><h2>Saved catalogue products</h2></div><div id="item-results">${itemTable(state.items)}</div></section>`;}
function itemTable(rows){if(!rows.length)return empty('Stock your digital shelf.','Add the items you sell. Prices fill in automatically on every bill.','box','Add your first item','add-item');return `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Unit / size</th><th class="right">Original price</th><th>Status</th><th>Details</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escape(row.name)}</strong></td><td>${escape(catalogueUnit(row))}</td><td class="right">${amount(row.default_price)} / ${escape(priceUnit(row))}</td><td>${badge(row.active?'active':'inactive')}</td><td><button class="button secondary small" data-action="edit-item" data-id="${row.item_id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;}
function itemForm(item={}){const bottle=item.pricing_mode==='bottle';showDialog(item.item_id?'Edit catalogue item':'Add catalogue item',`<form id="item-form" data-id="${item.item_id||''}"><div class="form-error" data-form-error role="alert" hidden></div>${field('name','Item name',{value:item.name,placeholder:'For example, Basmati rice',attrs:'maxlength="160"'})}<div class="form-grid"><label class="field"><span>Unit</span><select name="unit">${(bottle?[['liter','Liter (L)']]:itemUnits).map(([unit,label])=>`<option value="${unit}" ${item.unit===unit?'selected':''}>${label}</option>`).join('')}</select></label>${field('price',bottle?'Original final price per bottle (Rs.)':'Price per unit (Rs.)',{type:'number',value:item.default_price,attrs:'min="0" max="999999999.99" step="0.01"'})}</div>${bottle?`<p class="summary-note">Bottle size: ${escape(formatQuantity(item.package_size,'liter'))}. This is the complete bottle price; no per-liter amount is added.</p>`:''}${item.item_id?`<label class="check-field"><input type="checkbox" name="active" ${item.active?'checked':''}><span>Available for new bills</span></label>`:''}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit">Save item</button></div></form>`);}
function customerOptions(){return '<option value="">Choose a customer</option>'+state.customers.filter(row=>row.status==='active'&&row.consent_status==='accepted').map(row=>`<option value="${row.customer_id}">${escape(row.name)} · ${escape(row.customer_code)}</option>`).join('');}
function billLine(){return `<div class="bill-line"><label class="field item-field"><span>Item</span><select name="itemId" required><option value="">Choose an item</option>${state.items.filter(row=>row.active).map(row=>`<option value="${row.item_id}">${escape(row.name)} · ${escape(unitSymbol(row.unit))}</option>`).join('')}</select></label><label class="field quantity-field"><span data-quantity-label>Quantity</span><input name="quantity" type="number" min="0.001" max="999999.999" step="0.001" value="1" required></label><label class="field price-field"><span data-price-label>Price (Rs.)</span><input name="price" type="number" min="0" max="999999999.99" step="0.01" required></label><div class="line-amount" data-line-total>Rs. 0.00</div><button type="button" class="icon-button remove-line" data-action="remove-line" aria-label="Remove item">${icon('close')}</button></div>`;}
function newBillPage(){return heading('New Bill','Choose a customer. Every item recorded this month is included automatically.')+khataWorkspace('monthly');}
function updateBill(){
  const form=$('#bill-form');if(!form)return;
  let total=0;
  for(const row of $$('.bill-line',form)){
    const item=state.items.find(item=>String(item.item_id)===$('[name="itemId"]',row).value);
    $('[data-quantity-label]',row).textContent=item?`Quantity (${unitSymbol(item.unit)})`:'Quantity';
    $('[data-price-label]',row).textContent=item?`Rs. per ${unitSymbol(item.unit)}`:'Price (Rs.)';
    const price=cents($('[name="price"]',row).value),qty=Math.round(Number($('[name="quantity"]',row).value||0)*1000),line=Math.round(price*qty/1000);
    $('[data-line-total]',row).textContent=amount(line/100);total+=line;
  }
  const selected=state.customers.find(row=>String(row.customer_id)===form.elements.customerId.value),balance=cents(selected?.balance||'0'),paid=cents(form.elements.paidNow.value),next=balance+total-paid;
  $('#current-balance').textContent=amount(balance/100);$('#bill-total').textContent=amount(total/100);$('#bill-pending').textContent=amount((total-paid)/100);$('#new-balance').textContent=amount(next/100);
  const warn=Boolean(selected&&next>cents(selected.credit_limit));$('#credit-warning').hidden=!warn;form.elements.creditReason.required=warn;
  form.elements.paidNow.max=(total/100).toFixed(2);
}
function paymentsPage(){return heading(isOwner()?'Cash in. Balance clear.':'Your payment history.',isOwner()?'Cash payments are confirmed immediately and applied oldest first.':'Only confirmed payments reduce your outstanding balance.',isOwner()?button('Receive cash','receive-payment','wallet'):'')+`<section class="panel"><div class="panel-header"><div><h2>${isOwner()?'Latest cash payments':'Latest payments'}</h2><p>Up to 100 recent entries · complete history in the customer ledger</p></div></div>${state.payments.length?`<div class="table-wrap"><table><thead><tr>${isOwner()?'<th>Customer</th>':''}<th>Reference</th><th>Date</th><th>Method</th><th class="right">Amount</th><th>Status</th></tr></thead><tbody>${state.payments.map(row=>`<tr>${isOwner()?`<td><strong>${escape(row.name)}</strong></td>`:''}<td>PAY-${row.payment_id}</td><td>${day(row.payment_date)}</td><td>${escape(row.method)}</td><td class="right"><strong>${amount(row.amount)}</strong></td><td>${badge(row.status)}</td></tr>`).join('')}</tbody></table></div>`:empty('No payments recorded yet.',isOwner()?'Receive cash from a customer to update their balance.':'Your confirmed payments will appear here.','wallet',isOwner()?'Receive cash':'',isOwner()?'receive-payment':'')}</section>`;}
function paymentForm(){
  if(!state.customers.some(row=>row.status==='active'&&row.consent_status==='accepted'&&Number(row.balance)>0))return showDialog('Receive cash',empty('There’s no outstanding khata to pay.','Payments can be received after a customer accepts their invitation and has an outstanding balance.','wallet'));
  showDialog('Receive a cash payment',`<form id="payment-form" data-key="${crypto.randomUUID()}"><div class="form-error" data-form-error role="alert" hidden></div><label class="field"><span>Customer</span><select name="customerId" required>${customerOptions()}</select></label><div id="payment-balance" class="setup-note" hidden></div><div class="form-grid">${field('amount','Cash received (Rs.)',{type:'number',attrs:'min="0.01" max="999999999.99" step="0.01"'})}${field('paymentDate','Payment date',{type:'date',value:businessDate(),attrs:`max="${businessDate()}"`})}</div><p class="summary-note">This payment reduces the oldest unpaid balance first. The customer receives an account update.</p><div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit">${icon('check')}Confirm cash received</button></div></form>`);
}
function profilePage(){
  if(!isOwner()){const customer=state.customers[0];return heading('Your account details.','Your profile and the shop behind your khata.')+`<section class="panel form-panel"><div class="panel-header"><h2>My profile</h2></div><div class="panel-body"><dl class="detail-list">${[['Name',state.user.name],['Customer ID',customer.customer_code],['Phone',state.user.phone],['Shop',state.shop.shop_name],['Shopkeeper',state.shop.owner_name]].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>${button('View my full ledger','my-ledger','book',true)}</div></section>`;}
  const s=state.shop;
  return heading(currentPage==='accounts'?'Payment details for your customers.':'Your shop, in your own name.',currentPage==='accounts'?'Keep your bank, Easypaisa, and JazzCash account details up to date.':'Keep your shop’s profile and account details accurate.')+`<section class="panel form-panel"><div class="panel-header"><h2>Shop profile and account details</h2></div><div class="panel-body"><form id="shop-form"><div class="form-error" data-form-error role="alert" hidden></div><div class="form-grid">${field('ownerName','Shopkeeper name',{value:s.owner_name,attrs:'maxlength="120"'})}${field('shopName','Shop name',{value:s.shop_name,attrs:'maxlength="160"'})}${field('phone','Verified phone',{value:s.phone,attrs:'readonly',help:'Phone changes require a verified recovery process.'})}${field('shopId','Shopkeeper ID',{value:`SHOP-${String(s.shop_id).padStart(4,'0')}`,attrs:'readonly'})}${field('address','Shop address',{value:s.address,required:false,className:'span-2',attrs:'maxlength="500"'})}${field('bankName','Bank name',{value:s.bank_name,required:false,attrs:'maxlength="120"'})}${field('bankAccount','Bank account / IBAN',{value:s.bank_account,required:false,attrs:'maxlength="120"'})}${field('easypaisaAccount','Easypaisa account',{value:s.easypaisa_account,required:false,attrs:'maxlength="30"'})}${field('jazzcashAccount','JazzCash account',{value:s.jazzcash_account,required:false,attrs:'maxlength="30"'})}</div><div class="form-actions">${installPrompt?button('Install app','install','down',true):''}<button class="button" type="submit">Save shop details</button></div></form></div></section>`;
}
function contactPage(){const s=state.shop;return heading('A conversation away.','Your shopkeeper’s contact and payment account details.')+`<div class="contact-grid"><section class="panel"><div class="panel-header"><h2>${escape(s.shop_name)}</h2></div><div class="panel-body"><dl class="detail-list">${[['Shopkeeper',s.owner_name],['Phone',s.phone],['Address',s.address||'No address added']].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><a class="button secondary" href="tel:${escape(s.phone)}">${icon('phone')}Call shopkeeper</a></div></section><section class="panel"><div class="panel-header"><h2>Payment account details</h2></div><div class="panel-body"><p class="summary-note">Online payments count only after the shopkeeper confirms receipt.</p><dl class="detail-list">${[['Bank',s.bank_name],['Account / IBAN',s.bank_account],['Easypaisa',s.easypaisa_account],['JazzCash',s.jazzcash_account]].map(([label,value])=>`<div><dt>${label}</dt><dd class="copy-row"><span>${escape(value||'Not added')}</span>${value?`<button class="icon-button" data-action="copy" data-value="${escape(value)}" aria-label="Copy ${label}">${icon('copy')}</button>`:''}</dd></div>`).join('')}</dl></div></section></div>`;}
function pageContent(){switch(currentPage){case'dashboard':return dashboard();case'customers':return customersPage();case'catalogue':return cataloguePage();case'item-catalogue':return customerCataloguePage();case'new-bill':return newBillPage();case'bills':{const history=`<section class="panel">${billsTable(state.bills)}</section>`;return heading(isOwner()?'Every bill has a story.':'Your bills, item by item.',isOwner()?'Your latest 100 bills. Open a customer ledger for complete history.':'Open a bill to check and confirm the items you received.',isOwner()?button('New bill','new-bill'):'')+(isOwner()?history+monthlyBillList():monthlyBillList({customer:true})+history);}case'payments':return paymentsPage();case'accounts':case'profile':return profilePage();case'contact':return contactPage();case'audit':return heading('A record behind every action.','Who changed what, and when. Your audit history is permanent.')+'<section class="panel" id="audit-content"><div class="empty">Loading audit history…</div></section>';default:return dashboard();}}
async function loadAudit(before){const version=viewVersion;try{const data=await request(`/audit${before?`?before=${before}`:''}`);if(version!==viewVersion)return;const target=$('#audit-content');target.innerHTML=data.entries.length?`<div class="table-wrap"><table><thead><tr><th>Action</th><th>By</th><th>Record</th><th>Date</th><th>Details</th></tr></thead><tbody>${data.entries.map(row=>`<tr><td><strong>${escape(row.action.replaceAll('_',' '))}</strong></td><td>${escape(row.actor)}</td><td>${escape(row.entity)} #${row.entity_id}</td><td>${day(row.created_at)}</td><td><details><summary>View changes</summary><pre class="audit-details">${escape(JSON.stringify({before:row.old_value,after:row.new_value,reason:row.reason},null,2))}</pre></details></td></tr>`).join('')}</tbody></table></div>${data.hasMore?`<div class="panel-body">${button('Older entries',`older-audit:${data.entries.at(-1).log_id}`,'arrow',true)}</div>`:''}`:empty('Your history starts here.','Every create, update, and approval is recorded automatically.','shield');}catch(error){if(version===viewVersion)$('#audit-content').innerHTML=empty('Audit history unavailable',escape(error.message),'info');}}
async function showLedger(id,offset=0){const customer=state.customers.find(row=>String(row.customer_id)===String(id));try{const data=await request(`/customers/${id}/ledger?offset=${offset}`);showDialog(`${escape(customer?.name||'My')} · Ledger`,`<div class="ledger-balance"><span>Total outstanding<br><small>Opening balance: ${amount(customer?.opening_balance)}</small></span><strong>${amount(data.balance)}</strong></div>${data.entries.length?`<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Entry</th><th class="right">Amount</th></tr></thead><tbody>${data.entries.map(row=>`<tr><td><strong>${escape(row.reference)}</strong></td><td>${day(row.occurred_at)}</td><td>${escape(row.type)}</td><td class="right">${row.type==='bill'?'+':'−'} ${amount(row.amount)}</td></tr>`).join('')}</tbody></table></div>`:empty('No entries yet.','Your opening balance is shown above. New bills and payments will appear here.','book')}<div class="pager">${offset>0?`<button class="button secondary small" data-action="ledger-page" data-id="${id}" data-offset="${Math.max(0,offset-100)}">Newer entries</button>`:'<span></span>'}${data.hasMore?`<button class="button secondary small" data-action="ledger-page" data-id="${id}" data-offset="${offset+100}">Older entries</button>`:''}</div>`);}catch(error){toast(error.message);}}
async function showBill(id){try{const data=await request(`/bills/${id}`),corrected=data.corrections.reduce((sum,row)=>sum+Number(row.amount),0);showDialog(escape(data.bill.bill_no),`<div class="dialog-meta"><div><strong>${escape(data.bill.name)}</strong><small>${escape(data.bill.phone)}</small></div><div>${day(data.bill.bill_date)}<small>${badge(data.bill.status)}</small></div></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th class="right">Price</th><th class="right">Amount</th><th>Customer status</th></tr></thead><tbody>${data.items.map(row=>`<tr><td><strong>${escape(row.name)}</strong>${Number(row.returned_quantity)>0?`<small>${escape(formatQuantity(row.returned_quantity,row.unit))} returned</small>`:''}</td><td>${escape(formatItemQuantity(row))}</td><td class="right">${amount(row.price)} / ${escape(priceUnit(row))}</td><td class="right">${amount(row.line_total)}</td><td>${!isOwner()&&row.customer_status==='pending'&&data.bill.status==='active'?`<button class="button secondary small" data-action="item-ok" data-id="${row.bill_item_id}" data-bill="${id}">${icon('check')}OK</button>`:badge(row.customer_status)}</td></tr>`).join('')}</tbody></table></div><div class="summary-row"><span>Original bill total</span><strong>${amount(data.bill.total)}</strong></div><div class="summary-row"><span>Paid now</span><strong>${amount(data.bill.paid_now)}</strong></div><div class="summary-row"><span>Corrections</span><strong>− ${amount(corrected)}</strong></div><div class="summary-row total"><span>Remaining on this bill</span><strong>${amount(Math.max(0,Number(data.bill.total)-corrected-Number(data.bill.allocated)))}</strong></div>${data.corrections.length?`<p class="summary-note">${data.corrections.map(row=>`${row.bill_item_id?'Item return':'Bill cancellation'}: ${amount(row.amount)} · ${escape(row.reason)}`).join('<br>')}</p>`:''}<p class="summary-note">The original bill stays on record. Corrections are recorded separately.</p>${isOwner()&&data.bill.status==='active'?'<a class="button secondary" href="/shopkeeper/bills.html">Manage corrections</a>':''}`);}catch(error){toast(error.message);}}
async function refresh(){const next=await request('/state');if(String(state?.user.user_id)!==String(next.user.user_id)){purchasedBefore=null;purchasedLast=null;purchasedMore=false;purchasedHistory=[];purchasedRequest++;}state=next;if(state.user.role==='staff'){location.assign('/shopkeeper/dashboard.html');return;}await countQueue();render();}
async function countQueue(){if(state&&isOwner())pendingCount=(await queued(state.user)).length;else pendingCount=0;}
function updateSyncBanner(){const banner=$('#sync-banner');if(!banner)return;banner.hidden=!pendingCount&&!syncMessage&&navigator.onLine;if(!banner.hidden)banner.innerHTML=`${icon('sync')}<span>${escape(syncMessage||(pendingCount?`${pendingCount} ${pendingCount===1?'entry':'entries'} saved on this device, awaiting sync. Balances update after sync.`:'You’re offline. Bills and cash payments can be saved on this device while this session stays open.'))}</span>${pendingCount?'<button class="link-button" data-action="sync">Retry sync</button>':''}`;}
async function saveFinancial(path,payload){
  await enqueue(state.user,path,payload);await countQueue();
  if(!navigator.onLine){updateSyncBanner();return {queued:true};}
  try{const result=await request(path,{method:'POST',body:payload});await remove(payload.clientKey);await countQueue();return result;}
  catch(error){
    if(error.status&&error.status<500&&error.status!==401){await remove(payload.clientKey);await countQueue();throw error;}
    syncMessage=error.status===401?'Your session expired. Sign in with the same account to sync the entry.':'Your entry is safely queued on this device. It will retry when the connection returns.';updateSyncBanner();return {queued:true};
  }
}
async function syncQueue(){
  if(syncBusy||!state||!isOwner()||!navigator.onLine)return;
  syncBusy=true;
  try{
    const fresh=await request('/state');
    if(String(fresh.user.user_id)!==String(state.user.user_id)||String(fresh.user.shop_id)!==String(state.user.shop_id))throw new Error('Sign in to the account that saved these entries before syncing.');
    const rows=await queued(state.user);if(!rows.length){syncMessage='';return;}
    for(const row of rows){const entry=await decrypt(row);await request(entry.path,{method:'POST',body:entry.payload});await remove(row.id);}
    syncMessage='';await refresh();toast('Your saved entries are synced.');
  }catch(error){syncMessage=`Sync paused: ${error.message}`;}finally{syncBusy=false;await countQueue();updateSyncBanner();}
}
async function handleSubmit(form){
  const values=formValues(form);
  switch(form.id){
    case'auth-form':{
      await request(`/auth/${authMode}`,{method:'POST',body:{...values,accountRole:values.accountRole||'shopkeeper',invite:invitation,accept:values.accept==='on'}});
      await refresh();location.hash='#/dashboard';await syncQueue();return;
    }
    case'customer-form':{
      const id=form.dataset.id,result=await request(id?`/customers/${id}`:'/customers',{method:id?'PATCH':'POST',body:values});dialog.close();await refresh();
      if(result.invitePath)showInvitation(result);else toast('Customer details saved.');return;
    }
    case'item-form':{const id=form.dataset.id;await request(id?`/items/${id}`:'/items',{method:id?'PATCH':'POST',body:{...values,active:values.active==='on'}});dialog.close();await refresh();toast('Catalogue item saved.');return;}
    case'bill-form':{
      const items=$$('.bill-line',form).map(row=>({itemId:$('[name="itemId"]',row).value,quantity:$('[name="quantity"]',row).value,price:$('[name="price"]',row).value}));
      if(!items.length)throw new Error('Add at least one item to the bill.');
      const result=await saveFinancial('/bills',{clientKey:form.dataset.key,...values,items});
      location.hash='#/bills';if(!result.queued){await refresh();toast(`${result.billNo} saved. The customer’s balance is updated.`);}else{render();toast('Bill saved on this device. It will sync when connected.');}return;
    }
    case'payment-form':{
      const result=await saveFinancial('/payments/cash',{clientKey:form.dataset.key,...values});dialog.close();
      if(!result.queued){await refresh();toast(`Cash payment confirmed. Remaining balance: ${amount(result.balance)}.`);}else toast('Cash payment saved on this device. It will sync when connected.');return;
    }
    case'shop-form':await request('/shop',{method:'PATCH',body:values});await refresh();toast('Shop details saved.');return;
  }
}
document.addEventListener('submit',async event=>{const form=event.target;if(!['auth-form','customer-form','item-form','bill-form','payment-form','shop-form'].includes(form.id))return;event.preventDefault();const submit=$('button[type="submit"]',form);submit.disabled=true;try{await handleSubmit(form);}catch(error){formError(form,error.message);}finally{if(submit.isConnected)submit.disabled=false;}});
document.addEventListener('click',async event=>{
  const element=event.target.closest('[data-action]');if(!element)return;
  event.preventDefault();const action=element.dataset.action;
  try{
    if(action.startsWith('auth-')){authMode=action.slice(5);showAuth();return;}
    if(['new-bill','customers','catalogue'].includes(action)){location.hash=`#/${action}`;return;}
    if(action.startsWith('older-audit:'))return loadAudit(action.split(':')[1]);
    switch(action){
      case'items-older':await changePurchasedPage(true);break;
      case'items-newer':await changePurchasedPage(false);break;
      case'items-view':purchasedView=element.dataset.view;purchasedBefore=null;purchasedLast=null;purchasedMore=false;purchasedHistory=[];render();break;
      case'refresh-items':await refresh();break;
      case'close-dialog':dialog.close();break;
      case'menu':$('.sidebar').classList.add('open');$('.mobile-overlay').classList.add('show');element.setAttribute('aria-expanded','true');break;
      case'close-menu':$('.sidebar').classList.remove('open');$('.mobile-overlay').classList.remove('show');$('.menu-button').setAttribute('aria-expanded','false');break;
      case'open-profile':location.hash='#/profile';break;
      case'add-customer':customerForm();break;
      case'edit-customer':customerForm(state.customers.find(row=>String(row.customer_id)===element.dataset.id));break;
      case'renew-invite':element.disabled=true;showInvitation(await request(`/customers/${element.dataset.id}/invite`,{method:'POST',body:{}}));break;
      case'add-item':itemForm();break;
      case'edit-item':itemForm(state.items.find(row=>String(row.item_id)===element.dataset.id));break;
      case'receive-payment':paymentForm();break;
      case'ledger':await showLedger(element.dataset.id);break;
      case'ledger-page':await showLedger(element.dataset.id,Number(element.dataset.offset));break;
      case'my-ledger':await showLedger(state.user.customer_id);break;
      case'view-bill':await showBill(element.dataset.id);break;
      case'item-ok':element.disabled=true;await request(`/bill-items/${element.dataset.id}/ok`,{method:'POST',body:{}});await showBill(element.dataset.bill);break;
      case'add-line':$('#bill-lines').insertAdjacentHTML('beforeend',billLine());updateBill();break;
      case'remove-line':if($$('.bill-line').length===1){toast('Keep at least one item on the bill.');break;}element.closest('.bill-line').remove();updateBill();break;
      case'copy':await navigator.clipboard.writeText(element.dataset.value);toast('Copied to clipboard.');break;
      case'sync':await syncQueue();break;
      case'install':if(installPrompt){await installPrompt.prompt();installPrompt=null;render();}break;
      case'logout':
        if(syncBusy){toast('Wait for your saved entries to finish syncing.');break;}
        await countQueue();if(pendingCount){toast('Sync your saved entries before signing out. They remain safely stored on this device.');break;}
        await request('/auth/logout',{method:'POST',body:{}});authMode='login';showAuth();location.hash='';break;
    }
  }catch(error){toast(error.message);}finally{if(element.isConnected)element.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.id==='customer-search'){const term=event.target.value.toLowerCase();$('#customer-results').innerHTML=customerTable(state.customers.filter(row=>`${row.name} ${row.phone} ${row.customer_code}`.toLowerCase().includes(term)));}
  if(event.target.id==='item-search'){const term=event.target.value.toLowerCase();$('#item-results').innerHTML=itemTable(state.items.filter(row=>row.name.toLowerCase().includes(term)));}
  if(event.target.closest('#bill-form'))updateBill();
});
document.addEventListener('change',event=>{
  if(event.target.name==='itemId'&&event.target.closest('.bill-line')){const row=event.target.closest('.bill-line'),item=state.items.find(item=>String(item.item_id)===event.target.value);$('[name="price"]',row).value=item?.default_price||'';$('[name="quantity"]',row).step=item?.unit==='piece'?'1':'0.001';$('[name="quantity"]',row).min=item?.unit==='piece'?'1':'0.001';updateBill();}
  if(event.target.name==='customerId'&&event.target.closest('#payment-form')){const row=state.customers.find(row=>String(row.customer_id)===event.target.value);$('#payment-balance').hidden=!row;if(row){$('#payment-balance').textContent=`Outstanding balance: ${amount(row.balance)}`;$('#payment-form').elements.amount.max=row.balance;}}
});
window.addEventListener('hashchange',()=>{if(state)render();});
window.addEventListener('online',()=>{const connection=$('.connection');if(connection){connection.textContent='Connected';connection.classList.remove('offline');}updateSyncBanner();syncQueue();});
window.addEventListener('offline',()=>{const connection=$('.connection');if(connection){connection.textContent='Offline';connection.classList.add('offline');}updateSyncBanner();});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;if(state&&currentPage==='profile')render();});
setInterval(()=>{if(pendingCount)syncQueue();},30000);
let customerRefreshing=false,lastCustomerRefresh=0;
async function refreshCustomerRecords(){
  if(!state||isOwner()||!['dashboard','bills','item-catalogue'].includes(currentPage)||customerRefreshing||purchasedLoading||!navigator.onLine||document.visibilityState!=='visible'||dialog.open||Date.now()-lastCustomerRefresh<5000)return;
  customerRefreshing=true;lastCustomerRefresh=Date.now();
  try{await refresh();}catch{/* Keep the last confirmed records visible during a connection failure. */}finally{customerRefreshing=false;}
}
window.addEventListener('focus',refreshCustomerRecords);
document.addEventListener('visibilitychange',refreshCustomerRecords);
setInterval(refreshCustomerRecords,5000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{/* App works online if service worker registration is blocked. */});
async function initialize(){try{health=await request('/health');if(invitation)invite=await request(`/auth/invite?token=${encodeURIComponent(invitation)}`);if(health.database==='connected'){try{await refresh();await syncQueue();return;}catch(error){if(error.status!==401)toast(error.message);}}}catch(error){toast(error.message);}showAuth();}
initialize();
