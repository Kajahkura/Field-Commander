import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(`${dir}/${e.name}`):`${dir}/${e.name}`))).flat();}
const paths=(await files('dist')).filter(p=>!p.endsWith('/sw.js'));
const hash=createHash('sha256');for(const p of paths.sort())hash.update(await readFile(p));
const cache=`field-commander-shell-${hash.digest('hex').slice(0,12)}`;
await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(paths.map(p=>p.slice(4)))};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
// Do not skipWaiting: open tabs may contain unsaved forms or pending work.
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('field-commander-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/_server_islands/')||u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;}if(FILES.includes(u.pathname))e.respondWith(caches.open(CACHE).then(c=>c.match(u.pathname)).then(r=>r||fetch(e.request)));});
`);
console.log(`Public shell precached: ${paths.length} files; ${cache}`);
