/** NAV-S35 opportunity definition only. Caller supplies the original, causal,
 * replay-verified snapshot; this module never enumerates, scores, labels or acts. */
import { canPass, teammateOf, type Combo, type GameState } from '@gd/engine';
import { canonicalActionId, resolveLegalMove } from '../../packages/ai/src/hybrid/legality';

export const FIRST_ROUND_TARGET_DEFINITION = Object.freeze({
 schema: 'ohuo-approved-public-target-v1',
 id: 'first-round-partner-control-v1',
 scope: 'research',
 rule: 'actor-turn-partner-current-highest-pass-and-legal-cover',
} as const);

export function validateFirstRoundTargetDefinition(definition:unknown):void {
 const expected=FIRST_ROUND_TARGET_DEFINITION;
 if(!definition||typeof definition!=='object'||Array.isArray(definition)||
    Object.keys(definition).length!==Object.keys(expected).length||
    Object.entries(expected).some(([k,v])=>!Object.hasOwn(definition,k)||(definition as Record<string,unknown>)[k]!==v))
  throw Error('target_definition_unimplemented');
}

export interface FirstRoundTargetSnapshot {
 /** Full state remains local; only actor's own hand and public play state are read
  * by resolveLegalMove. No opponent hand is inspected to find a cover. */
 readonly state:GameState;
 readonly actorSeat:number;
 readonly candidateCombos:readonly (Combo|null)[];
 /** Optional original-record/capture witnesses whose source identity the caller
  * already verified. These do not expand the frozen training candidate set. */
 readonly originalWitnessCombos?:readonly Combo[];
}
export interface FirstRoundTargetResult {
 readonly sampleClass:'target'|'ordinary'|null;
 readonly reason:'partner_control_opportunity'|'game_over'|'not_actor_turn'|'no_legal_pass'|'partner_not_current_highest'|'candidate_coverage_unknown';
 readonly coverage:'covered'|'gap'|'unknown'|'not_applicable';
 /** Existence evidence, not a recommended action, CE target or teacher label. */
 readonly existenceWitnessCanonicalId:string|null;
}
const ordinary=(reason:FirstRoundTargetResult['reason']):FirstRoundTargetResult=>({sampleClass:'ordinary',reason,coverage:'not_applicable',existenceWitnessCanonicalId:null});

export function classifyFirstRoundTarget(snapshot:FirstRoundTargetSnapshot,definition:unknown):FirstRoundTargetResult {
 validateFirstRoundTargetDefinition(definition);
 const {state,actorSeat,candidateCombos,originalWitnessCombos=[]}=snapshot;
 if(!Number.isSafeInteger(actorSeat)||actorSeat<0||actorSeat>3||!state||
    !Array.isArray(candidateCombos)||!Array.isArray(originalWitnessCombos))
  throw Error('target_public_observation_unclassifiable');
 if(state.over)return ordinary('game_over');
 if(state.turn!==actorSeat)return ordinary('not_actor_turn');
 if(!canPass(state))return ordinary('no_legal_pass');
 // The effective highest is state.lastPlayer, not the last item of a history
 // list (which may be a pass) and not merely a teammate's earlier play.
 if(state.lastPlayer!==teammateOf(actorSeat))return ordinary('partner_not_current_highest');
 try{resolveLegalMove(state,{pass:true});}catch{return ordinary('no_legal_pass');}
 const validate=(combo:Combo):string=>{
  try{return canonicalActionId(resolveLegalMove(state,{pass:false,combo}).combo!,state.ctx);}
  catch{throw Error('target_cover_witness_invalid');}
 };
 // Validate all supplied witnesses, even after one succeeds; malformed captured
 // evidence cannot be hidden behind an earlier legal candidate.
 const frozen=candidateCombos.filter((c):c is Combo=>c!==null).map(validate);
 const original=originalWitnessCombos.map(validate);
 const witness=frozen[0]??original[0];
 if(witness!==undefined)return{sampleClass:'target',reason:'partner_control_opportunity',coverage:frozen.length?'covered':'gap',existenceWitnessCanonicalId:witness};
 // A truncated enum/pool is not an exhaustive no-cover proof. Keep uncertainty
 // distinct from an ordinary non-target; the caller retains it in exclusions.
 return{sampleClass:null,reason:'candidate_coverage_unknown',coverage:'unknown',existenceWitnessCanonicalId:null};
}
