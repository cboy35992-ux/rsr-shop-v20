const CACHE='rsr-v22-20260805';
const CORE=['/','/index.html','/offline.html','/styles.css?v=21.0','/app.js?v=21.0','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/gcash-qr.png','/gotyme-qr.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy));return res}).catch(()=>caches.match('/index.html').then(r=>r||caches.match('/offline.html'))));return;
 }
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res}).catch(()=>caches.match('/offline.html'))));
});
self.addEventListener('message',event=>{if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting()});
