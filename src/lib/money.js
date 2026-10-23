import { ensure } from './errors.js';

// Financial calculations use integer paisa. SQL stores DECIMAL, never floating-point totals.
export function money(value, label = 'Amount') {
  const text = String(value ?? '').trim();
  ensure(/^\d{1,9}(?:\.\d{1,2})?$/.test(text), 400, `${label} must be a non-negative amount with at most two decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function decimal(paisa) {
  ensure(Number.isSafeInteger(paisa), 400, 'Invalid financial amount.');
  return `${paisa < 0 ? '-' : ''}${Math.floor(Math.abs(paisa) / 100)}.${String(Math.abs(paisa) % 100).padStart(2, '0')}`;
}
export function quantity(value) {
  const text = String(value ?? '').trim();
  ensure(/^\d{1,6}(?:\.\d{1,3})?$/.test(text), 400, 'Quantity must have at most three decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  ensure(result > 0, 400, 'Quantity must be greater than zero.');
  return result;
}
export function lineTotal(price, thousandths) {
  ensure(Number.isSafeInteger(price * thousandths), 400, 'Item amount is too large.');
  const total = Math.round(price * thousandths / 1000);
  ensure(total <= 99999999999, 400, 'Item amount exceeds the supported limit.');
  return total;
}
export function oldestFirst(amount, debts) {
  let remaining = amount;
  const allocations = [];
  for (const debt of debts) {
    const allocated = Math.min(remaining, debt.unpaid);
    if (allocated > 0) allocations.push({ billId: debt.billId ?? null, amount: allocated });
    remaining -= allocated;
    if (!remaining) break;
  }
  return { allocations, remaining };
}
