import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const hook=vi.hoisted(()=>({current:null as any}));
vi.mock('react',async original=>({...await original<any>(),
 useState:(v:any)=>hook.current.state(v),useRef:(v:any)=>hook.current.ref(v),useEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),
}));
import {HomePage} from '../src/ui/HomePage';
import {AISelectionModal,makeAIChoiceOptions} from '../src/ui/AISelectionModal';
import {SettingsModal} from '../src/ui/SettingsModal';
import {SeatPicker,assignmentKey} from '../src/ui/SeatPicker';
import {newGameSettingsFromLegacy,setAllDraftSeats,resolveNewGameAssignments} from '../src/game/ai-selection';
import {validatePolicyIndex} from '../../ai/src/policy/descriptor';
import {RELEASES} from '../../ai/src/policy/seats';
import {providerPresetFields} from '../src/game/provider-presets';
const policies=validatePolicyIndex(JSON.parse(readFileSync(new URL('../../../lab/model-index.json',import.meta.url),'utf8'))).policies;
const choices=RELEASES.map(release=>({release,available:true}));
const auto=newGameSettingsFromLegacy({passA:'double'}),context={policies,choices};
const p={...providerPresetFields('deepseek',{profileId:'fake-ds',nickname:'same name'}),revision:1,snapshotHash:'a'.repeat(64)};
const ref={profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash};
const emptyProvider={availability:'missing' as const,reference:null,connection:{state:'unknown' as const,reason:'provider_not_ready' as const}};
const providerView=(profiles:any[]=[p],references:any={deepseek:ref})=>({schema:'ohuo-provider-state-v1' as const,profiles,providers:{
 glm:references.glm?{availability:'ready' as const,reference:references.glm,connection:{state:'untested' as const,reason:'no_receipt' as const}}:emptyProvider,
 deepseek:references.deepseek?{availability:'ready' as const,reference:references.deepseek,connection:{state:'untested' as const,reason:'no_receipt' as const}}:emptyProvider,
}});
const shared=providerView();
const hybrid={controller:'ai' as const,mode:'hybrid' as const,releaseRef:'ohuo-1030-h-v1',profileRevisionRef:ref};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
/** Same bounded real-handler method as the existing M tests; not a DOM/IAB claim. */
class Render {
 slots:any[]=[];index=0;effects:(()=>void)[]=[];tree:any;
 constructor(public component:any,public props:any){}
 slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
 state(initial:any){const s=this.slot(()=>({value:typeof initial==='function'?initial():initial}));return [s.value,(v:any)=>{s.value=typeof v==='function'?v(s.value):v;}];}
 ref(v:any){return this.slot(()=>({current:v}));}
 effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps[i]))){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
 render(){this.index=0;hook.current=this;this.tree=this.component(this.props);hook.current=null;this.effects.splice(0).forEach(fn=>fn());return this;}
 unmount(){this.slots.forEach(s=>s.cleanup?.());}
 nodes(node=this.tree):any[]{if(Array.isArray(node))return node.flatMap(n=>this.nodes(n??null));if(!node||typeof node!=='object')return [];return [node,...this.nodes(node.props?.children??null)];}
 text(node=this.tree):string{if(Array.isArray(node))return node.map(n=>this.text(n??null)).join('');if(node==null||typeof node==='boolean')return '';return typeof node==='object'?this.text(node.props?.children??null):String(node);}
 button(text:string){const node=this.nodes().find(n=>n.type==='button'&&(this.text(n??null)===text||n.props['aria-label']===text));expect(node,`button ${text}`).toBeDefined();return node;}
}
beforeEach(()=>{vi.stubGlobal('document',{activeElement:{focus:vi.fn()}});vi.stubGlobal('localStorage',{getItem:()=>{throw Error('real storage forbidden');},setItem:()=>{throw Error('real storage forbidden');}});vi.stubGlobal('fetch',()=>{throw Error('real network forbidden');});});
afterEach(()=>vi.unstubAllGlobals());
function home(settings=auto,profiles:any[]=[],override:any={}){return new Render(HomePage,{settings,profiles,context,onPassA:vi.fn(),onAISelection:vi.fn(),onStart:vi.fn(),onResume:vi.fn(),onAbandon:vi.fn(),fixture:{stats:{games:10,wins:10,headFinish:9,byDifficulty:{}},resume:null},...override}).render();}
function modal(value:any=auto,props:any={}){const onConfirm=vi.fn(),onClose=vi.fn(),services={refreshProfiles:vi.fn(async()=>[p]),refreshProviderState:vi.fn(async()=>shared)};const r=new Render(AISelectionModal,{value,context,onConfirm,onClose,services,...props}).render();return {r,onConfirm,onClose,services};}
it('home removes custom-seat switch, locks middle tier without faded/changed strategy and collapses same full AI identity',()=>{
 const r=home(),radios=r.nodes().filter(n=>n.type==='button'&&n.props.role==='radio').slice(0,3);
 expect(radios.map(n=>[n.props.disabled,n.props['aria-checked']])).toEqual([[true,false],[true,true],[true,false]]);
 expect(r.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')).toHaveLength(0);
 expect(r.text()).not.toMatch(/默认模式|自选四席|clean2|当前固定为标准档|你是1号/);
 expect(r.text().match(/ohuo-v1-1031/g)).toHaveLength(1);
 expect(r.button('AI选择，更换新局队友和对手').props.onClick).toBe(r.props.onAISelection);
 expect(r.nodes(r.button('AI选择，更换新局队友和对手')).filter(n=>n.type==='button')).toHaveLength(1);
});
it('mixed card shows all 2/3/4 rows; same-name different profile revision does not collapse',()=>{
 const next={...p,revision:2,snapshotHash:'b'.repeat(64)},settings=setAllDraftSeats(auto,hybrid);
 if(settings.aiSelection.kind!=='explicit')throw Error('fixture');
 const mixed={...settings,aiSelection:{kind:'explicit',seats:settings.aiSelection.seats.map((s,i)=>i===3?{...hybrid,profileRevisionRef:{...ref,revision:2,snapshotHash:next.snapshotHash}}:s)}};
 const r=home(mixed as any,[p,next]);expect(r.text()).toMatch(/2号 · 队友.*3号 · 左侧.*4号 · 右侧/);
 expect(r.text().match(/ohuo-v1-1031 \+ DeepSeek/g)).toHaveLength(3);expect(r.text()).not.toMatch(/协助|混合/);
});
it('selectors render 1 fixed plus exact 2/3/4 engine order, never choose first profile for a release',()=>{
 const options=makeAIChoiceOptions({...context,profiles:[p]},shared).options;
 expect(options.filter(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='hybrid')).toHaveLength(1);
 const empty=makeAIChoiceOptions({...context,profiles:[p]},providerView([p],{}));expect(empty.options.some(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='hybrid')).toBe(false);
 const r=new Render(SeatPicker,{value:resolveNewGameAssignments(auto,context),options,onChange:vi.fn()}).render();
 expect(r.nodes().filter(n=>n.type==='select').map(n=>n.props['aria-label'])).toEqual(['2号牌手','3号牌手','4号牌手']);
 r.nodes().find(n=>n.type==='select').props.onChange({target:{value:assignmentKey(hybrid)}});expect(r.props.onChange).toHaveBeenCalledWith(2,hybrid);
});
it('unchanged confirm retains auto; uniform draft is explicit; restore default preserves passA',async()=>{
 const {r,onConfirm}=modal();await settle();r.render();r.button('确认选择').props.onClick();await settle();expect(onConfirm).toHaveBeenCalledWith({kind:'auto_latest'},[p]);
 const next=modal();await settle();next.r.render();next.r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(hybrid)}});next.r.render();
 const selector=next.r.nodes().find(n=>n.type===SeatPicker);expect(selector.props.value.slice(1)).toEqual([hybrid,hybrid,hybrid]);
 next.r.button('恢复默认').props.onClick();next.r.render();next.r.button('确认选择').props.onClick();await settle();expect(next.onConfirm).toHaveBeenCalledWith({kind:'auto_latest'},[p]);expect(auto.passA).toBe('double');
});
it.each(['取消','关闭AI选择','Escape','mask','unmount'])('%s drops the draft and cannot commit late profile results',async action=>{
 const hold=deferred<any[]>(),services={refreshProfiles:async()=>[p],refreshProviderState:()=>hold.promise.then(rows=>providerView(rows))};const {r,onConfirm,onClose}=modal(auto,{services});
 r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey({controller:'ai',mode:'local',releaseRef:'ohuo-1030-b-v1'})}});r.render();
 if(action==='unmount')r.unmount();else if(action==='Escape')r.tree.props.onKeyDown({key:'Escape',preventDefault:vi.fn()});else if(action==='mask'){const target={};r.tree.props.onClick({target,currentTarget:target});}else r.button(action).props.onClick();
 hold.resolve([p]);await settle();expect(onConfirm).not.toHaveBeenCalled();if(action!=='unmount')expect(onClose).toHaveBeenCalledOnce();expect(auto.aiSelection.kind).toBe('auto_latest');
});
it('storage failure retains explicit draft, remains open, and does not report success',async()=>{
 const onConfirm=vi.fn(()=>{throw Error('quota');}),{r,onClose}=modal(auto,{onConfirm});await settle();r.render();r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(hybrid)}});r.render();r.button('确认选择').props.onClick();await settle();r.render();
 expect(onClose).not.toHaveBeenCalled();expect(r.text()).toContain('未保存：Error: quota');expect(r.nodes().find(n=>n.type===SeatPicker).props.value[1]).toEqual(hybrid);
});
it('repeated confirm sends one commit; closing during a held refresh discards the late result',async()=>{
 const {r,onConfirm,services,onClose}=modal(setAllDraftSeats(auto,hybrid));await settle();r.render();const hold=deferred<any[]>();services.refreshProfiles.mockImplementation(()=>hold.promise);
 r.button('确认选择').props.onClick();r.button('确认选择').props.onClick();r.button('关闭AI选择').props.onClick();hold.resolve([p]);await settle();expect(onConfirm).not.toHaveBeenCalled();expect(onClose).toHaveBeenCalledOnce();expect(services.refreshProfiles).toHaveBeenCalledTimes(1);
});
it('missing profile cannot confirm or silently rebound; invalid preference needs explicit reset',async()=>{
 const {r}=modal(setAllDraftSeats(auto,hybrid),{services:{refreshProfiles:async()=>[],refreshProviderState:async()=>providerView([],{})}});await settle();r.render();expect(r.button('确认选择').props.disabled).toBe(true);expect(r.text()).toContain('profile_reference_unavailable');
 const invalid=modal(null);expect(invalid.r.button('确认选择').props.disabled).toBe(true);invalid.r.button('恢复默认').props.onClick();invalid.r.render();expect(invalid.r.button('确认选择').props.disabled).toBe(false);
});
it('S31-UI-01 retains a valid old explicit hybrid only on its original seat, never in uniform/new-seat choices',async()=>{
 const old={...p,profileId:'old-explicit',requestedModel:'legacy-model',snapshotHash:'d'.repeat(64)};
 const oldSeat={...hybrid,profileRevisionRef:{profileId:old.profileId,revision:old.revision,snapshotHash:old.snapshotHash}};
 const seats=resolveNewGameAssignments(auto,context).map((s,i)=>i===2?oldSeat:s);
 const value={...auto,aiSelection:{kind:'explicit',seats}};
 const {r,onConfirm}=modal(value,{services:{refreshProfiles:async()=>[p,old],refreshProviderState:async()=>providerView([p,old])}});await settle();r.render();
 const uniform=r.nodes().find(n=>n.props?.id==='ai-uniform');expect(r.nodes(uniform).filter(n=>n.type==='option').some(n=>n.props.value===assignmentKey(oldSeat))).toBe(false);
 const picker=r.nodes().find(n=>n.type===SeatPicker),rendered=new Render(SeatPicker,picker.props).render(),selects=rendered.nodes().filter(n=>n.type==='select');
 const options=(select:any)=>rendered.nodes(select).filter(n=>n.type==='option'&&n.props.value===assignmentKey(oldSeat));
 expect(options(selects[0])).toHaveLength(1);expect(options(selects[0])[0].props.disabled).toBe(true);expect(options(selects[1])).toHaveLength(0);expect(options(selects[2])).toHaveLength(0);
 r.button('确认选择').props.onClick();await settle();expect(onConfirm).toHaveBeenCalledWith(value.aiSelection,[p,old]);
});

it('S31-local-regression keeps both recognized provider combinations visible without inventing assignments',()=>{
 const none=providerView([],{});
 const result=makeAIChoiceOptions({...context,profiles:[]},none);
 for(const name of ['GLM','DeepSeek']){
  const option=result.options.find(o=>o.description.shortName===`ohuo-v1-1031 + ${name}`);
  expect(option,`${name} preset remains discoverable`).toBeDefined();
  expect(option?.available).toBe(false);expect(option?.assignment).toBeNull();
 }
 expect(result.issues.join(' ')).not.toContain('尚未配置');
 const rendered=new Render(SeatPicker,{value:resolveNewGameAssignments(auto,context),options:result.options,onChange:vi.fn()}).render();
 for(const select of rendered.nodes().filter(n=>n.type==='select')){
  for(const name of ['GLM','DeepSeek'])expect(rendered.nodes(select).some(n=>n.type==='option'&&n.props.disabled&&rendered.text(n).includes(`+ ${name}`))).toBe(true);
 }
 const unavailable=result.options.find(o=>o.description.shortName.endsWith('+ GLM'))!;
 rendered.nodes().find(n=>n.type==='select').props.onChange({target:{value:unavailable.key}});
 expect(rendered.props.onChange).not.toHaveBeenCalled();
});
it('S31-local-regression unavailable or loading shared reference stays visible, never guessed from a profile',()=>{
 const missing=makeAIChoiceOptions({...context,profiles:[]},providerView([],{}));
 expect(missing.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.available).toBe(false);
 expect(missing.issues.join(' ')).not.toContain('尚未配置');
 const ready=makeAIChoiceOptions({...context,profiles:[p]},shared);
 expect(ready.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.assignment).toEqual(hybrid);
 expect(ready.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.available).toBe(true);
 const failed=makeAIChoiceOptions({...context,profiles:[]},null,{profileIssue:'fixture_offline'});
 for(const name of ['GLM','DeepSeek']){const option=failed.options.find(o=>o.description.shortName.endsWith(`+ ${name}`));expect(option?.available).toBe(false);expect(option?.reason).toContain('读取失败');expect(option?.reason).not.toContain('正在读取');}
 const glm={...providerPresetFields('glm',{profileId:'saved-glm',nickname:'GLM'}),revision:7,snapshotHash:'c'.repeat(64)};
 const glmRef={profileId:glm.profileId,revision:glm.revision,snapshotHash:glm.snapshotHash};
 const recognized=makeAIChoiceOptions({...context,profiles:[glm]},providerView([glm],{glm:glmRef}));
 expect(recognized.options.find(o=>o.description.shortName.endsWith('+ GLM'))).toMatchObject({available:true,assignment:{profileRevisionRef:glmRef}});
});
it('S31-local-regression settings entry preserves draft and rereads shared state on return without committing',async()=>{
 let saved=false;
 const services={refreshProfiles:vi.fn(async()=>[p]),refreshProviderState:vi.fn(async()=>saved?shared:providerView([p],{}))};
 const {r,onConfirm}=modal(auto,{services});await settle();r.render();
 const local={controller:'ai',mode:'local',releaseRef:'ohuo-1030-b-v1'};
 r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(local as any)}});r.render();
 r.button('AI设置').props.onClick();r.render();
 const settings=r.nodes().find(n=>n.type===SettingsModal);expect(settings).toBeDefined();expect(onConfirm).not.toHaveBeenCalled();
 saved=true;settings.props.onClose();r.render();await settle();r.render();
 expect(services.refreshProviderState).toHaveBeenCalledTimes(2);
 expect(r.nodes().find(n=>n.type===SeatPicker).props.value.slice(1)).toEqual([local,local,local]);
 expect(r.nodes().some(n=>n.type==='option'&&!n.props.disabled&&n.props.value===assignmentKey(hybrid))).toBe(true);
 expect(onConfirm).not.toHaveBeenCalled();
});
it('S31-local-regression restores native enabled row color and inherited card color without overriding child text paint',()=>{
 const css=readFileSync(new URL('../src/ui/app-frame.css',import.meta.url),'utf8');
 const row=css.match(/#sp-stage \.tz-radiogroup \.tz-row:disabled\s*\{([^}]+)\}/)?.[1]??'';
 const card=css.match(/#sp-stage \.ai-selection-card\s*\{([^}]+)\}/)?.[1]??'';
 expect(row).toMatch(/color\s*:\s*ButtonText\s*;/);expect(card).toMatch(/color\s*:\s*inherit\s*;/);
 expect(css).not.toMatch(/\.tz-row:disabled\s+\*[^}]*color|\.ai-selection-card\s+\*[^}]*color/);
});
it('S31-R2-UI-01 corrupt local metadata keeps provider diagnostics disabled instead of crashing the modal',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../src/game/local-model-releases.json',import.meta.url),'utf8'));
 const broken={...context,catalog:{...catalog,formalLocalReleaseRef:'absent'},profiles:[]};
 let result:ReturnType<typeof makeAIChoiceOptions>|undefined;
 expect(()=>{result=makeAIChoiceOptions(broken,providerView([],{}));}).not.toThrow();
 expect(result!.options).toHaveLength(2);
 expect(result!.options.every(o=>!o.available&&o.assignment===null&&o.description.shortName.includes('底座未就绪'))).toBe(true);
 expect(result!.issues.join(' ')).toContain('formal_local_release_unavailable');
 const {r}=modal(auto,{context:broken});expect(r.button('确认选择').props.disabled).toBe(true);
 expect(r.text()).toContain('本地底座未就绪');
});
it('S31 shared backend exactRefs produce both provider choices without any browser binding read or implicit confirmation',async()=>{
 const glm={...providerPresetFields('glm',{profileId:'shared-glm',nickname:'same name'}),revision:2,snapshotHash:'e'.repeat(64)};
 const gref={profileId:glm.profileId,revision:glm.revision,snapshotHash:glm.snapshotHash},state=providerView([p,glm],{glm:gref,deepseek:ref});
 const services={refreshProfiles:async()=>[p,glm],refreshProviderState:async()=>state};
 const a=modal(auto,{services}),b=modal(auto,{services});await settle();a.r.render();b.r.render();
 for(const r of [a.r,b.r]){const select=r.nodes().find(n=>n.props?.id==='ai-uniform');const options=r.nodes(select).filter(n=>n.type==='option'&&!n.props.disabled);expect(options.some(n=>n.props.value===assignmentKey(hybrid))).toBe(true);expect(options.some(n=>n.props.value===assignmentKey({...hybrid,profileRevisionRef:gref}))).toBe(true);}
 expect(a.onConfirm).not.toHaveBeenCalled();expect(b.onConfirm).not.toHaveBeenCalled();expect(auto.aiSelection.kind).toBe('auto_latest');
});

it('R5 provider historical diagnostic appears in the existing identity-details field',()=>{
 const state=providerView();state.providers.deepseek.connection={state:'passed',testedAt:'2026-10-31T18:58:22.528252Z',scope:'native-connection-probe',httpStatus:200,returnedModel:'deepseek-flash'} as any;
 const option=makeAIChoiceOptions({...context,profiles:[p]},state).options.find(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='hybrid')!;
 expect(option.description.detail).toContain('2026-10-31 18:58:22 UTC');expect(option.description.detail).toContain('非网页业务调用验收');
});

it('naming A: new choices expose only formal standard; old O intent requires explicit reset and cancel preserves it',async()=>{
 const options=makeAIChoiceOptions({...context,profiles:[p]},shared).options;
 expect(options).toHaveLength(3);expect(options.filter(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='local')).toHaveLength(1);
 expect(options.some(o=>o.assignment?.controller==='ai'&&o.assignment.releaseRef.startsWith('product-o-'))).toBe(false);
 for(const release of RELEASES.filter(r=>r.releaseRef.startsWith('product-o-'))){
  const old=setAllDraftSeats(auto,{controller:'ai',mode:'local',releaseRef:release.releaseRef}),before=JSON.stringify(old);
  expect(()=>resolveNewGameAssignments(old,context)).toThrow('历史选择，当前仅提供标准档，请恢复默认后确认');
  const cancelled=modal(old);await settle();cancelled.r.render();expect(cancelled.r.text()).toContain('历史选择，当前仅提供标准档，请恢复默认后确认');
  expect(cancelled.r.button('确认选择').props.disabled).toBe(true);cancelled.r.button('取消').props.onClick();expect(cancelled.onConfirm).not.toHaveBeenCalled();expect(JSON.stringify(old)).toBe(before);
  const reset=modal(old);await settle();reset.r.render();reset.r.button('恢复默认').props.onClick();reset.r.render();reset.r.button('确认选择').props.onClick();await settle();
  expect(reset.onConfirm).toHaveBeenCalledWith({kind:'auto_latest'},[p]);expect(JSON.stringify(old)).toBe(before);
 }
});

it('modal visible focus ring includes summaries but wraps only after the last visible control',async()=>{
 const {r}=modal();await settle();r.render();
 const dialog=r.nodes().find(n=>n.props?.role==='dialog');let queried='';
 const node=(tag:string,visible=true):any=>({tag,tabIndex:0,visible,focus:vi.fn(),getClientRects(){return this.visible?[{}]:[];}});
 const first=node('button'),summary=node('summary'),folded=node('input',false),cancel=node('button'),save=node('button'),hidden=node('button',false),nodes=[first,summary,folded,cancel,save,hidden];
 dialog.ref.current={querySelectorAll:(selector:string)=>{queried=selector;return nodes.filter(n=>n.tag!=='summary'||selector.includes('summary'));}};
 vi.stubGlobal('getComputedStyle',()=>({visibility:'visible'}));
 const event=(shiftKey=false)=>({key:'Tab',shiftKey,preventDefault:vi.fn()});
 vi.stubGlobal('document',{activeElement:save});let e=event();r.tree.props.onKeyDown(e);expect(e.preventDefault).toHaveBeenCalledTimes(1);expect(first.focus).toHaveBeenCalledTimes(1);expect(queried).toContain('summary');
 vi.stubGlobal('document',{activeElement:first});e=event(true);r.tree.props.onKeyDown(e);expect(save.focus).toHaveBeenCalledTimes(1);
 vi.stubGlobal('document',{activeElement:summary});e=event();r.tree.props.onKeyDown(e);expect(e.preventDefault).not.toHaveBeenCalled();
 cancel.visible=false;save.visible=false;e=event();r.tree.props.onKeyDown(e);expect(e.preventDefault).toHaveBeenCalledTimes(1);expect(first.focus).toHaveBeenCalledTimes(2);expect(hidden.focus).not.toHaveBeenCalled();expect(folded.focus).not.toHaveBeenCalled();r.unmount();
});

it('F07 selected hybrid reaches native transport and next decision',async()=>{
 const {createHash}=await import('node:crypto'),{mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os'),{join}=await import('node:path'),{EventEmitter}=await import('node:events');
 const {DEFAULT_RULES,legalCombos}=await import('@gd/engine');
 const {NeuralDecider}=await import('@gd/ai');
 const {resolvePolicy}=await import('../../ai/src/policy/resolve');
 const {faceCounts,publicCombo}=await import('../../ai/src/hybrid/protocol');
 const {resolveFourSeats}=await import('../src/game/seats');
 const {resolveNewGameSeats,validateNewGameSettings}=await import('../src/game/ai-selection');
 const {MatchController}=await import('../src/game/controller');
 // @ts-expect-error Node server helper intentionally JS; never imported by browser production.
 const {createProfileStore}=await import('../server/llm-profiles.mjs');
 // @ts-expect-error Node server helper intentionally JS; same route as the actual foreground adapter.
 const {createPlayRoutes}=await import('../server/play-routes.mjs');
 const temp=await mkdtemp(join(tmpdir(),'ohuo-f07-'));
 let controller:InstanceType<typeof MatchController>|undefined,r:Render|undefined;
 let restoreScore:(()=>void)|undefined;
 try {
  const bytes=new Uint8Array(policies.find(d=>d.tierSpecId==='none')!.parameterCount*4);
  const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
  const descriptor={...policies.find(d=>d.tierSpecId==='none')!,policyId:'f07-synthetic-policy',weightsSHA256:digest(bytes),
   weightsPathOrUrl:{assetUrl:'f07-memory-only.f32'}};
  const local={...RELEASES.find(release=>release.releaseRef==='ohuo-1030-b-v1')!,releaseRef:'ohuo-v1.1.0-1101',
   proposalPolicyRef:descriptor.policyId,remoteFallbackPolicyRef:descriptor.policyId};
  const remote={...RELEASES.find(release=>release.releaseRef==='ohuo-1030-h-v1')!,releaseRef:`${local.releaseRef}-hybrid`,
   parentRelease:local.releaseRef,proposalPolicyRef:descriptor.policyId,remoteFallbackPolicyRef:descriptor.policyId};
  const catalog={schema:'ohuo-product-model-catalog-v1',formalLocalReleaseRef:local.releaseRef,models:[{
   releaseRef:local.releaseRef,policyId:descriptor.policyId,weightsSHA256:descriptor.weightsSHA256,name:'ohuo',
   version:'1.1.0',displayVersion:'v1.1.0',effectiveDate:'2026-11-01'}]};
  const store=createProfileStore({filePath:join(temp,'profiles.json')});
  const sentinel='F07-only-synthetic-credential-not-real';
  const profile=store.save({expectedRevision:null,profile:{...providerPresetFields('deepseek',{profileId:'f07-fixture',nickname:'F07 synthetic'}),secret:sentinel}});
  const exactRef={profileId:profile.profileId,revision:profile.revision,snapshotHash:profile.snapshotHash};
  const ctx={catalog,policies:[descriptor],releases:[local,remote],choices:[{release:local,available:true},{release:remote,available:true}],profiles:[profile]};
  const frozenInputs=JSON.stringify({catalog,descriptor,local,remote,profile,auto});
  const view=providerView([profile],{deepseek:exactRef});
  const onConfirm=vi.fn(),onClose=vi.fn();
  r=new Render(AISelectionModal,{value:auto,context:ctx,onConfirm,onClose,
   services:{refreshProviderState:async()=>view,refreshProfiles:async()=>store.list()}}).render();
  await settle();r.render();
  const chosen={controller:'ai' as const,mode:'hybrid' as const,releaseRef:remote.releaseRef,profileRevisionRef:exactRef};
  r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(chosen)}});r.render();
  await r.button('确认选择').props.onClick();await settle();
  expect(onConfirm).toHaveBeenCalledOnce();expect(onClose).toHaveBeenCalledOnce();
  const [selection,confirmedProfiles]=onConfirm.mock.calls[0];
  // Same settings merge/validator as App.commitAI; never reconstruct a choice after confirmation.
  const settings=validateNewGameSettings({...auto,aiSelection:selection});
  expect(settings.aiSelection).toEqual({kind:'explicit',seats:[{controller:'human'},chosen,chosen,chosen]});
  expect(confirmedProfiles).toEqual([profile]);r.unmount();r=undefined;
  const loaded=await resolveNewGameSeats(settings,ctx,assignments=>resolveFourSeats(assignments,
   ref=>resolvePolicy(ref,{registry:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:descriptor.policyId,policies:[descriptor]},site:'browser',
    readWeights:async location=>{expect(location).toBe('f07-memory-only.f32');return bytes;},sha256:digest}),confirmedProfiles,[local,remote]));
  const frozenSeats=JSON.stringify(loaded.snapshot);
  for(const seat of loaded.snapshot.seats.slice(1)){
   expect(seat).toMatchObject({controller:'ai',releaseRef:remote.releaseRef,mode:'hybrid',profileRevisionRef:exactRef,
    policyIdentity:{policyId:descriptor.policyId,weightsSHA256:descriptor.weightsSHA256,epsilon:0,tierSpecId:'none'}});
  }
  const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,
   setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);},key:(i:number)=>[...memory.keys()][i]??null,get length(){return memory.size;}});
  const nativeViews:any[]=[],nativeReplies:Array<()=>void>=[],browserBodies:any[]=[],receipts:any[]=[],responses:any[]=[],committedActors:number[]=[];
  const resolvedRefs:any[]=[];const resolve=store.resolve.bind(store);store.resolve=(reference:any)=>{resolvedRefs.push(structuredClone(reference));return resolve(reference);};
  const nativeFake=vi.fn(async(url:string,options:RequestInit)=>{
   expect(url).toBe(`${profile.baseUrl}/chat/completions`);expect(options.method).toBe('POST');
   const body=JSON.parse(options.body as string);expect(body.model).toBe(profile.requestedModel);expect(body.stream).toBe(true);
   const dynamic=JSON.parse(body.messages.at(-1).content),state=controller!.state!,observation=dynamic.observation;
   expect(observation.actorSeat).toBe(state.turn);expect(observation.moveNo).toBe(state.moveNo);expect(observation.gameNo).toBe(state.match.gameNo);
   expect(observation.ownHand).toEqual(faceCounts(state.hands[state.turn]));
   // Original B02 keeps 3 entries with empty public lower bounds, not an empty outer array.
   expect(observation.knownOtherHands).toHaveLength(3);expect(observation.knownOtherHands.every((seat:any)=>seat.cards.length===0)).toBe(true);
   const actualMoves=controller!.matchSavePoint().activeGame!.moves;
   expect(observation.publicPrefix).toHaveLength(actualMoves.length);
   observation.publicPrefix.forEach((step:any,i:number)=>{
    const action=step.events.find((event:any)=>event.type==='play'||event.type==='pass'),actual=actualMoves[i];
    expect(step.moveNo).toBe(i+1);expect(action.player).toBe(committedActors[i]);expect(action.type).toBe(actual.pass?'pass':'play');
    if(!actual.pass)expect(action.combo).toEqual(publicCombo(actual.combo!));
   });
   function safe(value:any){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){
    expect(['hands','initialHands','state','controller','network','weights','secret','apiKey','rawQ','originalIndex'].includes(key)).toBe(false);safe(item);
   }}safe(dynamic);expect(JSON.stringify(dynamic)).not.toContain(sentinel);
   expect(dynamic.candidates.length).toBeGreaterThan(1);
   const candidate=dynamic.candidates.at(-1);expect(candidate.actionId).not.toBe(dynamic.candidates[0].actionId);
   nativeViews.push(structuredClone(dynamic));
   return new Promise<Response>(complete=>nativeReplies.push(()=>{
    const content=JSON.stringify({kind:'choose',decisionId:observation.decisionId,actionId:candidate.actionId});
    const text=`data: ${JSON.stringify({model:profile.requestedModel,choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`+
     `data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`;
    const data=new TextEncoder().encode(text),cut=Math.floor(data.length/2);
    complete(new Response(new ReadableStream<Uint8Array>({start(stream){stream.enqueue(data.slice(0,cut));stream.enqueue(data.slice(cut));stream.close();}}),
     {status:200,headers:{'content-type':'text/event-stream'}}));
   }));
  });
  const handler=createPlayRoutes({store,fetchImpl:nativeFake});
  const browserFetch=vi.fn(async(url:string|URL|Request,options?:RequestInit)=>{
   expect(url).toBe('/api/llm-play');expect(options?.method).toBe('POST');
   const command=JSON.parse(options!.body as string);expect(command.reference).toEqual(exactRef);browserBodies.push(command);
   const req=new EventEmitter() as any,res=new EventEmitter() as any;
   Object.assign(req,{url:'/api/llm-play',method:'POST',headers:{host:'localhost:8787',origin:'http://localhost:5180','content-type':'application/json'},
    socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(options!.body as string);}});
   Object.assign(res,{writableEnded:false,writeHead(status:number,headers:Record<string,string>){this.status=status;this.headers=headers;},
    end(body:string){this.body=body;this.writableEnded=true;}});
   const abort=()=>req.emit('aborted');options?.signal?.addEventListener('abort',abort,{once:true});
   try{await handler(req,res);}finally{options?.signal?.removeEventListener('abort',abort);}
   expect(res.writableEnded).toBe(true);const result=JSON.parse(res.body);receipts.push(result.summary);responses.push(result.response);
   return new Response(res.body,{status:res.status,headers:res.headers});
  });
  vi.stubGlobal('fetch',browserFetch);vi.useFakeTimers();const score=vi.spyOn(NeuralDecider.prototype,'decide');restoreScore=()=>score.mockRestore();
  // No remoteRequest injection: this must traverse the real default browser adapter.
  controller=new MatchController({difficulty:1,rules:{...DEFAULT_RULES,passA:settings.passA},seats:loaded,aiDelayMs:1});
  controller.match.rngState=1234;controller.startGame();let humanCommit=0;
  if(controller.humanTurn){committedActors.push(controller.state!.turn);controller.humanPlay(legalCombos(controller.state!)[0]);humanCommit++;}
  const firstMove=controller.state!.moveNo;
  for(let i=0;i<2;i++){
   await vi.advanceTimersByTimeAsync(1);await settle();
   expect(nativeFake).toHaveBeenCalledTimes(i+1);expect(browserFetch).toHaveBeenCalledTimes(i+1);
   expect(controller.state!.moveNo).toBe(firstMove+i);
   expect(controller.matchSavePoint().activeGame!.decisionRecords).toHaveLength(i);
   expect(controller.waitingRemote).toBe(true); // Held native stream: no remote commit yet.
   expect(browserBodies[i].view).toEqual(nativeViews[i]);
   nativeReplies[i]();await settle();await vi.advanceTimersByTimeAsync(0);
   const ledger=controller.matchSavePoint().activeGame!.decisionRecords!;
   expect(controller.state!.moveNo).toBe(firstMove+i+1);expect(ledger).toHaveLength(i+1);
   const outcome=ledger[i],request=nativeViews[i],selected=request.candidates.at(-1);
   expect(outcome).toMatchObject({status:'selected',source:'remote',actionId:selected.actionId,
    decisionKey:{moveNo:request.observation.moveNo,actorSeat:request.observation.actorSeat,gameNo:request.observation.gameNo}});
   expect(responses[i]).toEqual({kind:'choose',decisionId:request.observation.decisionId,actionId:selected.actionId});
   expect(outcome.remote?.decisionKey).toEqual(outcome.decisionKey);
   expect(publicCombo(outcome.actualMove!.pass?null:outcome.actualMove!.combo!)).toEqual(selected.action);
   expect(controller.matchSavePoint().executionState).toBe('confirmed');expect(controller.decisionError).toBeNull();
   committedActors.push(request.observation.actorSeat);
   expect(receipts[i]).toMatchObject({...exactRef,requestCount:1,httpStatus:200,requestedModel:profile.requestedModel,returnedModel:profile.requestedModel});
  }
  expect(nativeViews[1].observation.decisionId).not.toBe(nativeViews[0].observation.decisionId);
  const ledger=controller.matchSavePoint().activeGame!.decisionRecords!;
  expect(ledger[1].decisionKey.requestSeq).toBeGreaterThan(ledger[0].decisionKey.requestSeq);
  expect(resolvedRefs).toEqual([exactRef,exactRef]);expect(score).toHaveBeenCalledTimes(2);
  expect(ledger.filter(d=>d.source==='remote')).toHaveLength(2);expect(ledger.filter(d=>d.status==='fallback')).toHaveLength(0);
  expect(controller.state!.moveNo).toBe(humanCommit+2);
  expect(JSON.stringify(loaded.snapshot)).toBe(frozenSeats);expect(JSON.stringify({catalog,descriptor,local,remote,profile,auto})).toBe(frozenInputs);
  // Proxy/native calls are the two explicit fake boundaries above; no real supplier or asset fetch exists.
  expect(browserFetch).toHaveBeenCalledTimes(2);expect(nativeFake).toHaveBeenCalledTimes(2);
 } finally {r?.unmount();controller?.destroy();restoreScore?.();vi.useRealTimers();await rm(temp,{recursive:true,force:true});}
});

it('S31-AUTO hot-cold and frozen consumers',async()=>{
 const {createHash}=await import('node:crypto'),{mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os'),{join,resolve}=await import('node:path'),{fileURLToPath}=await import('node:url');
 const {createServer,loadConfigFromFile}=await import('vite');
 const {createProductDirectory}=await import('../src/game/product-directory');
 const {validateProductModelCatalog,resolveNewGameSeats}=await import('../src/game/ai-selection');
 const {policyIndexPlugin}=await import('../policy-index-plugin');
 const {MatchController}=await import('../src/game/controller');
 const {DEFAULT_RULES}=await import('@gd/engine');
 const {assertSavedSeats}=await import('../src/game/seats');
 const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
 const base=policies.find(p=>p.tierSpecId==='none')!,bytes1=new Uint8Array(base.parameterCount*4),bytes2=new Uint8Array(bytes1);new DataView(bytes2.buffer).setFloat32(0,0.25,true);
 const model=(n:number,bytes:Uint8Array)=>({...base,policyId:`auto-synthetic-r${n}`,modelVersion:`auto-synthetic-r${n}`,weightsSHA256:digest(bytes),weightsPathOrUrl:{assetUrl:`ai/auto-r${n}.f32`}});
 const p1=model(1,bytes1),p2=model(2,bytes2);
 const rawRelease=(n:number):{releaseRef:string;label:string;proposalPolicyRef:string;mode:'local'|'hybrid';tier:'hard';status:'candidate';parentRelease:string|null}=>({releaseRef:`ohuo-v1.${n}.0-1101`,label:`synthetic R${n}`,proposalPolicyRef:`auto-synthetic-r${n}`,mode:'local',tier:'hard',status:'candidate',parentRelease:null});
 const product=(n:number,p:typeof p1)=>({releaseRef:`ohuo-v1.${n}.0-1101`,policyId:p.policyId,weightsSHA256:p.weightsSHA256,name:'ohuo',version:`1.${n}.0`,displayVersion:`v1.${n}.0`,effectiveDate:'2026-11-01'});
 const r1={schema:'ohuo-public-policy-directory-v1',index:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:p1.policyId,policies:[p1]},
  catalog:{schema:'ohuo-product-model-catalog-v1',formalLocalReleaseRef:rawRelease(1).releaseRef,models:[product(1,p1)]},
  releaseCatalog:{schemaVersion:'ohuo-release-index-v1',releases:[rawRelease(1)],legacyProductLayouts:{easy:['human',rawRelease(1).releaseRef,rawRelease(1).releaseRef,rawRelease(1).releaseRef],standard:['human',rawRelease(1).releaseRef,rawRelease(1).releaseRef,rawRelease(1).releaseRef],hard:['human',rawRelease(1).releaseRef,rawRelease(1).releaseRef,rawRelease(1).releaseRef]}}};
 const r2=structuredClone(r1);r2.index.policies.push(p2);r2.catalog.models.push(product(2,p2));r2.catalog.formalLocalReleaseRef=rawRelease(2).releaseRef;r2.releaseCatalog.releases.push(rawRelease(2));
 const immutable=JSON.stringify([r1,r2]),assets=new Map([[p1.weightsPathOrUrl.assetUrl,bytes1],[p2.weightsPathOrUrl.assetUrl,bytes2]]);
 const fetcher=vi.fn(async(url:string|URL|Request)=>{const bytes=assets.get(String(url));return bytes?new Response(bytes,{status:200}):new Response('',{status:404});});
 vi.stubGlobal('fetch',fetcher);const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)});
 const options={validateCatalog:validateProductModelCatalog,loadProfiles:async()=>[]};
 const directory=createProductDirectory(r1,options),first=directory.capture();
 const seats1=await resolveNewGameSeats(auto,first.context,first.loadSeats);
 const controller=new MatchController({difficulty:1,rules:DEFAULT_RULES,seats:seats1});const destroy=vi.spyOn(controller,'destroy');
 const frozen=JSON.stringify(seats1.snapshot);let server:Awaited<ReturnType<typeof createServer>>|undefined;const temp=await mkdtemp(join(tmpdir(),'ohuo-auto-'));
 try {
  directory.install(r2);const hot=directory.capture(),cold=createProductDirectory(r2,options).capture();
  const hotSeats=await resolveNewGameSeats(auto,hot.context,hot.loadSeats),coldSeats=await resolveNewGameSeats(auto,cold.context,cold.loadSeats);
  expect(hotSeats.snapshot).toEqual(coldSeats.snapshot);expect(hotSeats.snapshot.seats[1]).toMatchObject({releaseRef:rawRelease(2).releaseRef});
  expect(destroy).not.toHaveBeenCalled();expect(JSON.stringify(seats1.snapshot)).toBe(frozen);
  const explicit={...auto,aiSelection:{kind:'explicit' as const,seats:[{controller:'human' as const},...Array.from({length:3},()=>({controller:'ai' as const,releaseRef:rawRelease(1).releaseRef,mode:'local' as const}))]}};
  const pinned=await resolveNewGameSeats(explicit,hot.context,hot.loadSeats);assertSavedSeats(seats1.snapshot,pinned.snapshot);
  const restored=await directory.loadSavedSeats(seats1.snapshot);assertSavedSeats(seats1.snapshot,restored.snapshot);
  // One captured generation survives an actual awaited profile boundary; never R1 intent + R2 loader.
  const pending=deferred<any[]>(),hybridRaw=structuredClone(r1),hybrid={...rawRelease(1),releaseRef:`${rawRelease(1).releaseRef}-hybrid`,mode:'hybrid' as const,parentRelease:rawRelease(1).releaseRef};hybridRaw.releaseCatalog.releases.push(hybrid);
  const held=createProductDirectory(hybridRaw,{...options,loadProfiles:()=>pending.promise}),heldCapture=held.capture();
  const shared={...p,profileId:'auto-fixture'},reference={profileId:shared.profileId,revision:shared.revision,snapshotHash:shared.snapshotHash};
  const intended={...auto,aiSelection:{kind:'explicit' as const,seats:[{controller:'human' as const},...Array.from({length:3},()=>({controller:'ai' as const,releaseRef:hybrid.releaseRef,mode:'hybrid' as const,profileRevisionRef:reference}))]}};
  const resolving=resolveNewGameSeats(intended,heldCapture.context,heldCapture.loadSeats);const nextHeld=structuredClone(r2);nextHeld.releaseCatalog.releases.push(hybrid);held.install(nextHeld);pending.resolve([shared]);
  const closed=await resolving;expect(closed.snapshot.seats[1]).toMatchObject({releaseRef:hybrid.releaseRef,policyIdentity:{policyId:p1.policyId}});expect(held.capture().context.catalog).toEqual(r2.catalog);
  const bad=structuredClone(r2);bad.index.policies[0].weightsSHA256='f'.repeat(64);expect(()=>directory.install(bad)).toThrow();expect(()=>directory.capture()).toThrow('directory_unavailable');
  assertSavedSeats(seats1.snapshot,(await directory.loadSavedSeats(seats1.snapshot)).snapshot);directory.install(r2);
  assets.delete(p2.weightsPathOrUrl.assetUrl);await expect(resolveNewGameSeats(auto,directory.capture().context,directory.capture().loadSeats)).rejects.toThrow();expect(destroy).not.toHaveBeenCalled();assets.set(p2.weightsPathOrUrl.assetUrl,bytes2);

  const paths={indexFile:join(temp,'index.json'),catalogFile:join(temp,'catalog.json'),releasesFile:join(temp,'releases.json')};
  const write=async(value:typeof r1)=>{await writeFile(paths.indexFile,JSON.stringify(value.index));await writeFile(paths.catalogFile,JSON.stringify(value.catalog));await writeFile(paths.releasesFile,JSON.stringify(value.releaseCatalog));};await write(r1);
  const pluginURL=resolve(fileURLToPath(new URL('../policy-index-plugin.ts',import.meta.url)));
  const wrapper=join(temp,'wrapper.config.mts');await writeFile(wrapper,`import {policyIndexPlugin} from ${JSON.stringify(pluginURL)};export default {plugins:[policyIndexPlugin(${JSON.stringify(paths)})]};`);
  const config=await loadConfigFromFile({command:'serve',mode:'test'},wrapper,temp);expect(config).toBeTruthy();for(const path of Object.values(paths))expect(config!.dependencies).not.toContain(path);
  const messages:any[]=[];server=await createServer({configFile:false,envFile:false,root:temp,cacheDir:join(temp,'cache'),publicDir:join(temp,'public'),
   plugins:[policyIndexPlugin(paths)],server:{middlewareMode:true,ws:false,watch:{ignored:()=>true}},optimizeDeps:{noDiscovery:true,include:[]}});
  expect(server.httpServer).toBeNull();expect(server.config.server.ws).toBe(false);for(const path of Object.values(paths))expect(server.config.configFileDependencies).not.toContain(path);
  const send=vi.spyOn(server.hot,'send').mockImplementation((...args:any[])=>{messages.push(args);});const restart=vi.spyOn(server,'restart');
  const loaded1=await server.ssrLoadModule('virtual:gd-model-index');expect(loaded1.productCatalog).toEqual(r1.catalog);
  // Inject events into the actual Vite watch listeners, not directly into the production hook.
  const added=new Set<string>(),originalGet=server.moduleGraph.getModulesByFile.bind(server.moduleGraph);
  vi.spyOn(server.moduleGraph,'getModulesByFile').mockImplementation((file:string)=>{added.add(file);return originalGet(file);});
  const {mkdir}=await import('node:fs/promises');await mkdir(join(temp,'public','ai'),{recursive:true});const asset=join(temp,'public','ai','auto-r2.f32');await writeFile(asset,bytes2);
  expect(server.moduleGraph._hasResolveFailedErrorModules.size).toBe(0);server.watcher.emit('add',asset);await vi.waitFor(()=>expect(added.has(asset)).toBe(true));
  expect(messages.some(args=>args[0]?.type==='full-reload'||args[0]?.type==='update')).toBe(false);
  await write(r2);for(const path of Object.values(paths)){for(const listener of server.watcher.listeners('change'))await listener.call(server.watcher,path);}
  const snapshots=messages.filter(args=>args[0]==='ohuo:policy-directory').map(args=>args[1]);expect(snapshots.at(-1)).toMatchObject({available:true,snapshot:{catalog:r2.catalog}});
  directory.receive(snapshots.at(-1));expect(directory.capture().context.catalog).toEqual(r2.catalog);
  const loaded2=await server.ssrLoadModule('virtual:gd-model-index');expect(loaded2.productCatalog).toEqual(r2.catalog);expect(JSON.stringify(loaded2.default)).not.toContain('nodePath');
  const nestedCatalog={...r2.catalog,models:r2.catalog.models.map((entry,i)=>i===0?{...entry,name:{nodePath:'PRIVATE_SENTINEL'}}:entry)};
  await writeFile(paths.catalogFile,JSON.stringify(nestedCatalog));
  const coldLoad=policyIndexPlugin(paths).load as (name:string)=>unknown;expect(()=>coldLoad('\0virtual:gd-model-index')).toThrow('invalid_public_directory_leaf');
  for(const listener of server.watcher.listeners('change'))await listener.call(server.watcher,paths.catalogFile);
  expect(messages.at(-1)).toEqual(['ohuo:policy-directory',{available:false,error:'directory_unavailable'}]);expect(JSON.stringify(messages)).not.toContain('PRIVATE_SENTINEL');
  await writeFile(paths.catalogFile,'{invalid');for(const listener of server.watcher.listeners('change'))await listener.call(server.watcher,paths.catalogFile);
  const lastMessage=messages.at(-1);expect(lastMessage).toEqual(['ohuo:policy-directory',{available:false,error:'directory_unavailable'}]);directory.receive(lastMessage[1]);expect(()=>directory.capture()).toThrow('directory_unavailable');
  const unrelated=policyIndexPlugin(paths).handleHotUpdate as (context:any)=>unknown;expect(unrelated({file:join(temp,'unrelated.ts'),server})).toBeUndefined();
  expect(restart).not.toHaveBeenCalled();expect(messages.some(args=>args[0]?.type==='full-reload'||args[0]?.type==='update')).toBe(false);expect(destroy).not.toHaveBeenCalled();send.mockRestore();
  expect(JSON.stringify([r1,r2])).toBe(immutable);expect(JSON.stringify(seats1.snapshot)).toBe(frozen);
 } finally {await server?.close();await rm(temp,{recursive:true,force:true});destroy.mockRestore();controller.destroy();vi.restoreAllMocks();}
});
