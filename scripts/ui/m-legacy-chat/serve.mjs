/** Inert on import. Starts only the fixed static fixture, never the production index/proxy. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const output=path.join(root,'lab/out/m-legacy-chat-ui');
const expectedOrigin='http://127.0.0.1:15183';
const names=new Map([['/','index.html'],['/helper.js','helper.js'],['/helper.css','helper.css']]);
export async function createStaticHandler(){
  const manifest=JSON.parse(await fs.readFile(path.join(output,'build-manifest.json'),'utf8'));
  if(manifest.origin!==expectedOrigin||!manifest.staticOnly)throw Error('wrong_fake_build');
  const files=new Map();
  for(const [url,name]of names){const bytes=await fs.readFile(path.join(output,name));const expected=manifest.outputs.find(row=>row.path===name);if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('build_hash_mismatch');files.set(url,bytes);}
  return (req,res)=>{
    res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    if(req.headers.host!=='127.0.0.1:15183'||req.method!=='GET'||!files.has(req.url)){res.writeHead(404);res.end('fixture static request only');return;}
    res.setHeader('content-type',req.url==='/'?'text/html; charset=utf-8':req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(files.get(req.url));
  };
}
export async function start(){
  const server=http.createServer(await createStaticHandler());
  const stop=()=>{server.close(()=>{console.log('M fake static helper owned session closed.');});server.closeAllConnections();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.on('error',error=>{console.error(`M fake helper not started: ${error.code??'listen_failed'}; do not change port or stop unrelated services.`);process.exitCode=1;});
  server.listen({host:'127.0.0.1',port:15183,exclusive:true},()=>console.log(JSON.stringify({purpose:'legacy-visible-ui-check',origin:expectedOrigin,pid:process.pid,cwd:root,staticRoot:output,noProductionProxy:true})));
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')!=='--fake-ui-only')throw Error('explicit_fake_ui_flag_required');
  await start();
}
