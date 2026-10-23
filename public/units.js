export const itemUnits = [
  ['kg', 'Kilogram (kg)'],
  ['g', 'Gram (g)'],
  ['liter', 'Liter (L)'],
  ['piece', 'Piece']
];

export const measurementColumns = [
  ['kg', 'Weight (kg)'],
  ['g', 'Weight (g)'],
  ['liter', 'Liter (L)'],
  ['piece', 'Pieces']
];

export const unitSymbol = unit => unit === 'liter' ? 'L' : unit;
export const unitLabel = unit => itemUnits.find(([value]) => value === unit)?.[1] || unit;

// Preserve the saved decimal quantity without rounding or changing its unit.
export function formatQuantity(value, unit) {
  const text = String(value ?? '');
  const formatted = /^\d+(?:\.\d+)?$/.test(text)
    ? text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    : text;
  return `${formatted} ${unitSymbol(unit)}`;
}

export const isBottle = item => item?.pricing_mode === 'bottle';

export function formatItemQuantity(item) {
  if (!isBottle(item)) return formatQuantity(item?.quantity, item?.unit);
  const count = Number(item.package_count ?? (Number(item.quantity) / Number(item.package_size)));
  const size = formatQuantity(item.package_size, 'liter');
  return count === 1 ? `${size} bottle` : `${count} × ${size} bottles`;
}

export function catalogueUnit(item) {
  return isBottle(item) ? `${formatQuantity(item.package_size, 'liter')} bottle` : unitLabel(item?.unit);
}

export function priceUnit(item) {
  return isBottle(item) ? 'bottle' : unitSymbol(item?.unit);
}

// Each saved quantity belongs to one column; never convert or combine units.
export function measurementValues(value, unit) {
  return measurementColumns.map(([columnUnit]) => columnUnit === unit ? formatQuantity(value, unit) : '—');
}
