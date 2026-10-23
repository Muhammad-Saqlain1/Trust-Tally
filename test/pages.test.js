import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { once } from 'node:events';
import { createApp } from '../src/server.js';

const root=new URL('../public/',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('page-catalog.json',root),'utf8'));
test('all PRD screens have complete standalone HTML documents and are served',async t=>{
  assert.equal(catalog.filter(page=>page.role==='shopkeeper').length,17);
  assert.equal(catalog.filter(page=>page.role==='customer').length,12);
  assert.equal(catalog.length,31);
  const app=createApp({query:async()=>[]}),server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{app.locals.cleanup();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const page of catalog){
    const response=await fetch(base+page.path),html=await response.text();
    assert.equal(response.status,200,page.path);
    assert.match(html,/<!doctype html>/i,page.path);
    assert.match(html,/<main id="main"/i,page.path);
    assert.match(html,/name="viewport"/,page.path);
    assert.match(html,/<script type="module" src="(?:\.\.\/|\.\/)pages\.js"/,page.path);
    assert.doesNotMatch(html,/\bon(?:click|submit|change)\s*=/i,page.path);
    assert.ok(html.length>3000,`${page.path} must contain a full screen, not a redirect`);
  }
});
test('standalone navigation and shared stylesheet/script links resolve to real files',async()=>{
  for(const page of catalog){
    const html=await readFile(new URL(page.path.slice(1),root),'utf8');
    for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
      const value=match[1];if(value.startsWith('#')||/^[a-z]+:/i.test(value))continue;
      const url=new URL(value,new URL('http://local'+page.path));
      await assert.doesNotReject(()=>access(new URL(url.pathname.slice(1),root)),`${page.path}: missing ${value}`);
    }
  }
});
