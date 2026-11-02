/** Four bounded witnesses over one already legal, frozen, B-ranked pool.
 * No rescoring, no action generation, and no claim of complete legal coverage. */
import { beats, canPass, isWild, teammateOf, type GameState } from '@gd/engine';
import type { FrozenCandidate } from './protocol';

export interface CoverageWitness {
  slot: 'A' | 'B' | 'C' | 'D';
  actionId: string | null;
  status: 'added' | 'already_covered' | 'absent';
  cost?: [number, number, number];
}
export interface CandidateCoverage {
  targetEligible: boolean;
  baseInitialCandidateIds: string[];
  focusFamily: string | null;
  witnesses: CoverageWitness[];
  poolNotOfferedCount: number;
  legalButUnenumeratedCount: null;
  nonFocusFamilies: Array<{family:string; attachmentRanks:number[]; unofferedAttachmentRanks:number[]}>;
}
const ATTACHMENT_ORDER = [2,3,4,5,6,7,8,9,10,11,12,13,14,16,17];
function structureCost(state: GameState, actorSeat: number, c: FrozenCandidate): [number,number,number] {
  const before=new Map<number,number>(), after=new Map<number,number>();
  const ids=new Set(c.canonical!.cards.map(card=>card.id));
  for (const card of state.hands[actorSeat]) {
    if (isWild(card,state.ctx) || card.rank===16 || card.rank===17) continue;
    before.set(card.rank,(before.get(card.rank)??0)+1);
    if (!ids.has(card.id)) after.set(card.rank,(after.get(card.rank)??0)+1);
  }
  let nativeBombLoss=0, fracturedPairsOrTrios=0;
  const bomb=(n:number)=>n>=4?n:0;
  for (const [rank,n] of before) {
    const left=after.get(rank)??0;
    nativeBombLoss+=bomb(n)-bomb(left);
    if ((n===2||n===3)&&left>0&&left<n) fracturedPairsOrTrios++;
  }
  const highCards=c.canonical!.cards.filter(card=>[11,12,13,16,17].includes(card.rank)||state.ctx.ranks.has(card.rank)).length;
  return [nativeBombLoss,fracturedPairsOrTrios,highCards];
}
function costLess(a:readonly number[],b:readonly number[]):boolean {
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]<b[i];
  return false;
}
export function appendTargetCoverage(state:GameState,actorSeat:number,pool:readonly FrozenCandidate[],base:readonly string[]):{initialCandidateIds:string[];coverage:CandidateCoverage} {
  const initialCandidateIds=[...base];
  const legal=pool.filter(c=>c.canonical!==null&&beats(c.canonical,state.lastCombo));
  const targetEligible=state.turn===actorSeat&&state.lastCombo!==null&&state.lastPlayer===teammateOf(actorSeat)&&canPass(state)&&legal.length>0;
  const coverage:CandidateCoverage={targetEligible,baseInitialCandidateIds:[...base],focusFamily:null,witnesses:[],poolNotOfferedCount:pool.length-base.length,legalButUnenumeratedCount:null,nonFocusFamilies:[]};
  if (!targetEligible) return {initialCandidateIds,coverage};
  const append=(slot:CoverageWitness['slot'],c:FrozenCandidate|undefined,cost?:[number,number,number])=>{
    const status=!c?'absent':initialCandidateIds.includes(c.actionId)?'already_covered':'added';
    coverage.witnesses.push({slot,actionId:c?.actionId??null,status,...(cost?{cost}:{})});
    if(status==='added') initialCandidateIds.push(c!.actionId);
  };
  // Pool order already fixes B ranking and stable original-index tie-break.
  const same=legal.filter(c=>c.canonical!.kind===state.lastCombo!.kind&&c.canonical!.size===state.lastCombo!.size);
  let A=same[0];
  for(const c of same.slice(1)) if(beats(A.canonical!,c.canonical!)&&!beats(c.canonical!,A.canonical!)) A=c;
  const families=new Map<string,FrozenCandidate[]>();
  for(const c of legal) if(c.canonical!.kind==='trio_pair') {
    const key=`trio_pair:${c.canonical!.mainRank}`;
    const family=families.get(key)??[];family.push(c);families.set(key,family);
  }
  const branches=[...families].filter(([,members])=>new Set(members.map(c=>c.canonical!.pairRanks[0])).size>=2);
  const focus=branches[0]; // insertion follows earliest B rank of each family
  coverage.focusFamily=focus?.[0]??null;
  let B:FrozenCandidate|undefined,C:FrozenCandidate|undefined;
  if(focus) {
    const ranks=ATTACHMENT_ORDER.filter(rank=>focus[1].some(c=>c.canonical!.pairRanks[0]===rank));
    B=focus[1].find(c=>c.canonical!.pairRanks[0]===ranks[0]);
    C=focus[1].find(c=>c.canonical!.pairRanks[0]===ranks[ranks.length-1]);
  }
  let D=legal[0],cost=structureCost(state,actorSeat,D);
  for(const c of legal.slice(1)) {const next=structureCost(state,actorSeat,c);if(costLess(next,cost)){D=c;cost=next;}}
  append('A',A);append('B',B);append('C',C);append('D',D,cost);
  if(initialCandidateIds.length>12) throw new Error('offer12 contract invariant violated');
  coverage.poolNotOfferedCount=pool.length-initialCandidateIds.length;
  coverage.nonFocusFamilies=[...families].filter(([family])=>family!==coverage.focusFamily).map(([family,members])=>{
    const attachmentRanks=ATTACHMENT_ORDER.filter(rank=>members.some(c=>c.canonical!.pairRanks[0]===rank));
    return {family,attachmentRanks,unofferedAttachmentRanks:attachmentRanks.filter(rank=>!members.some(c=>c.canonical!.pairRanks[0]===rank&&initialCandidateIds.includes(c.actionId)))};
  });
  return {initialCandidateIds,coverage};
}
