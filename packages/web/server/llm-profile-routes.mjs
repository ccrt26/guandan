/** No-listen handler for named settings only; no upstream network or environment import. */
import { createProfileStore, ProfileError } from './llm-profiles.mjs';
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
export function createProfileRoutes({store=createProfileStore(),port=8787,uiPort=5180}={}) {
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
  const origins=new Set([`http://localhost:${uiPort}`,`http://127.0.0.1:${uiPort}`,...[...hosts].map(host=>`http://${host}`)]);
  return async function handleProfileRoute(req,res) {
    if(req.url!=='/api/llm-profiles') return false;
    const origin=req.headers.origin;
    if(!loopback(req.socket?.remoteAddress)||!hosts.has(req.headers.host)|| (origin!==undefined&&!origins.has(origin)) || req.headers['sec-fetch-site']==='cross-site' || (req.method==='POST'&&!origin)) {
      json(res,403,{error:'local_same_origin_required'});return true;
    }
    try {
      if(req.method==='GET') json(res,200,store.list());
      else if(req.method==='POST') {
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')) {json(res,415,{error:'json_required'});return true;}
        const chunks=[];let bytes=0;
        for await(const chunk of req) {bytes+=chunk.length;if(bytes>32768) {json(res,413,{error:'profile_request_too_large'});return true;}chunks.push(chunk);}
        let command;try {command=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new ProfileError('invalid_json');}
        json(res,200,store.save(command));
      } else json(res,405,{error:'method_not_allowed'});
    } catch(error) {
      const code=error instanceof ProfileError?error.code:'profile_service_unavailable';
      json(res,code==='revision_conflict'||code==='profile_store_busy'?409:400,{error:code});
    }
    return true;
  };
}
