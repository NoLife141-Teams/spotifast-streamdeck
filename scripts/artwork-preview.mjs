import http from 'node:http';
import { ArtworkRenderer } from '../src/artwork.mjs';
import { Spotifast, ArtworkCache } from '../src/core.mjs';
const renderer = new ArtworkRenderer({ fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
let cover;
try { const snapshot = await new Spotifast().snapshot(); cover = await new ArtworkCache().get(snapshot.artUrl); } catch {}
const samples = new Map([
  ['perfect', ['Perfect', 'Kaley, LYON']],
  ['long', ['Une chanson au titre très long', 'Éléonore, François et les autres musiciens']],
  ['french', ['Été à Montréal', 'Éléonore et François']],
  ['wide', ['WWWWWWWWWWWW', 'WWWWWWWWWWWW']],
  ['emoji', ['👨‍👩‍👧‍👦 🎸 🎵 ✨', '音楽 · Éléonore 🎤']]
]);
const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Défilement et temps restant — aperçu</title>
<style>body{background:#252525;color:#eee;font:14px Arial;padding:24px;margin:0}h1{font-size:20px}p{color:#bbb;line-height:1.5}.samples{display:flex;gap:28px;flex-wrap:wrap}figure{margin:0;max-width:160px}img{width:72px;height:72px;border-radius:8px}img.large{width:144px;height:144px}figcaption{margin-top:10px;color:#ccc}h2{font-size:16px;margin:28px 0 18px}.controls{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}button{background:#444;color:white;border:1px solid #777;padding:8px;border-radius:5px}</style>
<h1>Texte défilant et temps restant</h1><p>Le titre et l’artiste défilent seulement s’ils dépassent la largeur disponible.<br>Le compteur se fige en pause. Cet aperçu utilise une lecture simulée.</p>
<div class="controls"><label><input id="scroll" type="checkbox" checked> Défilement</label><label><input id="remaining" type="checkbox" checked> Temps restant</label><label><input id="text" type="checkbox" checked> Titre et artiste</label><button id="pause">Mettre l’aperçu en pause</button></div>
<h2>Taille réelle · 72 × 72</h2><div class="samples">${[...samples.keys()].map(id => `<figure><img data-sample="${id}" src="/frame.svg?id=${id}"><figcaption>${id}</figcaption></figure>`).join('')}</div>
<h2>Agrandissement · 144 × 144</h2><div class="samples">${['long', 'perfect', 'emoji'].map(id => `<figure><img class="large" data-sample="${id}" src="/frame.svg?id=${id}"></figure>`).join('')}</div>
<script>
const start=performance.now();let playing=true,played=0,last=start,busy=false;
const controls={scroll:document.getElementById('scroll'),remaining:document.getElementById('remaining'),text:document.getElementById('text')};
document.getElementById('pause').onclick=()=>{const clock=performance.now();if(playing)played+=clock-last;last=clock;playing=!playing;document.getElementById('pause').textContent=playing?'Mettre l’aperçu en pause':'Reprendre l’aperçu';};
window.previewFrame=()=>{const clock=performance.now();return {elapsed:Math.round(clock-start),remaining:Math.max(0,154000-played-(playing?clock-last:0)),scroll:controls.scroll.checked,text:controls.text.checked,showRemaining:controls.remaining.checked};};
async function paint(){if(busy)return;busy=true;try{const f=window.previewFrame();await Promise.all([...document.querySelectorAll('img[data-sample]')].map(async img=>{const old=img.dataset.frameUrl;const query=new URLSearchParams({id:img.dataset.sample,...f});const blob=await(await fetch('/frame.svg?'+query)).blob();const next=URL.createObjectURL(blob);await new Promise(resolve=>{img.onload=img.onerror=resolve;img.src=next;});img.dataset.frameUrl=next;if(old)URL.revokeObjectURL(old);}));}finally{busy=false;}}
paint();setInterval(paint,200);
</script></html>`;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/frame.svg') {
      const sample = samples.get(url.searchParams.get('id')) || samples.get('long');
      const elapsedMs = Math.max(0, Number(url.searchParams.get('elapsed')) || 0);
      const remainingMs = url.searchParams.get('showRemaining') === 'false' ? undefined : Math.max(0, Number(url.searchParams.get('remaining') ?? 154000));
      const image = await renderer.render(cover, ...sample, { elapsedMs, remainingMs, scrollText: url.searchParams.get('scroll') !== 'false', showText: url.searchParams.get('text') !== 'false' });
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      response.end(Buffer.from(image.split(',')[1], 'base64'));
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
    }
  } catch { response.writeHead(500); response.end('Preview unavailable'); }
});
server.listen(4318, '127.0.0.1', () => console.log('Artwork preview: http://127.0.0.1:4318'));