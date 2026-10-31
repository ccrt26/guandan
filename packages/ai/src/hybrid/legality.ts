/** Strict shared legality, extracted without guard/reselection from the research
 * entry. This module has no Node/lab dependency and never mutates a move. */
import { beats, canPass, classify, isWild, type Card, type Combo, type GameState, type LevelCtx } from '@gd/engine';

// Preserve the legacy action-effect key's numeric face encoding, without
// importing the Node-only KSCB replay reader. Physical copies share a face code.
function legacyFaceCode(c: Card): number | null {
  if (c.suit === 'J') return c.rank === 16 ? 94 : c.rank === 17 ? 95 : null;
  const band = ['S', 'H', 'D', 'C'].indexOf(c.suit);
  if (band < 0) return null;
  return [17, 33, 49, 65][band] + (c.rank === 14 ? 0 : c.rank - 1);
}

/** Necessary declared effect, with complete physical suit/rank resources.
 * Natural-rank self substitution and non-flush assignment suits are annotations;
 * different assigned ranks and flush suits remain distinct. Never edits a move. */
export function necessaryDeclarationKey(combo:Combo|null,ctx?:LevelCtx):string{
 if(!combo)return'pass';
 const seen=new Set<number>(),wildAs=[];
 for(const assignment of combo.wildAs){
  const card=combo.cards.find(c=>c.id===assignment.cardId);
  if(!card||seen.has(assignment.cardId)||ctx&&!isWild(card,ctx)||!Number.isInteger(assignment.asRank)||assignment.asRank<2||assignment.asRank>14||assignment.asSuit!==undefined&&!['S','H','D','C'].includes(assignment.asSuit))throw new Error('invalid declared wildcard identity');
  seen.add(assignment.cardId);
  if(assignment.asRank===card.rank&&(combo.kind!=='flush'||assignment.asSuit===undefined||assignment.asSuit===card.suit))continue;
  wildAs.push({code:legacyFaceCode(card),rank:assignment.asRank,suit:combo.kind==='flush'?assignment.asSuit:undefined});
 }
 return JSON.stringify({kind:combo.kind,mainRank:combo.mainRank,keyRank:combo.keyRank,length:combo.length,size:combo.size,suit:combo.kind==='flush'?combo.suit:undefined,resources:combo.cards.map(c=>legacyFaceCode(c)).sort((a,b)=>a!-b!),wildAs:wildAs.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),pairRanks:[...combo.pairRanks].sort((a,b)=>a-b)});
}

/** applyMove trusts a declared combination. Validate its full owned resources and
 * declaration independently; no guard fallback and no best-response reselection. */
export function resolveLegalMove(state:GameState,move:{pass:boolean;combo?:Combo}):{pass:boolean;combo?:Combo}{
 if(state.over||state.pendingReturns.length)throw new Error('illegal move outside active play');
 if(move.pass){if(!canPass(state)||move.combo)throw new Error('illegal pass');return{pass:true};}
 if(!move.combo?.cards.length)throw new Error('illegal empty declared move');
 const ids=move.combo.cards.map(c=>c.id);if(new Set(ids).size!==ids.length)throw new Error('duplicate physical resource identity');
 const own=state.hands[state.turn],cards=ids.map(id=>own.find(c=>c.id===id));if(cards.some(c=>!c))throw new Error('physical resource not owned');
 if(cards.some((card,index)=>card!.suit!==move.combo!.cards[index].suit||card!.rank!==move.combo!.cards[index].rank))throw new Error('selected physical-card identity differs from the actual owned card');
 const key=necessaryDeclarationKey(move.combo,state.ctx),declared=classify(cards as any,state.ctx,state.match.opts).find(c=>necessaryDeclarationKey(c,state.ctx)===key);
 if(!declared||state.lastCombo&&!beats(declared,state.lastCombo))throw new Error('declared legal action identity mismatch');
 return{pass:false,combo:move.combo};
}

/** Local executable identity: physical resources AND necessary declaration.
 * Never use a weak comboKey, physical IDs alone, or truthiness for pass. */
export function canonicalActionId(combo: Combo | null, ctx?: LevelCtx): string {
  if (combo === null) return 'pass';
  return JSON.stringify({ physicalCardIds: combo.cards.map(c => c.id).sort((a, b) => a - b),
    declaration: necessaryDeclarationKey(combo, ctx) });
}
