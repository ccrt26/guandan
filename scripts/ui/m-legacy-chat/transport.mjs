/** In-memory fake only; no native fetch, filesystem, service or credential access. */
export function createFixtureTransport(fixture) {
  const data=new Map(),listeners=new Set(),pending=[];
  let mode='completed',requests=0,chatRequests=0,importRequests=0,aborted=0,released=0,writes=0,reportWrites=0,blocked=0;
  const emit=()=>{for(const listener of listeners)listener();};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:key=>data.get(key)??null,
    setItem:(key,value)=>{data.set(String(key),String(value));writes++;if(String(key).startsWith('gd_report'))reportWrites++;emit();},
    removeItem:key=>{data.delete(key);writes++;emit();},clear:()=>{data.clear();writes++;emit();}};
  const expected={profileId:fixture.profile.profileId,revision:fixture.profile.revision,snapshotHash:fixture.profile.snapshotHash};
  const failed=()=>{blocked++;emit();return reply({status:'failed',error:'fixture_request_not_allowed'},400);};
  async function fetchImpl(input,init={}) {
    if(typeof input!=='string')return failed();
    const url=new URL(input,fixture.origin),method=init.method??'GET';requests++;
    if(url.origin!==fixture.origin||url.search||url.hash)return failed();
    if(url.pathname==='/api/llm-profiles'&&method==='GET'){emit();return reply([fixture.profile]);}
    if(url.pathname==='/api/import-zcode'&&method==='POST'){importRequests++;emit();return reply(fixture.importDraft);}
    if(url.pathname!=='/api/chat'||method!=='POST')return failed();
    let body;try{body=JSON.parse(init.body);}catch{return failed();}
    if(!body||Object.keys(body).sort().join(',')!=='messages,reference'||JSON.stringify(body.reference)!==JSON.stringify(expected)||!Array.isArray(body.messages)||!body.messages.length)return failed();
    chatRequests++;
    const text=body.messages[0].role==='system'?JSON.stringify(fixture.coachOutput):'正常';
    const completed={status:'completed',text,summary:{...expected,protocol:fixture.profile.protocol,requestedModel:fixture.profile.requestedModel,returnedModel:'fake-returned',requestCount:1}};
    if(mode==='failed'){emit();return reply({status:'failed',error:'fixture_provider_error'},502);}
    if(mode==='hold')return new Promise(resolve=>{
      const entry={resolve,body:completed,signal:init.signal,abort:null};
      entry.abort=()=>{aborted++;emit();};
      // Deliberately retain the fake response after abort to observe generation suppression.
      if(init.signal?.aborted)entry.abort();else init.signal?.addEventListener('abort',entry.abort,{once:true});
      pending.push(entry);emit();
    });
    emit();return reply(completed);
  }
  return {storage,fetchImpl,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    setMode(value){if(!['completed','failed','hold'].includes(value))throw Error('invalid_fixture_mode');mode=value;emit();},
    releaseLate(){for(const entry of pending.splice(0)){entry.signal?.removeEventListener('abort',entry.abort);released++;entry.resolve(reply(entry.body));}emit();},
    snapshot(){return{artificial:true,mode,requests,chatRequests,importRequests,aborted,held:pending.length,released,memoryWrites:writes,reportWrites,memoryKeys:[...data.keys()],blocked,nativeFetchCalls:0,verdict:'人工观察后回件，本面板不自判通过'};},
  };
}
