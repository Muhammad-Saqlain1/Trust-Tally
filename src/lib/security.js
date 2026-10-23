import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure } from './errors.js';
const scrypt = promisify(derive);
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashSecret(value) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifySecret(value, encoded) {
  if (!encoded || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)) return false;
  const [salt, hash] = encoded.split(':');
  const derived = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
export function phone(value) {
  let normalized = String(value ?? '').replace(/[\s()-]/g, '');
  if (/^03\d{9}$/.test(normalized)) normalized = '+92' + normalized.slice(1);
  ensure(/^\+[1-9]\d{9,14}$/.test(normalized), 400, 'Enter a valid phone number, for example 03001234567.');
  return normalized;
}
export function pin(value) {
  ensure(typeof value === 'string' && /^\d{6}$/.test(value), 400, 'Use a six-digit PIN.');
  return value;
}
export function text(value, label, max = 120, required = true) {
  ensure(typeof value === 'string' || (!required && value == null), 400, `${label} is invalid.`);
  const result = String(value ?? '').trim();
  ensure((!required || result.length > 0) && result.length <= max, 400, `${label} must be ${required ? '1' : '0'}–${max} characters.`);
  return result;
}
