/** Product intent/identity adapter only. Does not mutate research defaults or frozen release schemas. */
import type { RuleOptions } from '@gd/engine';
import type { PolicyDescriptor } from '../../../ai/src/policy/descriptor';
import { RELEASES, type ReleaseDescriptor, type SeatAssignment, type FrozenAISeat } from '../../../ai/src/policy/seats';
import { freezeCopy } from '../../../ai/src/hybrid/protocol';
import { freezeSeatAssignments, isResolvedFourSeats, type ResolvedFourSeats } from './seats';
import type { PublicProfile } from './llm-profiles';
import productCatalog from './local-model-releases.json';

export interface ProductModel {releaseRef:string;policyId:string;weightsSHA256:string;name:'ohuo';version:string;displayVersion:string;effectiveDate:string}
export interface ProductModelCatalog {schema:'ohuo-product-model-catalog-v1';formalLocalReleaseRef:string;models:readonly ProductModel[]}
export type AISelection = {kind:'auto_latest'} | {kind:'explicit';seats:readonly SeatAssignment[]};
export interface NewGameSettings {schema:'ohuo-new-game-settings-v1';passA:RuleOptions['passA'];aiSelection:AISelection}
export interface SelectionContext {
 policies?:readonly PolicyDescriptor[];
 releases?:readonly ReleaseDescriptor[];
 choices?:readonly {release:ReleaseDescriptor;available:boolean}[];
 profiles?:readonly PublicProfile[];
 catalog?:unknown;
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exact(value:unknown,keys:string[],label:string):asserts value is Record<string,unknown> {
 if(!plain(value)||Object.keys(value).sort().join(',')!==keys.slice().sort().join(','))throw Error(`invalid_${label}`);
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v===v.trim();
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
/** Policy descriptors are the existing registry objects, never a second weight catalog. */
export function validateProductModelCatalog(value:unknown=productCatalog,policies?:readonly PolicyDescriptor[],releases=RELEASES):ProductModelCatalog {
 exact(value,['schema','formalLocalReleaseRef','models'],'product_model_catalog');
 if(value.schema!=='ohuo-product-model-catalog-v1'||!text(value.formalLocalReleaseRef)||!Array.isArray(value.models)||!value.models.length)throw Error('invalid_product_model_catalog');
 const refs=new Set<string>(),versions=new Set<string>();
 const models=value.models.map(raw=>{
  exact(raw,['releaseRef','policyId','weightsSHA256','name','version','displayVersion','effectiveDate'],'product_model');
  if(!['releaseRef','policyId','weightsSHA256','version','displayVersion','effectiveDate'].every(k=>text(raw[k]))||raw.name!=='ohuo')throw Error('invalid_product_model');
  const m=raw as unknown as ProductModel;
  if(!/^[a-f0-9]{64}$/.test(m.weightsSHA256)||!semver.test(m.version)||!/^\d{4}-\d{2}-\d{2}$/.test(m.effectiveDate)||Number.isNaN(Date.parse(m.effectiveDate))||new Date(m.effectiveDate).toISOString().slice(0,10)!==m.effectiveDate)throw Error('invalid_product_version_or_date');
  const initial=m.releaseRef==='ohuo-1030-b-v1'&&m.version==='1.0.0'&&m.effectiveDate==='2026-10-31';
  if(m.displayVersion!==(initial?'v1':`v${m.version}`))throw Error('invalid_display_version');
  if(refs.has(m.releaseRef)||versions.has(m.version))throw Error('duplicate_product_identity');refs.add(m.releaseRef);versions.add(m.version);
  const release=releases.find(r=>r.releaseRef===m.releaseRef);
  if(!release||release.mode!=='local'||release.proposalPolicyRef!==m.policyId)throw Error('product_release_identity_mismatch');
  if(policies){const policy=policies.find(p=>p.policyId===m.policyId);if(!policy||policy.weightsSHA256!==m.weightsSHA256)throw Error('product_policy_identity_mismatch');}
  return {...m};
 });
 if(!models.some(m=>m.releaseRef===value.formalLocalReleaseRef))throw Error('formal_local_release_unavailable');
 return freezeCopy({schema:'ohuo-product-model-catalog-v1',formalLocalReleaseRef:value.formalLocalReleaseRef,models});
}
export function validateNewGameSettings(value:unknown):NewGameSettings {
 exact(value,['schema','passA','aiSelection'],'new_game_settings');
 if(value.schema!=='ohuo-new-game-settings-v1'||!['head','head3','double'].includes(String(value.passA))||!plain(value.aiSelection))throw Error('invalid_new_game_settings');
 const selection=value.aiSelection;
 let aiSelection:AISelection;
 if(selection.kind==='auto_latest'){exact(selection,['kind'],'ai_selection');aiSelection={kind:'auto_latest'};}
 else if(selection.kind==='explicit'){
  exact(selection,['kind','seats'],'ai_selection');const seats=freezeSeatAssignments(selection.seats);
  if(seats[0].controller!=='human')throw Error('new_game_requires_human_seat_zero');aiSelection={kind:'explicit',seats};
 }else throw Error('unknown_ai_selection');
 return freezeCopy({schema:'ohuo-new-game-settings-v1',passA:value.passA as RuleOptions['passA'],aiSelection});
}
export function newGameSettingsFromLegacy(legacy:{passA?:RuleOptions['passA'];seats?:readonly SeatAssignment[]}={}):NewGameSettings {
 return validateNewGameSettings({schema:'ohuo-new-game-settings-v1',passA:legacy.passA??'head3',aiSelection:legacy.seats?{kind:'explicit',seats:legacy.seats}:{kind:'auto_latest'}});
}
function catalogFor(context:SelectionContext) {return validateProductModelCatalog(context.catalog??productCatalog,context.policies,context.releases??RELEASES);}
function assignmentsFor(settings:NewGameSettings,context:SelectionContext):readonly SeatAssignment[] {
 if(settings.aiSelection.kind==='explicit')return settings.aiSelection.seats;
 const catalog=catalogFor(context);
 return freezeSeatAssignments([{controller:'human'},...Array.from({length:3},()=>({controller:'ai',releaseRef:catalog.formalLocalReleaseRef,mode:'local'}))]);
}
export function resolveNewGameAssignments(value:unknown,context:SelectionContext):readonly SeatAssignment[] {
 const settings=validateNewGameSettings(value),catalog=catalogFor(context),releases=context.releases??RELEASES;
 const assignments=assignmentsFor(settings,context);
 for(const seat of assignments){
  if(seat.controller==='human')continue;
  const release=releases.find(r=>r.releaseRef===seat.releaseRef);
  if(!release||release.mode!==seat.mode)throw Error(`release_unavailable:${seat.releaseRef}`);
  if(context.choices&&!context.choices.some(c=>c.available&&c.release.releaseRef===seat.releaseRef))throw Error(`asset_unavailable:${seat.releaseRef}`);
  const policy=context.policies?.find(p=>p.policyId===release.proposalPolicyRef);
  if(context.policies&&(!policy||!policy.weightsPathOrUrl.assetUrl))throw Error(`policy_asset_unavailable:${release.proposalPolicyRef}`);
  if(settings.aiSelection.kind==='auto_latest'){
   const model=catalog.models.find(m=>m.releaseRef===seat.releaseRef)!;
   if(!policy||policy.weightsSHA256!==model.weightsSHA256||policy.tierSpecId!=='none'||policy.epsilon!==0||release.tier!=='hard')throw Error('formal_native_policy_unavailable');
  }
  if(seat.mode==='hybrid'&&context.profiles&&!context.profiles.some(p=>sameProfile(p,seat.profileRevisionRef)))throw Error('profile_reference_unavailable');
 }
 return assignments;
}
function sameProfile(a:{profileId:string;revision:number;snapshotHash:string},b:{profileId:string;revision:number;snapshotHash:string}|undefined) {return !!b&&a.profileId===b.profileId&&a.revision===b.revision&&a.snapshotHash===b.snapshotHash;}
export async function resolveNewGameSeats(value:unknown,context:SelectionContext,loadSeats:(assignments:readonly SeatAssignment[])=>Promise<ResolvedFourSeats>):Promise<ResolvedFourSeats> {
 const settings=validateNewGameSettings(value),assignments=resolveNewGameAssignments(settings,context);
 const resolved=await loadSeats(assignments);
 if(!isResolvedFourSeats(resolved)||resolved.snapshot.seats.length!==4)throw Error('unverified_loaded_seats');
 // A resolved snapshot must match the chosen product identity; it never rewrites an old descriptor.
 resolved.snapshot.seats.forEach((seat,i)=>{
  const intended=assignments[i];
  if(seat.controller!==intended.controller)throw Error('loaded_controller_identity_mismatch');
  if(seat.controller==='ai'&&intended.controller==='ai'){
   if(seat.releaseRef!==intended.releaseRef||seat.mode!==intended.mode||!sameOptionalProfile(seat.profileRevisionRef,intended.profileRevisionRef))throw Error('loaded_seat_identity_mismatch');
   const actual=describeSeatChoice(seat,context);
   const profiles=seat.profileSnapshot?[seat.profileSnapshot as PublicProfile]:[];
   if(actual.identity!==describeSeatChoice(intended,{...context,profiles}).identity)throw Error('loaded_policy_identity_mismatch');
  }
 });
 return resolved;
}
function sameOptionalProfile(a:FrozenAISeat['profileRevisionRef'],b:FrozenAISeat['profileRevisionRef']){return !a&&!b||!!a&&sameProfile(a,b);}
export interface SeatChoiceDescription {shortName:string;detail:string;identity:string}
/** Frozen records use their frozen profile/identity, never today's mutable profile service. */
export function describeSeatChoice(seat:SeatAssignment|FrozenAISeat,context:SelectionContext={}):SeatChoiceDescription {
 if(seat.controller==='human')return {shortName:'你（真人）',detail:'真人',identity:'human'};
 const releases=context.releases??RELEASES,catalog=catalogFor(context);
 const frozen='policyIdentity' in seat;
 const release=frozen?seat.release:releases.find(r=>r.releaseRef===seat.releaseRef);
 if(!release||release.releaseRef!==seat.releaseRef||release.mode!==seat.mode)throw Error('release_identity_unavailable');
 const policy=frozen?seat.policyIdentity:context.policies?.find(p=>p.policyId===release.proposalPolicyRef);
 if(!policy||policy.policyId!==release.proposalPolicyRef)throw Error('policy_identity_unavailable');
 let localRef=release.releaseRef;
 if(seat.mode==='hybrid'){
  const base=releases.find(r=>r.releaseRef===release.parentRelease);
  if(!base||base.mode!=='local'||base.proposalPolicyRef!==release.proposalPolicyRef)throw Error('hybrid_local_base_mismatch');
  localRef=base.releaseRef;
 }
 const model=catalog.models.find(m=>m.releaseRef===localRef);
 if(model&&(model.policyId!==policy.policyId||model.weightsSHA256!==policy.weightsSHA256))throw Error('product_frozen_identity_mismatch');
 const localName=model?`${model.name}-${model.displayVersion}-${model.effectiveDate.slice(5).replace('-','')}`:release.label;
 let shortName=localName,profile:PublicProfile|undefined;
 if(seat.mode==='hybrid'){
  profile=frozen?seat.profileSnapshot as PublicProfile|undefined:context.profiles?.find(p=>sameProfile(p,seat.profileRevisionRef));
  if(!profile||!sameProfile(profile,seat.profileRevisionRef))throw Error('profile_reference_unavailable');
  // The exact public model id supplies only the short display brand, never selects a connection.
  const brand=profile.requestedModel==='deepseek-flash'?'DeepSeek':profile.requestedModel==='glm-5.3'?'GLM':profile.nickname;
  shortName=`${localName} + ${brand}`;
 }
 const policyIdentity='encoder' in policy?{
  policyId:policy.policyId,modelVersion:policy.modelVersion,weightsSHA256:policy.weightsSHA256,inputDim:policy.inputDim,
  encoderVersion:policy.encoder.encoderVersion,candidateVersion:policy.candidateSpecId,passEncoding:policy.encoder.passEncoding,
  candidateCompat:policy.candidateSpecId==='cand-dedup-v2'?'v2':undefined,architectureId:policy.architectureId,
  weightsLayoutVersion:policy.weightsLayoutVersion,epsilon:policy.epsilon,tieBreakId:policy.tieBreakId,tierSpecId:policy.tierSpecId,
 }:policy;
 const identity=canonical({releaseRef:seat.releaseRef,mode:seat.mode,policyIdentity,profileRevisionRef:seat.profileRevisionRef??null});
 const detail=[shortName,`release: ${seat.releaseRef}`,`policy: ${policy.policyId}`,`SHA256: ${policy.weightsSHA256}`,`实际策略: ${release.tier}`,...(profile?[`连接: ${profile.nickname}`,`requestedModel: ${profile.requestedModel}`,`profileId: ${profile.profileId}`,`revision: ${profile.revision}`,`snapshotHash: ${profile.snapshotHash}`]:[])].join('\n');
 return {shortName,detail,identity};
}
export function sameAIChoice(a:SeatAssignment|FrozenAISeat,b:SeatAssignment|FrozenAISeat,context:SelectionContext={}):boolean {return describeSeatChoice(a,context).identity===describeSeatChoice(b,context).identity;}
export function setDraftSeat(value:NewGameSettings,engineSeat:number,seat:SeatAssignment,context:SelectionContext):NewGameSettings {
 if(![1,2,3].includes(engineSeat)||seat.controller!=='ai')throw Error('fixed_human_seat');
 const seats=assignmentsFor(validateNewGameSettings(value),context).map((s,i)=>i===engineSeat?seat:s);
 return validateNewGameSettings({...value,aiSelection:{kind:'explicit',seats}});
}
export function setAllDraftSeats(value:NewGameSettings,seat:SeatAssignment):NewGameSettings {
 if(seat.controller!=='ai')throw Error('ai_choice_required');
 return validateNewGameSettings({...value,aiSelection:{kind:'explicit',seats:[{controller:'human'},seat,seat,seat]}});
}
export function restoreDefaultSelection(value:NewGameSettings):NewGameSettings {return validateNewGameSettings({...value,aiSelection:{kind:'auto_latest'}});}
