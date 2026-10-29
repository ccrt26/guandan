import type {Combo} from '@gd/engine';
import {decompose,scoreCandidates,type DecisionInput,type Plan,type ScoreTerm,type ScoredMove} from '@gd/ai';

export const REVIEW_HEURISTIC_ID='heuristic:review6-resource-v1';
/** Reference resources form a disjoint legal partition. Fully consuming a
 * resource, including as part of an extended bomb, does not split that resource. */
export function resourceSplitTerms(plan:Plan,played:Combo):ScoreTerm[] {
  const used=new Set(played.cards.map(c=>c.id)),terms:ScoreTerm[]=[];
  for(const resource of plan.combos){
    const shared=resource.cards.filter(c=>used.has(c.id)).length;
    if(shared===0||shared===resource.cards.length)continue;
    if(['bomb','joker_bomb','flush'].includes(resource.kind))terms.push({key:'break-bomb',label:'部分消耗参考拆分中的炸弹资源',value:-12});
    else if(['straight','pair_seq','trio_seq'].includes(resource.kind))terms.push({key:'break-seq',label:'部分消耗参考拆分中的长组合',value:-5});
  }
  return terms;
}
/** Independent review evaluator. The playing policy continues importing the
 * frozen AI scorer. Greedy legal decompositions are feasible upper bounds,
 * never a proof of minimum hand count or team-optimal strategy. */
export function scoreReviewCandidates(input:DecisionInput):ScoredMove[] {
  const original=scoreCandidates({...input,explain:true});
  if(!input.caps.planning)return original;
  const hand=input.state.hands[input.seat],plan=decompose(hand,input.state.ctx);
  return original.map(item=>{
    if(!item.combo)return item;
    const ids=new Set(item.combo.cards.map(c=>c.id)),rest=hand.filter(c=>!ids.has(c.id));
    const after=decompose(rest,input.state.ctx);
    const terms=(item.terms??[]).filter(t=>!['hands','hands-delta','break-bomb','break-seq'].includes(t.key));
    if(input.state.lastCombo===null)terms.push({key:'hands',label:`合法参考拆分：余牌可用 ${after.hands} 手出完（上界，非最优）`,value:-after.hands*3});
    else terms.push({key:'hands-delta',label:`合法参考拆分手数 ${plan.hands}→${after.hands}（均非最优证明）`,value:-(after.hands-plan.hands)*6});
    terms.push(...resourceSplitTerms(plan,item.combo));
    return {...item,terms,score:terms.reduce((sum,t)=>sum+t.value,0)};
  }).sort((a,b)=>b.score-a.score);
}
