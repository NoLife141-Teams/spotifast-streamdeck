import http from 'node:http';
import { readFile } from 'node:fs/promises';
const ui = new URL('../streamdeck/ui/', import.meta.url);
const mock = language => '<script>' + [
  'window.previewMessages = [];',
  'class PreviewSocket {',
  'static OPEN = 1;',
  'constructor(){this.readyState=1;queueMicrotask(()=>this.onopen());}',
  'send(raw){const m=JSON.parse(raw);window.previewMessages.push(m);',
  "if(m.event==='getGlobalSettings')this.reply({event:'didReceiveGlobalSettings',payload:{settings:{}}});",
  "if(m.event==='setGlobalSettings')this.reply({event:'didReceiveGlobalSettings',payload:{settings:m.payload}});",
  "if(m.event==='sendToPlugin'&&m.payload.type==='status')this.reply({event:'sendToPropertyInspector',payload:{type:'status',online:true,messageKey:'connected'}});",
  '}',
  'reply(value){queueMicrotask(()=>this.onmessage({data:JSON.stringify(value)}));}',
  '}',
  'window.WebSocket=PreviewSocket;',
  '</script>'
].join('\n');
const bootstrap = language => '<script>window.connectElgatoStreamDeckSocket(28196,"preview-inspector","registerPropertyInspector",' + JSON.stringify(JSON.stringify({application:{language}})) + ',' + JSON.stringify(JSON.stringify({action:'rocks.spotifast.streamdeck.playlist',context:'different-action-instance',payload:{settings:{uri:'https://open.spotify.com/playlist/example123',step:5,showText:true}}})) + ');</script>';
const server = http.createServer(async (request,response)=>{
  try {
    const url = new URL(request.url,'http://127.0.0.1');
    const language = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
    if(url.pathname==='/' || url.pathname==='/settings.html') {
      let html = await readFile(new URL('settings.html',ui),'utf8');
      html = html.replace('<script src="i18n.js">',mock(language)+'<script src="i18n.js">').replace('</body>',bootstrap(language)+'</body>');
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(html);
    } else if(['/settings.js','/i18n.js'].includes(url.pathname)) {
      response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});response.end(await readFile(new URL(url.pathname.slice(1),ui)));
    } else {response.writeHead(404);response.end();}
  } catch(error) {response.writeHead(500);response.end(error.message);}
});
server.listen(4317,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4317/?lang=en or ?lang=fr'));
