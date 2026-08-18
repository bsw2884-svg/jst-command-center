const VERSION='jst-command-v4';
const SHELL=['/','/index.html','/manifest.webmanifest','/icons/generated/jst-favicon-48.png','/icons/generated/jst-apple-180.png','/icons/generated/jst-standard-192.png','/icons/generated/jst-standard-512.png','/icons/generated/jst-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
  return;
 }
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(VERSION).then(cache=>cache.put('/index.html',copy));return response}).catch(()=>caches.match('/index.html')));
  return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy))}return response})));
});
