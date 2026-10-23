import { formatQuantity, formatItemQuantity, unitLabel, measurementColumns, measurementValues } from './units.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const purchasedItemHeadings = ['Date', 'Item Name', ...measurementColumns.map(([, label]) => label), 'Total Cost', 'Bill', 'Details'];

export function billItemSummary(items = []) {
  if (!items.length) return '';
  return `<ul class="bill-item-summary" aria-label="Items taken">${items.map(item => `<li><span>${escape(item.name)}</span><strong>${escape(formatItemQuantity(item))}</strong></li>`).join('')}</ul>`;
}

export function purchasedItemRows(items, { dateLabel, money, badge, actionAttribute = 'data-page-action' }) {
  return items.map(row => {
    const correction = row.bill_status === 'cancelled' ? `<small>${badge('cancelled')}</small>`
      : Number(row.returned_quantity) > 0 ? `<small>${escape(formatQuantity(row.returned_quantity, row.unit))} returned</small>` : '';
    const measurements = measurementValues(row.quantity, row.unit).map((value, index) =>
      `<td class="right" data-label="${escape(measurementColumns[index][1])}"${row.unit !== measurementColumns[index][0] ? ' data-empty' : ''}>${escape(value)}</td>`).join('');
    return `<tr><td data-label="Date">${dateLabel(row.bill_date)}</td><td class="purchased-item-name" data-label="Item Name"><strong>${escape(row.name)}</strong><span class="item-quantity">${escape(formatItemQuantity(row))}</span><small>${escape(row.pricing_mode==='bottle'?'Bottle · final price':unitLabel(row.unit))}</small>${correction}</td>${measurements}<td class="right" data-label="Total Cost">${money(row.line_total)}</td><td data-label="Bill">${escape(row.bill_no)}</td><td class="purchased-item-details"><button type="button" class="button secondary small" ${actionAttribute}="view-bill" data-id="${escape(row.bill_id)}">View bill</button></td></tr>`;
  }).join('');
}
