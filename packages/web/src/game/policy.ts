import modelIndex,{productCatalog,releaseCatalog} from 'virtual:gd-model-index';
import type {ResolvedPolicy} from '@gd/ai';
import {resolveBrowserPolicy} from '../../../ai/src/policy/browser';
import type {SeatAssignment,SeatSnapshot} from '../../../ai/src/policy/seats';
import {createProfileClient} from './llm-profiles';
import {validateProductModelCatalog} from './ai-selection';
import {createProductDirectory,publishProductIntent} from './product-directory';

const directory=createProductDirectory({schema:'ohuo-public-policy-directory-v1',index:modelIndex,catalog:productCatalog,releaseCatalog},{
 validateCatalog:validateProductModelCatalog,
 loadProfiles:()=>createProfileClient({storage:localStorage,fetchImpl:fetch}).refresh(),
 onPublish:snapshot=>{publishProductIntent(snapshot);webPolicyDescriptors=snapshot.policies;webReleaseChoices=snapshot.choices;},
});
publishProductIntent(directory.exactSnapshot());
/** Live public data bindings; existing resolved games never read these again. */
export let webPolicyDescriptors=directory.exactSnapshot().policies;
export let webReleaseChoices=directory.exactSnapshot().choices;
export const captureWebDirectory=()=>directory.capture();
export const getWebSelectionContext=()=>directory.displayContext();
/** Every new operation captures one immutable generation before any await. */
export function loadWebPolicy(ref?:string):Promise<ResolvedPolicy>{const {snapshot}=directory.capture();return resolveBrowserPolicy(ref??snapshot.index.defaultPolicyRef,snapshot.index);}
export function loadWebSeats(assignments:readonly SeatAssignment[],saved?:SeatSnapshot){return directory.capture().loadSeats(assignments,saved);}
/** Historical consumers only resolve their recorded identity, even while a new catalog is invalid. */
export const loadSavedWebSeats=(saved:SeatSnapshot)=>directory.loadSavedSeats(saved);
export const loadSavedWebPolicy=(reference:string|undefined)=>directory.loadSavedPolicy(reference);
export const loadRecordedWebPolicy=(references:readonly string[]|undefined)=>directory.loadRecordedPolicy(references);

if(import.meta.hot){
 directory.markUnavailable();
 const receive=(value:unknown)=>directory.receive(value),disconnect=()=>directory.markUnavailable();
 import.meta.hot.on('ohuo:policy-directory',receive);
 import.meta.hot.on('vite:ws:disconnect',disconnect);
 // Vite buffers this single initial request until its connection is ready. No poll/retry/reconnect platform.
 import.meta.hot.send('ohuo:policy-directory-request');
 import.meta.hot.dispose(()=>{import.meta.hot?.off('ohuo:policy-directory',receive);import.meta.hot?.off('vite:ws:disconnect',disconnect);});
}
