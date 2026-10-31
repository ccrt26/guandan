/** Static loopback listener; no API process, proxy, public-dir copy or dev/HMR client. */
import {build} from 'vite';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,parse,relative,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inlineConfig,repoRoot,boundarySources} from './config.mjs';
import {ASSETS,ORIGIN,clearInheritedVite,allowServerRequest} from './safety.mjs';
export const listenerPolicy={host:'127.0.0.1',port:15182,strictPort:true,proxy:false,hmr:false};
export const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readRegular(file){
 const anchor=parse(file).root;let part=anchor;
 for(const component of relative(anchor,file).split(sep)){part=resolve(part,component);if((await lstat(part)).isSymbolicLink())throw Error('symlink_refused');}
 if(!(await lstat(file)).isFile())throw Error('regular_file_required');
 return readFile(file);
}
export async function verifyAsset(root,asset){
 const file=resolve(root,'packages/web/public'+asset.url),bytes=await readRegular(file),sha256=digest(bytes);
 if(bytes.length!==asset.bytes||sha256!==asset.sha256)throw Error('asset_identity_mismatch');
 return {path:relative(root,file),bytes:bytes.length,sha256};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.f32':'application/octet-stream'};
export function makeHandler({root,output,buildPaths,evidence}){
 return async(req,res)=>{
  res.setHeader('Content-Security-Policy',CSP);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url??'/',ORIGIN),path=decodeURIComponent(url.pathname);
   if(url.search||!allowServerRequest(req.method??'',path)){evidence.blockedRequests++;res.writeHead(403);res.end('local-only boundary');return;}
   if(path==='/__c1400_server_evidence'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(evidence));return;}
   const asset=Object.entries(ASSETS).find(([,a])=>a.url===path);
   const name=path==='/'?'/index.html':path;
   const fromBuild=buildPaths.has(name),base=fromBuild?output:resolve(root,'packages/web/public');
   if(!fromBuild&&!asset&&!['.svg','.png','.jpg','.jpeg','.webp','.avif','.ico','.woff','.woff2','.ttf'].includes(extname(name)))throw Error('not_public_UI');
   const file=resolve(base,'.'+name);
   if(!file.startsWith(base+sep))throw Error('outside_public_root');
   const bytes=await readRegular(file);
   if(asset){if(bytes.length!==asset[1].bytes||digest(bytes)!==asset[1].sha256)throw Error('asset_changed');evidence.assetReads[asset[0]]++;}
   res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.statusCode=404;res.end('unavailable');}
 };
}
export async function start(args){
 if(args.length!==1||args[0]!=='--isolated-one-new-game')throw Error('exact --isolated-one-new-game required');
 clearInheritedVite(process.env);
 // Own the fixed port before reading/building anything; an occupied port cannot alter a live helper's output.
 let handler=null;
 const server=createServer((req,res)=>{if(handler)void handler(req,res);else{res.statusCode=503;res.end('preparing owned local build');}});
 await new Promise((ok,no)=>{server.once('error',no);server.listen(listenerPolicy.port,listenerPolicy.host,ok);});
 const stop=()=>server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const assets={};for(const [name,asset]of Object.entries(ASSETS))assets[name]=await verifyAsset(repoRoot,asset);
  const sourceSHA256={};for(const path of boundarySources)sourceSHA256[path]=digest(await readFile(resolve(repoRoot,path)));
  const built=await build(inlineConfig),outputs=(Array.isArray(built)?built:[built]).flatMap(x=>x.output);
  for(const [path,hash]of Object.entries(sourceSHA256))if(digest(await readFile(resolve(repoRoot,path)))!==hash)throw Error('source_changed_during_build');
  const buildPaths=new Set(outputs.map(x=>'/'+x.fileName)),buildSHA256={};
  for(const path of buildPaths)buildSHA256[path]=digest(await readFile(resolve(inlineConfig.build.outDir,'.'+path)));
  const evidence={origin:ORIGIN,pid:process.pid,root:repoRoot,mode:'static-build-no-HMR',sourceSHA256,buildSHA256,assets,assetReads:{C:0,O:0},blockedRequests:0,proxyConfigured:false};
  handler=makeHandler({root:repoRoot,output:inlineConfig.build.outDir,buildPaths,evidence});
  console.log(JSON.stringify({...evidence,url:ORIGIN+'/',purpose:'isolated one new game; NOT acceptance',exit:'Ctrl-C stops only this owned process; do not kill another listener'}));
  return server;
 }catch(error){await new Promise(ok=>server.close(ok));process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await start(process.argv.slice(2));}catch(error){console.error(`C1400 helper not started: ${error.message}; preserve existing services/storage.`);process.exitCode=1;}
}
