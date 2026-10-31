import {expect,it,vi,afterEach} from 'vitest';
import {existsSync} from 'node:fs';
import {MatchController} from '../src/game/controller';
import oldSave from '../../../lab/review6_2/checks/fixtures/B05-old-o-save.json';
import missingSave from '../../../lab/review6_2/checks/fixtures/B05-missing-release-save.json';
const path=new URL('../../../scripts/ui/b05-restore-ui/safety.mjs',import.meta.url);
const storage=(entries:Record<string,string>={})=>{
 const map=new Map(Object.entries(entries));return {get length(){return map.size;},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('ships the bounded B05 helper safety contract',()=>expect(existsSync(path)).toBe(true));
it('only installs exact artificial saves into empty or fixture-owned storage',async()=>{
 const {installFixture,MARKER_KEY,MARKER_VALUE}=await import('../../../scripts/ui/b05-restore-ui/safety.mjs');
 const s=storage();installFixture(s,oldSave);expect(JSON.parse(s.getItem('gd_match_current')!)).toEqual(oldSave);
 s.setItem('gd_llm_profiles_public_v1','[]');installFixture(s,missingSave);expect(JSON.parse(s.getItem('gd_match_current')!)).toEqual(missingSave);
 for(const entries of [{unrelated:'keep'},{gd_match_current:JSON.stringify(oldSave)},
  {[MARKER_KEY]:MARKER_VALUE,gd_match_current:JSON.stringify({...oldSave,matchId:'user-match'})},
  {[MARKER_KEY]:MARKER_VALUE,gd_llm_profiles_public_v1:'[{"private":"do not read"}]'},
  {[MARKER_KEY]:MARKER_VALUE,unrelated:'keep'}]) {
   const foreign=storage(entries);const before=[...Array(foreign.length)].map((_,i)=>[foreign.key(i),foreign.getItem(foreign.key(i)!)]);
   expect(()=>installFixture(foreign,oldSave)).toThrow('origin_not_fixture_owned');
   expect([...Array(foreign.length)].map((_,i)=>[foreign.key(i),foreign.getItem(foreign.key(i)!)] )).toEqual(before);
 }
 expect(()=>installFixture(s,{...oldSave,matchId:'user-match'})).toThrow('unknown_fixture');
});
it('only accepts same-origin registered O and empty-profile GETs',async()=>{
 const {allowedFetch}=await import('../../../scripts/ui/b05-restore-ui/safety.mjs');
 const origin='http://127.0.0.1:15181';
 expect(allowedFetch('ai/clean2.f32',undefined,origin)).toBe('o');
 expect(allowedFetch('/api/llm-profiles',undefined,origin)).toBe('profiles');
 for(const [url,init] of [['/api/llm-play',undefined],['https://example.test/ai/clean2.f32',undefined],['/ai/other.f32',undefined],['/api/llm-profiles',{method:'POST'}],['/ai/clean2.f32?other=1',undefined]] as const)expect(allowedFetch(url,init,origin)).toBe(null);
});
it('seed1234 original old-O fixture starts at human0 with zero actions; no model is loaded',()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',storage({'gd_match_current':JSON.stringify(oldSave)}));
 const c=new MatchController({difficulty:1,rules:oldSave.ruleOpts as any,resumeMatch:oldSave as any});
 try {c.startGame();expect(c.humanTurn).toBe(true);expect(c.state!.turn).toBe(0);expect(c.state!.moveNo).toBe(0);expect(c.waitingRemote).toBe(false);expect(c.matchSavePoint().activeGame!.moves).toHaveLength(0);}finally{c.destroy();}
});
it('blocks the real forward and controller action methods before work',async()=>{
 const {installNoPlayGuards}=await import('../../../scripts/ui/b05-restore-ui/safety.mjs');
 const {MLP}=await import('../../ai/src/nn/mlp');const events:string[]=[];
 const restore=installNoPlayGuards(MLP,MatchController,(kind:string)=>events.push(kind));
 try {expect(()=>MLP.prototype.forward.call(null as any,null as any,1)).toThrow('forward_forbidden');expect(()=>(MatchController.prototype as any).step.call(null,{pass:true})).toThrow('play_forbidden');expect(events).toEqual(['forward','step']);}finally{restore();}
});
