/** B05 thin foreground adapter. Import is inert; no env/default credential reads.
 * Each invocation resolves the exact B03 reference and delegates one B04 request.
 * There is deliberately no session table or automatic retry. */
import {createProfileStore,ProfileError} from './llm-profiles.mjs';
import {createProfileSelector} from './llm-select.mjs';
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
export function createPlayRoutes({store=createProfileStore(),port=8787,uiPort=5180,fetchImpl=globalThis.fetch}={}) {
 const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
 const origins=new Set([`http://localhost:${uiPort}`,`http://127.0.0.1:${uiPort}`,...[...hosts].map(h=>`http://${h}`)]);
 return async function handlePlay(req,res) {
  if(req.url!=='/api/llm-play')return false;
  if(!loopback(req.socket?.remoteAddress)||!hosts.has(req.headers.host)||!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'local_same_origin_required'});return true;}
  if(req.method!=='POST'){json(res,405,{error:'method_not_allowed'});return true;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')){json(res,415,{error:'json_required'});return true;}
  const abort=new AbortController();let disconnected=false;
  const close=()=>{if(!res.writableEnded){disconnected=true;abort.abort('user_stop');}};
  req.on('aborted',close);res.on('close',close);
  try {
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>1024*1024){json(res,413,{error:'input_too_large'});return true;}chunks.push(chunk);}
   if(disconnected)return true;
   let command;try{command=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ProfileError('invalid_json');}
   if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).sort().join(',')!=='reference,view')throw new ProfileError('invalid_play_request');
   const selector=createProfileSelector({store,reference:command.reference,fetchImpl});
   // No await between frozen profile resolution and the one B04 invocation.
   const result=await selector.request(command.view,abort.signal);
   if(!disconnected)json(res,200,result);
  } catch(error) {
   if(!disconnected)json(res,error instanceof ProfileError&&error.code==='revision_conflict'?409:400,{error:error instanceof ProfileError?error.code:'profile_service_unavailable'});
  } finally {req.off('aborted',close);res.off('close',close);}
  return true;
 };
}
