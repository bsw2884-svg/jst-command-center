const RECOVERY_CACHE_VERSION='jst-command-cache-reset-v7';

self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.map(key=>caches.delete(key)));
  await self.registration.unregister();
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  await Promise.all(clients.map(client=>client.navigate(client.url)));
 })());
});

self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request,{cache:'no-store'}));
  return;
 }
 event.respondWith(fetch(event.request));
});

void RECOVERY_CACHE_VERSION;
