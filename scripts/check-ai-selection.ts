/** NAV-S31 bounded UI-INTENT / IDENTITY / COMPAT checks. Synthetic storage only; no network/weights. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolvePolicy } from '../packages/ai/src/policy/resolve';
import { RELEASES, defaultSeatAssignments, type FrozenAISeat } from '../packages/ai/src/policy/seats';
import { validatePolicyIndex } from '../packages/ai/src/policy/descriptor';
import { assertSavedSeats, savedAssignments, resolveFourSeats } from '../packages/web/src/game/seats';
import { validateProductModelCatalog, validateNewGameSettings, newGameSettingsFromLegacy, resolveNewGameAssignments,
  resolveNewGameSeats, describeSeatChoice, sameAIChoice, setDraftSeat, setAllDraftSeats, restoreDefaultSelection } from '../packages/web/src/game/ai-selection';
import { loadNewGameSettings, saveNewGameSettings, loadProviderBindings, saveProviderBindings } from '../packages/web/src/game/storage';
const registry=validatePolicyIndex(JSON.parse(readFileSync(new URL('../lab/model-index.json',import.meta.url),'utf8')));
const policies=registry.policies;
const catalog=JSON.parse(readFileSync(new URL('../packages/web/src/game/local-model-releases.json',import.meta.url),'utf8'));
const choices=RELEASES.map(release=>({release,available:!!policies.find(p=>p.policyId===release.proposalPolicyRef)?.weightsPathOrUrl.assetUrl}));
const context={policies,choices,profiles:[]};
let checks=0;function check(name:string,fn:()=>void){fn();checks++;console.log(`PASS ${name}`);}
const auto={schema:'ohuo-new-game-settings-v1',passA:'head3',aiSelection:{kind:'auto_latest'}} as const;
check('UI-IDENTITY actual formal C policy, native full strategy and immutable descriptors',()=>{
 assert.equal(catalog.formalLocalReleaseRef,'ohuo-1030-b-v1');
 const c=validateProductModelCatalog(catalog,policies);assert.equal(c.models[0].weightsSHA256,'d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081');
 const p=policies.find(p=>p.policyId===c.models[0].policyId)!;assert.equal(p.tierSpecId,'none');assert.equal(p.epsilon,0);
 assert.equal(RELEASES.find(r=>r.releaseRef===c.formalLocalReleaseRef)!.tier,'hard');
 assert.match(RELEASES.find(r=>r.releaseRef===c.formalLocalReleaseRef)!.label,/C1400/);
 assert.equal(registry.defaultPolicyRef,'frozenChampion-clean2-ck7051-encv1-candv2');
});
check('UI-INTENT auto resolves three exact C assignments, explicit preserves O and no tier field',()=>{
 const seats=resolveNewGameAssignments(auto,context);
 assert.deepEqual(seats,[{controller:'human'},...Array.from({length:3},()=>({controller:'ai',releaseRef:'ohuo-1030-b-v1',mode:'local'}))]);
 assert.deepEqual(newGameSettingsFromLegacy({passA:'head',seats:defaultSeatAssignments('easy')}).aiSelection,{kind:'explicit',seats:defaultSeatAssignments('easy')});
 assert.throws(()=>validateNewGameSettings({...auto,tier:'standard'}));
 assert.throws(()=>validateNewGameSettings({...auto,aiSelection:{kind:'explicit',seats:[...seats].fill(seats[1])}}));
 assert.equal(newGameSettingsFromLegacy({passA:'head3'}).aiSelection.kind,'auto_latest');
});
check('UI-IDENTITY catalog rejects unknown, duplicate, invalid date/version and mismatched identity',()=>{
 for(const bad of [{...catalog,unknown:1},{...catalog,models:[...catalog.models,...catalog.models]}, {...catalog,formalLocalReleaseRef:'ohuo-1030-h-v1'},
 ...[{version:'01.0.0'},{version:'1.0.1',displayVersion:'v1'},{effectiveDate:'2026-02-30'},{weightsSHA256:'f'.repeat(64)},{policyId:'absent'}].map(p=>({...catalog,models:[{...catalog.models[0],...p}]}))]) assert.throws(()=>validateProductModelCatalog(bad,policies));
});
check('UI-INTENT drafts isolate changes, uniform setting and reset keep passA; no-change confirm stays auto',()=>{
 const before=JSON.stringify(auto),seat=defaultSeatAssignments('easy')[1];
 const one=setDraftSeat(auto,2,seat,context);assert.equal(one.aiSelection.kind,'explicit');
 assert.equal(JSON.stringify(auto),before);assert.equal(validateNewGameSettings(auto).aiSelection.kind,'auto_latest');
 const all=setAllDraftSeats(one,seat);assert.equal(all.passA,'head3');
 assert.deepEqual(resolveNewGameAssignments(all,context).slice(1),[seat,seat,seat]);
 assert.deepEqual(restoreDefaultSelection({...all,passA:'double'}),{...auto,passA:'double'});
});
check('UI-IDENTITY names use actual local and hybrid identities; distinct profile revisions never merge',()=>{
 const local=resolveNewGameAssignments(auto,context)[1];
 const profile={profileId:'synthetic-ds',revision:1,snapshotHash:'a'.repeat(64),nickname:'DeepSeek',protocol:'openai-chat-completions' as const,baseUrl:'https://api.deepseek.com',requestedModel:'deepseek-flash',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'}};
 const hybrid={controller:'ai' as const,releaseRef:'ohuo-1030-h-v1',mode:'hybrid' as const,profileRevisionRef:{profileId:profile.profileId,revision:1,snapshotHash:profile.snapshotHash}};
 assert.equal(describeSeatChoice(local,context).shortName,'ohuo-v1-1031');
 const desc=describeSeatChoice(hybrid,{...context,profiles:[profile]});assert.equal(desc.shortName,'ohuo-v1-1031 + DeepSeek');assert.match(desc.detail,/synthetic-ds/);
 assert(sameAIChoice(local,local,context));assert(!sameAIChoice(local,hybrid,{...context,profiles:[profile]}));
 const nextProfile={...profile,revision:2,snapshotHash:'b'.repeat(64)},next={...hybrid,profileRevisionRef:{...hybrid.profileRevisionRef,revision:2,snapshotHash:nextProfile.snapshotHash}};
 assert(!sameAIChoice(hybrid,next,{...context,profiles:[profile,nextProfile]}));
 assert.throws(()=>resolveNewGameAssignments(setAllDraftSeats(auto,hybrid),context),/profile/);
 const badReleases=RELEASES.map(r=>r.releaseRef===hybrid.releaseRef?{...r,parentRelease:'product-o-hard-v1'}:r);
 assert.throws(()=>describeSeatChoice(hybrid,{...context,releases:badReleases,profiles:[profile]}));
});
check('UI-INTENT storage failures never replace committed state, corrupt values retained',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 assert.deepEqual(loadNewGameSettings(undefined,storage),auto);saveNewGameSettings(auto,storage);
 assert.deepEqual(loadNewGameSettings(undefined,storage),auto);
 assert.throws(()=>saveNewGameSettings({...auto,passA:'head'},{setItem:()=>{throw Error('quota');}}),/quota/);
 assert.deepEqual(loadNewGameSettings(undefined,storage),auto);
 data.set('gd_new_game_settings_v1','{bad');assert.throws(()=>loadNewGameSettings(undefined,storage));assert.equal(data.get('gd_new_game_settings_v1'),'{bad');
});
check('UI-COMPAT frozen old local and all-AI seats retain original complete snapshot bytes',()=>{
 const p=policies[1],r=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!;
 const ai={controller:'ai',releaseRef:r.releaseRef,mode:r.mode,release:r,policyIdentity:{policyId:p.policyId,weightsSHA256:p.weightsSHA256}} as FrozenAISeat;
 const snapshot={schemaVersion:2 as const,seats:[ai,ai,ai,ai]},before=JSON.stringify(snapshot);
 assertSavedSeats(snapshot,structuredClone(snapshot));assert.equal(savedAssignments(snapshot)[0].controller,'ai');
 assert.equal(describeSeatChoice(ai).shortName,'ohuo-v1-1031');assert.equal(JSON.stringify(snapshot),before);
 assert.throws(()=>assertSavedSeats(snapshot,{...snapshot,seats:[{...ai,release:{...r,label:'new name'}},ai,ai,ai]}));
});
check('UI-INTENT missing formal assets never fall back to O',()=>{
 assert.throws(()=>resolveNewGameAssignments(auto,{...context,choices:choices.map(c=>({...c,available:false}))}),/unavailable/);
});
check('UI-INTENT formal pointer only changes the next auto game, explicit remains pinned',()=>{
 const c=structuredClone(catalog),release={...RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,releaseRef:'fixture-formal-v2',proposalPolicyRef:'fixture-policy-v2'};
 const policy={...policies[1],policyId:'fixture-policy-v2',weightsSHA256:'c'.repeat(64)};
 c.models.push({...c.models[0],releaseRef:release.releaseRef,policyId:policy.policyId,weightsSHA256:policy.weightsSHA256,version:'1.1.0',displayVersion:'v1.1.0',effectiveDate:'2026-11-01'});c.formalLocalReleaseRef=release.releaseRef;
 const old=resolveNewGameAssignments(auto,context),before=JSON.stringify(old),explicit=validateNewGameSettings({...auto,aiSelection:{kind:'explicit',seats:old}});
 const nextContext={...context,catalog:c,releases:[...RELEASES,release],policies:[...policies,policy],choices:[...choices,{release,available:true}]};
 assert.equal((resolveNewGameAssignments(auto,nextContext)[1] as any).releaseRef,release.releaseRef);
 assert.equal((resolveNewGameAssignments(explicit,nextContext)[1] as any).releaseRef,'ohuo-1030-b-v1');assert.equal(JSON.stringify(old),before);
});
check('UI-IDENTITY full policy identity participates in frozen aggregation',()=>{
 const p=policies[1],r=RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!;
 const ai={controller:'ai',releaseRef:r.releaseRef,mode:r.mode,release:r,policyIdentity:{policyId:p.policyId,weightsSHA256:p.weightsSHA256,encoderVersion:'one'}} as FrozenAISeat;
 assert(!sameAIChoice(ai,{...ai,policyIdentity:{...ai.policyIdentity,encoderVersion:'two'}}));
});
check('UI-INTENT provider binding persistence is public exact-reference only',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 const empty=loadProviderBindings(storage);assert.deepEqual(empty,{schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null});
 const ref={profileId:'synthetic',revision:1,snapshotHash:'a'.repeat(64)};saveProviderBindings({...empty,glm:ref},storage);assert.deepEqual(loadProviderBindings(storage).glm,ref);
 for(const bad of [{...empty,secret:'sentinel'},{...empty,glm:{...ref,secret:'sentinel'}},{...empty,glm:{...ref,revision:0}},{...empty,glm:{...ref,snapshotHash:'bad'}}])assert.throws(()=>saveProviderBindings(bad as any,storage));
 assert.throws(()=>saveProviderBindings(empty,{setItem:()=>{throw Error('quota');}}));assert.deepEqual(loadProviderBindings(storage).glm,ref);
 data.set('gd_provider_bindings_v1','bad');assert.throws(()=>loadProviderBindings(storage));assert.equal(data.get('gd_provider_bindings_v1'),'bad');
});
let invoked=0;await assert.rejects(()=>resolveNewGameSeats(auto,{...context,choices:choices.map(c=>({...c,available:false}))},async()=>{invoked++;throw Error('must not load');}));assert.equal(invoked,0);
// One honest synthetic byte fixture exercises the original verified load/freeze/restore chain.
// It is generated in memory and has its own hash/id; never claims to be the registered C bytes.
const fixtureBytes=new Uint8Array(policies[1].parameterCount*4),fixtureSHA=createHash('sha256').update(fixtureBytes).digest('hex');
const fixturePolicy={...policies[1],policyId:'s31-synthetic-policy',weightsSHA256:fixtureSHA};
const fixtureRelease={...RELEASES.find(r=>r.releaseRef==='ohuo-1030-b-v1')!,releaseRef:'s31-synthetic-release',proposalPolicyRef:fixturePolicy.policyId,remoteFallbackPolicyRef:fixturePolicy.policyId};
const fixtureCatalog={schema:'ohuo-product-model-catalog-v1',formalLocalReleaseRef:fixtureRelease.releaseRef,models:[{...catalog.models[0],releaseRef:fixtureRelease.releaseRef,policyId:fixturePolicy.policyId,weightsSHA256:fixtureSHA,version:'1.1.0',displayVersion:'v1.1.0',effectiveDate:'2026-11-01'}]};
const fixtureContext={catalog:fixtureCatalog,policies:[fixturePolicy],releases:[fixtureRelease],choices:[{release:fixtureRelease,available:true}],profiles:[]};
const loadFixture=()=>resolvePolicy(fixturePolicy.policyId,{registry:{schemaVersion:'gd-model-index-v1',defaultPolicyRef:fixturePolicy.policyId,policies:[fixturePolicy]},site:'browser',readWeights:async()=>fixtureBytes,sha256:bytes=>createHash('sha256').update(bytes).digest('hex')});
const loaded=await resolveNewGameSeats(auto,fixtureContext,assignments=>resolveFourSeats(assignments,loadFixture,[],[fixtureRelease]));
assert.equal(loaded.snapshot.seats[0].controller,'human');assert(loaded.runtime.slice(1).every(s=>s?.policy.identity.tierSpecId==='none'&&s.policy.identity.epsilon===0));
const saved=structuredClone(loaded.snapshot),savedBefore=JSON.stringify(saved);
const restored=await resolveFourSeats(savedAssignments(saved),loadFixture,[],[fixtureRelease]);assertSavedSeats(saved,restored.snapshot);assert.equal(JSON.stringify(saved),savedBefore);
await assert.rejects(()=>resolveNewGameSeats(auto,fixtureContext,async()=>({snapshot:saved,runtime:loaded.runtime})),/unverified_loaded_seats/);
checks++;console.log('PASS UI-COMPAT generated synthetic bytes exercise real verified new-game load and unchanged saved snapshot restore');
console.log(JSON.stringify({status:'passed',groups:['UI-INTENT','UI-IDENTITY','UI-COMPAT'],checks,networkRequests:0,actualModelReads:0}));
