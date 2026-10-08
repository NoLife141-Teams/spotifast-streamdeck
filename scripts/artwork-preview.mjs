import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ArtworkRenderer } from '../src/artwork.mjs';
import { isArtworkUrl } from '../src/core.mjs';
const samples = new Map();
const renderer = new ArtworkRenderer({ fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
let cover;
try {
  const exe = (process.env.LOCALAPPDATA || '') + '/Programs/Spotifast/spotifast.exe';
  const { stdout } = await promisify(execFile)(exe, ['now-playing','--raw'], {windowsHide:true,timeout:5000,encoding:'utf8',shell:false});
  const artUrl = stdout.trimEnd().split('\t')[9];
  if (isArtworkUrl(artUrl)) {
    const response = await fetch(artUrl, {signal:AbortSignal.timeout(4000),redirect:'error'});
    if(response.ok && response.headers.get('content-type')?.startsWith('image/')) {
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length <= 2*1024*1024)cover='data:' + response.headers.get('content-type').split(';')[0]+';base64,'+bytes.toString('base64');
    }
  }
} catch {}
for (const [id,title,artists] of [
  ['perfect','Perfect','Kaley, LYON'],
  ['long','A very long song title that will not fit','Artist one, Artist two, Artist three'],
  ['french','Été à Montréal','Éléonore et François'],
  ['wide','WWWWWWWWWWWW','WWWWWWWWWWWW']
]) {
  const image = await renderer.render(cover,title,artists);
  samples.set('/'+id+'.svg',Buffer.from(image.split(',')[1],'base64'));
}
const html='<!doctype html><meta charset="utf-8"><title>Artwork caption</title><style>body{background:#252525;color:#eee;font:14px Arial;padding:24px}.samples{display:flex;gap:28px;flex-wrap:wrap}figure{margin:0;max-width:144px}img{width:72px;height:72px;border-radius:8px}img.large{width:144px;height:144px}figcaption{margin-top:10px;color:#ccc}h2{font-size:16px;margin:28px 0 18px}</style><h2>Actual key size · 72 × 72</h2><div class="samples">'+Array.from(samples.keys(),url=>'<figure><img src="'+url+'"><figcaption>'+url.slice(1,-4)+'</figcaption></figure>').join('')+'</div><h2>High resolution · 144 × 144</h2><div class="samples">'+Array.from(samples.keys(),url=>'<figure><img class="large" src="'+url+'"></figure>').join('')+'</div>';
const server=http.createServer((req,res)=>{if(samples.has(req.url)){res.writeHead(200,{'content-type':'image/svg+xml'});res.end(samples.get(req.url));}else{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);}});
server.listen(4318,'127.0.0.1',()=>console.log('Artwork preview: http://127.0.0.1:4318'));
