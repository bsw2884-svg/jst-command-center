const LEGACY_CACHE_PREFIXES=['jst-command','workbox-precache'];

self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>LEGACY_CACHE_PREFIXES.some(prefix=>key.startsWith(prefix))).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});

// Navigation always comes from the network. Hashed Vite assets use the browser's
// normal HTTP cache and are never placed in a long-lived app-shell cache here.
self.addEventListener('fetch',event=>{
 if(event.request.method==='GET'&&event.request.mode==='navigate'){
  event.respondWith(fetch(event.request,{cache:'no-store'}));
 }
});

self.addEventListener('push',event=>{
 let payload={};
 try{payload=event.data?.json()||{}}catch{payload={body:event.data?.text()||''}}
 const title=payload.title||'JST Command Center';
 const options={
  body:payload.body||'New activity in JumpStart Tomorrow.',
  icon:'/icons/generated/jst-standard-192.png',
  badge:'/icons/generated/jst-favicon-48.png',
  tag:payload.notificationId?`jst-notification-${payload.notificationId}`:undefined,
  data:{url:payload.url||'/',notificationId:payload.notificationId||null},
 };
 event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){
   await existing.focus();
   existing.postMessage({type:'JST_PUSH_NAVIGATE',url:target});
   return;
  }
  await self.clients.openWindow(target);
 })());
});
