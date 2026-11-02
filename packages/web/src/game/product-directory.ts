/** Data only. No React lifecycle, controller, storage subscription or network polling. */
import initialCatalog from './local-model-releases.json';
import {RELEASES,projectReleaseCatalog,type ReleaseDescriptor,type SeatAssignment,type SeatSnapshot} from '../../../ai/src/policy/seats';
import {validatePolicyIndex,type PolicyIndex,type PolicyDescriptor} from '../../../ai/src/policy/descriptor';
import {resolveBrowserPolicy,resolveSavedBrowserPolicy,resolveRecordedBrowserPolicy} from '../../../ai/src/policy/browser';
import {freezeCopy} from '../../../ai/src/hybrid/protocol';
import {resolveFourSeats,savedAssignments,assertSavedSeats} from './seats';
import type {PublicProfile} from './llm-profiles';
import type {ProductModelCatalog,SelectionContext} from './ai-selection';

let intent:{catalog:unknown;releases:readonly ReleaseDescriptor[]}={catalog:initialCatalog,releases:RELEASES};
export function currentProductIntent(){return intent;}
export function publishProductIntent(value:{catalog:ProductModelCatalog;releases:readonly ReleaseDescriptor[]}){intent=Object.freeze({catalog:value.catalog,releases:value.releases});}
export interface PublicDirectoryInput {schema:'ohuo-public-policy-directory-v1';index:unknown;catalog:unknown;releaseCatalog:unknown}
export interface ProductDirectorySnapshot {
 readonly index:PolicyIndex;readonly catalog:ProductModelCatalog;readonly releases:readonly ReleaseDescriptor[];
 readonly policies:readonly PolicyDescriptor[];readonly choices:readonly {release:ReleaseDescriptor;available:boolean}[];
 readonly legacyProductLayouts:unknown;
}
interface DirectoryOptions {
 validateCatalog:(catalog:unknown,policies:readonly PolicyDescriptor[],releases:readonly ReleaseDescriptor[])=>ProductModelCatalog;
 loadProfiles:()=>Promise<PublicProfile[]>;
 onPublish?:(snapshot:ProductDirectorySnapshot)=>void;
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):string=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function appendOnly<T>(old:readonly T[],next:readonly T[],key:(v:T)=>string){
 for(const previous of old){const current=next.find(value=>key(value)===key(previous));if(!current||canonical(current)!==canonical(previous))throw Error('directory_identity_changed');}
}
export function createProductDirectory(initial:unknown,options:DirectoryOptions){
 function validate(value:unknown):ProductDirectorySnapshot {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='catalog,index,releaseCatalog,schema'||value.schema!=='ohuo-public-policy-directory-v1')throw Error('invalid_public_directory');
  const index=validatePolicyIndex(value.index),releases=projectReleaseCatalog(value.releaseCatalog),catalog=options.validateCatalog(value.catalog,index.policies,releases);
  if(index.policies.some(policy=>policy.weightsPathOrUrl.nodePath!==undefined))throw Error('private_policy_path_forbidden');
  return freezeCopy({index,catalog,releases,policies:index.policies,choices:releases.map(release=>({release,available:!!index.policies.find(policy=>policy.policyId===release.proposalPolicyRef)?.weightsPathOrUrl.assetUrl})),
   legacyProductLayouts:(value.releaseCatalog as Record<string,unknown>).legacyProductLayouts});
 }
 let last=validate(initial),available=true;
 const context=(snapshot:ProductDirectorySnapshot):SelectionContext=>({catalog:snapshot.catalog,releases:snapshot.releases,policies:snapshot.policies,choices:snapshot.choices});
 function loader(snapshot:ProductDirectorySnapshot){return async(assignments:readonly SeatAssignment[],saved?:SeatSnapshot)=>{
  const profiles=assignments.some(seat=>seat.controller==='ai'&&seat.mode==='hybrid')?await options.loadProfiles():[];
  const resolved=await resolveFourSeats(assignments,ref=>resolveBrowserPolicy(ref,snapshot.index),profiles,snapshot.releases);
  if(saved)assertSavedSeats(saved,resolved.snapshot);return resolved;
 };}
 function install(value:unknown){
  try {
   const next=validate(value);
   appendOnly(last.index.policies,next.index.policies,p=>p.policyId);appendOnly(last.releases,next.releases,r=>r.releaseRef);appendOnly(last.catalog.models,next.catalog.models,m=>m.releaseRef);
   if(canonical(last.legacyProductLayouts)!==canonical(next.legacyProductLayouts))throw Error('legacy_layout_identity_changed');
   last=next;available=true;options.onPublish?.(next);
  }catch(error){available=false;throw error;}
 }
 return {
  install,
  receive(event:unknown){if(!plain(event)||event.available!==true||!('snapshot'in event)){available=false;return;}try{install(event.snapshot);}catch{/* Data unavailable; never substitute yesterday's auto. */}},
  markUnavailable(){available=false;},
  capture(){if(!available)throw Error('directory_unavailable');const snapshot=last;return Object.freeze({snapshot,context:context(snapshot),loadSeats:loader(snapshot)});},
  displayContext():SelectionContext {return available?context(last):{...context(last),choices:last.choices.map(choice=>({...choice,available:false}))};},
  exactSnapshot(){return last;},
  loadSavedSeats(saved:SeatSnapshot){const snapshot=last;return loader(snapshot)(savedAssignments(saved),saved);},
  loadSavedPolicy(reference:string|undefined){return resolveSavedBrowserPolicy(reference,last.index);},
  loadRecordedPolicy(references:readonly string[]|undefined){return resolveRecordedBrowserPolicy(references,last.index);},
 };
}
