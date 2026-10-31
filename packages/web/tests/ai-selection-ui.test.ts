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
const bindings={schema:'ohuo-provider-bindings-v1' as const,glm:null,deepseek:ref};
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
function modal(value:any=auto,props:any={}){const onConfirm=vi.fn(),onClose=vi.fn(),services={refreshProfiles:vi.fn(async()=>[p]),loadBindings:()=>bindings};const r=new Render(AISelectionModal,{value,context,onConfirm,onClose,services,...props}).render();return {r,onConfirm,onClose,services};}
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
 const options=makeAIChoiceOptions({...context,profiles:[p]},bindings).options;
 expect(options.filter(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='hybrid')).toHaveLength(1);
 const empty=makeAIChoiceOptions({...context,profiles:[p]},{...bindings,deepseek:null});expect(empty.options.some(o=>o.assignment?.controller==='ai'&&o.assignment.mode==='hybrid')).toBe(false);
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
 const hold=deferred<any[]>(),services={refreshProfiles:()=>hold.promise,loadBindings:()=>bindings};const {r,onConfirm,onClose}=modal(auto,{services});
 r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey({controller:'ai',mode:'local',releaseRef:'product-o-hard-v1'})}});r.render();
 if(action==='unmount')r.unmount();else if(action==='Escape')r.tree.props.onKeyDown({key:'Escape',preventDefault:vi.fn()});else if(action==='mask'){const target={};r.tree.props.onClick({target,currentTarget:target});}else r.button(action).props.onClick();
 hold.resolve([p]);await settle();expect(onConfirm).not.toHaveBeenCalled();if(action!=='unmount')expect(onClose).toHaveBeenCalledOnce();expect(auto.aiSelection.kind).toBe('auto_latest');
});
it('storage failure retains explicit draft, remains open, and does not report success',async()=>{
 const onConfirm=vi.fn(()=>{throw Error('quota');}),{r,onClose}=modal(auto,{onConfirm});await settle();r.render();r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(hybrid)}});r.render();r.button('确认选择').props.onClick();await settle();r.render();
 expect(onClose).not.toHaveBeenCalled();expect(r.text()).toContain('未保存：Error: quota');expect(r.nodes().find(n=>n.type===SeatPicker).props.value[1]).toEqual(hybrid);
});
it('repeated confirm sends one commit; closing during a held refresh discards the late result',async()=>{
 const {r,onConfirm,services,onClose}=modal(setAllDraftSeats(auto,hybrid));await settle();r.render();const hold=deferred<any[]>();services.refreshProfiles.mockImplementation(()=>hold.promise);
 r.button('确认选择').props.onClick();r.button('确认选择').props.onClick();r.button('关闭AI选择').props.onClick();hold.resolve([p]);await settle();expect(onConfirm).not.toHaveBeenCalled();expect(onClose).toHaveBeenCalledOnce();expect(services.refreshProfiles).toHaveBeenCalledTimes(2);
});
it('missing profile cannot confirm or silently rebound; invalid preference needs explicit reset',async()=>{
 const {r}=modal(setAllDraftSeats(auto,hybrid),{services:{refreshProfiles:async()=>[],loadBindings:()=>bindings}});await settle();r.render();expect(r.button('确认选择').props.disabled).toBe(true);expect(r.text()).toContain('profile_reference_unavailable');
 const invalid=modal(null);expect(invalid.r.button('确认选择').props.disabled).toBe(true);invalid.r.button('恢复默认').props.onClick();invalid.r.render();expect(invalid.r.button('确认选择').props.disabled).toBe(false);
});
it('S31-UI-01 retains a valid old explicit hybrid only on its original seat, never in uniform/new-seat choices',async()=>{
 const old={...p,profileId:'old-explicit',requestedModel:'legacy-model',snapshotHash:'d'.repeat(64)};
 const oldSeat={...hybrid,profileRevisionRef:{profileId:old.profileId,revision:old.revision,snapshotHash:old.snapshotHash}};
 const seats=resolveNewGameAssignments(auto,context).map((s,i)=>i===2?oldSeat:s);
 const value={...auto,aiSelection:{kind:'explicit',seats}};
 const {r,onConfirm}=modal(value,{services:{refreshProfiles:async()=>[p,old],loadBindings:()=>bindings}});await settle();r.render();
 const uniform=r.nodes().find(n=>n.props?.id==='ai-uniform');expect(r.nodes(uniform).filter(n=>n.type==='option').some(n=>n.props.value===assignmentKey(oldSeat))).toBe(false);
 const picker=r.nodes().find(n=>n.type===SeatPicker),rendered=new Render(SeatPicker,picker.props).render(),selects=rendered.nodes().filter(n=>n.type==='select');
 const options=(select:any)=>rendered.nodes(select).filter(n=>n.type==='option'&&n.props.value===assignmentKey(oldSeat));
 expect(options(selects[0])).toHaveLength(1);expect(options(selects[0])[0].props.disabled).toBe(true);expect(options(selects[1])).toHaveLength(0);expect(options(selects[2])).toHaveLength(0);
 r.button('确认选择').props.onClick();await settle();expect(onConfirm).toHaveBeenCalledWith(value.aiSelection,[p,old]);
});

it('S31-local-regression keeps both recognized provider combinations visible without inventing assignments',()=>{
 const none={...bindings,deepseek:null};
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
it('S31-local-regression unavailable or loading exact binding stays visible, never guessed from a profile',()=>{
 const missing=makeAIChoiceOptions({...context,profiles:[]},bindings);
 expect(missing.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.available).toBe(false);
 expect(missing.issues.join(' ')).not.toContain('尚未配置');
 const ready=makeAIChoiceOptions({...context,profiles:[p]},bindings);
 expect(ready.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.assignment).toEqual(hybrid);
 expect(ready.options.find(o=>o.description.shortName.endsWith('+ DeepSeek'))?.available).toBe(true);
 const failed=makeAIChoiceOptions({...context,profiles:[]},bindings,{profilesReady:false,profileIssue:'fixture_offline'});
 for(const name of ['GLM','DeepSeek']){const option=failed.options.find(o=>o.description.shortName.endsWith(`+ ${name}`));expect(option?.available).toBe(false);expect(option?.reason).toContain('读取失败');expect(option?.reason).not.toContain('正在读取');}
 const glm={...providerPresetFields('glm',{profileId:'saved-glm',nickname:'GLM'}),revision:7,snapshotHash:'c'.repeat(64)};
 const glmRef={profileId:glm.profileId,revision:glm.revision,snapshotHash:glm.snapshotHash};
 const recognized=makeAIChoiceOptions({...context,profiles:[glm]},{...bindings,glm:glmRef,deepseek:null});
 expect(recognized.options.find(o=>o.description.shortName.endsWith('+ GLM'))).toMatchObject({available:true,assignment:{profileRevisionRef:glmRef}});
});
it('S31-local-regression settings entry preserves draft and rereads bindings on return without committing',async()=>{
 let saved=false;
 const services={refreshProfiles:vi.fn(async()=>[p]),loadBindings:vi.fn(()=>saved?bindings:{...bindings,deepseek:null})};
 const {r,onConfirm}=modal(auto,{services});await settle();r.render();
 const local={controller:'ai',mode:'local',releaseRef:'product-o-hard-v1'};
 r.nodes().find(n=>n.props?.id==='ai-uniform').props.onChange({target:{value:assignmentKey(local as any)}});r.render();
 r.button('AI设置').props.onClick();r.render();
 const settings=r.nodes().find(n=>n.type===SettingsModal);expect(settings).toBeDefined();expect(onConfirm).not.toHaveBeenCalled();
 saved=true;settings.props.onClose();r.render();await settle();r.render();
 expect(services.loadBindings).toHaveBeenCalledTimes(2);
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
 expect(()=>{result=makeAIChoiceOptions(broken,{...bindings,deepseek:null});}).not.toThrow();
 expect(result!.options).toHaveLength(2);
 expect(result!.options.every(o=>!o.available&&o.assignment===null&&o.description.shortName.includes('底座未就绪'))).toBe(true);
 expect(result!.issues.join(' ')).toContain('formal_local_release_unavailable');
 const {r}=modal(auto,{context:broken});expect(r.button('确认选择').props.disabled).toBe(true);
 expect(r.text()).toContain('本地底座未就绪');
});
