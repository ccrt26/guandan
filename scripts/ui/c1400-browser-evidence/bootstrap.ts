/** Visible opt-in adapter. The real App, browser loader and model files are unchanged. */
import {MLP} from '../../../packages/ai/src/nn/mlp';
import {MatchController} from '../../../packages/web/src/game/controller';
import {defaultSeatAssignments} from '../../../packages/ai/src/policy/seats';
import {ASSETS,C_IDENTITY,C_REF,MATCH_KEY,ORIGIN,assertFreshOrigin,classifyFetch,matchesCIdentity,matchesTrialSeats,projectSave,installForwardObserver,installSingleTrialStart} from './safety.mjs';
const panel=document.getElementById('c1400-evidence')!;
panel.style.cssText='position:relative;z-index:100000;padding:12px;background:#fff8da;color:#172033;font:14px/1.45 system-ui;border:2px solid #9c7800';
panel.innerHTML='<strong>C1400 独立新局验收 · 不代表正式采用</strong><p>仅此空 origin；不读写原 5180 存档。不训练、不连 API。先核真实 C HTTP/loader，再在真实首页自选四席：0 真人，1/2/3 为 ohuo-1030-b-v1 本地 C。H 仅观察不选。若真人回合前向仍0，只点一次“提示”（不出牌）。首次前向完成后自动停止控制器，保存仍保留；不要刷新重开、进入设置或复盘。</p><div id="c1400-buttons"></div><pre id="c1400-status" style="white-space:pre-wrap;max-height:55vh;overflow:auto"></pre>';
const status=document.getElementById('c1400-status')!,buttons=document.getElementById('c1400-buttons')!;
let controller:MatchController|null=null,started=0,stopped=false,prepared=false,lastError='';
let initialStorage:null|{local:number;session:number}=null,loaderActual:unknown=null,firstSave:unknown=null,serverActual:unknown=null;
let lastObservedHomeChoices:unknown=null,lastObservedHomeSelectedRefs:string[]=[];
let forwardCalls=0,blockedStarts=0,blockedStorageClears=0,emptyPublicProfileReads=0;
const blockedNetworkAttempts:Record<string,number>={fetch:0,xhr:0,websocket:0,eventsource:0,beacon:0,csp:0};
const forwardInputDims=new Set<number>(),httpActual:unknown[]=[],forwardBatches:unknown[]=[];
const forwardCounts={attempted:0,completed:0,failed:0};
const localEvidenceRequests={attempted:0,completed:0,failed:0};
function stop(){if(controller&&!stopped){stopped=true;controller.destroy();}refresh();}
function refresh(){
 try{
  const saved=projectSave(localStorage.getItem(MATCH_KEY));if(saved&&firstSave===null)firstSave=structuredClone(saved);
  const selects=[...document.querySelectorAll<HTMLSelectElement>('#root select[aria-label$="号席牌手"]')];
  if(selects[0]){lastObservedHomeChoices=[...selects[0].options].map(o=>({ref:o.value,label:o.text,disabled:o.disabled}));lastObservedHomeSelectedRefs=selects.map(s=>s.value);}
  status.textContent=JSON.stringify({origin:location.origin,initialStorage,prepared,started,stopped,expected:{C:ASSETS.C,identity:C_IDENTITY},actual:{httpResponses:httpActual,loader:loaderActual,server:serverActual,
   defaultLayouts:{easy:defaultSeatAssignments('easy'),standard:defaultSeatAssignments('standard'),hard:defaultSeatAssignments('hard')},
   lastObservedHomeChoices,lastObservedHomeSelectedRefs,currentController:controller?{humanTurn:controller.humanTurn,turn:controller.state?.turn??null,moveNo:controller.state?.moveNo??null}:null,
   firstSave,currentSave:saved,forwardCalls,forwardCounts,forwardInputDims:[...forwardInputDims],forwardBatches,blockedNetworkAttempts,localEvidenceRequests,emptyPublicProfileReads,blockedStarts,blockedStorageClears},
   note:'空公共 profile 列表仅隔离适配，无 HTTP/API。任何被拒绝网络尝试也计数；unknown/null 不算通过。仅身份投影，不含手牌/动作。manual由Mac真实观察后填写。',lastError},null,2);
 }catch{lastError='invalid_local_save_projection';status.textContent=lastError;controller?.destroy();}
}
function button(label:string,fn:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.marginRight='8px';b.addEventListener('click',fn);buttons.append(b);return b;}
function blocked(kind:string):never{blockedNetworkAttempts[kind]++;lastError=`network_attempt_blocked:${kind}`;refresh();throw Error(lastError);}
try{
 assertFreshOrigin(location.href,localStorage,sessionStorage);initialStorage={local:localStorage.length,session:sessionStorage.length};
 // No App or local storage writer has been loaded before the empty-origin gate.
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const kind=classifyFetch(input,init,location.origin);
  if(kind==='empty-public-profiles'){emptyPublicProfileReads++;refresh();return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});}
  if(kind!=='C'&&kind!=='O')return blocked('fetch');
  const observed:{asset:string;state:string;responseUrl?:string;status?:number;bytes?:number;sha256?:string}={asset:kind,state:'attempted'};httpActual.push(observed);refresh();
  try{
   const response=await nativeFetch(input,{...init,cache:'no-store',redirect:'error'});
   const bytes=await response.clone().arrayBuffer();
   const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   Object.assign(observed,{state:'completed',responseUrl:response.url,status:response.status,bytes:bytes.byteLength,sha256});refresh();return response;
  }catch(error){observed.state='failed';refresh();throw error;}
 };
 XMLHttpRequest.prototype.open=function(){return blocked('xhr');};
 window.WebSocket=new Proxy(window.WebSocket,{construct(){return blocked('websocket');}});
 window.EventSource=new Proxy(window.EventSource,{construct(){return blocked('eventsource');}});
 navigator.sendBeacon=()=>blocked('beacon');
 document.addEventListener('securitypolicyviolation',()=>{blockedNetworkAttempts.csp++;lastError='CSP blocked a resource/network attempt';refresh();});
 // Preserve any saved trial, including if a second page tries to begin a game.
 const removeItem=Storage.prototype.removeItem;
 Storage.prototype.removeItem=function(key:string){if(this===localStorage&&key===MATCH_KEY&&this.getItem(key)!==null){blockedStorageClears++;refresh();throw Error('existing_trial_save_removal_refused');}return removeItem.call(this,key);};
 Storage.prototype.clear=function(){blockedStorageClears++;refresh();throw Error('storage_clear_forbidden');};
 installForwardObserver(MLP,(event:{phase:keyof typeof forwardCounts;inputDim:number;batchRows:number;featureLength:number})=>{
  forwardCounts[event.phase]++;if(event.phase==='attempted'){forwardCalls++;forwardInputDims.add(event.inputDim);forwardBatches.push({inputDim:event.inputDim,batchRows:event.batchRows,featureLength:event.featureLength});}
 },()=>{if(controller)stop();});
 installSingleTrialStart(MatchController,{ready:()=>prepared,storage:localStorage,
  onStart:(actual:MatchController)=>{started++;controller=actual;actual.subscribe(refresh);},
  onReject:()=>{blockedStarts++;lastError='only_one_exact_local_C_new_game_per_empty_origin';refresh();},
 });
 const readServerEvidence=async()=>{localEvidenceRequests.attempted++;try{const value=await(await nativeFetch('/__c1400_server_evidence',{cache:'no-store',redirect:'error'})).json();localEvidenceRequests.completed++;return value;}catch(error){localEvidenceRequests.failed++;throw error;}};
 const prepare=button('核实际 C HTTP / loader → 打开真实首页',()=>{void(async()=>{
  try{
   assertFreshOrigin(location.href,localStorage,sessionStorage);prepare.disabled=true;
   const {loadWebPolicy,webReleaseChoices}=await import('../../../packages/web/src/game/policy');
   const loaded=await loadWebPolicy(C_IDENTITY.policyId);
   loaderActual={identity:loaded.identity,encoder:loaded.encoder,descriptorEncoder:loaded.descriptor.encoder,parameterCount:loaded.descriptor.parameterCount,
    registeredAssetUrl:loaded.descriptor.weightsPathOrUrl.assetUrl,releaseChoices:webReleaseChoices.map(c=>({releaseRef:c.release.releaseRef,mode:c.release.mode,available:c.available,policyRef:c.release.proposalPolicyRef}))};
   if(!matchesCIdentity(loaded.identity)||loaded.encoder.schema!=='v2'||loaded.encoder.ctxFill!=='rule-context'||loaded.encoder.passEncoding!=='action64'||loaded.encoder.candidateCompat!==undefined)throw Error('actual_C_identity_mismatch');
   serverActual=await readServerEvidence();
   // Recheck before mounting; no clearing if another tab acquired this origin.
   assertFreshOrigin(location.href,localStorage,sessionStorage);prepared=true;refresh();
   await import('../../../packages/web/src/main');
   new MutationObserver(refresh).observe(document.getElementById('root')!,{childList:true,subtree:true});
   document.getElementById('root')!.addEventListener('change',()=>queueMicrotask(refresh));refresh();
  }catch(error){lastError=String(error);refresh();}
 })();});
 button('刷新可见证据（不改存档）',()=>{void readServerEvidence().then(v=>{serverActual=v;refresh();},()=>{lastError='server_evidence_unavailable';refresh();});});
 button('停止本次控制器（保留新局存档）',stop);
 window.addEventListener('error',()=>{lastError='browser_runtime_error';refresh();});
 window.addEventListener('unhandledrejection',()=>{lastError='browser_unhandled_rejection';refresh();});
 refresh();
}catch(error){buttons.replaceChildren();status.textContent=`拒绝：${String(error)}。未挂载 App，未写/清任何存档；保留此 origin 现有数据，交回执行者。`;}
