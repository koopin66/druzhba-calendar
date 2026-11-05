const BASE=new URL('./',self.location.href);
const PREFIX='druzhba-demo:'+BASE.pathname;
const CACHE=PREFIX+'v1';
const SHELL=['./','./app.js','./demo-runtime.js','./style.css','./manrope.ttf','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'].map(p=>new URL(p,BASE).href);
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);
 if(e.request.method!=='GET'||!url.href.startsWith(BASE.href))return;
 e.respondWith(fetch(e.request).then(response=>{if(response.ok){const duplicate=response.clone();caches.open(CACHE).then(c=>c.put(e.request,duplicate));}return response;}).catch(()=>caches.match(e.request).then(r=>r||(e.request.mode==='navigate'?caches.match(BASE.href):Response.error()))));
});
