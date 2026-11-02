import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Same finite hook runner as M: real component handlers and real operation client;
// no DOM/IAB claim and no provider traffic. Only synthetic public profiles/secrets.
const hook = vi.hoisted(() => ({ current: null as any }));
vi.mock('react', async original => ({ ...await original<any>(),
  useState: (v:any) => hook.current.state(v), useRef: (v:any) => hook.current.ref(v),
  useMemo: (fn:any,deps:any) => hook.current.memo(fn,deps),
  useEffect: (fn:any,deps:any) => hook.current.effect(fn,deps),
  useLayoutEffect: (fn:any,deps:any) => hook.current.effect(fn,deps),
}));
import { SettingsModal } from '../src/ui/SettingsModal';
import { providerPresetFields, validateProviderPreset, isProviderEndpoint, GLM_ANTHROPIC_BASE } from '../src/game/provider-presets';
class Render {
  slots:any[]=[]; index=0; effects:(()=>void)[]=[]; tree:any; writes=0;
  constructor(public component:any,public props:any){}
  slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
  state(initial:any){const s=this.slot(()=>({value:typeof initial==='function'?initial():initial}));return [s.value,(v:any)=>{this.writes++;s.value=typeof v==='function'?v(s.value):v;}];}
  ref(initial:any){return this.slot(()=>({current:initial}));}
  memo(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps[i]))){s.value=fn();s.deps=deps;}return s.value;}
  effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps[i]))){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
  render(props=this.props){this.props=props;this.index=0;hook.current=this;this.tree=this.component(props);hook.current=null;this.effects.splice(0).forEach(fn=>fn());return this;}
  unmount(){for(const s of this.slots)s.cleanup?.();}
  nodes(node?:any):any[]{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.flatMap(n=>this.nodes(n));if(!node||typeof node!=='object')return [];return [node,...this.nodes(node.props?.children??null)];}
  text(node?:any):string{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.map(n=>this.text(n)).join('');if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return this.text(node.props?.children??null);}
  button(label:string){const b=this.nodes().find(n=>n.type==='button'&&this.text(n)===label);expect(b,`button ${label}: ${this.text()}`).toBeDefined();return b;}
  select(){const s=this.nodes().find(n=>n.type==='select'&&n.props['aria-label']==='测试与教练连接');expect(s,'explicit reference selector').toBeDefined();s.props.onChange({target:{value:JSON.stringify(ref)}});this.render();}
}

let data:Map<string,string>, reads:string[], writes:string[], records:any[], fetcher:ReturnType<typeof vi.fn>;
let testAction:((command:any)=>Promise<any>)|null;
let saveAction:((url:string,init:any)=>Promise<any>)|null, readAction:(()=>Promise<any>)|null;
const response=(data:any,ok=true)=>({ok,status:ok?200:409,json:async()=>structuredClone(data)});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const bindingKey='gd_provider_bindings_v1';
const ref=(p:any)=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
function profile(provider:'glm'|'deepseek'='glm',overrides:any={}) {return {...providerPresetFields(provider,{profileId:`fake-${provider}`,nickname:'same nickname'}),revision:1,snapshotHash:(provider==='glm'?'a':'b').repeat(64),...overrides};}
const anthropic=()=>profile('glm',providerPresetFields('glm',{profileId:'fake-anthropic',nickname:'GLM'},{baseUrl:GLM_ANTHROPIC_BASE,protocol:'anthropic-messages'}));
// In-memory public fixture only. No origin/port is treated as isolation from a real private store.
function view(rows=records):any {return {schema:'ohuo-provider-state-v1',profiles:structuredClone(rows),providers:Object.fromEntries((['glm','deepseek'] as const).map(provider=>{
 const sources=rows.filter(p=>isProviderEndpoint(provider,p.baseUrl)),valid=sources.filter(p=>{try{validateProviderPreset(provider,p);return true;}catch{return false;}});
 return [provider,valid.length===1?{availability:'ready',reference:ref(valid[0]),connection:provider==='glm'?{state:'passed',testedAt:'2026-10-31T18:58:35.463806Z',scope:'native-connection-probe',httpStatus:200,returnedModel:'glm-5.3'}:{state:'untested',reason:'no_receipt'}}:
 {availability:valid.length>1?'ambiguous':sources.length?'incompatible':'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}}];
}))};}
function deferred<T=any>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function settings() {const r=new Render(SettingsModal,{onClose:vi.fn()}).render();await settle();return r.render();}
function input(r:Render,provider:string) {const v=r.nodes().find(n=>n.type==='input'&&n.props['aria-label']===`${provider} API Key`);expect(v).toBeDefined();return v;}
function enter(r:Render,provider:string,value:string) {input(r,provider).props.onChange({target:{value}});r.render();}
function edit(r:Render,provider:string) {const section=r.nodes().find(n=>n.type==='section'&&n.props['aria-label']===`${provider} API 设置`);r.nodes(section).find(n=>n.type==='button'&&r.text(n)==='修改').props.onClick();r.render();}
const posts=()=>fetcher.mock.calls.filter(c=>c[0]==='/api/llm-profiles'&&c[1]?.method==='POST');
async function accept(init:any) {const command=JSON.parse(init.body),{secret,...fields}=command.profile;
 const saved={...fields,revision:command.expectedRevision??1,snapshotHash:command.expectedSnapshotHash??'c'.repeat(64)};
 records=[...records.filter(p=>p.profileId!==saved.profileId),saved];return response(saved);
}
beforeEach(()=>{
 data=new Map();reads=[];writes=[];records=[];saveAction=null;readAction=null;testAction=null;
 vi.stubGlobal('document',{activeElement:null});
 vi.stubGlobal('localStorage',{getItem:(k:string)=>{reads.push(k);return data.get(k)??null;},setItem:(k:string,v:string)=>{writes.push(k);data.set(k,v);},removeItem:()=>{throw Error('no removal allowed');}});
 fetcher=vi.fn(async(url:string,init:any)=>{
  expect(['/api/llm-profiles?view=providers','/api/llm-profiles','/api/import-zcode','/api/llm-profiles/test']).toContain(url);
  if(url==='/api/llm-profiles/test'){const command=JSON.parse(init.body);return testAction?testAction(command):response(testReply(command));}
  if(init?.method==='POST')return saveAction?saveAction(url,init):accept(init);
  return readAction?readAction():response(url.includes('?')?view():records);
 });vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>vi.unstubAllGlobals());
it('opening presents only two fixed presets and reads shared state without provider/chat/binding writes',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();expect(r.nodes().filter(n=>n.type==='input')).toHaveLength(2);expect(r.nodes().some(n=>['select','textarea'].includes(n.type))).toBe(false);
 expect(r.text()).toContain('GLM-5.3');expect(r.text()).toContain('DeepSeek-V4.1-Flash');expect(r.text()).toContain('连接诊断通过（2026-10-31 18:58:35 UTC）');expect(r.text()).toContain('非网页业务调用验收');expect(r.text()).not.toContain('待确认关联');
 expect(reads).not.toContain(bindingKey);expect(posts()).toHaveLength(0);expect(writes).not.toContain(bindingKey);expect(writes).not.toContain('gd_chat_profile_reference_v1');
});
it.each([null,'{broken','{"schema":"old"}'])('fresh/corrupt browser binding %s cannot hide shared profiles or turn unchanged Save into a POST',async raw=>{
 records=[profile(),profile('deepseek')];if(raw)data.set(bindingKey,raw);const r=await settings();expect(input(r,'GLM').props.placeholder).toContain('•');expect(input(r,'DeepSeek').props.placeholder).toContain('•');
 await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get(bindingKey)).toBe(raw??undefined);expect(reads).not.toContain(bindingKey);
});
it('blank missing provider does not create a fake connection or clear invalid legacy',async()=>{
 const raw=JSON.stringify({baseUrl:'https://unverified.invalid',model:'old',apiKey:'SYNTHETIC_ONLY'});data.set('gd_llm_config',raw);const r=await settings();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get('gd_llm_config')).toBe(raw);expect(r.text()).toContain('旧配置保留');
});
it('explicit new DeepSeek save uses the fixed max preset and no browser association',async()=>{
 const r=await settings();enter(r,'DeepSeek','FAKE_NEW_KEY');await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);const c=JSON.parse(posts()[0][1].body);
 expect(c.expectedRevision).toBeNull();expect(c.profile.profileId).toMatch(/^ohuo-deepseek-/);expect(c.profile).toEqual({...providerPresetFields('deepseek',{profileId:c.profile.profileId,nickname:'DeepSeek'}),secret:'FAKE_NEW_KEY'});
 expect(input(r,'DeepSeek').props.value).toBe('');expect(data.has(bindingKey)).toBe(false);expect([...data.values()].join('')).not.toContain('FAKE_NEW_KEY');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
});
it('shared exactRef is the key-only same-ID/CAS target; blank key and old choices remain unchanged',async()=>{
 const p=profile();records=[p];data.set('gd_chat_profile_reference_v1',JSON.stringify(ref(p)));data.set('gd_new_game_settings_v1','unchanged selection');const r=await settings();edit(r,'GLM');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);
 enter(r,'GLM','FAKE_NEW_KEY');await r.button('保存设置').props.onClick();r.render();const c=JSON.parse(posts()[0][1].body);expect(c.profile.profileId).toBe(p.profileId);expect(c.expectedRevision).toBe(p.revision);expect(c.expectedSnapshotHash).toBe(p.snapshotHash);expect(c.profile.secret).toBe('FAKE_NEW_KEY');expect(posts()).toHaveLength(1);
 expect(data.get('gd_chat_profile_reference_v1')).toBe(JSON.stringify(ref(p)));expect(data.get('gd_new_game_settings_v1')).toBe('unchanged selection');expect(input(r,'GLM').props.value).toBe('');
});
it.each(['https://open.bigmodel.cn/api/paas/v4',GLM_ANTHROPIC_BASE])('browser legacy %s is retained and requires explicit edit before Save',async baseUrl=>{
 const raw=JSON.stringify({baseUrl,model:'old',apiKey:'LEGACY_SYNTHETIC_ONLY',effort:'off'});data.set('gd_llm_config',raw);const r=await settings();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(r.text()).not.toContain('LEGACY_SYNTHETIC_ONLY');edit(r,'GLM');await r.button('保存设置').props.onClick();
 const c=JSON.parse(posts()[0][1].body);expect(c.profile.baseUrl).toBe(baseUrl);expect(c.profile.protocol).toBe(baseUrl===GLM_ANTHROPIC_BASE?'anthropic-messages':'openai-chat-completions');expect(c.profile.secret).toBe('LEGACY_SYNTHETIC_ONLY');expect(data.get('gd_llm_config')).toBe(raw);expect(posts()).toHaveLength(1);
});
it.each(['https://open.bigmodel.cn/api/anthropic/custom','https://open.bigmodel.cn/api/coding/paas/v4','https://proxy.invalid/v1'])('legacy route %s is never guessed or switched',async baseUrl=>{
 const raw=JSON.stringify({baseUrl,model:'old',apiKey:'LEGACY_SYNTHETIC_ONLY'});data.set('gd_llm_config',raw);const r=await settings();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get('gd_llm_config')).toBe(raw);expect(r.text()).toContain('不会改路由');
});
it('unknown legacy shape is safe and does not prevent independent explicit DeepSeek save',async()=>{
 const raw=JSON.stringify({baseUrl:'https://private.invalid',model:'old',apiKey:'LEGACY_SYNTHETIC_ONLY',extra:true});data.set('gd_llm_config',raw);const r=await settings();expect(r.text()).toContain('旧配置格式未识别');expect(r.text()).not.toContain('private.invalid');expect(r.text()).not.toContain('LEGACY_SYNTHETIC_ONLY');enter(r,'DeepSeek','FAKE_NEW_KEY');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);expect(data.get('gd_llm_config')).toBe(raw);
});
it.each(['取消','escape','overlay','unmount'])('unsaved %s drops drafts with zero POST or association write',async action=>{
 const r=await settings();enter(r,'DeepSeek','FAKE_DRAFT');if(action==='unmount')r.unmount();else if(action==='escape')r.nodes().find(n=>n.props?.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){}});else if(action==='overlay'){const node=r.nodes()[0];node.props.onClick({target:node,currentTarget:node});}else r.button(action).props.onClick();expect(posts()).toHaveLength(0);expect(writes).not.toContain(bindingKey);
});
it.each(['取消','unmount'])('busy %s aborts and rejects late private POST/cache/state completion',async action=>{
 records=[profile()];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_DRAFT');const hold=deferred();saveAction=()=>hold.promise;const pending=r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);const signal=posts()[0][1].signal;
 if(action==='unmount')r.unmount();else r.button(action).props.onClick();expect(signal.aborted).toBe(true);await settle();const count=r.writes,cache=JSON.stringify([...data]);hold.resolve(response(profile()));await pending;expect(r.writes).toBe(count);expect(JSON.stringify([...data])).toBe(cache);
});
it('initial shared-state refresh ignores late results after close',async()=>{
 const hold=deferred();readAction=()=>hold.promise;const r=new Render(SettingsModal,{onClose:vi.fn()}).render();r.button('取消').props.onClick();await settle();const count=r.writes;hold.resolve(response(view([profile()])));await settle();expect(r.writes).toBe(count);expect(writes).toEqual([]);
});
it('confirmed private save survives state-read failure and reopening without resending',async()=>{
 records=[profile()];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_NEW_KEY');saveAction=async(_,init)=>{const saved=await accept(init);readAction=async()=>{throw Error('synthetic read failure');};return saved;};await r.button('保存设置').props.onClick();r.render();expect(r.text()).toContain('配置保存已确认');expect(r.text()).toContain('连接诊断读取失败');expect(r.text()).not.toContain('保存结果未知');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
 r.button('取消').props.onClick();readAction=null;const reopened=await settings();await reopened.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
});
it('key-only lost receipt stays unknown despite identical public snapshot and never retransmits',async()=>{
 records=[profile()];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_NEW_KEY');saveAction=async()=>{throw Error('lost reply');};await r.button('保存设置').props.onClick();r.render();expect(r.text()).toContain('保存结果未知');await r.button('核对保存状态').props.onClick();r.render();expect(r.text()).toContain('不能证明本次 Key 写入');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);r.button('取消').props.onClick();const again=await settings();expect(again.text()).toContain('保存结果未知');await again.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
});
it('sequential partial success retains first receipt and does not resend either provider',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();edit(r,'GLM');edit(r,'DeepSeek');enter(r,'GLM','FAKE_GLM_KEY');enter(r,'DeepSeek','FAKE_DS_KEY');saveAction=async(_,init)=>{if(JSON.parse(init.body).profile.profileId==='fake-deepseek')throw Error('lost reply');return accept(init);};await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(2);expect(r.text()).toContain('保存结果未知');expect(input(r,'GLM').props.value).toBe('');expect(input(r,'DeepSeek').props.value).toBe('');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(2);expect(data.has(bindingKey)).toBe(false);
});
it('revision conflict rereads only the same exact profile and needs a new explicit Save',async()=>{
 records=[profile()];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_NEW_KEY');saveAction=async()=>{records=[profile('glm',{revision:2,snapshotHash:'f'.repeat(64)})];return response({error:'revision_conflict'},false);};await r.button('保存设置').props.onClick();r.render();expect(input(r,'GLM').props.value).toBe('FAKE_NEW_KEY');expect(r.text()).toContain('版本冲突');expect(posts()).toHaveLength(1);saveAction=null;await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(2);const c=JSON.parse(posts()[1][1].body);expect(c.expectedRevision).toBe(2);expect(c.expectedSnapshotHash).toBe('f'.repeat(64));
});
it.each(['ambiguous','incompatible'])('%s keeps saved source intact and cannot create replacement',async kind=>{
 records=kind==='ambiguous'?[profile(),profile('glm',{profileId:'second'})]:[profile('glm',{requestedModel:'old-model'})];const before=JSON.stringify(records);const r=await settings();expect(input(r,'GLM').props.disabled).toBe(true);await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(JSON.stringify(records)).toBe(before);expect(r.text()).toContain('旧配置保留');expect(input(r,'DeepSeek').props.disabled).toBe(false);
});
it('stale browser binding is ignored, not rewritten, when backend has a unique exact profile',async()=>{
 const raw=JSON.stringify({schema:'ohuo-provider-bindings-v1',glm:ref(profile('glm',{revision:99})),deepseek:null});data.set(bindingKey,raw);records=[profile()];const r=await settings();expect(input(r,'GLM').props.placeholder).toContain('•');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get(bindingKey)).toBe(raw);
});
it('double Save during a held POST sends exactly one request',async()=>{
 records=[profile()];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_NEW_KEY');const hold=deferred();saveAction=()=>hold.promise;const fn=r.button('保存设置').props.onClick,a=fn(),b=fn();expect(posts()).toHaveLength(1);hold.resolve(response(profile()));await Promise.all([a,b]);expect(posts()).toHaveLength(1);
});
it('DEV fixture uses only injected storage/fetch and cannot touch real store sentinel',async()=>{
 const isolated=new Map<string,string>(),fixtureRows=[profile('deepseek')];const fixture={storage:{getItem:(k:string)=>isolated.get(k)??null,setItem:(k:string,v:string)=>isolated.set(k,v),removeItem:()=>{throw Error('forbidden');}},fetchImpl:vi.fn(async()=>response(view(fixtureRows)))};
 data.set('gd_llm_config','REAL_STORE_NOT_TO_READ');const r=new Render(SettingsModal,{onClose:vi.fn(),fixture}).render();await settle();r.render();await r.button('保存设置').props.onClick();expect(reads).toEqual([]);expect(writes).toEqual([]);expect(fetcher).not.toHaveBeenCalled();expect(data.get('gd_llm_config')).toBe('REAL_STORE_NOT_TO_READ');expect(isolated.has(bindingKey)).toBe(false);
});
it('saved Anthropic GLM is ready without import, local binding or POST',async()=>{
 records=[anthropic()];const r=await settings();expect(input(r,'GLM').props.placeholder).toContain('•');expect(r.text()).toContain('连接诊断通过');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);
});
it('explicit original GLM import then Save retains protocol/key and does not change untouched DS',async()=>{
 const ds=profile('deepseek');records=[ds];saveAction=async(url,init)=>url==='/api/import-zcode'?response({baseUrl:GLM_ANTHROPIC_BASE,apiKey:'FAKE_IMPORTED_KEY',model:'GLM-5.3'}):accept(init);
 const r=await settings();await r.button('读取本机已有 GLM').props.onClick();r.render();expect(posts()).toHaveLength(0);expect(r.text()).not.toContain('FAKE_IMPORTED_KEY');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);const c=JSON.parse(posts()[0][1].body);expect(c.profile.protocol).toBe('anthropic-messages');expect(c.profile.baseUrl).toBe(GLM_ANTHROPIC_BASE);expect(c.profile.secret).toBe('FAKE_IMPORTED_KEY');expect(records.find(p=>p.profileId===ds.profileId)).toEqual(ds);
});
it('late import after Cancel cannot expose/save the source',async()=>{
 const r=await settings(),hold=deferred();saveAction=()=>hold.promise;const pending=r.button('读取本机已有 GLM').props.onClick();r.button('取消').props.onClick();const count=r.writes;hold.resolve(response({baseUrl:GLM_ANTHROPIC_BASE,apiKey:'FAKE_LATE_KEY',model:'GLM-5.3'}));await pending;expect(r.writes).toBe(count);expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);
});
it('explicit import refuses unsupported endpoint and does not save',async()=>{
 const r=await settings();saveAction=async()=>response({baseUrl:'https://unverified.invalid',apiKey:'FAKE_IMPORTED_KEY',model:'GLM-5.3'});await r.button('读取本机已有 GLM').props.onClick();r.render();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(r.text()).not.toContain('FAKE_IMPORTED_KEY');expect(r.text()).not.toContain('unverified.invalid');
});
it('GLM restore cannot migrate or replace an untouched incompatible saved DeepSeek',async()=>{
 const ds=profile('deepseek',{requestOptions:{thinking:{type:'enabled'},reasoning_effort:'high'}});records=[ds];saveAction=async(url,init)=>url==='/api/import-zcode'?response({baseUrl:GLM_ANTHROPIC_BASE,apiKey:'FAKE_IMPORTED_KEY',model:'GLM-5.3'}):accept(init);const r=await settings();await r.button('读取本机已有 GLM').props.onClick();r.render();await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(records.find(p=>p.profileId===ds.profileId)).toEqual(ds);await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
});
it('shared source appearing before explicit new save prevents duplicate creation',async()=>{
 const r=await settings();enter(r,'DeepSeek','FAKE_NEW_KEY');records=[profile('deepseek')];await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(0);expect(input(r,'DeepSeek').props.disabled).toBe(true);expect(r.text()).toContain('未新建或覆盖');
});
it('failed shared read cannot use public cache as ready or show a cached pass',async()=>{
 data.set('gd_llm_profiles_public_v1',JSON.stringify([profile()]));readAction=async()=>{throw Error('offline');};const r=await settings();expect(r.button('保存设置').props.disabled).toBe(true);expect(r.text()).toContain('共享状态未知');expect(r.text()).not.toContain('连接诊断通过');expect(posts()).toHaveLength(0);
});

it('R4 a second edit failure retains its draft/CAS/blocked reason through another provider success readback',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();edit(r,'GLM');enter(r,'GLM','FAKE_FIRST_KEY');await r.button('保存设置').props.onClick();r.render();
 edit(r,'GLM');edit(r,'DeepSeek');enter(r,'GLM','FAKE_SECOND_KEY');enter(r,'DeepSeek','FAKE_DS_KEY');saveAction=async(_,init)=>JSON.parse(init.body).profile.profileId==='fake-glm'?response({error:'profile_store_busy'},false):accept(init);
 await r.button('保存设置').props.onClick();r.render();expect(input(r,'GLM').props.value).toBe('FAKE_SECOND_KEY');expect(input(r,'GLM').props.disabled).toBe(true);expect(r.text()).toContain('此连接未保存');expect(posts()).toHaveLength(3);expect(JSON.parse(posts()[1][1].body).expectedSnapshotHash).toBe('a'.repeat(64));await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(3);
});

it('modal visible focus ring includes summaries but wraps only after the last visible control',async()=>{
 records=[profile()];const r=await settings();
 const dialog=r.nodes().find(n=>n.props?.role==='dialog');let queried='';
 const node=(tag:string,visible=true):any=>({tag,tabIndex:0,visible,focus:vi.fn(),getClientRects(){return this.visible?[{}]:[];}});
 const first=node('button'),summary=node('summary'),folded=node('input',false),cancel=node('button'),save=node('button'),hidden=node('button',false),nodes=[first,summary,folded,cancel,save,hidden];
 dialog.ref.current={querySelectorAll:(selector:string)=>{queried=selector;return nodes.filter(n=>n.tag!=='summary'||selector.includes('summary'));}};
 vi.stubGlobal('getComputedStyle',()=>({visibility:'visible'}));
 const event=(shiftKey=false)=>({key:'Tab',shiftKey,preventDefault:vi.fn()});
 vi.stubGlobal('document',{activeElement:save});let e=event();dialog.props.onKeyDown(e);expect(e.preventDefault).toHaveBeenCalledTimes(1);expect(first.focus).toHaveBeenCalledTimes(1);expect(queried).toContain('summary');
 vi.stubGlobal('document',{activeElement:first});e=event(true);dialog.props.onKeyDown(e);expect(save.focus).toHaveBeenCalledTimes(1);
 vi.stubGlobal('document',{activeElement:summary});e=event();dialog.props.onKeyDown(e);expect(e.preventDefault).not.toHaveBeenCalled();
 cancel.visible=false;save.visible=false;e=event();dialog.props.onKeyDown(e);expect(e.preventDefault).toHaveBeenCalledTimes(1);expect(first.focus).toHaveBeenCalledTimes(2);expect(hidden.focus).not.toHaveBeenCalled();expect(folded.focus).not.toHaveBeenCalled();r.unmount();
});

const testPosts=()=>fetcher.mock.calls.filter(c=>c[0]==='/api/llm-profiles/test');
const testReply=(command:any)=>({...command,connection:{state:'passed',testedAt:'2026-11-01T03:00:00.123Z',scope:'native-connection-probe',httpStatus:200,returnedModel:'safe-alias'},profileUnchanged:true,persisted:true});
function testButton(r:Render,provider='GLM') {const section=r.nodes().find(n=>n.type==='section'&&n.props['aria-label']===`${provider} API 设置`);const button=r.nodes(section).find(n=>n.type==='button'&&['测试连接','测试中…'].includes(r.text(n)));expect(button).toBeDefined();return button;}
it('explicit test buttons require saved exact state; opening and blank Save do not test, blank edit may test',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();expect(testPosts()).toHaveLength(0);await r.button('保存设置').props.onClick();expect(testPosts()).toHaveLength(0);edit(r,'GLM');expect(testButton(r).props.disabled).toBe(false);
 await testButton(r).props.onClick();r.render();expect(testPosts()).toHaveLength(1);const c=JSON.parse(testPosts()[0][1].body);expect(Object.keys(c).sort()).toEqual(['provider','reference','requestId']);expect(c.reference).toEqual(ref(records[0]));expect(c.requestId).toMatch(/^[a-f0-9-]{36}$/);expect(r.text()).toContain('2026-11-01 03:00:00 UTC');
 const status=r.nodes().find(n=>n.props?.id===testButton(r).props['aria-describedby']);expect(status.props.role).toBe('status');expect(r.nodes().filter(n=>n.type==='details').every(n=>n.props.open!==true)).toBe(true);expect(r.text()).not.toContain('apiKey');
});
it('dirty key/import draft disables testing with visible reason; acknowledged Save never auto-tests',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();edit(r,'GLM');enter(r,'GLM','SYNTHETIC_NEW_KEY');expect(testButton(r).props.disabled).toBe(true);expect(r.text()).toContain('先保存再测试');await testButton(r).props.onClick();expect(testPosts()).toHaveLength(0);await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(testPosts()).toHaveLength(0);expect(testButton(r).props.disabled).toBe(false);await testButton(r).props.onClick();expect(testPosts()).toHaveLength(1);
 r.unmount();data=new Map();records=[];const imported=await settings();saveAction=async()=>response({baseUrl:GLM_ANTHROPIC_BASE,apiKey:'SYNTHETIC_IMPORTED',model:'old'});await imported.button('读取本机已有 GLM').props.onClick();imported.render();expect(testButton(imported).props.disabled).toBe(true);expect(imported.text()).toContain('先保存再测试');await testButton(imported).props.onClick();expect(testPosts()).toHaveLength(1);
});
it('each provider needs an explicit click; duplicate in-flight clicks and Save cannot create another request',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings(),holds:Record<string,ReturnType<typeof deferred>>={};testAction=c=>{const hold=deferred();holds[c.provider]={...hold,resolve:()=>hold.resolve(response(testReply(c)))};return hold.promise;};
 const first=testButton(r).props.onClick();r.render();expect(testButton(r).props.disabled).toBe(true);expect(input(r,'GLM').props.disabled).toBe(true);expect(r.button('保存设置').props.disabled).toBe(true);expect(r.text()).toContain('不代表后台回滚');await testButton(r).props.onClick();expect(testPosts()).toHaveLength(1);
 const second=testButton(r,'DeepSeek').props.onClick();expect(testPosts()).toHaveLength(2);await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);holds.glm.resolve(undefined);holds.deepseek.resolve(undefined);await Promise.all([first,second]);r.render();expect(testButton(r).props.disabled).toBe(false);r.unmount();data=new Map();records=[profile('deepseek')];const missing=await settings();const another=testButton(missing,'DeepSeek').props.onClick();missing.render();expect(missing.button('读取本机已有 GLM').props.disabled).toBe(true);holds.deepseek.resolve(undefined);await another;
});
it('test close/late result does not write cache/state and reopen only GETs',async()=>{
 records=[profile()];const r=await settings(),hold=deferred();let command:any;testAction=c=>{command=c;return hold.promise;};const pending=testButton(r).props.onClick();r.render();r.button('取消').props.onClick();await settle();const count=r.writes,cache=JSON.stringify([...data]);hold.resolve(response(testReply(command)));await pending;expect(r.writes).toBe(count);expect(JSON.stringify([...data])).toBe(cache);const reopened=await settings();expect(testPosts()).toHaveLength(1);expect(reopened.text()).toContain('2026-10-31 18:58:35 UTC');
 // If an already queued input handler creates a newer local draft, an old completion cannot replace it.
 const hold2=deferred();testAction=c=>{command=c;return hold2.promise;};edit(reopened,'GLM');const pending2=testButton(reopened).props.onClick();enter(reopened,'GLM','SYNTHETIC_LATE_DRAFT');hold2.resolve(response(testReply(command)));await pending2;reopened.render();expect(input(reopened,'GLM').props.value).toBe('SYNTHETIC_LATE_DRAFT');expect(reopened.text()).not.toContain('2026-11-01 03:00:00 UTC');
});
it('lost test response is unknown without auto-retry or stale green; a later explicit click gets a new ID',async()=>{
 records=[profile()];const r=await settings();testAction=async()=>{throw Error('RAW_PRIVATE_TEXT');};await testButton(r).props.onClick();r.render();expect(r.text()).toContain('本次测试结果未知');expect(r.text()).toContain('以下为已有记录');expect(r.text()).not.toContain('RAW_PRIVATE_TEXT');expect(testPosts()).toHaveLength(1);testAction=null;await testButton(r).props.onClick();expect(testPosts()).toHaveLength(2);expect(JSON.parse(testPosts()[0][1].body).requestId).not.toBe(JSON.parse(testPosts()[1][1].body).requestId);
});
it('unpersisted timeout result stays visibly unsaved with real time and no retry or stale GET overwrite',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();testAction=async c=>response({...testReply(c),persisted:false,error:'receipt_persist_failed',connection:{...testReply(c).connection,state:'failed',errorCategory:'timeout_unknown'}});const readsBefore=fetcher.mock.calls.length;
 await testButton(r).props.onClick();r.render();expect(r.text()).toContain('本次测试结果未保存');expect(r.text()).toContain('超时，供应商处理状态未知');expect(r.text()).toContain('2026-11-01 03:00:00 UTC');expect(fetcher).toHaveBeenCalledTimes(readsBefore+1);expect(testPosts()).toHaveLength(1);
 edit(r,'DeepSeek');enter(r,'DeepSeek','SYNTHETIC_OTHER_EDIT');await r.button('保存设置').props.onClick();r.render();expect(r.text()).toContain('本次测试结果未保存');expect(r.text()).toContain('超时，供应商处理状态未知');expect(r.text()).toContain('2026-11-01 03:00:00 UTC');expect(testPosts()).toHaveLength(1);expect(posts()).toHaveLength(1);edit(r,'GLM');expect(r.text()).toContain('此前显示的诊断结果未保存');
 records[0]={...records[0],revision:2,snapshotHash:'f'.repeat(64)};edit(r,'DeepSeek');enter(r,'DeepSeek','SYNTHETIC_SECOND_EDIT');await r.button('保存设置').props.onClick();r.render();expect(testButton(r).props.disabled).toBe(true);expect(r.text()).toContain('所示诊断仅属原连接');const section=r.nodes().find(n=>n.type==='section'&&n.props['aria-label']==='GLM API 设置');const detail=JSON.parse(r.text(r.nodes(section).find(n=>n.type==='pre')));expect(detail.revision).toBe(1);expect(detail.snapshotHash).toBe('a'.repeat(64));expect(detail.connection.errorCategory).toBe('timeout_unknown');expect(testPosts()).toHaveLength(1);
 r.unmount();data=new Map();records=[profile()];const cas=await settings();await testButton(cas).props.onClick();cas.render();edit(cas,'GLM');enter(cas,'GLM','SYNTHETIC_CAS_EDIT');saveAction=async()=>{records=[profile('glm',{revision:2,snapshotHash:'f'.repeat(64)})];return response({error:'revision_conflict'},false);};await cas.button('保存设置').props.onClick();cas.render();expect(cas.text()).toContain('版本冲突');expect(cas.text()).not.toContain('此前显示的诊断结果未保存');expect(cas.text()).not.toContain('本次测试结果未保存');expect(input(cas,'GLM').props.value).toBe('SYNTHETIC_CAS_EDIT');const updated=JSON.parse(cas.text(cas.nodes().find(n=>n.type==='pre')));expect(updated.revision).toBe(2);expect(updated.connection.testedAt).toBe('2026-10-31T18:58:35.463806Z');
 cas.unmount();data=new Map();records=[profile(),profile('deepseek')];saveAction=null;readAction=null;const prior=await settings();edit(prior,'GLM');enter(prior,'GLM','SYNTHETIC_FIRST_SAVE');await prior.button('保存设置').props.onClick();prior.render();await testButton(prior).props.onClick();prior.render();edit(prior,'DeepSeek');enter(prior,'DeepSeek','SYNTHETIC_OTHER_SAVE');readAction=async()=>{throw Error('synthetic read failure');};await prior.button('保存设置').props.onClick();prior.render();const glmSection=prior.nodes().find(n=>n.type==='section'&&n.props['aria-label']==='GLM API 设置'),dsSection=prior.nodes().find(n=>n.type==='section'&&n.props['aria-label']==='DeepSeek API 设置');expect(prior.text(glmSection)).toContain('本次测试结果未保存');expect(prior.text(glmSection)).toContain('超时，供应商处理状态未知');expect(prior.text(glmSection)).toContain('2026-11-01 03:00:00 UTC');expect(prior.text(glmSection)).not.toContain('连接诊断读取失败');expect(prior.text(dsSection)).toContain('连接诊断读取失败');
});
it('changed credential/profile test is stale and blocked until authoritative reopening, never rebound automatically',async()=>{
 records=[profile(),profile('deepseek')];const r=await settings();testAction=async c=>response({...testReply(c),profileUnchanged:false,connection:{state:'stale',testedAt:'2026-11-01T03:00:00.123Z',scope:'native-connection-probe',reason:'credential_or_profile_changed'}});await testButton(r).props.onClick();r.render();expect(r.text()).toContain('不证明当前配置可用');expect(r.text()).toContain('当前配置未测试');expect(testButton(r).props.disabled).toBe(true);edit(r,'DeepSeek');enter(r,'DeepSeek','SYNTHETIC_OTHER_EDIT');await r.button('保存设置').props.onClick();r.render();expect(testButton(r).props.disabled).toBe(true);expect(r.text()).toContain('不证明当前配置可用');await testButton(r).props.onClick();expect(testPosts()).toHaveLength(1);expect(posts()).toHaveLength(1);
});
it('known test preflight rejection says not executed, distinct from supplier failure or transport unknown',async()=>{
 records=[profile()];const r=await settings();testAction=async()=>response({error:'test_in_progress'},false);await testButton(r).props.onClick();r.render();expect(r.text()).toContain('本次未另发测试');expect(r.text()).not.toContain('本次测试结果未知');expect(testPosts()).toHaveLength(1);expect(r.text()).toContain('以下为已有记录');testAction=async c=>response({...testReply(c),persisted:false,error:'receipt_persist_failed'});await testButton(r).props.onClick();r.render();testAction=async()=>response({error:'revision_conflict'},false);await testButton(r).props.onClick();r.render();expect(r.text()).toContain('本次测试未执行');expect(r.text()).toContain('未保存');expect(r.text()).toContain('2026-11-01 03:00:00 UTC');expect(testButton(r).props.disabled).toBe(true);expect(testPosts()).toHaveLength(3);
});
