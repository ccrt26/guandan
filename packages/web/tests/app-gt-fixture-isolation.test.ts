import {afterEach,expect,it,vi} from 'vitest';
import {isValidElement} from 'react';
const hook=vi.hoisted(()=>({current:null as any}));
const forbidden=vi.hoisted(()=>({
 construct:vi.fn(function ForbiddenFixtureController(){throw Error('fixture_constructed_real_controller');}),
 start:vi.fn(()=>{throw Error('fixture_started_game');}),
 load:vi.fn(async()=>{throw Error('fixture_loaded_policy');}),
}));
// Only dependency boundaries are fake. App, PlayerApp, TablePage, the original stub and visual VM stay real.
vi.mock('react',async original=>({...await original<any>(),
 useState:(v:any)=>hook.current.state(v),useRef:(v:any)=>hook.current.ref(v),
 useMemo:(fn:any,deps:any)=>hook.current.memo(fn,deps),useCallback:(fn:any,deps:any)=>hook.current.memo(()=>fn,deps),
 useEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),useLayoutEffect:(fn:any,deps:any)=>hook.current.effect(fn,deps),
 useSyncExternalStore:(subscribe:any,snapshot:any)=>{hook.current.effect(()=>subscribe(()=>{}),[subscribe]);return snapshot();},
}));
vi.mock('../src/game/policy',()=>({webPolicyDescriptors:[],webReleaseChoices:[],loadWebPolicy:forbidden.load,
 loadWebSeats:forbidden.load,loadSavedWebSeats:forbidden.load,loadSavedWebPolicy:forbidden.load,loadRecordedWebPolicy:forbidden.load}));
vi.mock('../src/game/controller',async original=>{
 const actual=await original<typeof import('../src/game/controller')>();
 vi.spyOn(actual.MatchController.prototype,'startGame').mockImplementation(forbidden.start);
 return {...actual,MatchController:forbidden.construct};
});

// This runner actually invokes registered effect functions and their cleanup; SSR alone would miss pruneOrphanReports.
class Instance {
 slots:any[]=[];index=0;
 constructor(readonly effects:Array<()=>void>){}
 slot(fn:()=>any){const i=this.index++;return this.slots[i]??(this.slots[i]=fn());}
 state(initial:any){const s=this.slot(()=>({value:typeof initial==='function'?initial():initial}));return [s.value,(v:any)=>{s.value=typeof v==='function'?v(s.value):v;}];}
 ref(initial:any){return this.slot(()=>({current:initial}));}
 memo(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||!deps||deps.some((v,i)=>!Object.is(v,s.deps[i]))){s.value=fn();s.deps=deps;}return s.value;}
 effect(fn:any,deps:any[]){const s=this.slot(()=>({}));if(!s.deps||!deps||deps.some((v,i)=>!Object.is(v,s.deps[i]))){this.effects.push(()=>{s.cleanup?.();s.cleanup=fn();});s.deps=deps;}}
 cleanup(){this.slots.forEach(s=>s.cleanup?.());}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();hook.current=null;});
it('existing GT DEV fixture bypasses PlayerApp initializers and effects',async()=>{
 const reads=vi.fn(()=>null),writes=vi.fn(),removes=vi.fn(),key=vi.fn(()=>null);
 const memory={getItem:reads,setItem:writes,removeItem:removes,key,length:0};
 const fetcher=vi.fn(async()=>{throw Error('fixture_network_forbidden');});
 vi.stubGlobal('localStorage',memory);vi.stubGlobal('sessionStorage',memory);vi.stubGlobal('fetch',fetcher);
 const events=new EventTarget();vi.stubGlobal('window',Object.assign(events,{location:{search:'?gtfixture=1&gthand=28'}}));
 vi.stubGlobal('document',{activeElement:null});
 // All imports happen after the inert memory boundaries are installed; no user store/weights is read.
 const storage=await import('../src/game/storage');
 const load=vi.spyOn(storage,'loadNewGameSettings'),prune=vi.spyOn(storage,'pruneOrphanReports');
 const {App}=await import('../src/App');
 const {TablePage}=await import('../src/ui/TablePage');
 const {GameTable}=await import('../src/ui/gt/GameTable');
 const {fixtureControllerStub}=await import('../src/ui/gp/fixture');
 const importCounts=[reads.mock.calls.length,writes.mock.calls.length,removes.mock.calls.length,fetcher.mock.calls.length];
 expect(importCounts).toEqual([0,0,0,0]);
 for(const [query,handCount,phase,boundary] of [
  ['?gtfixture=1&gthand=28',28,'normal',false],['?gpfixture=1',27,'normal',false],
  ['?gtfixture=1&gtcounts=boundary&gthand=10',10,'normal',true],
  ['?gtfixture=1&gtcounts=boundary&gtstate=return-pick&gthand=28',28,'return-pick',true],
  ['?gtfixture=1&gtcounts=boundary&gtstate=tribute&gthand=28',28,'tribute-result',true],
 ] as const){
  window.location.search=query;
  const instances:Instance[]=[],effects:Array<()=>void>=[];let game:any,table:any;
  function walk(node:any):void {
   if(Array.isArray(node)){node.forEach(walk);return;}if(!isValidElement(node))return;
   if(node.type===GameTable){game=node;return;} // Real component type/props; geometry/font belongs to the separate real-window check.
   if(typeof node.type==='function'){
    if(node.type===TablePage)table=node;
    const instance=new Instance(effects);instances.push(instance);hook.current=instance;
    let child;try{child=(node.type as (props:unknown)=>unknown)(node.props);}finally{hook.current=null;}
    walk(child);return;
   }
   walk((node.props as {children?:unknown}).children);
  }
  const app=new Instance(effects);instances.push(app);hook.current=app;let tree;
  try{tree=App();}finally{hook.current=null;}walk(tree);
  // Do not replace this with renderToString: the original bug is a registered PlayerApp effect.
  effects.splice(0).forEach(run=>run());
  expect(table.type).toBe(TablePage);expect(table.props.controller).toBe(fixtureControllerStub);
  expect(game.type).toBe(GameTable);expect(game.props.demo).toBe(true);expect(game.props.vm.hand).toHaveLength(handCount);
  expect(game.props.vm.phase).toBe(phase);
  expect(['north','west','east'].map(seat=>game.props.vm.players.find((player:{seat:string;remaining:number})=>player.seat===seat).remaining)).toEqual(boundary?[0,9,27]:[23,23,21]);
  game.props.onBack();game.props.onNav('stats');game.props.onNav('review');game.props.onSettings();table.props.onReview(undefined);
  effects.splice(0).forEach(run=>run());instances.reverse().forEach(instance=>instance.cleanup());
  expect(load).not.toHaveBeenCalled();expect(prune).not.toHaveBeenCalled();
  expect(reads).not.toHaveBeenCalled();expect(writes).not.toHaveBeenCalled();expect(removes).not.toHaveBeenCalled();expect(key).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();expect(forbidden.construct).not.toHaveBeenCalled();expect(forbidden.start).not.toHaveBeenCalled();expect(forbidden.load).not.toHaveBeenCalled();
 }
});
