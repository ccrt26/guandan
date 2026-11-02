/** NAV-R13's one fixed comparison list, not a search or a teacher answer.
 * Caller passes only the replay-verified initial C rows, never the full pool,
 * and persists the returned list with four worlds before starting branches. */
import type {Combo,GameState} from '@gd/engine';
import {canonicalActionId,resolveLegalMove} from '../../packages/ai/src/hybrid/legality';
import {classifyFirstRoundTarget,FIRST_ROUND_TARGET_DEFINITION} from './first-round-target';
export interface FirstRoundScreenCandidate {actionId:string;canonicalId:string;canonical:Combo|null;rawQ:number;originalIndex:number}
export function freezeFirstRoundScreenActions({state,actorSeat,candidates,proposalActionId,baselineActionId}:{state:GameState;actorSeat:number;candidates:readonly FirstRoundScreenCandidate[];proposalActionId:string;baselineActionId:string}){
 if(!Array.isArray(candidates)||!candidates.length||candidates.length>12||candidates.some(c=>!c||typeof c.actionId!=='string'||!c.actionId||typeof c.canonicalId!=='string'||!c.canonicalId||!Number.isFinite(c.rawQ)||!Number.isSafeInteger(c.originalIndex)||c.originalIndex<0)||new Set(candidates.map(c=>c.actionId)).size!==candidates.length||new Set(candidates.map(c=>c.originalIndex)).size!==candidates.length)throw Error('screen_initial_c_identity');
 const target=classifyFirstRoundTarget({state,actorSeat,candidateCombos:candidates.map(c=>c.canonical)},FIRST_ROUND_TARGET_DEFINITION);
 if(target.sampleClass!=='target'||target.coverage!=='covered')throw Error('screen_target_not_covered');
 const rows=candidates.map(c=>{
  const move=resolveLegalMove(state,c.canonical===null?{pass:true}:{pass:false,combo:c.canonical});
  const canonicalId=canonicalActionId(move.pass?null:move.combo!,state.ctx);
  if(canonicalId!==c.canonicalId)throw Error('screen_canonical_identity');
  return{...c,move};
 });
 if(new Set(rows.map(c=>c.canonicalId)).size!==rows.length)throw Error('screen_canonical_duplicate');
 const proposal=rows.find(c=>c.actionId===proposalActionId),baseline=rows.find(c=>c.actionId===baselineActionId),pass=rows.find(c=>c.move.pass);
 if(!proposal||!baseline)throw Error('screen_action_outside_frozen_c');
 if(!pass)throw Error('screen_frozen_pass_missing');
 const covers=rows.filter(c=>!c.move.pass),bestCover=covers.reduce((best,c)=>c.rawQ>best.rawQ||c.rawQ===best.rawQ&&c.originalIndex<best.originalIndex?c:best);
 const opposite=proposal.move.pass?bestCover:pass,seen=new Set<string>();
 return [proposal,baseline,opposite].filter(c=>{if(seen.has(c.canonicalId))return false;seen.add(c.canonicalId);return true;}).map(c=>({actionId:c.actionId,canonicalId:c.canonicalId,move:structuredClone(c.move)}));
}
