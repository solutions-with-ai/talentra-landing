/** Loopback-only QA view. Never deploy this server or use it as a production proxy. */
import http from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=await realpath(fileURLToPath(new URL('../../../landing/',import.meta.url)));
const endpoint='https://talentra-forms-staging.talentra-encuentratutalento.workers.dev/api/waitlist';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try {
    const url=new URL(req.url,'http://127.0.0.1:18085');
    if(url.pathname==='/__qa_health'){res.setHeader('Content-Type','text/plain');res.end('Talentra isolated preview');return;}
    let name=decodeURIComponent(url.pathname);if(name==='/')name='/index.html';
    if(name.split('/').some(part=>part.startsWith('.')||part.includes('\\')))throw Error('path');
    // Disable all analytics for QA; the production asset is left untouched.
    if(name==='/analytics.js'){res.setHeader('Content-Type',mime['.js']);res.end('window.talentraTrack=()=>{};');return;}
    const target=await realpath(path.join(root,name));
    if(!target.startsWith(root+path.sep)||!mime[path.extname(target)])throw Error('path');
    let data=await readFile(target);
    if(name==='/index.html')data=Buffer.from(data.toString().replace(
      '<meta name="talentra-waitlist-endpoint" content="" />',
      `<meta name="talentra-waitlist-endpoint" content="${endpoint}" />`));
    res.setHeader('Content-Type',mime[path.extname(target)]);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(18085,'127.0.0.1',()=>process.stdout.write('Talentra QA: http://127.0.0.1:18085/#lista-espera\n'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
