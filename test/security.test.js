import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, verifySecret, phone, pin, digest, token } from '../src/lib/security.js';
test('PIN hashes use independent salts and reject incorrect or malformed secrets',async()=>{
  const first=await hashSecret('195824'),second=await hashSecret('195824');
  assert.notEqual(first,second);assert.ok(!first.includes('195824'));assert.equal(await verifySecret('195824',first),true);
  assert.equal(await verifySecret('195825',first),false);assert.equal(await verifySecret('195824','plain-text-pin'),false);
});
test('Pakistani local phone numbers normalize to one canonical identity',()=>{
  assert.equal(phone('0300 1234567'),'+923001234567');assert.equal(phone('+92 (300) 1234567'),'+923001234567');assert.throws(()=>phone('0300123'));
});
test('PIN and session input meet the authentication contract',()=>{
  assert.equal(pin('123456'),'123456');for(const value of ['1234','abcdef','1234567',123456])assert.throws(()=>pin(value));
  const raw=token();assert.equal(raw.length,64);assert.equal(digest(raw).length,64);assert.notEqual(raw,digest(raw));
});
