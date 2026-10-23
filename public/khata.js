import {formatQuantity,formatItemQuantity,priceUnit,unitSymbol} from './units.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=value=>`Rs. ${new Intl.NumberFormat('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0))}`;
const monthLabel=month=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'Asia/Karachi'}).format(new Date(month+'-01T12:00:00Z'));
const dateLabel=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(new Date(String(value).slice(0,10)+'T12:00:00Z'));
const customerField=mode=>`<label class="field"><span>Customer ID or name</span><input type="search" name="customer" list="${mode}-customer-options" autocomplete="off" placeholder="Type a customer ID or name" required><datalist id="${mode}-customer-options" data-khata-customers></datalist></label>`;

export function khataWorkspace(mode){
  const entry=mode==='entry';
  const entryFields=`<div class="form-grid">
    <label class="field"><span>Item name</span><input name="name" list="khata-item-options" maxlength="160" placeholder="For example, Cooking oil" required><datalist id="khata-item-options" data-khata-items></datalist></label>
    <label class="field"><span data-khata-quantity-label>Quantity given</span><input name="quantity" type="number" min="0.001" max="999999.999" step="0.001" inputmode="decimal" placeholder="2, 3.5 or 250" required></label>
    <label class="field"><span>Unit</span><select name="unit"><option value="kg">Kilogram (kg)</option><option value="g">Gram (g)</option><option value="liter">Liter (L)</option></select></label>
    <label class="field" data-khata-liquid-pricing hidden><span>Liquid pricing</span><select name="pricingMode"><option value="bottle">Bottle - saved final price</option><option value="measured">Loose liquid - price per liter</option></select></label>
    <label class="field" data-khata-bottle-count hidden><span>Number of bottles</span><input name="bottleCount" type="number" min="1" max="999999" step="1" value="1" inputmode="numeric"></label>
    <label class="field"><span data-khata-rate-label>Rate per kg (Rs.)</span><input name="price" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal" required></label>
  </div><p class="summary-note" data-khata-price-note hidden>Use this bottle size's original final price. No per-liter amount is added.</p><div class="summary-row"><span>Item amount</span><output data-khata-amount>Rs. 0.00</output></div><label class="field" data-khata-credit hidden><span>Reason for exceeding the credit limit</span><textarea name="creditReason" maxlength="500"></textarea></label>`;
  return `<div class="khata-workspace" data-khata-mode="${mode}"><section class="panel"><div class="panel-header"><h2>${entry?"Add item to customer's khata":"Create this month's bill"}</h2></div><div class="panel-body"><form data-khata-form>${customerField(mode)}${entry?entryFields:''}<div class="form-error" data-khata-feedback role="status" aria-live="polite" hidden></div><div class="form-actions"><button class="button" type="submit" ${entry?'':'disabled'}>${entry?'Add item':'Create bill'}</button></div></form></div></section><section class="panel khata-month-panel"><div class="panel-header"><div><h2>${entry?'Items given this month':"This month's items"}</h2><p data-khata-period>Choose a customer to see their items.</p></div></div><div data-khata-preview aria-live="polite"><div class="empty"><p>Enter a customer ID or name above.</p></div></div></section></div>`;
}

function findCustomer(state,value){
  const term=value.trim().toLowerCase(),rows=state.customers.filter(row=>row.status==='active'&&row.consent_status==='accepted');
  const exact=rows.find(row=>[String(row.customer_id),row.customer_code,`${row.customer_code} · ${row.name}`].some(candidate=>candidate.toLowerCase()===term));
  if(exact)return exact;
  const names=rows.filter(row=>row.name.toLowerCase()===term);
  return names.length===1?names[0]:null;
}

function quantityList(data){
  if(!data.items.length)return '<div class="empty"><p>No items recorded for this customer this month.</p></div>';
  return `<ol class="khata-quantity-list">${data.items.map(item=>`<li><span><strong>${escape(item.name)}</strong>: ${escape(formatItemQuantity(item))}${item.bill_status==='cancelled'?' <small>Cancelled</small>':Number(item.returned_quantity)>0?` <small>${escape(formatQuantity(item.returned_quantity,item.unit))} returned</small>`:''}</span><span>${money(item.amount)}</span></li>`).join('')}</ol><div class="panel-body summary-row total"><span>Month's total</span><strong>${money(data.total)}</strong></div>`;
}

function monthlyTable(data){
  if(!data.items.length)return '<div class="empty"><p>No items recorded for this customer this month.</p></div>';
  return `<div class="table-wrap"><table class="purchased-items"><thead><tr><th>No.</th><th>Date</th><th>Item</th><th>Quantity</th><th>Price</th><th>Amount</th></tr></thead><tbody>${data.items.map((item,index)=>`<tr><td data-label="No.">${index+1}</td><td data-label="Date">${dateLabel(item.bill_date)}</td><td class="purchased-item-name" data-label="Item"><strong>${escape(item.name)}</strong>${item.bill_status==='cancelled'?'<small>Cancelled</small>':Number(item.returned_quantity)>0?`<small>${escape(formatQuantity(item.returned_quantity,item.unit))} returned</small>`:''}</td><td data-label="Quantity">${escape(formatItemQuantity(item))}</td><td data-label="Price">${money(item.price)} / ${escape(priceUnit(item))}</td><td data-label="Amount">${money(item.amount)}</td></tr>`).join('')}</tbody></table></div><div class="panel-body">${Number(data.returnsTotal)>0?`<div class="summary-row"><span>Original item amounts</span><strong>${money(data.originalTotal)}</strong></div><div class="summary-row"><span>Returns / cancellations</span><strong>- ${money(data.returnsTotal)}</strong></div>`:''}<div class="summary-row total"><span>Monthly bill total</span><strong>${money(data.total)}</strong></div><div class="summary-row"><span>Current account balance</span><strong>${money(data.currentBalance)}</strong></div></div>`;
}

export async function viewMonthlyBill(request,showRecord,id){
  const data=await request(`/monthly-bills/${encodeURIComponent(id)}`),snapshot=data.snapshot;
  showRecord(data.bill_no,`<article class="receipt"><h3>${escape(monthLabel(snapshot.month))} monthly bill</h3><p><strong>${escape(snapshot.customer.name)}</strong> · ${escape(snapshot.customer.customer_code)}</p>${monthlyTable(snapshot)}<p class="summary-note">Account balance shown as of ${dateLabel(data.created_at)}. Item charges are included in the customer's khata.</p><button type="button" class="button secondary" data-monthly-print>Print bill</button></article>`);
  document.querySelector('[data-monthly-print]')?.addEventListener('click',()=>{document.body.classList.add('printing-record');window.addEventListener('afterprint',()=>document.body.classList.remove('printing-record'),{once:true});window.print();});
}

export function mountKhata({state,request,onSaved,showRecord,saveFinancial}){
  const root=document.querySelector('.khata-workspace');if(!root)return;
  root._disposeKhata?.();
  const controller=new AbortController(),signal=controller.signal;
  let timer,previewVersion=0,preview=null,busy=false;
  root._disposeKhata=()=>{clearTimeout(timer);controller.abort();};
  const form=root.querySelector('form'),entry=root.dataset.khataMode==='entry',button=form.querySelector('[type=submit]'),feedback=root.querySelector('[data-khata-feedback]');
  const customerInput=form.elements.customer;
  root.querySelector('[data-khata-customers]').innerHTML=state.customers.filter(row=>row.status==='active'&&row.consent_status==='accepted').map(row=>`<option value="${escape(row.customer_code+' · '+row.name)}"></option>`).join('');
  root.querySelector('[data-khata-items]')?.replaceChildren(...[...new Set(state.items.filter(item=>item.active&&['kg','g','liter'].includes(item.unit)).map(item=>item.name))].map(name=>{const option=document.createElement('option');option.value=name;return option;}));
  const message=text=>{feedback.textContent=text;feedback.hidden=!text;};
  const chosen=()=>findCustomer(state,customerInput.value);
  const itemCandidates=()=>state.items.filter(item=>item.active&&item.name.toLowerCase()===form.elements.name.value.trim().toLowerCase()&&['kg','g','liter'].includes(item.unit));
  const mode=()=>form.elements.unit.value==='liter'?form.elements.pricingMode.value:'measured';
  const exactItem=()=>itemCandidates().find(item=>item.unit===form.elements.unit.value&&(item.pricing_mode||'measured')===mode()&&(mode()!=='bottle'||Number(item.package_size)===Number(form.elements.quantity.value)));
  function refreshProduct({choose=false}={}){
    if(!entry)return;
    const candidates=itemCandidates();
    if(choose&&candidates.length){
      const matchingMode=candidates.find(item=>item.unit===form.elements.unit.value&&(item.pricing_mode||'measured')===mode());
      const product=matchingMode||candidates.find(item=>item.pricing_mode==='bottle')||candidates[0];
      form.elements.unit.value=product.unit;
      if(product.unit==='liter')form.elements.pricingMode.value=product.pricing_mode||'measured';
      if(product.pricing_mode==='bottle')form.elements.quantity.value=String(Number(product.package_size));
    }
    const bottled=mode()==='bottle',product=exactItem();
    root.querySelector('[data-khata-liquid-pricing]').hidden=form.elements.unit.value!=='liter';
    root.querySelector('[data-khata-bottle-count]').hidden=!bottled;
    root.querySelector('[data-khata-price-note]').hidden=!bottled;
    form.elements.bottleCount.required=bottled;
    root.querySelector('[data-khata-quantity-label]').textContent=bottled?'Bottle size (L)':'Quantity given';
    root.querySelector('[data-khata-rate-label]').textContent=bottled?'Original final price per bottle (Rs.)':`Rate per ${unitSymbol(form.elements.unit.value)} (Rs.)`;
    if(product)form.elements.price.value=product.default_price;
    else if(bottled)form.elements.price.value='';
    form.elements.price.readOnly=Boolean(bottled&&product);
  }
  function calculate(){
    if(!entry)return;
    const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(form.elements.price.value),price=match?Number(match[1])*100+Number((match[2]||'').padEnd(2,'0')):0;
    const factor=mode()==='bottle'?Number(form.elements.bottleCount.value||0):Math.round(Number(form.elements.quantity.value||0)*1000)/1000;
    const amount=Math.round(price*factor);
    root.querySelector('[data-khata-amount]').textContent=money(amount/100);
    const customer=chosen(),crosses=customer&&Number(customer.balance)+amount/100>Number(customer.credit_limit);
    root.querySelector('[data-khata-credit]').hidden=!crosses;form.elements.creditReason.required=Boolean(crosses);
  }
  async function loadPreview(){
    const version=++previewVersion,customer=chosen();preview=null;
    if(!entry)button.disabled=true;
    const target=root.querySelector('[data-khata-preview]');
    if(!customer){target.innerHTML='<div class="empty"><p>Choose a customer by ID or name.</p></div>';return;}
    try{
      const data=await request(`/khata/monthly?customerId=${encodeURIComponent(customer.customer_id)}`);
      if(signal.aborted||version!==previewVersion)return;
      preview=data;root.querySelector('[data-khata-period]').textContent=`${customer.name} · ${monthLabel(data.month)}`;
      target.innerHTML=entry?quantityList(data):monthlyTable(data);
      if(!entry)button.disabled=!data.items.length||busy;
    }catch(error){if(!signal.aborted&&version===previewVersion){target.innerHTML=`<div class="empty"><p>${escape(error.message)}</p></div>`;message(error.message);}}
  }
  form.addEventListener('input',event=>{
    customerInput.setCustomValidity('');message('');
    if(event.target===customerInput){clearTimeout(timer);timer=setTimeout(loadPreview,180);}
    if(entry&&event.target.name==='name')refreshProduct({choose:true});
    if(entry&&event.target.name==='quantity'&&mode()==='bottle')refreshProduct();
    calculate();
  },{signal});
  form.addEventListener('change',event=>{
    if(entry&&event.target.name==='unit'){
      const candidates=itemCandidates().filter(item=>item.unit===event.target.value);
      if(event.target.value==='liter')form.elements.pricingMode.value=candidates.some(item=>item.pricing_mode==='bottle')?'bottle':'measured';
      refreshProduct({choose:candidates.length>0});
    }
    if(entry&&event.target.name==='pricingMode')refreshProduct();
    calculate();
  },{signal});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();if(busy)return;
    const customer=chosen();
    if(!customer){message('Choose a matching customer ID or name. If names repeat, select the customer ID.');customerInput.focus();return;}
    busy=true;button.disabled=true;message('');
    try{
      if(entry){
        const data=Object.fromEntries(new FormData(form));
        const body={customerId:customer.customer_id,name:data.name,quantity:data.quantity,unit:data.unit,pricingMode:mode(),bottleCount:mode()==='bottle'?data.bottleCount:undefined,price:data.price,creditReason:data.creditReason,billDate:state.businessDate,clientKey:form.dataset.key||=crypto.randomUUID()};
        const saved=saveFinancial?await saveFinancial('/khata/items',body):await request('/khata/items',{method:'POST',body});
        const selected=customerInput.value;form.reset();customerInput.value=selected;delete form.dataset.key;refreshProduct();
        if(saved.queued){message('Item saved on this device. It will be added to the khata and monthly list after syncing.');return;}
        await onSaved(saved);message(`${saved.message||'Saved.'} Balance: ${money(saved.balance)}.`);
      }else{
        const saved=await request('/monthly-bills',{method:'POST',body:{customerId:customer.customer_id}});
        await viewMonthlyBill(request,showRecord,saved.monthlyBillId);
        message(saved.duplicate?`${saved.billNo} is already in the customer's Bill section.`:`${saved.billNo} was added to the customer's Bill section.`);
      }
    }catch(error){message(error.message);}
    finally{busy=false;button.disabled=!entry&&!preview?.items.length;calculate();}
  },{signal});
  if(entry)refreshProduct();calculate();if(chosen())loadPreview();
}

export function monthlyBillList({customer=false}={}){return `<section class="panel section-gap"><div class="panel-header"><div><h2>${customer?'Bills created by your shopkeeper':'Monthly bills'}</h2>${customer?'<p>New monthly bills appear here automatically.</p>':''}</div></div><div data-monthly-bill-list aria-live="polite"><div class="empty"><p>Loading monthly bills...</p></div></div></section>`;}

export async function loadMonthlyBillList(request,showRecord){
  const target=document.querySelector('[data-monthly-bill-list]');if(!target)return;
  try{
    const result=await request('/monthly-bills');if(!target.isConnected)return;
    target.innerHTML=result.bills.length?`<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Month</th><th>Bill</th><th>Total</th><th>Details</th></tr></thead><tbody>${result.bills.map(row=>`<tr><td>${escape(row.name)}<small>${escape(row.customer_code)}</small></td><td>${escape(monthLabel(String(row.month).slice(0,7)))}</td><td>${escape(row.bill_no)}</td><td>${money(row.total)}</td><td><button type="button" class="button secondary small" data-monthly-bill="${escape(row.monthly_bill_id)}">View bill</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><p>No monthly bills created yet.</p></div>';
    target.querySelectorAll('[data-monthly-bill]').forEach(button=>button.addEventListener('click',()=>viewMonthlyBill(request,showRecord,button.dataset.monthlyBill).catch(error=>{target.querySelector('.empty')?.remove();const message=document.createElement('p');message.textContent=error.message;target.append(message);}))); 
    return result.bills;
  }catch(error){target.innerHTML=`<div class="empty"><p>${escape(error.message)}</p></div>`;}
}
