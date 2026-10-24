const CACHE='moaflow-shell-v4';
const FILES=['/moaflow/','/moaflow/style.css','/moaflow/river.css','/moaflow/river.mjs','/moaflow/flow-model.mjs','/moaflow/app.mjs','/moaflow/embedded.mjs','/moaflow/cloud.mjs','/moaflow/finance.mjs','/moaflow/charts.mjs','/moaflow/mark.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('moaflow-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!FILES.includes(url.pathname)||url.search)return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(url.pathname,copy));}return response;}).catch(()=>caches.match(url.pathname)));});
// Native/web-push transport can later reuse this privacy-preserving payload.
self.addEventListener('push',event=>{let payload={};try{payload=event.data.json();}catch{}const title=typeof payload.title==='string'?payload.title.slice(0,80):'모아흐름 알림';event.waitUntil(self.registration.showNotification(title,{body:'모아흐름에서 구독 내역을 확인해 주세요.',icon:'/moaflow/mark.svg',tag:'moaflow-reminder',data:{url:'/moaflow/#subscriptions'}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.openWindow('/moaflow/#subscriptions'));});
