import{isWild,type Combo,type LevelCtx}from'@gd/engine';
import{codeOfCard,DEFAULT_MAPPING}from'../src/review5_tuning/kscbReplay';

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
  wildAs.push({code:codeOfCard(card,DEFAULT_MAPPING),rank:assignment.asRank,suit:combo.kind==='flush'?assignment.asSuit:undefined});
 }
 return JSON.stringify({kind:combo.kind,mainRank:combo.mainRank,keyRank:combo.keyRank,length:combo.length,size:combo.size,suit:combo.kind==='flush'?combo.suit:undefined,resources:combo.cards.map(c=>codeOfCard(c,DEFAULT_MAPPING)).sort((a,b)=>a!-b!),wildAs:wildAs.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),pairRanks:[...combo.pairRanks].sort((a,b)=>a-b)});
}
