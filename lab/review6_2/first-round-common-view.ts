/** r2 teacher input is a pure projection of the captured student 423 rows.
 * No observation/history/hidden state/policy scores are accepted by this API.
 * Layout: schema.ts v4 action64 + S33 scorer public-high-card-memory-v1.
 * Request identities and addressMap MUST remain outside the model payload. */
import { createHash } from 'node:crypto';
export interface CommonViewRow { actionId: string; input423: readonly number[]; equivalenceKey?: string }
export interface CommonViewSchema { inputDim: 423; passEncoding: 'action64' }
const KINDS = ['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb'] as const;
const REL = ['partner','lower','upper'] as const;
const MEM_REL = ['self','partner','upper','lower'] as const;
const MEM_SLOTS = ['J','Q','K','LEVEL_OTHER','SJ','BJ'] as const;
const MEM_DIV = [8,8,8,8,2,2];
export const COMMON_VIEW_FIELD_MAP = Object.freeze({myHand:[0,54],unplayedOutsideOwnHand:[54,108],target:[108,177],otherSeats:[177,186],recentMoves:[186,312],levelsAndTributeBits:[312,317],ruleContext:[317,331],candidateAction:[331,399],publicHighCardMemory:[399,423]});
const rules = [
 '仅根据本视图从给定候选地址选动作，不补造任何玩家持牌。',
 '当前领先不等于已经赢得本墩；PASS只是选择不出牌，不证明不能压。',
 '三带二比较三张主体的比较点数，不比较带牌。',
 'unplayedOutsideOwnHand仅为尚未公开打出且不在本人手中的总量，不含归属信息。',
 'recentMoves仅保存各相对玩家最近三次动作（新到旧）；缺失历史未知。',
 'publicHighCardMemory为编码已保存的出牌累计，不表示剩余持有者；LEVEL_OTHER保留原编码类别，不补全贡还归属。',
];
function integer(v:number, divisor:number, min:number, max:number, field:string):number {
 const n=Math.round(v*divisor);
 if(!Number.isFinite(v)||Math.abs(v*divisor-n)>1e-5||n<min||n>max)throw Error(`common view invalid encoded grid: ${field}`);
 return n===0?0:n;
}
function bit(v:number, field:string):boolean { return integer(v,1,0,1,field)===1; }
function oneHot(xs:readonly number[], field:string):number|null {
 const active=xs.flatMap((x,i)=>bit(x,field)?[i]:[]);
 if(active.length>1)throw Error(`common view invalid one-hot: ${field}`);
 return active[0]??null;
}
function cards(xs:readonly number[], field:string){
 return xs.flatMap((v,i)=>{const count=integer(v,1,0,2,field);return count?[{card:i<52?`${['S','H','D','C'][Math.floor(i/13)]}${i%13+2}`:i===52?'SJ':'BJ',count}]:[];});
}
function action(x:readonly number[]){
 const pass=bit(x[64],'action.pass'), k=oneHot(x.slice(54,64),'action.kind');
 if(pass&&(k!==null||x.some((v,i)=>i!==64&&v!==0)))throw Error('common view invalid PASS encoding');
 if(!pass&&k===null)throw Error('common view missing action kind');
 return {pass,cards:cards(x.slice(0,54),'action.cards'),kind:k===null?null:KINDS[k],comparisonRank:integer(x[65],41,0,41,'action.rank'),size:integer(x[66],10,0,10,'action.size'),wildCount:integer(x[67],2,0,2,'action.wild')};
}
function state(x:readonly number[]){
 const targetSeat=oneHot(x.slice(162,165),'target.seat'), targetKind=oneHot(x.slice(165,175),'target.kind');
 const otherSeats=Object.fromEntries(REL.map((r,i)=>[r,{remainingCards:integer(x[177+i*3],27,0,27,'seat.count'),reportedLow:bit(x[178+i*3],'seat.report'),finishOrder:integer(x[179+i*3],3,0,4,'seat.finish')||null}])) as Record<typeof REL[number],{remainingCards:number;reportedLow:boolean;finishOrder:number|null}>;
 const recentMoves=Object.fromEntries(REL.map((r,i)=>[r,Array.from({length:3},(_,j)=>{
  const at=186+(i*3+j)*14, v=x.slice(at,at+14), k=oneHot(v.slice(0,10),'recent.kind'),pass=bit(v[10],'recent.pass'),none=bit(v[13],'recent.none');
  if((none&&(pass||k!==null))||(pass&&k!==null))throw Error('common view invalid recent move');
  return {unknown:none,pass,kind:k===null?null:KINDS[k],comparisonRank:integer(v[11],41,0,41,'recent.rank'),size:integer(v[12],10,0,10,'recent.size')};
 })]));
 const rank=oneHot(x.slice(317,330),'level.onehot');
 const publicHighCardMemory=Object.fromEntries(MEM_REL.map((r,i)=>[r,Object.fromEntries(MEM_SLOTS.map((s,j)=>[s,integer(x[399+i*6+j],MEM_DIV[j],0,MEM_DIV[j],'memory.count')]))])) as Record<typeof MEM_REL[number],Record<typeof MEM_SLOTS[number],number>>;
 return {myHand:cards(x.slice(0,54),'myHand'),unplayedOutsideOwnHand:cards(x.slice(54,108),'unplayedOutsideOwnHand'),currentTarget:{cards:cards(x.slice(108,162),'target.cards'),leadingSeat:targetSeat===null?null:REL[targetSeat],kind:targetKind===null?null:KINDS[targetKind],comparisonRank:integer(x[175],41,0,41,'target.rank'),size:integer(x[176],10,0,10,'target.size')},otherSeats,recentMoves,levels:{own:integer(x[312],12,0,12,'own.level')+2,opponent:integer(x[313],12,0,12,'opponent.level')+2,effectiveRank:rank===null?null:rank+2,ownTeamOnStage:bit(x[330],'ownTeamOnStage')},ownWildCount:integer(x[314],2,0,2,'ownWild'),encodedTributeBits:{resistance:bit(x[315],'resistance'),selfIsTributeGiver:bit(x[316],'selfIsTributeGiver')},publicHighCardMemory};
}
export function buildCommonTeacherView(rows:readonly CommonViewRow[],schema:CommonViewSchema){
 if(schema?.inputDim!==423||schema.passEncoding!=='action64')throw Error('common view requires frozen 423/action64 schema');
 if(!Array.isArray(rows)||rows.length<1||rows.length>12)throw Error('common view candidate count');
 const ids=new Set<string>();
 for(const r of rows){
  if(typeof r.actionId!=='string'||!r.actionId||ids.has(r.actionId))throw Error('common view candidate identity');ids.add(r.actionId);
  if(r.input423?.length!==423||Array.from(r.input423).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('common view requires finite 423 rows');
 }
 const stateValues=(x:readonly number[])=>[...x.slice(0,331),...x.slice(399,423)];
 const stateKey=JSON.stringify(stateValues(rows[0].input423));
 if(rows.some(r=>JSON.stringify(stateValues(r.input423))!==stateKey))throw Error('common view state mismatch');
 const sorted=rows.map(r=>({r,key:JSON.stringify(Array.from(r.input423))})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const groups:{key:string;rows:CommonViewRow[]}[]=[];
 for(const e of sorted){
  const prev=groups[groups.length-1];
  if(prev?.key===e.key){
   // Equivalence must be established by the caller's existing canonical-action contract.
   if(!e.r.equivalenceKey||prev.rows.some(r=>r.equivalenceKey!==e.r.equivalenceKey))throw Error('action_representation_ambiguous');
   prev.rows.push(e.r);
  }else groups.push({key:e.key,rows:[e.r]});
 }
 const candidates=groups.map((g,i)=>({address:`c${i}`,action:action(g.rows[0].input423.slice(331,399))}));
 const modelPayload={schema:'first-round-common-view-r2',rules:[...rules],state:state(rows[0].input423),candidates};
 const modelPayloadBytes=JSON.stringify(modelPayload);
 const addressMap=groups.map((g,i)=>{const actionIds=g.rows.map(r=>r.actionId).sort();return{address:`c${i}`,actionId:actionIds[0],equivalentActionIds:actionIds};});
 return {modelPayload,modelPayloadBytes,viewSHA256:createHash('sha256').update(modelPayloadBytes).digest('hex'),fieldMap:COMMON_VIEW_FIELD_MAP,addressMap};
}

/** Shared natural/designed used-decision identity. Opaque local action IDs and
 * interchangeable physical-copy IDs are deliberately absent. The caller must
 * derive each effect with the original necessaryDeclarationKey after legality
 * validation, never from a designer-supplied equivalence claim. This function
 * does not load history, reserve a question, or confer teaching eligibility. */
export function normalizedCommonDecisionIdentity(view:ReturnType<typeof buildCommonTeacherView>,ruleOptions:unknown,candidateSpec:string,effectByActionId:ReadonlyMap<string,string>){
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 if(!view||typeof view.modelPayloadBytes!=='string'||view.modelPayloadBytes!==JSON.stringify(view.modelPayload)||view.viewSHA256!==hash(view.modelPayloadBytes)||view.modelPayload?.schema!=='first-round-common-view-r2'||!Array.isArray(view.modelPayload.candidates)||view.modelPayload.candidates.length<1||view.modelPayload.candidates.length>12||!Array.isArray(view.addressMap)||view.addressMap.length!==view.modelPayload.candidates.length)throw Error('normalized_common_view');
 const ruleKeys=['levelMode','passA','pairSeqMin','pairSeqMax','trioSeqMin','trioSeqMax','flushLen','straightLen'];
 const options=ruleOptions as Record<string,unknown>;
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).sort().join(',')!==[...ruleKeys].sort().join(',')||typeof options.levelMode!=='string'||typeof options.passA!=='string'||ruleKeys.slice(2).some(k=>!Number.isSafeInteger(options[k])))throw Error('normalized_common_rules');
 if(typeof candidateSpec!=='string'||!candidateSpec.trim()||!(effectByActionId instanceof Map))throw Error('normalized_common_effect');
 const seen=new Set<string>();
 const mapping=view.addressMap.map((row,index)=>{
  if(row.address!==`c${index}`||view.modelPayload.candidates[index].address!==row.address||!Array.isArray(row.equivalentActionIds)||!row.equivalentActionIds.length||new Set(row.equivalentActionIds).size!==row.equivalentActionIds.length||row.actionId!==[...row.equivalentActionIds].sort()[0])throw Error('normalized_common_view');
  const effects=new Set(row.equivalentActionIds.map(id=>{const effect=effectByActionId.get(id);if(seen.has(id)||typeof effect!=='string'||!effect)throw Error('normalized_common_effect');seen.add(id);return effect;}));
  if(effects.size!==1)throw Error('normalized_common_effect');
  return {address:row.address,effect:[...effects][0]};
 });
 if(effectByActionId.size!==seen.size)throw Error('normalized_common_effect');
 const identity={schema:'ohuo-normalized-common-decision-v1' as const,ruleOptions:Object.fromEntries(ruleKeys.map(k=>[k,options[k]])),candidateSpec,modelPayloadBytes:view.modelPayloadBytes,mapping};
 return {schema:identity.schema,sha256:hash(JSON.stringify(identity))};
}
