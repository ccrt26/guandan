/** Capture the old default API before the optional declared-deal implementation. */
import{join}from'node:path';import{createMatch,startGame,applyMove,DEFAULT_RULES}from'@gd/engine';import{resolveLegalMove,indexedDealSeed}from'../review6/match-play';import{HOME,json,atomicJson,fileHash}from'./protocol';
const prefix=json(join(HOME,'data/terminal-native-probe-001/root-5/native-prefix.json')),parent=createMatch({...DEFAULT_RULES},prefix.sourceSeed);let at=0;
for(let g=1;g<=14;g++){
 parent.rngState=indexedDealSeed(prefix.dealNamespace,prefix.sourceSeed,parent.gameNo);const s=startGame(parent);
 while(at<prefix.moves.length&&prefix.moves[at].gameNo===g){const r=prefix.moves[at++];if(s.turn!==r.actor||s.over)throw Error('default fixture prefix mismatch');applyMove(s,resolveLegalMove(s,r.move)as any);}
 if(!s.over||parent.winner!==null)throw Error('default fixture not before actual game15');
}
if(JSON.stringify(parent.levels)!=='[10,14]')throw Error('actual prefix does not give planned levels');
const records:any[]=[];
for(const [name,match,seats]of[['first-13',createMatch({...DEFAULT_RULES},13),[]],['first-97',createMatch({...DEFAULT_RULES},97),[]],['real-parent15-auto',structuredClone(parent),[]],['real-parent15-interactive',structuredClone(parent),[0,1,2,3]]]as const){const input={match:structuredClone(match),interactiveSeats:[...seats]},expected=JSON.parse(JSON.stringify(startGame(structuredClone(match),seats)));records.push({name,input,expected});}
const path=join(HOME,'data/default-deal-before-explicit.json');atomicJson(path,{scope:'engine API regression only; no model outcomes or new training data',oldSources:['packages/engine/src/deck.ts','packages/engine/src/game.ts'].map(p=>({path:p,sha256:fileHash(join(HOME,'../../',p))})),records});
atomicJson(join(HOME,'data/explicit-parent-before-game15.json'),{schema:'native-parent-prefix-before-declared-deal-v1',sourceSeed:prefix.sourceSeed,dealNamespace:prefix.dealNamespace,sourceFamilyId:prefix.sourceFamilyId,moves:prefix.moves.filter((r:any)=>r.gameNo<=14),parentMatch:parent,sourceRef:join(HOME,'data/terminal-native-probe-001/root-5/native-prefix.json'),sourceSHA256:fileHash(join(HOME,'data/terminal-native-probe-001/root-5/native-prefix.json'))});console.log(JSON.stringify({path,records:records.length,parentLevels:parent.levels,actualNativeGamesReplayed:14,policyMatchesSimulated:0}));
