import {afterEach,it,expect,vi} from 'vitest';
const hook=vi.hoisted(()=>({current:null as any}));
const visual=vi.hoisted(()=>({vm:{phase:'normal',hand:[],selectedIds:[],players:[{name:'2号',remaining:27},{name:'3号',remaining:27},{name:'4号',remaining:27}],levels:{own:'2',other:'2'},wildRule:'合成公开夹具',phaseLabel:'合成状态',passes:{},actions:{message:'请选择手牌',canPass:false,canHint:false,canPlay:false},selectable:false,exchange:null,exchangeError:null} as any}));
vi.mock('react',async original=>({...await original<any>(),useState:(v:any)=>hook.current.state(v),useRef:(v:any)=>hook.current.ref(v),useMemo:(fn:any,deps:any)=>hook.current.memo(fn,deps),useCallback:(fn:any,deps:any)=>hook.current.memo(()=>fn,deps),useEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),useLayoutEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),useSyncExternalStore:()=>0}));
vi.mock('@gd/engine',()=>({canPass:()=>false,isReturnableCard:()=>false,describeCombo:()=>''}));
vi.mock('../src/game/controller',()=>({HUMAN_SEAT:0}));
vi.mock('../src/ui/gt/viewmodel',()=>({buildGameTableVM:()=>visual.vm}));
vi.mock('../src/ui/gt/fixture',()=>({gtFixtureVM:()=>visual.vm}));
vi.mock('../src/ui/gp/viewmodel',()=>({SEAT_DISPLAY:{north:'2号',west:'3号',east:'4号',self:'1号'}}));
vi.mock('../src/ui/gt/ExchangeHistory',()=>({ExchangeHistory:()=>null}));
import {TablePage} from '../src/ui/TablePage';
import {GameTable} from '../src/ui/gt/GameTable';
/** Actual component functions with controlled hooks/VM, not DOM or a game run. */
class Render {
 slots:any[]=[];index=0;effects:(()=>void)[]=[];tree:any;
 constructor(readonly component:any,public props:any){}
 slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
 state(v:any){const s=this.slot(()=>({value:typeof v==='function'?v():v}));return[s.value,(n:any)=>{s.value=typeof n==='function'?n(s.value):n;}];}
 ref(v:any){return this.slot(()=>({current:v}));}
 memo(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((d,i)=>d!==s.deps[i])){s.value=fn();s.deps=deps;}return s.value;}
 effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||deps.some((d,i)=>d!==s.deps[i])){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
 render(){this.index=0;hook.current=this;this.tree=this.component(this.props);hook.current=null;this.effects.splice(0).forEach(fn=>fn());return this;}
 unmount(){this.slots.forEach(s=>s.cleanup?.());}
 nodes(node?:any):any[]{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.flatMap(n=>this.nodes(n));if(!node||typeof node!=='object')return[];return[node,...this.nodes(node.props?.children??null)];}
 text(node?:any):string{if(arguments.length===0)node=this.tree;if(Array.isArray(node))return node.map(n=>this.text(n)).join('');if(node==null||typeof node==='boolean')return'';return typeof node==='object'?this.text(node.props?.children??null):String(node);}
 table(){return this.nodes().find(n=>n.type===GameTable).props;}
}
function setup(){vi.useFakeTimers();vi.stubGlobal('window',Object.assign(new EventTarget(),{location:{search:''}}));const c:any={state:{ctx:null,lastCombo:null,moveNo:0,match:{gameNo:1},over:false,pendingReturns:[]},sortedHand:()=>[],humanTurn:false,humanReturning:false,waitingRemote:true,decisionError:null,lastDecision:null,exchangeError:null,exchangeHistory:[]};const onExit=vi.fn();const r=new Render(TablePage,{controller:c,onExit,onReview:vi.fn(),onNavStats:vi.fn(),onNavReview:vi.fn(),onOpenSettings:vi.fn()}).render().render();return{c,r,onExit};}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('R14 table status: no engineering/manual panel, persistent waiting and safe alert priority',()=>{
 const {c,r,onExit}=setup();expect(r.nodes().some(n=>n.type==='aside'||n.type==='details')).toBe(false);expect(r.text()).not.toMatch(/四席冻结身份|缓存本地B|连接版本/);expect(r.table()).toMatchObject({toast:'正在等待外部模型决定…',toastRole:'status'});r.table().onBack();expect(onExit).toHaveBeenCalledTimes(1);r.table().onImageError('synthetic');r.render();expect(r.table().toast).toContain('缺少牌面文件');
 for(const [reason,text]of [['revision_conflict','牌局已暂停，请检查设置后再继续。'],['execution_uncertain','牌局已暂停，出牌结果尚未确认，请勿重复出牌。'],['PRIVATE_RAW_ERROR','牌局已暂停，暂时无法完成本手决定，请返回检查。']]){c.decisionError=reason;r.render();expect(r.table()).toMatchObject({toast:text,toastRole:'alert'});expect(r.table().toast).not.toContain(reason);}
 c.decisionError=null;c.waitingRemote=false;r.render();expect(r.table().toast).toContain('缺少牌面文件');vi.advanceTimersByTime(2800);r.render();expect(r.table().toast).toBeNull();r.unmount();
});
it('R14 table status: only confirmed outcome toasts once, historical wording and scope cleanup',()=>{
 const {c,r}=setup();c.waitingRemote=false;c.lastDecision={status:'halted',source:'remote_failure',decisionKey:{gameNo:1}};r.render().render();expect(r.table().toast).toBeNull();c.lastDecision={status:'fallback',source:'remote_failure',decisionKey:{gameNo:1}};r.render().render();expect(r.table().toast).toBe('外部模型本次未能完成决定，已由本地AI接手。');vi.advanceTimersByTime(2000);r.render();vi.advanceTimersByTime(800);r.render();expect(r.table().toast).toBeNull();
 c.lastDecision={status:'fallback',source:'local_override',decisionKey:{gameNo:1}};r.render().render();expect(r.table().toast).toBe('上一手由本地AI接手（历史记录）');c.state.match.gameNo=2;r.render().render();expect(r.table().toast).toBeNull();expect(vi.getTimerCount()).toBe(0);r.unmount();
});
it('R14 table status: existing GameTable toast role and footer precedence stay separate',()=>{
 const {r}=setup();const g=new Render(GameTable,{...r.table(),toast:'暂停提示',toastRole:'alert'}).render();expect(g.nodes().find(n=>n.props.className==='gt-toast')?.props.role).toBe('alert');expect(g.text(g.nodes().find(n=>n.props.className==='gt-message'))).toContain('请选择手牌');
 g.props={...g.props,vm:{...visual.vm,phase:'tribute-result'},toastRole:'status'};g.render();expect(g.nodes().find(n=>n.props.className==='gt-toast')?.props.role).toBe('status');expect(g.text(g.nodes().find(n=>n.props.className==='gt-message'))).toContain('正在核对贡还结果');expect(g.text(g.nodes().find(n=>n.props.className==='gt-message'))).not.toContain('暂停提示');g.unmount();r.unmount();
});
