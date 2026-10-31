/** Fixture-only guard. No browser, server or storage side effects on import. */
export const MARKER_KEY='b05_restore_ui_owner';
export const MARKER_VALUE='B05.restore_ui/artificial-fixtures/v1';
export const MATCH_KEY='gd_match_current';
const ids=new Set(['B05-manual-legacy-o','B05-manual-missing']);
const keys=new Set([MARKER_KEY,MATCH_KEY,'gd_llm_profiles_public_v1']);
export function assertOwnedStorage(storage) {
 if(storage.length===0)return;
 if(storage.getItem(MARKER_KEY)!==MARKER_VALUE)throw Error('origin_not_fixture_owned');
 for(let i=0;i<storage.length;i++)if(!keys.has(storage.key(i)))throw Error('origin_not_fixture_owned');
 if(![null,'[]'].includes(storage.getItem('gd_llm_profiles_public_v1')))throw Error('origin_not_fixture_owned');
 const raw=storage.getItem(MATCH_KEY);
 if(raw!==null){let save;try{save=JSON.parse(raw);}catch{throw Error('origin_not_fixture_owned');}if(!ids.has(save?.matchId))throw Error('origin_not_fixture_owned');}
}
export function installFixture(storage,fixture) {
 if(!ids.has(fixture?.matchId))throw Error('unknown_fixture');
 assertOwnedStorage(storage);
 storage.setItem(MARKER_KEY,MARKER_VALUE);
 storage.setItem(MATCH_KEY,JSON.stringify(fixture));
}
export function allowedFetch(input,init,origin) {
 const url=new URL(typeof input==='string'?input:input.url??String(input),origin+'/');
 const method=(init?.method??input?.method??'GET').toUpperCase();
 if(url.origin!==origin||method!=='GET'||url.search||url.hash)return null;
 return url.pathname==='/ai/clean2.f32'?'o':url.pathname==='/api/llm-profiles'?'profiles':null;
}
export function clearInheritedVite(env) {
 for(const key of Object.keys(env))if(key.startsWith('VITE_'))delete env[key];
}
/** Same real prototypes used by App; rejection happens before any computation/action. */
export function installNoPlayGuards(MLP,Controller,onBlocked) {
 const forward=MLP.prototype.forward,step=Controller.prototype.step;
 MLP.prototype.forward=function(){onBlocked('forward');throw Error('B05_restore_ui_forward_forbidden');};
 Controller.prototype.step=function(){onBlocked('step');throw Error('B05_restore_ui_play_forbidden');};
 return ()=>{MLP.prototype.forward=forward;Controller.prototype.step=step;};
}
