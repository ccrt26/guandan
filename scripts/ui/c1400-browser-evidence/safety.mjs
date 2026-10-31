/** Pure isolation/evidence projection; no asset, storage, server or model side effects. */
export const ORIGIN='http://127.0.0.1:15182';
export const MATCH_KEY='gd_match_current';
export const C_REF='ohuo-1030-b-v1';
export const ASSETS={
 C:{url:'/ai/ohuo/ohuo-1030-b-v1/weights.f32',bytes:673796,sha256:'d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081'},
 O:{url:'/ai/clean2.f32',bytes:659460,sha256:'b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55'},
};
export const C_IDENTITY={policyId:'r62-p8c-control-u1400-greedy',modelVersion:'r62-p8c-control-u001400-41c9a38f',weightsSHA256:ASSETS.C.sha256,inputDim:399,encoderVersion:'gd-lab-schema-v4',candidateVersion:'cand-suit-v3',passEncoding:'action64',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',epsilon:0,tieBreakId:'first-candidate-v1',tierSpecId:'none'};
export function matchesCIdentity(value){return !!value&&Object.entries(C_IDENTITY).every(([key,v])=>value[key]===v)&&value.candidateCompat===undefined;}
export function assertFreshOrigin(href,local,session){if(href!==ORIGIN+'/')throw Error('exact_new_origin_required');if(local.length||session.length)throw Error('nonempty_origin_refused_without_clearing');}
export function classifyFetch(input,init,origin){
 const url=new URL(typeof input==='string'?input:input.url??String(input),origin+'/');
 if(url.origin!==origin||url.username||url.password||url.search||url.hash||(init?.method??input?.method??'GET').toUpperCase()!=='GET')return null;
 if(url.pathname==='/api/llm-profiles')return 'empty-public-profiles';
 return Object.keys(ASSETS).find(k=>ASSETS[k].url===url.pathname)??null;
}
export function allowServerRequest(method,path){
 if(!['GET','HEAD'].includes(method)||path==='/api'||path.startsWith('/api/'))return false;
 // All weight locations except the two canonical public URLs are denied, even via Vite /@fs.
 if(path.endsWith('.f32')||path.startsWith('/ai/')||path.includes('/public/ai/'))return Object.values(ASSETS).some(a=>a.url===path);
 return true;
}
const IDENTITY_KEYS=[...Object.keys(C_IDENTITY),'candidateCompat'];
export function projectSave(raw){
 if(raw===null)return null;
 const save=JSON.parse(raw),seats=save?.seatConfig?.seats;
 return {matchId:save.matchId??null,snapshotRevision:save.snapshotRevision??null,gameNo:save.gameNo??null,executionState:save.executionState??null,
  seats:Array.isArray(seats)?seats.map(s=>s.controller==='human'?{controller:'human'}:{controller:s.controller,releaseRef:s.releaseRef,mode:s.mode,profilePresent:s.profileRevisionRef!==undefined||s.profileSnapshot!==undefined,policyIdentity:Object.fromEntries(IDENTITY_KEYS.filter(k=>s.policyIdentity?.[k]!==undefined).map(k=>[k,s.policyIdentity[k]]))}):null,
  moveCount:save.activeGame?.moves?.length??null,recorderPolicies:save.activeGame?.recorderMeta?.aiPolicies??null};
}
export function matchesTrialSeats(seats){return Array.isArray(seats)&&seats.length===4&&seats[0]?.controller==='human'&&seats.slice(1).every(s=>s.controller==='ai'&&s.releaseRef===C_REF&&s.mode==='local'&&!s.profilePresent&&s.profileRevisionRef===undefined&&s.profileSnapshot===undefined&&matchesCIdentity(s.policyIdentity));}
export function clearInheritedVite(env){for(const key of Object.keys(env))if(key.startsWith('VITE_'))delete env[key];}
/** Public prototype observers only; no private state/eval and no altered inference values. */
export function installForwardObserver(Network,onEvent,afterReturn){
 const original=Network.prototype.forward;
 Network.prototype.forward=function(...args){
  const event={inputDim:this.inputDim,batchRows:args[1],featureLength:args[0]?.length};onEvent({...event,phase:'attempted'});
  try{const result=original.apply(this,args);onEvent({...event,phase:'completed'});return result;}
  catch(error){onEvent({...event,phase:'failed'});throw error;}
  finally{queueMicrotask(afterReturn);}
 };
 return ()=>{Network.prototype.forward=original;};
}
export function installSingleTrialStart(Controller,{ready,storage,onStart,onReject}){
 const original=Controller.prototype.startGame;let started=false;
 Controller.prototype.startGame=function(){
  const projection=projectSave(JSON.stringify(this.matchSavePoint()));
  if(!ready()||started||storage.getItem(MATCH_KEY)!==null||!matchesTrialSeats(projection?.seats)){
   this.destroy();onReject();throw Error('only_one_exact_local_C_new_game_per_empty_origin');
  }
  started=true;onStart(this);return original.call(this);
 };
 return ()=>{Controller.prototype.startGame=original;};
}
