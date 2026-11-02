import { afterEach, expect, it, vi } from 'vitest';
const hook=vi.hoisted(()=>({current:null as any}));
const coachMocks=vi.hoisted(()=>({request:vi.fn(async(..._args:any[])=>'{"summary":"fake","lessons":[]}')}));
vi.mock('react',async original=>({...await original<any>(),useState:(v:any)=>hook.current.state(v),useRef:(v:any)=>hook.current.ref(v),useMemo:(fn:any,deps:any)=>hook.current.memo(fn,deps),useEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),useLayoutEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps)}));
vi.mock('../src/ui/chat-operation',async original=>({...await original<any>(),requestCompletedChat:coachMocks.request}));
vi.mock('@gd/review',()=>({SEAT_DISPLAY_VERSION:'fake-seat-version',readCoachCache:()=>null,makeCoachCache:()=>({}),buildCoachJsonMessages:()=>[{role:'user',content:'fake'}],acceptCoachResponse:()=>({summary:'fake',lessons:[]})}));
import {projectReviewModelDisplay} from '../src/game/review-model-display';
import { VerifiedReportTab } from '../src/ui/VerifiedReportTab';
import { createProfileClient, type ProviderStateView, type ProviderTestResult } from '../src/game/llm-profiles';
import { providerPresetFields, describeProviderAvailability, describeProviderConnection } from '../src/game/provider-presets';
import { createChatOperationOwner, operationProfileClient } from '../src/ui/chat-operation';
const glm={...providerPresetFields('glm',{profileId:'fake-glm',nickname:'GLM'}),revision:1,snapshotHash:'a'.repeat(64)};
const ds={...providerPresetFields('deepseek',{profileId:'fake-ds',nickname:'DeepSeek'}),revision:1,snapshotHash:'b'.repeat(64)};
const ref=(p:typeof glm)=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
const shared:ProviderStateView={schema:'ohuo-provider-state-v1',profiles:[glm,ds],providers:{
 glm:{availability:'ready',reference:ref(glm),connection:{state:'passed',testedAt:'2026-10-31T18:58:35.463806Z',scope:'native-connection-probe',httpStatus:200,returnedModel:'glm-5.3'}},
 deepseek:{availability:'ready',reference:ref(ds),connection:{state:'untested',reason:'no_receipt'}},
}};
const response=(data:any)=>({ok:true,status:200,json:async()=>structuredClone(data)});
const storage=(raw:string|null=null)=>({getItem:vi.fn((key:string)=>key==='gd_provider_bindings_v1'?raw:null),setItem:vi.fn(),removeItem:vi.fn()});
afterEach(()=>vi.unstubAllGlobals());
it('S31 shared state gives two independent empty/corrupt storages the same exact ready profiles without binding or private POST',async()=>{
 const fetchImpl=vi.fn(async()=>response(shared));
 for(const isolated of [storage(),storage('{bad')]){
  const client=createProfileClient({storage:isolated,fetchImpl}),state=await client.refreshProviderState();
  for(const provider of ['glm','deepseek'] as const){const s=describeProviderAvailability(provider,state);expect(s.state).toBe('ready');expect(ref(s.profile!)).toEqual(shared.providers[provider].reference);}
  expect(isolated.getItem).not.toHaveBeenCalledWith('gd_provider_bindings_v1');expect(isolated.removeItem).not.toHaveBeenCalled();
 }
 expect(fetchImpl.mock.calls).toEqual([['/api/llm-profiles?view=providers',undefined],['/api/llm-profiles?view=providers',undefined]]);
});
it.each(['secret','ref','reason','no-time','bad-time','bad-http','model','duplicate-profile','unknown-field'])('rejects unsafe/inconsistent provider-state %s without cached success',async kind=>{
 const bad:any=structuredClone(shared);
 if(kind==='secret')bad.providers.glm.secret='FAKE_SECRET';
 if(kind==='ref')bad.providers.glm.reference.revision=99;
 if(kind==='reason')bad.providers.glm.connection.reason='FAKE_RAW_SECRET';
 if(kind==='no-time')delete bad.providers.glm.connection.testedAt;
 if(kind==='bad-time')bad.providers.glm.connection.testedAt='today';
 if(kind==='bad-http')bad.providers.glm.connection.httpStatus=500;
 if(kind==='model')bad.providers.glm.connection.returnedModel='FAKE RAW\nSECRET';
 if(kind==='duplicate-profile')bad.profiles.push(glm);
 if(kind==='unknown-field')bad.credentialRevision=1;
 const isolated=storage(),client=createProfileClient({storage:isolated,fetchImpl:async()=>response(bad)});
 await expect(client.refreshProviderState()).rejects.toThrow(/invalid_provider_state|invalid_public_profile/);expect(isolated.setItem).not.toHaveBeenCalled();
});
it('history is UTC/time-bound, stale is not a pass, and failed/untested does not disable structural readiness',async()=>{
 expect(describeProviderAvailability('glm',shared).reason).toContain('2026-10-31 18:58:35 UTC');
 for(const state of ['failed','incomplete','stale'] as const){const next=structuredClone(shared);next.providers.glm.connection.state=state;expect(describeProviderAvailability('glm',next).state).toBe('ready');expect(describeProviderAvailability('glm',next).reason).not.toContain('诊断通过');}
 expect(describeProviderAvailability('deepseek',shared).reason).toContain('未测试');
 const stale=structuredClone(shared);stale.providers.glm.connection.state='stale';expect(describeProviderAvailability('glm',stale).reason).toContain('当前配置未测试');
});
it('unknown/ambiguous/missing provider does not choose a first profile, and loading has no cached pass',()=>{
 const state=structuredClone(shared);state.providers.glm={availability:'ambiguous',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}};
 expect(describeProviderAvailability('glm',state).profile).toBeNull();expect(describeProviderAvailability('glm',null).state).toBe('checking');
});
it('shared-state read inherits operation cancellation and cannot write a late public cache',async()=>{
 let resolve!:(v:any)=>void;const held=new Promise(r=>resolve=r),isolated=storage();vi.stubGlobal('localStorage',isolated);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:()=>held})));
 const owner=createChatOperationOwner(),pending=operationProfileClient(owner.begin()).refreshProviderState();await Promise.resolve();owner.invalidate();resolve(shared);await expect(pending).rejects.toThrow();expect(isolated.setItem).not.toHaveBeenCalled();
});
it('shared view failure is not replaced with the existing public-profile cache',async()=>{
 const isolated=storage();isolated.getItem.mockReturnValue(JSON.stringify([glm,ds]));const client=createProfileClient({storage:isolated,fetchImpl:async()=>{throw Error('FAKE_RAW_SECRET');}});
 await expect(client.refreshProviderState()).rejects.toThrow('profile_service_unavailable');expect(isolated.setItem).not.toHaveBeenCalled();
});

it('R3 incompatible surviving historical profile displays stale time but remains nonselectable',async()=>{
 const state=structuredClone(shared);state.providers.glm={availability:'incompatible',reference:null,connection:{...shared.providers.glm.connection,state:'stale',reason:'credential_or_profile_changed'}};
 const client=createProfileClient({storage:storage(),fetchImpl:async()=>response(state)}),status=describeProviderAvailability('glm',await client.refreshProviderState());
 expect(status.state).toBe('incompatible');expect(status.profile).toBeNull();expect(status.reason).toContain('当前配置未测试');expect(status.reason).toContain('2026-10-31 18:58:35 UTC');
 for(const availability of ['missing','ambiguous'] as const){const bad=structuredClone(state);bad.providers.glm.availability=availability;await expect(createProfileClient({storage:storage(),fetchImpl:async()=>response(bad)}).refreshProviderState()).rejects.toThrow('invalid_provider_state');}
});

/** Bounded actual component/handler runner. Coach output is stubbed; this is not a real model/report test. */
class CoachRender {
 slots:any[]=[];index=0;effects:(()=>void)[]=[];tree:any;
 props:any={record:{id:'fake-record',humanSeat:0},evidence:[{decisionId:'fake',moveNo:1,policy:null,candidates:null,replayStatus:'exact',verifiedPrefixEnd:1,actual:{actionId:'fake'},singleStep:{actual:{text:'fake',remainingCards:1}},heuristic:{topActionId:null},facts:{},claims:[],missing:[],expressionScope:'fake'}],onJump:vi.fn()};
 constructor(){const modelDisplay=projectReviewModelDisplay(this.props.evidence,{analysisPolicy:null,analysisSeat:null,frozenSeats:undefined,referenceOnly:false});this.props={...this.props,evidence:modelDisplay.displayEvidences,modelDisplay};}
 slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
 state(v:any){const s=this.slot(()=>({value:typeof v==='function'?v():v}));return [s.value,(n:any)=>{s.value=typeof n==='function'?n(s.value):n;}];}
 ref(v:any){return this.slot(()=>({current:v}));}
 memo(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((d,i)=>d!==s.deps[i])){s.value=fn();s.deps=deps;}return s.value;}
 effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((d,i)=>d!==s.deps[i])){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
 render(){this.index=0;hook.current=this;this.tree=VerifiedReportTab(this.props);hook.current=null;this.effects.splice(0).forEach(fn=>fn());return this;}
 unmount(){this.slots.forEach(s=>s.cleanup?.());}
 nodes(node?:any):any[]{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.flatMap(n=>this.nodes(n));if(!node||typeof node!=='object')return [];return [node,...this.nodes(node.props?.children??null)];}
 text(node?:any):string{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.map(n=>this.text(n)).join('');if(node==null||typeof node==='boolean')return '';return typeof node==='object'?this.text(node.props?.children??null):String(node);}
 button(text:string){const n=this.nodes().find(n=>n.type==='button'&&this.text(n)===text);expect(n).toBeDefined();return n;}
 select(){return this.nodes().find(n=>n.type==='select');}
}
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function coachSetup(initial=shared,choice:any=null){
 const memory=new Map<string,string>();if(choice)memory.set('gd_chat_profile_reference_v1',JSON.stringify(choice));let state=structuredClone(initial);
 vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)});
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{expect(url).toBe('/api/llm-profiles?view=providers');expect(init?.method).toBeUndefined();return response(state);});vi.stubGlobal('fetch',fetcher);coachMocks.request.mockClear();
 return {memory,fetcher,setState:(next:ProviderStateView)=>{state=structuredClone(next);}};
}
it('coach shared view exposes both providers in a fresh context without choosing or calling a model',async()=>{
 coachSetup();const r=new CoachRender().render();await tick();r.render();const options=r.nodes(r.select()).filter(n=>n.type==='option'&&n.props.value&&!n.props.disabled);expect(options).toHaveLength(2);expect(r.text()).toContain('2026-10-31 18:58:35 UTC');expect(r.text()).toContain('非网页业务调用验收');expect(r.select().props.value).toBe('');expect(coachMocks.request).not.toHaveBeenCalled();r.unmount();
});
it('coach existing exact choice remains usable outside the current shared provider default and is retain-only',async()=>{
 const old={...glm,profileId:'old-coach',requestedModel:'old-model',snapshotHash:'c'.repeat(64)},state={...shared,profiles:[glm,ds,old]};const chosen=ref(old),{memory}=coachSetup(state,chosen);const r=new CoachRender().render();await tick();r.render();
 expect(r.select().props.value).toBe(JSON.stringify(chosen));const option=r.nodes(r.select()).find(n=>n.type==='option'&&n.props.value===JSON.stringify(chosen));expect(option.props.disabled).toBe(true);expect(r.button('生成 AI 讲解').props.disabled).toBe(false);await r.button('生成 AI 讲解').props.onClick();expect(coachMocks.request).toHaveBeenCalledTimes(1);expect(coachMocks.request.mock.calls[0][0]).toEqual(old);expect(JSON.parse(memory.get('gd_chat_profile_reference_v1')!)).toEqual(chosen);r.unmount();
});
it('coach stays mounted while save events add a source/change revision; old choice is not rebound',async()=>{
 const empty:ProviderStateView={schema:'ohuo-provider-state-v1',profiles:[],providers:{glm:{availability:'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}},deepseek:{availability:'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}}}};
 const f=coachSetup(empty),r=new CoachRender().render();await tick();r.render();f.setState(shared);window.dispatchEvent(new Event('ohuo-provider-state-changed'));await tick();r.render();r.select().props.onChange({target:{value:JSON.stringify(ref(glm))}});r.render();
 const next=structuredClone(shared);next.profiles[0]={...glm,revision:2,snapshotHash:'f'.repeat(64)};next.providers.glm.reference=ref(next.profiles[0]);f.setState(next);window.dispatchEvent(new Event('ohuo-provider-state-changed'));await tick();r.render();expect(r.button('生成 AI 讲解').props.disabled).toBe(true);expect(JSON.parse(f.memory.get('gd_chat_profile_reference_v1')!)).toEqual(ref(glm));expect(coachMocks.request).not.toHaveBeenCalled();r.unmount();
});
it('coach preflight rejects a changed exactRef with zero model calls and retains the explicit choice',async()=>{
 const f=coachSetup(shared,ref(glm)),r=new CoachRender().render();await tick();r.render();const next=structuredClone(shared);next.profiles[0]={...glm,revision:2,snapshotHash:'f'.repeat(64)};next.providers.glm.reference=ref(next.profiles[0]);f.setState(next);await r.button('生成 AI 讲解').props.onClick();r.render();expect(coachMocks.request).not.toHaveBeenCalled();expect(r.text()).toContain('本次未调用模型');expect(JSON.parse(f.memory.get('gd_chat_profile_reference_v1')!)).toEqual(ref(glm));r.unmount();
});
it('coach focus/visibility are read-only and cleanup removes mounted listeners',async()=>{
 const f=coachSetup(),r=new CoachRender().render();await tick();r.render();const before=f.fetcher.mock.calls.length;window.dispatchEvent(new Event('focus'));await tick();document.dispatchEvent(new Event('visibilitychange'));await tick();expect(f.fetcher).toHaveBeenCalledTimes(before+2);expect(coachMocks.request).not.toHaveBeenCalled();r.unmount();window.dispatchEvent(new Event('focus'));await tick();expect(f.fetcher).toHaveBeenCalledTimes(before+2);
});

// Explicit tests use an isolated memory client; none of these fixtures contacts a provider.
const testId='11111111-1111-4111-8111-111111111111';
const testResult:ProviderTestResult={provider:'glm',reference:ref(glm),requestId:testId,
 connection:{state:'passed',testedAt:'2026-11-01T00:00:00.123Z',scope:'native-connection-probe',httpStatus:200,returnedModel:'safe-alias'},profileUnchanged:true,persisted:true};
it('explicit provider client sends only the saved reference once and does not cache a test result',async()=>{
 const memory=storage(),fetchImpl=vi.fn(async()=>response(testResult)),client=createProfileClient({storage:memory,fetchImpl});
 expect(fetchImpl).not.toHaveBeenCalled();expect(await client.testProvider('glm',ref(glm),testId)).toEqual(testResult);
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect(fetchImpl.mock.calls[0]).toEqual(['/api/llm-profiles/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'glm',reference:ref(glm),requestId:testId})}]);expect(memory.setItem).not.toHaveBeenCalled();
});
it('explicit timeout and unsaved receipt retain the safe result and original time without automatic retry',async()=>{
 const value:ProviderTestResult={...testResult,persisted:false,error:'receipt_persist_failed',connection:{...testResult.connection,state:'failed',errorCategory:'timeout_unknown'}};
 const fetchImpl=vi.fn(async()=>response(value)),client=createProfileClient({storage:storage(),fetchImpl}),got=await client.testProvider('glm',ref(glm),testId);
 expect(got.persisted).toBe(false);expect(got.error).toBe('receipt_persist_failed');expect(describeProviderConnection(got.connection)).toContain('超时，供应商处理状态未知');expect(got.connection.testedAt).toBe(value.connection.testedAt);expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('explicit test response rejects unsafe or mismatched envelopes without retries',async()=>{
 const changes:Array<(v:any)=>void>=[v=>v.secret='FAKE_ONLY',v=>v.reference.revision=2,v=>v.requestId='22222222-2222-4222-8222-222222222222',v=>v.connection.errorCategory='RAW_SECRET',v=>delete v.connection.testedAt,v=>v.profileUnchanged=false,v=>v.persisted=false,v=>v.connection.state=['passed'],v=>v.connection.errorCategory='timeout_unknown'];
 for(const change of changes){const bad=structuredClone(testResult);change(bad);const memory=storage(),fetchImpl=vi.fn(async()=>response(bad)),client=createProfileClient({storage:memory,fetchImpl});await expect(client.testProvider('glm',ref(glm),testId)).rejects.toMatchObject({code:'invalid_provider_test_response',execution:'unknown'});expect(fetchImpl).toHaveBeenCalledTimes(1);expect(memory.setItem).not.toHaveBeenCalled();}
});
it('explicit invalid input is zero-call, known preflight rejection differs from lost response, and neither retries',async()=>{
 const fetchImpl=vi.fn(async()=>response(testResult)),client=createProfileClient({storage:storage(),fetchImpl});
 await expect(client.testProvider('glm',ref(glm),'bad')).rejects.toMatchObject({execution:'not-started'});expect(fetchImpl).not.toHaveBeenCalled();
 const rejected=vi.fn(async()=>({ok:false,status:409,json:async()=>({error:'test_in_progress'})}));await expect(createProfileClient({storage:storage(),fetchImpl:rejected}).testProvider('glm',ref(glm),testId)).rejects.toMatchObject({code:'test_in_progress',execution:'not-started'});expect(rejected).toHaveBeenCalledTimes(1);
 const lost=vi.fn(async()=>{throw Error('RAW_SECRET');});await expect(createProfileClient({storage:storage(),fetchImpl:lost}).testProvider('glm',ref(glm),testId)).rejects.toMatchObject({code:'provider_test_result_unknown',execution:'unknown'});expect(lost).toHaveBeenCalledTimes(1);
});
it('new read-only clients preserve persisted timeout category and reject uncontrolled diagnostic text',async()=>{
 const view=structuredClone(shared);view.providers.glm.connection={...testResult.connection,state:'failed',errorCategory:'timeout_unknown'};
 for(let i=0;i<2;i++){const fetchImpl=vi.fn(async()=>response(view));const state=await createProfileClient({storage:storage(),fetchImpl}).refreshProviderState();expect(describeProviderAvailability('glm',state).reason).toContain('超时，供应商处理状态未知');expect(fetchImpl.mock.calls).toEqual([['/api/llm-profiles?view=providers',undefined]]);}
 const bad:any=structuredClone(view);bad.providers.glm.connection.errorCategory='RAW_SECRET';await expect(createProfileClient({storage:storage(),fetchImpl:async()=>response(bad)}).refreshProviderState()).rejects.toThrow('invalid_provider_state');
});
