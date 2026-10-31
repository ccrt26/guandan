import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Finite hook runner executes real component handlers. Not a DOM/IAB or React runtime claim.
const hook = vi.hoisted(() => ({ current: null as any }));
vi.mock('react', async original => ({ ...await original<any>(),
  useState: (v:any) => hook.current.state(v), useRef: (v:any) => hook.current.ref(v),
  useMemo: (fn:any,deps:any) => hook.current.memo(fn,deps),
  useEffect: (fn:any,deps:any) => hook.current.effect(fn,deps),
  useLayoutEffect: (fn:any,deps:any) => hook.current.effect(fn,deps),
}));
import { SettingsModal } from '../src/ui/SettingsModal';
import { VerifiedReportTab } from '../src/ui/VerifiedReportTab';
import { acceptCoachResponse } from '@gd/review';
const p={profileId:'fake-one',nickname:'Fake one',revision:1,snapshotHash:'a'.repeat(64),protocol:'openai-chat-completions',baseUrl:'https://fixture.invalid/v1',requestedModel:'fake-model',supportedReasoningOptions:{},requestOptions:{}};
const ref={profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash};
const completed=(text='正常')=>({status:'completed',text,summary:{...ref,protocol:p.protocol,requestedModel:p.requestedModel,returnedModel:null,requestCount:1}});
const response=(data:any,ok=true)=>({ok,status:ok?200:400,json:async()=>data});
function deferred<T=any>(){let resolve!:(value:T)=>void,reject!:(reason:any)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
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
let data:Map<string,string>,fetcher:ReturnType<typeof vi.fn>;
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
beforeEach(()=>{data=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});fetcher=vi.fn(async (url:string)=>{if(url==='/api/llm-profiles')return response([p]);throw Error('unplanned fake request');});vi.stubGlobal('fetch',fetcher);});
afterEach(()=>vi.unstubAllGlobals());
async function settings(){const r=new Render(SettingsModal,{onClose:vi.fn()}).render();await settle();r.render();r.select();return r;}
it('settings sends only exact explicit reference/messages and requires completed JSON',async()=>{
 const r=await settings();fetcher.mockResolvedValueOnce(response(completed()));await r.button('测试连接').props.onClick();r.render();
 const [url,init]=fetcher.mock.calls.at(-1)!;expect(url).toBe('/api/chat');expect(JSON.parse(init.body)).toEqual({reference:ref,messages:[{role:'user',content:'请只回复两个字：正常'}]});expect(init.signal).toBeInstanceOf(AbortSignal);expect(init.headers).toEqual({'content-type':'application/json'});expect(r.text()).toContain('连接成功');
 fetcher.mockResolvedValueOnce(response({status:'failed',error:'provider_error'}));await r.button('测试连接').props.onClick();r.render();expect(r.text()).not.toContain('连接成功');
});
it.each(['取消测试','关闭设置','unmount'])('settings %s aborts without waiting for held fetch and late writes',async action=>{
 const r=await settings(),hold=deferred();fetcher.mockReturnValueOnce(hold.promise);let settled=false;const pending=r.button('测试连接').props.onClick().finally(()=>{settled=true;});r.render();const signal=fetcher.mock.calls.at(-1)![1].signal;
 if(action==='unmount')r.unmount();else r.button(action).props.onClick();expect(signal.aborted).toBe(true);await settle();expect(settled).toBe(true);const writes=r.writes,cache=JSON.stringify([...data]);hold.resolve(response(completed()));await pending;expect(r.writes).toBe(writes);expect(JSON.stringify([...data])).toBe(cache);
});
it('settings import is POST, keeps draft only, and late cancelled import cannot write',async()=>{
 const r=await settings(),before=JSON.stringify([...data]);fetcher.mockResolvedValueOnce(response({baseUrl:'https://fake.invalid',apiKey:'FAKE_ONLY',model:'fake',note:'fixture'}));await r.button('显式读取本机 Coding Plan 草稿').props.onClick();r.render();expect(fetcher.mock.calls.at(-1)![1].method).toBe('POST');expect(JSON.stringify([...data])).toBe(before);expect(r.text()).toContain('未验证');expect(r.text()).toContain('未保存');
 const hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const pending=r.button('显式读取本机 Coding Plan 草稿').props.onClick();r.render();r.button('取消导入').props.onClick();await settle();const writes=r.writes;hold.resolve(response({apiKey:'LATE_FAKE'}));await pending;expect(r.writes).toBe(writes);
});
const evidence:any={decisionId:'surface#m2',recordId:'surface',moveNo:2,seat:1,replayStatus:'exact',actual:{actionId:'a0',coverage:{status:'exact',index:0},wildAs:[],declaration:null},facts:{rule:'小王压得过♥A',count:'剩余5张'},actionTexts:{a0:'小王',a1:'♥A'},claims:[{claimId:'c1',kind:'rule_relation',decisionId:'surface#m2',factIds:['rule'],scope:'provable_fact',text:'小王压得过♥A'}],claimLevel:'provable_fact',conflicts:[],missing:[],recordHash:'fixture',verifiedPrefixEnd:2,ruleContext:{levelMode:'stage',stageTeam:0,levelsBefore:[2,2],version:'fixture'},observation:{hash:'fixture',basis:'legal visible'},candidates:null,policy:null,heuristic:{topActionId:null,note:null,perItemBreakdown:false},heuristicBreakdowns:[],rollouts:[],expressionScope:'只陈述规则事实',singleStep:{actual:{actionId:'a0',label:'实际打法',sourceId:'record',text:'小王',remainingCards:5,wildsSpent:0,factIds:['count']},alternatives:[]}};
const positive={summary:'以下仅说明规则事实。',lessons:[{decisionId:'surface#m2',actionIds:['a0'],factIds:['rule'],claimIds:['c1'],claimLevel:'provable_fact',title:'规则比较',text:'小王压得过♥A。'}]};
async function coach(){const r=new Render(VerifiedReportTab,{record:{id:'surface',humanSeat:0},evidence:[evidence],onJump:vi.fn()}).render();await settle();r.render();r.select();return r;}
it.each(['取消讲解','scope','unmount'])('coach %s invalidates immediately and late JSON writes nothing',async action=>{
 const r=await coach(),hold=deferred();fetcher.mockResolvedValueOnce({ok:true,status:200,json:()=>hold.promise});let settled=false;const pending=r.button('生成 AI 讲解').props.onClick().finally(()=>{settled=true;});await settle();r.render();const signal=fetcher.mock.calls.at(-1)![1].signal;
 if(action==='unmount')r.unmount();else if(action==='scope')r.render({...r.props,record:{id:'other',humanSeat:0}});else r.button(action).props.onClick();expect(signal.aborted).toBe(true);await settle();expect(settled).toBe(true);const writes=r.writes,cache=JSON.stringify([...data]);hold.resolve(completed(JSON.stringify(positive)));await pending;expect(r.writes).toBe(writes);expect(JSON.stringify([...data])).toBe(cache);
});
it('coach accepts completed valid facts only, preserves original factual validator',async()=>{
 const r=await coach();expect(acceptCoachResponse(JSON.stringify(positive),[evidence])).toEqual(positive);fetcher.mockResolvedValueOnce(response(completed(JSON.stringify(positive))));await r.button('生成 AI 讲解').props.onClick();r.render();expect(r.nodes().some(n=>n.props?.['data-testid']==='accepted-coach-output'),r.text()).toBe(true);
 const bad={...positive,summary:'小王压不过♥A。'};expect(acceptCoachResponse(JSON.stringify(bad),[evidence])).toBeNull();fetcher.mockResolvedValueOnce(response(completed(JSON.stringify(bad))));await r.button('生成 AI 讲解').props.onClick();r.render();expect(r.nodes().some(n=>n.props?.['data-testid']==='accepted-coach-output')).toBe(false);expect(r.text()).toContain('未通过事实');
});

it('no automatic first profile, no legacy read/migration; stale saved revision never rebinds',async()=>{
 data.set('gd_llm_config',JSON.stringify({baseUrl:'https://legacy.invalid',apiKey:'LEGACY_FAKE',model:'legacy'}));
 const r=new Render(SettingsModal,{onClose:vi.fn()}).render();await settle();r.render();expect(r.button('测试连接').props.disabled).toBe(true);expect(data.has('gd_chat_profile_reference_v1')).toBe(false);
 data.set('gd_chat_profile_reference_v1',JSON.stringify({...ref,revision:99}));
 const stale=new Render(SettingsModal,{onClose:vi.fn()}).render();await settle();stale.render();expect(stale.button('测试连接').props.disabled).toBe(true);expect(stale.text()).toContain('不再匹配');expect(JSON.parse(data.get('gd_chat_profile_reference_v1')!).revision).toBe(99);
});
it('new settings operation survives old rejection/finally without a second send',async()=>{
 const r=await settings(),old=deferred(),fresh=deferred();fetcher.mockReturnValueOnce(old.promise);const first=r.button('测试连接').props.onClick();r.render();r.button('取消测试').props.onClick();r.render();fetcher.mockReturnValueOnce(fresh.promise);const second=r.button('测试连接').props.onClick();await settle();r.render();const writes=r.writes;old.reject(Error('LATE_FAKE'));await first;r.render();expect(r.writes).toBe(writes);expect(r.button('取消测试')).toBeDefined();fresh.resolve(response(completed()));await second;r.render();expect(r.text()).toContain('连接成功');expect(fetcher.mock.calls.filter(c=>c[0]==='/api/chat')).toHaveLength(2);
});
it('coach evidence-only change aborts, and deterministic action invalidates old network output',async()=>{
 const r=await coach(),hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const pending=r.button('生成 AI 讲解').props.onClick();r.render();const signal=fetcher.mock.calls.at(-1)![1].signal;
 r.render({...r.props,evidence:[{...evidence,facts:{...evidence.facts,count:'剩余7张'}}]});expect(signal.aborted).toBe(true);await settle();const writes=r.writes;hold.resolve(response(completed(JSON.stringify(positive))));await pending;expect(r.writes).toBe(writes);
 const hold2=deferred();fetcher.mockReturnValueOnce(hold2.promise);const pending2=r.button('生成 AI 讲解').props.onClick();r.render();const signal2=fetcher.mock.calls.at(-1)![1].signal;r.button('查看确定性事实讲解').props.onClick();expect(signal2.aborted).toBe(true);await settle();const after=r.writes;hold2.resolve(response(completed(JSON.stringify(positive))));await pending2;expect(r.writes).toBe(after);
});
it('profile choice change aborts current test and never automatically tests the replacement',async()=>{
 const r=await settings(),hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const pending=r.button('测试连接').props.onClick();r.render();const signal=fetcher.mock.calls.at(-1)![1].signal;r.select();expect(signal.aborted).toBe(true);await settle();const writes=r.writes;hold.resolve(response(completed()));await pending;expect(r.writes).toBe(writes);expect(fetcher.mock.calls.filter(c=>c[0]==='/api/chat')).toHaveLength(1);
});

it.each(['新增连接','显式读取本机 Coding Plan 草稿'])('review: early %s preserves profile-readiness load',async action=>{
 const listHold=deferred();fetcher.mockReturnValueOnce(listHold.promise);
 const r=new Render(SettingsModal,{onClose:vi.fn()}).render();
 const listSignal=fetcher.mock.calls[0][1].signal;
 fetcher.mockResolvedValueOnce(response({baseUrl:'https://fake.invalid',apiKey:'FAKE_ONLY',model:'fake'}));
 await r.button(action).props.onClick();r.render();
 listHold.resolve(response([p]));await settle();r.render();
 expect.soft(listSignal.aborted, 'editor/import action should not abort sole initial profile refresh').toBe(false);
 expect.soft(r.nodes().find(n=>n.type==='select'&&n.props['aria-label']==='测试与教练连接').props.disabled,'profile choice must become available without losing draft by reopening modal').toBe(false);
});
it('review: semantically unchanged evidence array from ReviewPage does not abort coach request',async()=>{
 const r=await coach(),hold=deferred();fetcher.mockReturnValueOnce(hold.promise);
 const pending=r.button('生成 AI 讲解').props.onClick();r.render();
 const signal=fetcher.mock.calls.at(-1)![1].signal;
 // ReviewPage.tsx:435 uses .filter(...) on every render, including favorite/playback state updates.
 r.render({...r.props,evidence:[...r.props.evidence]});
 expect.soft(signal.aborted,'same review scope is not a cancellation event').toBe(false);
 hold.resolve(response(completed(JSON.stringify(positive))));await pending;r.render();
 expect(r.nodes().some(n=>n.props?.['data-testid']==='accepted-coach-output'),'current complete valid output should survive unrelated parent update').toBe(true);
});
it('independent settings profile refresh still aborts on close/unmount with zero late cache/state writes',async()=>{
 for(const action of ['关闭设置','unmount']){
  const hold=deferred();fetcher.mockReturnValueOnce(hold.promise);const r=new Render(SettingsModal,{onClose:vi.fn()}).render();const signal=fetcher.mock.calls.at(-1)![1].signal;
  if(action==='unmount')r.unmount();else r.button(action).props.onClick();expect(signal.aborted).toBe(true);await settle();const writes=r.writes,cache=JSON.stringify([...data]);hold.resolve(response([p]));await settle();expect(r.writes).toBe(writes);expect(JSON.stringify([...data])).toBe(cache);
 }
});
