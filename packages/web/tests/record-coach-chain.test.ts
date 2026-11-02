import {afterEach,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import {policyParameterCount,type PolicyDescriptor} from '../../ai/src/policy/descriptor';
const fixture=vi.hoisted(()=>({current:null as any,virtual:null as any}));
vi.mock('virtual:gd-model-index',()=>{if(!fixture.virtual)throw Error('synthetic directory not prepared');return fixture.virtual;});
vi.mock('react',async original=>({...await original<any>(),
 useState:(value:any)=>fixture.current.state(value),useRef:(value:any)=>fixture.current.ref(value),
 useMemo:(fn:any,deps:any)=>fixture.current.memo(fn,deps),useCallback:(fn:any,deps:any)=>fixture.current.memo(()=>fn,deps),
 useEffect:(fn:any,deps:any)=>fixture.current.effect(fn,deps),useLayoutEffect:(fn:any,deps:any)=>fixture.current.effect(fn,deps),
}));
import type {GameRecord} from '@gd/engine';
import type {SeatSnapshot} from '../../ai/src/policy/seats';
import type {ProviderStateView} from '../src/game/llm-profiles';
/** Actual component functions/effects. Child element props are inspected; this is not DOM/IAB. */
class Render {
 slots:any[]=[];index=0;effects:(()=>void)[]=[];tree:any;
 constructor(public component:any,public props:any){}
 slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
 state(value:any){const s=this.slot(()=>({value:typeof value==='function'?value():value}));return[s.value,(next:any)=>{s.value=typeof next==='function'?next(s.value):next;}];}
 ref(value:any){return this.slot(()=>({current:value}));}
 changed(s:any,deps:any[]|undefined){return !deps||!s.deps||deps.length!==s.deps.length||deps.some((v,i)=>!Object.is(v,s.deps[i]));}
 memo(fn:any,deps:any[]){const s=this.slot(()=>({}));if(this.changed(s,deps)){s.value=fn();s.deps=deps;}return s.value;}
 effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(this.changed(s,deps)){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
 render(){this.index=0;fixture.current=this;try{this.tree=this.component(this.props);}finally{fixture.current=null;}this.effects.splice(0).forEach(fn=>fn());return this;}
 unmount(){this.slots.forEach(s=>s.cleanup?.());this.effects=[];}
 nodes(node?:any):any[]{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.flatMap(n=>this.nodes(n));if(!node||typeof node!=='object')return[];return[node,...this.nodes(node.props?.children??null)];}
 text(node?:any):string{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.map(n=>this.text(n)).join('');if(node==null||typeof node==='boolean')return'';return typeof node==='object'?this.text(node.props?.children??null):String(node);}
 button(label:string){const n=this.nodes().find(n=>n.type==='button'&&this.text(n).trim()===label);expect(n,`actual button ${label}`).toBeDefined();return n;}
 child(component:any){const n=this.nodes().find(n=>n.type===component);expect(n,'actual child props').toBeDefined();return n.props;}
}
const mounted:Render[]=[];
const mount=(component:any,props:any)=>{const r=new Render(component,props);mounted.push(r);return r.render();};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
afterEach(()=>{mounted.splice(0).reverse().forEach(r=>r.unmount());fixture.current=null;vi.unstubAllGlobals();vi.restoreAllMocks();});

it('F18-F19 frozen record reaches replay analysis and verified coach',async()=>{
 // Honest public synthetic bytes/registrations, not the real released C/O weights or user records.
 const bytes1=new Uint8Array(policyParameterCount(399)*4),bytes2=new Uint8Array(bytes1);new DataView(bytes2.buffer).setFloat32(0,0.25,true);
 const policy=(n:number,bytes:Uint8Array):PolicyDescriptor=>({policyId:`record-chain-synthetic-r${n}`,modelVersion:`record-chain-synthetic-r${n}`,
  architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:policyParameterCount(399),inputDim:399,
  weightsPathOrUrl:{assetUrl:`ai/record-chain-r${n}.f32`},weightsSHA256:createHash('sha256').update(bytes).digest('hex'),
  encoder:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64',encoderVersion:'gd-lab-schema-v4'},candidateSpecId:'cand-suit-v3',epsilon:0,tierSpecId:'none',tieBreakId:'first-candidate-v1'});
 const p1=policy(1,bytes1),p2=policy(2,bytes2),release=(n:number)=>({releaseRef:`ohuo-v1.${n}.0-1101`,label:`synthetic analysis R${n}`,proposalPolicyRef:`record-chain-synthetic-r${n}`,mode:'local',tier:'hard',status:'candidate',parentRelease:null});
 const product=(n:number,p:PolicyDescriptor)=>({releaseRef:release(n).releaseRef,policyId:p.policyId,weightsSHA256:p.weightsSHA256,name:'ohuo',version:`1.${n}.0`,displayVersion:`v1.${n}.0`,effectiveDate:'2026-11-01'});
 const oldLayout=['human',release(1).releaseRef,release(1).releaseRef,release(1).releaseRef];
 fixture.virtual={default:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:p2.policyId,policies:[p1,p2]},
  productCatalog:{schema:'ohuo-product-model-catalog-v1',formalLocalReleaseRef:release(2).releaseRef,models:[product(1,p1),product(2,p2)]},
  releaseCatalog:{schemaVersion:'ohuo-release-index-v1',releases:[release(1),release(2)],legacyProductLayouts:{easy:oldLayout,standard:oldLayout,hard:oldLayout}}};
 const frozenDirectory=JSON.stringify(fixture.virtual),memory=new Map<string,string>();
 const storage:Storage={get length(){return memory.size;},clear:()=>memory.clear(),key:i=>[...memory.keys()][i]??null,
  getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,String(value));},removeItem:key=>{memory.delete(key);}};
 vi.stubGlobal('localStorage',storage);vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',()=>{throw Error('unapproved network boundary');});
 const {providerPresetFields}=await import('../src/game/provider-presets');
 // Two different IDs, only P2 matches today's preset: real provider selector can produce this ready view.
 const currentProfile={...providerPresetFields('glm',{profileId:'record-chain-p2',nickname:'synthetic current coach'}),revision:1,snapshotHash:'b'.repeat(64)};
 const oldProfile={...currentProfile,profileId:'record-chain-p1',nickname:'synthetic pinned coach',requestedModel:'old-model',snapshotHash:'a'.repeat(64)};
 const reference=(p:typeof currentProfile)=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
 let shared:ProviderStateView={schema:'ohuo-provider-state-v1',profiles:[oldProfile,currentProfile],providers:{
  glm:{availability:'ready',reference:reference(currentProfile),connection:{state:'untested',reason:'no_receipt'}},
  deepseek:{availability:'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}},
 }};
 const assets=new Map([[p1.weightsPathOrUrl.assetUrl!,bytes1],[p2.weightsPathOrUrl.assetUrl!,bytes2]]),assetReads:string[]=[],profileGets:string[]=[],chatBodies:any[]=[],forbiddenURLs:string[]=[];
 const complete=deferred<Response>();let productReads=0;
 const fetcher=vi.fn(async(input:string|URL|Request,init?:RequestInit):Promise<Response>=>{
  const url=String(input);
  if(assets.has(url)){expect(init?.method).toBeUndefined();assetReads.push(url);return new Response(new Uint8Array(assets.get(url)!),{status:200});}
  if(url==='review6-product-status-003.json'){expect(init?.method).toBeUndefined();productReads++;return Response.json(null);}
  if(url==='/api/llm-profiles?view=providers'){expect(init?.method).toBeUndefined();profileGets.push(url);return Response.json(structuredClone(shared));}
  if(url==='/api/chat'){expect(init?.method).toBe('POST');expect(init?.signal?.aborted).toBe(false);chatBodies.push(JSON.parse(String(init?.body)));return complete.promise;}
  forbiddenURLs.push(url);throw Error(`unexpected fake-only URL: ${url}`);
 });vi.stubGlobal('fetch',fetcher);
 const engine=await import('@gd/engine'),ai=await import('@gd/ai'),review=await import('@gd/review'),coachProtocol=await import('../../review/src/coachJson');
 const {selectionPolicyIdentity}=await import('../src/game/ai-selection'),{projectReleaseCatalog}=await import('../../ai/src/policy/seats');
 const releases=projectReleaseCatalog(fixture.virtual.releaseCatalog),release1=releases.find(r=>r.releaseRef===release(1).releaseRef)!,release2=releases.find(r=>r.releaseRef===release(2).releaseRef)!;
 const identity1={...selectionPolicyIdentity(p1),candidateCompat:undefined},identity2={...selectionPolicyIdentity(p2),candidateCompat:undefined};
 const seatConfig:SeatSnapshot={schemaVersion:2,seats:[{controller:'human'},...Array.from({length:3},(_,i)=>{const old=i+1===2,registered=old?release1:release2;return{controller:'ai' as const,mode:'local' as const,releaseRef:registered.releaseRef,release:registered,policyIdentity:old?identity1:identity2};})]};
 const savedReference=(p:PolicyDescriptor)=>`neural-policy:v1:${encodeURIComponent(p.policyId)}:${p.weightsSHA256}:hard`;
 // Same finite playRecord construction as the original review.test, one seed only.
 const seed=101,rng=new engine.RNG(seed),match=engine.createMatch({...engine.DEFAULT_RULES},seed),state=engine.startGame(match);
 const recorder=new engine.Recorder({schemaVersion:2,id:'synthetic-frozen-analysis-record',matchId:'synthetic-review-chain',createdAt:1793491200000,
  ruleOpts:{...engine.DEFAULT_RULES},levelsBefore:[...state.levelsBefore] as [number,number],stageTeam:state.stageTeam,leader:state.leader,humanSeat:0,difficulties:[null,1,1,1],initialHands:state.hands.map(h=>[...h])});
 const memories=[0,1,2,3].map(()=>ai.PlayMemory.fromStart(state.ctx));let guard=0;
 while(!state.over&&guard++<2000){
  const seat=state.turn,combos=engine.legalCombos(state);let move=ai.decideMove({state,seat,caps:{memory:true,inference:false,cooperation:true,planning:true,noise:0.1,rolloutIters:0},memory:memories[seat],rand:rng.next.bind(rng)});
  if(move.pass&&!engine.canPass(state))move={pass:false,combo:combos[0]};
  if(!move.pass){const chosen=move.combo;if(!combos.some(c=>c===chosen))move=combos.length?{pass:false,combo:combos[0]}:{pass:true};}
  const toBeat=state.lastCombo;engine.applyMove(state,move);recorder.record(seat,{pass:move.pass,combo:move.pass?null:move.combo},state.hands,toBeat);
 }
 expect(state.over,'single synthetic record must genuinely finish').toBe(true);expect(state.result).not.toBeNull();
 // This metadata declares an analysis fixture, NOT a claim the heuristic game was played by real C/O.
 const record:GameRecord&{seatConfig:SeatSnapshot}={...recorder.finish(state.result!),seatConfig,aiPolicies:['human',savedReference(p2),savedReference(p1),savedReference(p2)]};
 const store=await import('../src/game/storage');store.saveRecord(record);
 const recordKey=`gd_record_${record.id}`,recordBytes=memory.get(recordKey),indexBytes=memory.get('gd_records_index');expect(recordBytes).toBeDefined();expect(indexBytes).toBeDefined();
 const unchanged=()=>{expect(memory.get(recordKey)).toBe(recordBytes);expect(memory.get('gd_records_index')).toBe(indexBytes);expect(JSON.stringify(fixture.virtual)).toBe(frozenDirectory);};
 const {ReviewPicker}=await import('../src/ui/ReviewPicker'),{ReviewPage}=await import('../src/ui/ReviewPage'),{VerifiedReportTab}=await import('../src/ui/VerifiedReportTab'),{DecisionFactsPanel}=await import('../src/ui/DecisionFactsPanel');
 let opened:GameRecord|undefined;const picker=mount(ReviewPicker,{onOpen:(value:GameRecord)=>{opened=value;}});
 expect(picker.button('开始复盘').props.disabled).not.toBe(true);picker.button('开始复盘').props.onClick();expect(opened?.id).toBe(record.id);expect(opened?.moves).toEqual(record.moves);expect((opened as typeof record).seatConfig).toEqual(JSON.parse(JSON.stringify(seatConfig)));
 const page=mount(ReviewPage,{record:opened!,settings:{},onBack:vi.fn()}).render();
 expect(page.text()).not.toContain('该记录无法复盘');expect(assetReads).toEqual([]);expect(chatBodies).toHaveLength(0);
 const dots=page.nodes().filter(n=>n.type==='button'&&typeof n.props.className==='string'&&n.props.className.startsWith('tl-dot'));
 expect(dots).toHaveLength(record.moves.length);const target=record.moves.findIndex(m=>m.player!==0&&m.player!==2);expect(target).toBeGreaterThanOrEqual(0);dots[target].props.onClick();page.render();
 expect(page.child(DecisionFactsPanel)).toMatchObject({moveNo:record.moves[target].moveNo,viewerSeat:0});
 const analysisSelect=(r:Render)=>{const box=r.nodes().find(n=>n.props.className==='recorded-analysis');expect(box).toBeDefined();return r.nodes(box).find(n=>n.type==='select');};
 analysisSelect(page).props.onChange({target:{value:'2'}});page.render();expect(assetReads).toEqual([]);page.button('加载冻结本地政策分析（不请求API）').props.onClick();page.render();
 await vi.waitFor(()=>{page.render();expect(page.child(VerifiedReportTab).modelDisplay.cacheDisplayContext.analysisIdentity).toEqual(identity1);});
 const coachProps=page.child(VerifiedReportTab),projection=coachProps.modelDisplay,evidence=coachProps.evidence;
 expect(coachProps.record).toBe(opened);expect(coachProps.viewerSeat).toBe(0);expect(evidence).toBe(projection.displayEvidences);expect(evidence.length).toBeGreaterThan(0);
 expect(projection.cacheDisplayContext).toMatchObject({analysisSeat:2,analysisIdentity:identity1,referenceOnly:false,unverifiedModelClaimIds:[]});expect(projection.sourceLabel).toBe(release(1).releaseRef);
 expect(record.moves[target].player).not.toBe(0);expect(record.moves[target].player).not.toBe(2);expect((opened as typeof record).seatConfig.seats[record.moves[target].player]).toMatchObject({policyIdentity:{policyId:p2.policyId}});expect(assetReads).toEqual([p1.weightsPathOrUrl.assetUrl]);expect(assetReads).not.toContain(p2.weightsPathOrUrl.assetUrl);
 expect(evidence.every((e:any)=>e.recordId===record.id&&e.seat===0&&e.policy?.proposalPolicyId===p1.policyId&&e.policy?.weightHash===p1.weightsSHA256)).toBe(true);
 const ev=evidence.find((e:any)=>e.claims.some((c:any)=>c.kind==='policy_preference'&&c.scope==='model_preference'));expect(ev,'real analysis must supply a model claim').toBeDefined();
 const claim=ev.claims.find((c:any)=>c.kind==='policy_preference'&&c.scope==='model_preference');expect(claim.text).toContain(projection.sourceLabel);unchanged();
 // Same actual evidence/projection reaches the real coach, client, strict gate and scoped cache.
 const legacy='synthetic legacy report: not verified';store.saveReport(record.id,legacy,0);store.saveChatProfileReference(reference(oldProfile));
 const coach=mount(VerifiedReportTab,coachProps).render();await vi.waitFor(()=>{coach.render();expect(coach.button('生成 AI 讲解').props.disabled).toBe(false);});
 expect(coach.text()).toContain('历史讲解未通过');expect(coach.nodes().some(n=>n.props['data-testid']==='accepted-coach-output')).toBe(false);expect(store.loadReport(record.id,0)).toBe(legacy);expect(chatBodies).toHaveLength(0);
 const choice=coach.nodes().find(n=>n.type==='select');expect(choice.props.value).toBe(JSON.stringify(reference(oldProfile)));expect(coach.nodes(choice).find(n=>n.type==='option'&&n.props.value===choice.props.value)?.props.disabled).toBe(true);
 const getBefore=profileGets.length,pending=coach.button('生成 AI 讲解').props.onClick();await vi.waitFor(()=>expect(chatBodies).toHaveLength(1));coach.render();
 expect(profileGets).toHaveLength(getBefore+1);expect(chatBodies[0].reference).toEqual(reference(oldProfile));expect(Object.keys(chatBodies[0]).sort()).toEqual(['messages','reference']);
 expect(chatBodies[0].messages.some((m:any)=>m.content.includes(claim.text)&&m.content.includes(ev.decisionId))).toBe(true);
 expect(coach.nodes().some(n=>n.props['data-testid']==='accepted-coach-output')).toBe(false);expect(store.loadReport(record.id,0)).toBe(legacy);
 const output={summary:'以下陈述原谱事实；策略优劣尚未验证。',lessons:[{decisionId:ev.decisionId,actionIds:[claim.subjectActionId,ev.actual.actionId],factIds:[...claim.factIds],claimIds:[claim.claimId],claimLevel:ev.claimLevel,title:'建议来源',text:claim.text}]};
 const raw=JSON.stringify(output);expect(coachProtocol.validateCoachJson(output,evidence)).toEqual([]);
 complete.resolve(Response.json({status:'completed',text:raw,summary:{...reference(oldProfile),protocol:oldProfile.protocol,requestedModel:oldProfile.requestedModel,returnedModel:'synthetic-coach',requestCount:1}}));await pending;coach.render();
 const accepted=coach.nodes().find(n=>n.props['data-testid']==='accepted-coach-output');expect(accepted).toBeDefined();expect(coach.text(accepted)).toContain(claim.text);
 const context={...projection.cacheDisplayContext,recordId:record.id,viewerSeat:0,seatDisplayVersion:review.SEAT_DISPLAY_VERSION,factsSchema:'decision-facts-v3',policyIds:evidence.map((e:any)=>e.policy)};
 const cached=store.loadReport(record.id,0);expect(cached).not.toBe(legacy);expect(review.readCoachCache(cached,evidence,context)).toEqual(output);
 expect(JSON.parse(JSON.parse(cached!).witness).context).toMatchObject({analysisSeat:2,analysisIdentity:JSON.parse(JSON.stringify(identity1)),viewerSeat:0});unchanged();
 shared={...shared,profiles:[currentProfile]};await coach.button('生成 AI 讲解').props.onClick();coach.render();expect(chatBodies).toHaveLength(1);expect(coach.text()).toContain('本次未调用模型');expect(store.loadChatProfileReference()).toEqual(reference(oldProfile));unchanged();
 // One explicit missing recorded reference: refuse analysis, never silently use formal R2.
 const missing={...opened!,aiPolicies:opened!.aiPolicies!.map((p,i)=>i===2?'missing-recorded-policy':p)},assetCount=assetReads.length;
 const missingPage=mount(ReviewPage,{record:missing,settings:{},onBack:vi.fn()}).render();analysisSelect(missingPage).props.onChange({target:{value:'2'}});missingPage.render();missingPage.button('加载冻结本地政策分析（不请求API）').props.onClick();missingPage.render();
 await vi.waitFor(()=>{missingPage.render();expect(missingPage.text()).toContain('政策加载失败');});expect(assetReads).toHaveLength(assetCount);expect(chatBodies).toHaveLength(1);expect(productReads).toBe(2);expect(profileGets).toHaveLength(getBefore+2);expect(forbiddenURLs).toEqual([]);unchanged();
});
