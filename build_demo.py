"""Build the static, isolated customer demo for GitHub Pages /docs hosting."""
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parent
OUTPUT=ROOT/'docs'
OUTPUT.mkdir(exist_ok=True)
for source in (ROOT/'public').iterdir():
    if source.is_file():
        shutil.copy2(source,OUTPUT/source.name)
shutil.copy2(ROOT/'demo-runtime.js',OUTPUT/'demo-runtime.js')
index=(OUTPUT/'index.html').read_text(encoding='utf-8')
index=index.replace('href="/','href="./').replace('src="/','src="./')
index=index.replace('<script src="./app.js"', '<script src="./demo-runtime.js" defer></script>\n  <script src="./app.js"')
index=index.replace('Общий календарь групп и банкетов ресторана Дружба, Выборг.','Тестовый календарь ресторана Дружба. Заявки хранятся только на вашем устройстве.')
(OUTPUT/'index.html').write_text(index,encoding='utf-8')
css=(OUTPUT/'style.css').read_text(encoding='utf-8').replace("url('/","url('./")
(OUTPUT/'style.css').write_text(css,encoding='utf-8')
manifest=json.loads((OUTPUT/'manifest.webmanifest').read_text(encoding='utf-8'))
manifest.update(id='./',start_url='./',scope='./',name='Дружба — тестовый календарь',description='Демонстрация календаря. Данные сохраняются на этом устройстве.')
for icon in manifest['icons']:
    icon['src']='.'+icon['src']
for shortcut in manifest['shortcuts']:
    shortcut['url']='.'+shortcut['url']
    for icon in shortcut['icons']:
        icon['src']='.'+icon['src']
(OUTPUT/'manifest.webmanifest').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
page404=(OUTPUT/'404.html').read_text(encoding='utf-8').replace('href="/','href="./')
(OUTPUT/'404.html').write_text(page404,encoding='utf-8')
(OUTPUT/'.nojekyll').write_text('',encoding='utf-8')
(OUTPUT/'sw.js').write_text('''const BASE=new URL('./',self.location.href);
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
''',encoding='utf-8')
assert 'src="/' not in index and 'href="/' not in index
assert (OUTPUT/'demo-runtime.js').is_file()
print(f'Static demo: {OUTPUT} ({len(list(OUTPUT.iterdir()))} files)')
