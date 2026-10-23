const DATABASE = 'trust-tally-outbox';
let connection;
let keyPromise;
async function database() {
  if (!connection) connection = new Promise((resolve,reject) => {
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('keys');request.result.createObjectStore('requests',{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return connection;
}
async function read(store,key) {
  const db=await database();
  return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function write(store,key,value) {
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const object=tx.objectStore(store);if(value === undefined)object.delete(key);else if(store==='requests')object.put(value);else object.put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
async function encryptionKey() {
  if(!keyPromise)keyPromise=(async()=>{
    const existing=await read('keys','device');if(existing)return existing;
    const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),db=await database();
    // Recheck inside a write transaction so two tabs cannot overwrite one another's key.
    return new Promise((resolve,reject)=>{
      let selected;const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys'),request=store.get('device');
      request.onsuccess=()=>{selected=request.result||candidate;if(!request.result)store.put(candidate,'device');};
      tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  })().catch(error=>{keyPromise=null;throw error;});
  return keyPromise;
}
export async function enqueue(user,path,payload) {
  const key=await encryptionKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const encoded=new TextEncoder().encode(JSON.stringify({path,payload}));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoded);
  await write('requests',payload.clientKey,{id:payload.clientKey,ownerId:String(user.user_id),shopId:String(user.shop_id),createdAt:Date.now(),iv,ciphertext});
}
export async function queued(user) {
  const db=await database();
  const all=await new Promise((resolve,reject)=>{const request=db.transaction('requests').objectStore('requests').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return all.filter(row=>row.ownerId===String(user.user_id)&&row.shopId===String(user.shop_id)).sort((a,b)=>a.createdAt-b.createdAt);
}
export async function decrypt(row) {
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv},await encryptionKey(),row.ciphertext);
  return JSON.parse(new TextDecoder().decode(data));
}
export async function remove(id) { await write('requests',id,undefined); }
