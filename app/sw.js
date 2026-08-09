const C='cg-v4';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 // 动态页面（游戏本体）永远走网络，绝不缓存，保证服务器新代码即时生效
 if(u.pathname==='/'||u.pathname==='/index.html'){
  e.respondWith(fetch(e.request).catch(()=>caches.match('/')));
  return;
 }
 e.respondWith(
  caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
   const cp=res.clone();
   if(res.ok&&u.origin===self.location.origin)caches.open(C).then(c=>c.put(e.request,cp));
   return res;
  }).catch(()=>caches.match('/')))
 );
});
