import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  nodes(node=this.tree):any[]{if(Array.isArray(node))return node.flatMap(n=>this.nodes(n));if(!node||typeof node!=='object')return [];return [node,...this.nodes(node.props?.children??null)];}
  text(node=this.tree):string{if(Array.isArray(node))return node.map(n=>this.text(n)).join('');if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return this.text(node.props?.children??null);}
  button(label:string){const b=this.nodes().find(n=>n.type==='button'&&this.text(n)===label);expect(b,`button ${label}: ${this.text()}`).toBeDefined();return b;}
  select(){const s=this.nodes().find(n=>n.type==='select'&&n.props['aria-label']==='测试与教练连接');expect(s,'explicit reference selector').toBeDefined();s.props.onChange({target:{value:JSON.stringify(ref)}});this.render();}
}

let data:Map<string,string>, reads:string[], writes:string[], fetcher:ReturnType<typeof vi.fn>;
const response=(data:any,ok=true)=>({ok,status:ok?200:400,json:async()=>data});
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const bindingKey='gd_provider_bindings_v1';
const ref=(p:any)=>({profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash});
function profile(provider='glm', overrides:any={}) {return {profileId:`fake-${provider}`,nickname:'same nickname',revision:1,snapshotHash:'a'.repeat(64),protocol:'openai-chat-completions',baseUrl:provider==='glm'?'https://open.bigmodel.cn/api/paas/v4':'https://api.deepseek.com',requestedModel:provider==='glm'?'glm-5.3':'deepseek-flash',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'},...overrides};}
function bind(p:any,provider='glm') {data.set(bindingKey,JSON.stringify({schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null,[provider]:ref(p)}));}
function deferred<T=any>(){let resolve!:(value:T)=>void,reject!:(reason:any)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settings() {const r=new Render(SettingsModal,{onClose:vi.fn()}).render();await settle();return r.render();}
function input(r:Render,provider:string) {const v=r.nodes().find(n=>n.type==='input'&&n.props['aria-label']===`${provider} API Key`);expect(v).toBeDefined();return v;}
function enter(r:Render,provider:string,value:string) {input(r,provider).props.onChange({target:{value}});r.render();}
const posts=()=>fetcher.mock.calls.filter(c=>c[1]?.method==='POST');
beforeEach(()=>{data=new Map();reads=[];writes=[];vi.stubGlobal('localStorage',{getItem:(k:string)=>{reads.push(k);return data.get(k)??null;},setItem:(k:string,v:string)=>{writes.push(k);data.set(k,v);},removeItem:()=>{throw Error('no removal allowed');}});fetcher=vi.fn(async()=>response([]));vi.stubGlobal('fetch',fetcher);});
afterEach(()=>vi.unstubAllGlobals());
it('opening presents only two fixed presets, checks legacy only locally, and writes no provider/chat binding',async()=>{
 expect(reads).toEqual([]);const r=await settings();expect(r.nodes().filter(n=>n.type==='input')).toHaveLength(2);expect(r.nodes().some(n=>['select','textarea'].includes(n.type))).toBe(false);
 expect(r.text()).toContain('GLM-5.3');expect(r.text()).toContain('DeepSeek-V4.1-Flash');expect(r.text()).not.toContain('已配置（未测试）');expect(reads).toContain('gd_llm_config');expect(posts()).toHaveLength(0);expect(writes).not.toContain(bindingKey);expect(writes).not.toContain('gd_chat_profile_reference_v1');
});
it('blank DeepSeek does not create a fake connection or clear legacy',async()=>{const legacy=JSON.stringify({baseUrl:'https://unverified.invalid',model:'old',apiKey:'SYNTHETIC_ONLY'});data.set('gd_llm_config',legacy);const r=await settings();await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(0);expect(data.get('gd_llm_config')).toBe(legacy);expect(r.text()).toContain('旧配置保留');});
it('explicit new DeepSeek save serializes the exact fixed max preset, no extra params, and only public binding',async()=>{
 const r=await settings();enter(r,'DeepSeek','SYNTHETIC_ONLY');fetcher.mockImplementation(async(url,init)=>{expect(url).toBe('/api/llm-profiles');const cmd=JSON.parse(init.body);expect(cmd.expectedRevision).toBeNull();expect(cmd.profile).toMatchObject({protocol:'openai-chat-completions',baseUrl:'https://api.deepseek.com',requestedModel:'deepseek-flash',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'},secret:'SYNTHETIC_ONLY'});expect(Object.keys(cmd.profile.requestOptions).sort()).toEqual(['reasoning_effort','thinking']);const {secret,...pub}=cmd.profile;return response({...pub,revision:1,snapshotHash:'b'.repeat(64)});});
 await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(data.get(bindingKey)).not.toContain('SYNTHETIC_ONLY');expect(JSON.parse(data.get(bindingKey)!).deepseek.revision).toBe(1);expect(input(r,'DeepSeek').props.value).toBe('');expect(r.text()).toContain('已配置（未测试）');expect(fetcher.mock.calls.every(c=>c[0]==='/api/llm-profiles')).toBe(true);
});
it('named preset migration omits empty secret and pins optimistic revision/hash without changing old selections',async()=>{
 const p=profile('glm',{requestedModel:'glm-5',requestOptions:{thinking:{type:'disabled'},reasoning_effort:'high'}});bind(p);data.set('gd_chat_profile_reference_v1',JSON.stringify(ref(p)));data.set('gd_new_game_settings_v1','unchanged selection');fetcher.mockResolvedValue(response([p]));const r=await settings();expect(r.text()).toContain('旧配置保留');expect(input(r,'GLM').props.value).toBe('');expect(input(r,'GLM').props.placeholder).toContain('•');
 fetcher.mockImplementation(async(url,init)=>{const cmd=JSON.parse(init.body);expect(cmd.expectedRevision).toBe(1);expect(cmd.expectedSnapshotHash).toBe('a'.repeat(64));expect(cmd.profile.secret).toBeUndefined();expect(cmd.profile.baseUrl).toBe(p.baseUrl);expect(cmd.profile.requestedModel).toBe('glm-5.3');expect(cmd.profile.requestOptions).toEqual({thinking:{type:'enabled'},reasoning_effort:'max'});return response(profile('glm',{revision:2,snapshotHash:'b'.repeat(64)}));});await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(data.get('gd_chat_profile_reference_v1')).toBe(JSON.stringify(ref(p)));expect(data.get('gd_new_game_settings_v1')).toBe('unchanged selection');
});

it('matching named configuration is masked and untouched until explicit key modification',async()=>{
 const p=profile();bind(p);fetcher.mockResolvedValue(response([p]));const r=await settings();expect(input(r,'GLM').props.disabled).toBe(true);await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);
 r.button('修改').props.onClick();r.render();enter(r,'GLM','NEW_SYNTHETIC_ONLY');fetcher.mockImplementation(async(_,init)=>{const cmd=JSON.parse(init.body);expect(cmd.profile.secret).toBe('NEW_SYNTHETIC_ONLY');expect(cmd.expectedRevision).toBe(1);return response(p);});await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(input(r,'GLM').props.value).toBe('');
});
it('legacy ordinary route is kept byte-for-byte, migrated only by Save, and never rewritten',async()=>{
 const value=JSON.stringify({baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'old-model',apiKey:'LEGACY_SYNTHETIC_ONLY',effort:'off'});data.set('gd_llm_config',value);const r=await settings();expect(posts()).toHaveLength(0);expect(input(r,'GLM').props.value).toBe('');expect(r.text()).not.toContain('LEGACY_SYNTHETIC_ONLY');
 fetcher.mockImplementation(async(_,init)=>{const cmd=JSON.parse(init.body);expect(cmd.profile.secret).toBe('LEGACY_SYNTHETIC_ONLY');expect(cmd.profile.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');expect(cmd.profile.requestOptions).toEqual({thinking:{type:'enabled'},reasoning_effort:'max'});const {secret,...publicFields}=cmd.profile;return response({...publicFields,revision:1,snapshotHash:'b'.repeat(64)});});await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(data.get('gd_llm_config')).toBe(value);expect([...data].filter(([k])=>k!=='gd_llm_config').every(([,v])=>!v.includes('LEGACY_SYNTHETIC_ONLY'))).toBe(true);
});
it.each(['https://open.bigmodel.cn/api/anthropic/custom','https://open.bigmodel.cn/api/coding/paas/v4','https://proxy.invalid/v1'])('legacy route %s is not guessed or switched to an ordinary endpoint',async baseUrl=>{
 const value=JSON.stringify({baseUrl,model:'GLM-5.3',apiKey:'LEGACY_SYNTHETIC_ONLY',effort:'max'});data.set('gd_llm_config',value);const r=await settings();await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(0);expect(data.get('gd_llm_config')).toBe(value);expect(r.text()).toContain('不会改路由');expect(r.text()).not.toContain('已配置（未测试）');
});
it('unknown legacy shape is retained and does not prevent explicit independent DeepSeek save',async()=>{
 const value=JSON.stringify({baseUrl:'https://other.invalid',model:'old',apiKey:'LEGACY_SYNTHETIC_ONLY',extra:true});data.set('gd_llm_config',value);const r=await settings();enter(r,'DeepSeek','DS_SYNTHETIC_ONLY');fetcher.mockImplementation(async(_,init)=>{const cmd=JSON.parse(init.body);expect(cmd.profile.requestedModel).toBe('deepseek-flash');const {secret,...publicFields}=cmd.profile;return response({...publicFields,revision:1,snapshotHash:'b'.repeat(64)});});await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);expect(data.get('gd_llm_config')).toBe(value);
});
it.each(['取消','escape','overlay','unmount'])('unsaved %s discards drafts without a POST or binding write',async action=>{
 const r=await settings();enter(r,'DeepSeek','DRAFT_SYNTHETIC_ONLY');if(action==='unmount')r.unmount();else if(action==='escape')r.nodes().find(n=>n.props?.role==='dialog').props.onKeyDown({key:'Escape',preventDefault(){}});else if(action==='overlay'){const node=r.nodes()[0];node.props.onClick({target:node,currentTarget:node});}else r.button(action).props.onClick();expect(posts()).toHaveLength(0);expect(writes).not.toContain(bindingKey);expect(data.has('gd_chat_profile_reference_v1')).toBe(false);
});
it.each(['取消','unmount'])('busy %s aborts and ignores late POST/cache/binding/state completion',async action=>{
 const r=await settings();enter(r,'DeepSeek','DRAFT_SYNTHETIC_ONLY');const hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const pending=r.button('保存设置').props.onClick();r.render();const signal=posts()[0][1].signal;const command=JSON.parse(posts()[0][1].body);if(action==='unmount')r.unmount();else r.button(action).props.onClick();expect(signal.aborted).toBe(true);await settle();const before=r.writes,cache=JSON.stringify([...data]);const {secret,...p}=command.profile;hold.resolve(response({...p,revision:1,snapshotHash:'c'.repeat(64)}));await pending;expect(r.writes).toBe(before);expect(JSON.stringify([...data])).toBe(cache);expect(data.has(bindingKey)).toBe(false);
});
it('initial public refresh ignores late results after close',async()=>{
 const hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const r=new Render(SettingsModal,{onClose:vi.fn()}).render();r.button('取消').props.onClick();await settle();const before=r.writes;hold.resolve(response([profile()]));await settle();expect(r.writes).toBe(before);expect(writes).toEqual([]);
});
it('binding failure retains real private receipt and retries only association, even after reopening',async()=>{
 const r=await settings();enter(r,'DeepSeek','DS_SYNTHETIC_ONLY');let saved:any;fetcher.mockImplementation(async(_,init)=>{const {secret,...pub}=JSON.parse(init.body).profile;saved={...pub,revision:1,snapshotHash:'d'.repeat(64)};return response(saved);});const original=localStorage.setItem;localStorage.setItem=(k,v)=>{if(k===bindingKey)throw Error('synthetic quota');original(k,v);};await r.button('保存设置').props.onClick();r.render();expect(r.text()).toContain('配置已保存、关联未保存');expect(input(r,'DeepSeek').props.value).toBe('');expect(posts()).toHaveLength(1);r.button('取消').props.onClick();fetcher.mockResolvedValue(response([saved]));const reopened=await settings();expect(reopened.text()).toContain('配置已保存、关联未保存');localStorage.setItem=original;await reopened.button('保存设置').props.onClick();reopened.render();expect(posts()).toHaveLength(1);expect(JSON.parse(data.get(bindingKey)!).deepseek).toEqual(ref(saved));
});
it('key-only lost receipt remains unknown after identical public snapshot; Save never retransmits',async()=>{
 const p=profile();bind(p);fetcher.mockResolvedValue(response([p]));const r=await settings();r.button('修改').props.onClick();r.render();enter(r,'GLM','NEW_SYNTHETIC_ONLY');fetcher.mockRejectedValueOnce(Error('synthetic lost response'));await r.button('保存设置').props.onClick();r.render();expect(r.text()).toContain('保存结果未知');expect(posts()).toHaveLength(1);fetcher.mockResolvedValue(response([p]));await r.button('核对保存状态').props.onClick();r.render();expect(r.text()).toContain('不能证明本次 Key 写入');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);r.button('取消').props.onClick();const reopened=await settings();expect(reopened.text()).toContain('保存结果未知');await reopened.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);
});
it('sequential partial success preserves first receipt and never resends either provider automatically',async()=>{
 const r=await settings();enter(r,'GLM','GLM_SYNTHETIC_ONLY');enter(r,'DeepSeek','DS_SYNTHETIC_ONLY');let calls=0;fetcher.mockImplementation(async(_,init)=>{calls++;const cmd=JSON.parse(init.body);if(calls===2)throw Error('lost DS reply');expect(cmd.profile.requestedModel).toBe('glm-5.3');const {secret,...pub}=cmd.profile;return response({...pub,revision:1,snapshotHash:'e'.repeat(64)});});await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(2);const binding=JSON.parse(data.get(bindingKey)!);expect(binding.glm).not.toBeNull();expect(binding.deepseek).toBeNull();expect(r.text()).toContain('已配置（未测试）');expect(r.text()).toContain('保存结果未知');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(2);
});
it('revision conflict does not overwrite; reads current version, preserves draft, requires another explicit Save',async()=>{
 const p=profile();bind(p);fetcher.mockResolvedValue(response([p]));const r=await settings();r.button('修改').props.onClick();r.render();enter(r,'GLM','NEW_SYNTHETIC_ONLY');const fresh=profile('glm',{revision:2,snapshotHash:'f'.repeat(64)});fetcher.mockImplementation(async(_,init)=>init?.method==='POST'?response({error:'revision_conflict'},false):response([fresh]));await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(input(r,'GLM').props.value).toBe('NEW_SYNTHETIC_ONLY');expect(data.get(bindingKey)).toContain('"revision":1');expect(r.text()).toContain('版本冲突');fetcher.mockImplementation(async(_,init)=>{const cmd=JSON.parse(init.body);expect(cmd.expectedRevision).toBe(2);expect(cmd.expectedSnapshotHash).toBe('f'.repeat(64));return response(fresh);});await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(2);expect(JSON.parse(data.get(bindingKey)!).glm.revision).toBe(2);
});
it('two same-nickname exact presets remain ambiguous; stale exact binding never follows latest',async()=>{
 const p=profile(),other=profile('glm',{profileId:'fake-other'});fetcher.mockResolvedValue(response([p,other]));const r=await settings();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);expect(r.text()).toContain('多份');r.unmount();bind({...p,revision:99});const stale=await settings();expect(stale.text()).toContain('不再匹配');await stale.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get(bindingKey)).toContain('99');
});
it('double Save while pending emits a single POST',async()=>{
 const r=await settings();enter(r,'DeepSeek','DS_SYNTHETIC_ONLY');const hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const handler=r.button('保存设置').props.onClick,first=handler(),second=handler();expect(posts()).toHaveLength(1);const {secret,...pub}=JSON.parse(posts()[0][1].body).profile;hold.resolve(response({...pub,revision:1,snapshotHash:'b'.repeat(64)}));await Promise.all([first,second]);expect(posts()).toHaveLength(1);
});

it('DEV fixture uses only injected storage/fetch and preserves local real-store sentinel',async()=>{
 const isolated=new Map<string,string>(),fixtureReads:string[]=[],fixtureWrites:string[]=[];
 const fixture={storage:{getItem:(k:string)=>{fixtureReads.push(k);return isolated.get(k)??null;},setItem:(k:string,v:string)=>{fixtureWrites.push(k);isolated.set(k,v);},removeItem:()=>{throw Error('no removal');}},fetchImpl:vi.fn(async(_,init:any)=>{if(!init?.method)return response([]);const {secret,...pub}=JSON.parse(init.body).profile;return response({...pub,revision:1,snapshotHash:'b'.repeat(64)});})};
 data.set('gd_llm_config','REAL_STORE_NOT_TO_READ');const r=new Render(SettingsModal,{onClose:vi.fn(),fixture}).render();await settle();r.render();enter(r,'DeepSeek','FIXTURE_ONLY');await r.button('保存设置').props.onClick();r.render();expect(reads).toEqual([]);expect(writes).toEqual([]);expect(fetcher).not.toHaveBeenCalled();expect(fixtureReads).toContain('gd_llm_config');expect(fixtureWrites).toContain(bindingKey);expect(isolated.get(bindingKey)).not.toContain('FIXTURE_ONLY');expect(data.get('gd_llm_config')).toBe('REAL_STORE_NOT_TO_READ');
});
it('malformed bindings remain unchanged and block saves instead of resetting into a new connection',async()=>{
 const raw='{"schema":"unknown","glm":null}';data.set(bindingKey,raw);const r=await settings();expect(r.text()).toContain('关联无法读取');expect(r.button('保存设置').props.disabled).toBe(true);await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.get(bindingKey)).toBe(raw);
});

it('S31-PRESET-01: unbound unique old named GLM is masked and migrates the exact saved ref without a replacement key',async()=>{
 const old=profile('glm',{requestedModel:'glm-5',requestOptions:{thinking:{type:'disabled'},reasoning_effort:'high'}});fetcher.mockResolvedValue(response([old]));const r=await settings();
 expect(data.has(bindingKey)).toBe(false);expect(data.has('gd_llm_config')).toBe(false);expect(r.text()).toContain('旧配置保留，预设待保存');expect(input(r,'GLM').props.placeholder).toContain('•');expect(input(r,'GLM').props.disabled).toBe(true);expect(r.text()).not.toContain('填写新 Key 将另建');expect(posts()).toHaveLength(0);
 fetcher.mockImplementation(async(_,init)=>{const command=JSON.parse(init.body);expect(command.expectedRevision).toBe(1);expect(command.expectedSnapshotHash).toBe('a'.repeat(64));expect(command.profile.profileId).toBe(old.profileId);expect(command.profile.baseUrl).toBe(old.baseUrl);expect(command.profile.secret).toBeUndefined();expect(command.profile.requestedModel).toBe('glm-5.3');return response(profile('glm',{revision:2,snapshotHash:'b'.repeat(64)}));});
 await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(JSON.parse(data.get(bindingKey)!).glm).toEqual({profileId:old.profileId,revision:2,snapshotHash:'b'.repeat(64)});expect(input(r,'GLM').props.value).toBe('');
});
it('S31-PRESET-01: ambiguous old named routes are preserved and cannot be replaced by an empty new connection',async()=>{
 const first=profile('glm',{requestedModel:'glm-5'}),second=profile('glm',{profileId:'old-second',requestedModel:'glm-4'});fetcher.mockResolvedValue(response([first,second]));const r=await settings();
 expect(r.text()).toContain('待定位');expect(input(r,'GLM').props.disabled).toBe(true);expect(input(r,'GLM').props.placeholder).not.toContain('填写');expect(r.text()).not.toContain('填写新 Key 将另建');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);expect(input(r,'DeepSeek').props.disabled).toBe(false);
});
it('S31-PRESET-01: an unbound old named endpoint with unverified protocol stays masked and cannot migrate',async()=>{
 const old=profile('glm',{protocol:'anthropic-messages',requestedModel:'glm-5',supportedReasoningOptions:{},requestOptions:{max_tokens:100}});fetcher.mockResolvedValue(response([old]));const r=await settings();
 expect(r.text()).toContain('旧配置保留');expect(r.text()).toContain('协议尚未核实');expect(input(r,'GLM').props.placeholder).toContain('•');expect(input(r,'GLM').props.disabled).toBe(true);expect(r.text()).not.toContain('填写新 Key 将另建');await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);
});

it('provider availability: both fixed presets are identified even before an API key is entered',async()=>{
 const r=await settings();expect(r.text().match(/预设已配置/g)).toHaveLength(2);expect(r.text()).toContain('API来源待确认');expect(r.text()).toContain('API待填写或确认关联');expect(posts()).toHaveLength(0);expect(data.has(bindingKey)).toBe(false);
});
it('provider availability: existing local legacy is saved API pending explicit association, not an empty API prompt',async()=>{
 const original=JSON.stringify({baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'old-model',apiKey:'LEGACY_SYNTHETIC_ONLY',effort:'off'});data.set('gd_llm_config',original);const r=await settings();expect(r.text()).toContain('API已保存');expect(r.text()).toContain('待确认关联');expect(input(r,'GLM').props.placeholder).toContain('•');expect(input(r,'GLM').props.disabled).toBe(true);expect(posts()).toHaveLength(0);expect(data.get('gd_llm_config')).toBe(original);
});
it('provider availability: unknown GLM source never prompts refilling a possibly saved key',async()=>{
 const r=await settings();expect(r.text()).toContain('API来源待确认');expect(r.text()).not.toContain('填写新 Key 将另建');expect(r.text()).toContain('当前浏览器未找到完整旧配置');expect(input(r,'GLM').props.placeholder).not.toContain('填写');expect(input(r,'GLM').props.placeholder).toContain('无需重填');expect(posts()).toHaveLength(0);
});
it('provider availability: invalid legacy exposes only a safe format diagnostic and retains the original',async()=>{
 const raw=JSON.stringify({baseUrl:'https://fixture.invalid',model:'old',apiKey:'LEGACY_SYNTHETIC_ONLY',unknownField:true});data.set('gd_llm_config',raw);const r=await settings();expect(r.text()).toContain('旧配置格式未识别');expect(r.text()).toContain('已有密钥无需重填');expect(r.text()).not.toContain('LEGACY_SYNTHETIC_ONLY');expect(r.text()).not.toContain('https://fixture.invalid');expect(data.get('gd_llm_config')).toBe(raw);expect(posts()).toHaveLength(0);
});

const anthropic=()=>profile('glm',{baseUrl:'https://open.bigmodel.cn/api/anthropic',protocol:'anthropic-messages',supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}});
it('GLM recovery: exact saved Anthropic profile associates without import or private POST',async()=>{
 const p=anthropic();fetcher.mockResolvedValue(response([p]));const r=await settings();expect(r.text()).toContain('API已保存');expect(input(r,'GLM').props.placeholder).toContain('•');
 await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(0);expect(JSON.parse(data.get(bindingKey)!).glm).toEqual(ref(p));
});
it('GLM recovery: explicit original import then Save preserves route and original key, leaving DS untouched',async()=>{
 const ds=profile('deepseek');bind(ds,'deepseek');fetcher.mockImplementation(async(url,init)=>{
  if(url==='/api/import-zcode')return response({baseUrl:'https://open.bigmodel.cn/api/anthropic',apiKey:'ZCODE_SYNTHETIC_ONLY',model:'GLM-5.3',note:'local source'});
  if(init?.method==='POST'){const c=JSON.parse(init.body);expect(c.profile.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');expect(c.profile.protocol).toBe('anthropic-messages');expect(c.profile.secret).toBe('ZCODE_SYNTHETIC_ONLY');expect(c.profile.requestOptions).toEqual({thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768});const{secret,...pub}=c.profile;return response({...pub,revision:1,snapshotHash:'b'.repeat(64)});}
  return response([ds]);
 });const r=await settings();expect(posts()).toHaveLength(0);await r.button('读取本机已有 GLM').props.onClick();r.render();expect(posts()).toHaveLength(1);expect(data.get(bindingKey)).not.toContain('ZCODE');expect(input(r,'GLM').props.placeholder).toContain('•');expect(r.text()).not.toContain('ZCODE_SYNTHETIC_ONLY');
 await r.button('保存设置').props.onClick();r.render();expect(posts()).toHaveLength(2);expect(JSON.parse(data.get(bindingKey)!).deepseek).toEqual(ref(ds));expect(data.has('gd_llm_config')).toBe(false);
});
it('GLM recovery: late import after Cancel cannot save, bind or expose the source',async()=>{
 const r=await settings(),hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const pending=r.button('读取本机已有 GLM').props.onClick();r.button('取消').props.onClick();const before=r.writes;
 hold.resolve(response({baseUrl:'https://open.bigmodel.cn/api/anthropic',apiKey:'LATE_SYNTHETIC_ONLY',model:'GLM-5.3'}));await pending;expect(r.writes).toBe(before);expect(data.has(bindingKey)).toBe(false);expect(posts()).toHaveLength(1);
});
it('GLM recovery: explicit import refuses a changed or unsupported endpoint without save',async()=>{
 const r=await settings();fetcher.mockResolvedValue(response({baseUrl:'https://unverified.invalid',apiKey:'SYNTHETIC_ONLY',model:'GLM-5.3'}));await r.button('读取本机已有 GLM').props.onClick();r.render();await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);expect(data.has(bindingKey)).toBe(false);expect(r.text()).not.toContain('SYNTHETIC_ONLY');expect(r.text()).not.toContain('unverified.invalid');
});

it('GLM recovery: recognized browser Anthropic legacy uses reviewed protocol only on Save and keeps old storage',async()=>{
 const raw=JSON.stringify({baseUrl:'https://open.bigmodel.cn/api/anthropic',model:'GLM-5.3',apiKey:'BROWSER_SYNTHETIC_ONLY',effort:'max'});data.set('gd_llm_config',raw);const r=await settings();expect(posts()).toHaveLength(0);expect(input(r,'GLM').props.placeholder).toContain('•');
 fetcher.mockImplementation(async(_,init)=>{const c=JSON.parse(init.body);expect(c.profile.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');expect(c.profile.protocol).toBe('anthropic-messages');expect(c.profile.secret).toBe('BROWSER_SYNTHETIC_ONLY');expect(c.profile.requestOptions.output_config.effort).toBe('max');const{secret,...pub}=c.profile;return response({...pub,revision:1,snapshotHash:'b'.repeat(64)});});
 await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);expect(data.get('gd_llm_config')).toBe(raw);
});
it('GLM-RESTORE-02: restoring GLM never migrates or rebinds an untouched saved DS old preset',async()=>{
 const ds=profile('deepseek',{requestOptions:{thinking:{type:'enabled'},reasoning_effort:'high'}});bind(ds,'deepseek');const originalBinding=data.get(bindingKey);fetcher.mockImplementation(async(url,init)=>{
  if(url==='/api/import-zcode')return response({baseUrl:'https://open.bigmodel.cn/api/anthropic',apiKey:'ZCODE_SYNTHETIC_ONLY',model:'GLM-5.3'});
  if(init?.method==='POST'){const c=JSON.parse(init.body);const{secret,...pub}=c.profile;return response({...pub,revision:2,snapshotHash:'b'.repeat(64)});}return response([ds]);
 });const r=await settings();await r.button('读取本机已有 GLM').props.onClick();r.render();await r.button('保存设置').props.onClick();r.render();
 const saved=posts().filter(c=>c[0]==='/api/llm-profiles');expect(saved).toHaveLength(1);expect(JSON.parse(saved[0][1].body).profile.profileId).not.toBe(ds.profileId);expect(JSON.parse(data.get(bindingKey)!).deepseek).toEqual(JSON.parse(originalBinding!).deepseek);
 expect(JSON.parse(data.get('gd_llm_profiles_public_v1')!).find((p:any)=>p.profileId===ds.profileId)).toEqual(ds);
 await r.button('保存设置').props.onClick();expect(posts().filter(c=>c[0]==='/api/llm-profiles')).toHaveLength(1);expect(JSON.parse(data.get(bindingKey)!).deepseek).toEqual(ref(ds));
});
it('GLM-RESTORE-02: an explicit independent DS modification still saves its same ref without key reentry',async()=>{
 const ds=profile('deepseek',{requestOptions:{thinking:{type:'enabled'},reasoning_effort:'high'}});bind(ds,'deepseek');fetcher.mockResolvedValue(response([ds]));const r=await settings();r.button('修改').props.onClick();r.render();
 fetcher.mockImplementation(async(_,init)=>{const c=JSON.parse(init.body);expect(c.profile.profileId).toBe(ds.profileId);expect(c.profile.secret).toBeUndefined();expect(c.expectedRevision).toBe(ds.revision);expect(c.profile.requestOptions.reasoning_effort).toBe('max');return response(profile('deepseek',{revision:2,snapshotHash:'b'.repeat(64)}));});
 await r.button('保存设置').props.onClick();expect(posts()).toHaveLength(1);expect(JSON.parse(data.get(bindingKey)!).deepseek.revision).toBe(2);
});
it('GLM-RESTORE-03: explicitly edited DS receipt retries only public binding during the same GLM restoration',async()=>{
 const ds=profile('deepseek',{requestOptions:{thinking:{type:'enabled'},reasoning_effort:'high'}});bind(ds,'deepseek');let block=true;const set=localStorage.setItem;
 localStorage.setItem=(k:string,v:string)=>{if(k===bindingKey&&JSON.parse(v).deepseek?.revision===2&&block)throw Error('synthetic_binding_failure');set(k,v);};
 fetcher.mockImplementation(async(url,init)=>{if(url==='/api/import-zcode')return response({baseUrl:'https://open.bigmodel.cn/api/anthropic',apiKey:'ZCODE_SYNTHETIC_ONLY',model:'GLM-5.3'});if(init?.method==='POST'){const c=JSON.parse(init.body);const{secret,...pub}=c.profile;return response({...pub,revision:2,snapshotHash:'b'.repeat(64)});}return response([ds]);});
 const r=await settings();await r.button('读取本机已有 GLM').props.onClick();r.render();r.nodes().filter(n=>n.type==='button'&&r.text(n)==='修改').at(-1).props.onClick();r.render();await r.button('保存设置').props.onClick();r.render();
 expect(posts().filter(c=>c[0]==='/api/llm-profiles')).toHaveLength(2);expect(JSON.parse(data.get(bindingKey)!).deepseek.revision).toBe(1);block=false;await r.button('保存设置').props.onClick();r.render();expect(posts().filter(c=>c[0]==='/api/llm-profiles')).toHaveLength(2);expect(JSON.parse(data.get(bindingKey)!).deepseek.revision).toBe(2);
});
