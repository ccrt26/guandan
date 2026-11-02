/** Pure, per-snapshot display projection. Never rewrites scientific evidence or saved records. */
import type {ResolvedPolicy} from '../../../ai/src/policy/resolve';
import {RELEASES,type SeatSnapshot} from '../../../ai/src/policy/seats';
import {freezeCopy} from '../../../ai/src/hybrid/protocol';
import {fnvId,renderModelPreferenceClaimText,type DecisionReview} from '../../../review/src/decisionReview';
import type {ReviewPolicyDisplayLabels} from '../../../review/src/coachJson';
import {describeSeatChoice,selectionPolicyIdentity,type SelectionContext} from './ai-selection';
export interface ReviewAnalysisSource {analysisPolicy:ResolvedPolicy|null;analysisSeat:number|null;frozenSeats:SeatSnapshot|undefined;referenceOnly:boolean}
export interface ReviewModelDisplay {sourceLabel:string;displayEvidences:DecisionReview[];policyLabels:ReviewPolicyDisplayLabels;cacheDisplayContext:Record<string,unknown>}
const UNKNOWN_MODEL='本地分析模型（产品身份未核验）';
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function projectReviewModelDisplay(evidences:readonly DecisionReview[],source:ReviewAnalysisSource,context:SelectionContext={}):ReviewModelDisplay {
 let sourceLabel=source.referenceOnly?'固定 O 参照（非历史模型）':UNKNOWN_MODEL,verified=false;
 const actual=source.analysisPolicy?.identity??null;
 if(!source.referenceOnly&&actual&&Number.isInteger(source.analysisSeat)&&source.analysisSeat!>=0&&source.analysisSeat!<4){
  const seat=source.frozenSeats?.seats[source.analysisSeat!];
  if(seat?.controller==='ai'&&canonical(actual)===canonical(seat.policyIdentity)){
   try {
    const description=describeSeatChoice(seat,{...context,policies:context.policies??[source.analysisPolicy!.descriptor]});
    if(description.productTier==='standard'&&description.localModelName){sourceLabel=description.localModelName;verified=true;}
   }catch{/* An unverifiable source is not today's default model. */}
  }
 }
 const labels:Record<string,{proposalPolicyId:string;weightHash:string;label:string}>={},unverifiedModelClaimIds=new Set<string>();
 const displayEvidences=evidences.map(original=>{
  const ev=structuredClone(original),pair=ev.policy;
  const matched=verified&&!!pair&&pair.weightHash!==null&&pair.proposalPolicyId===actual!.policyId&&pair.weightHash===actual!.weightsSHA256;
  if(matched)labels[ev.decisionId]={proposalPolicyId:pair!.proposalPolicyId,weightHash:pair!.weightHash!,label:sourceLabel};
  const top=ev.candidates?.ranking[0];
  const expected=!!top&&ev.replayStatus!=='ambiguous'&&ev.replayStatus!=='invalid'&&ev.moveNo<=ev.verifiedPrefixEnd;
  const claimId=fnvId(`pp-${ev.decisionId}-model`),claims=ev.claims.filter(c=>c.claimId===claimId),claim=claims[0],ctxId=`f${ev.moveNo}-ctx`;
  if(!expected){if(claims.length)unverifiedModelClaimIds.add(claimId);return ev;}
  if(claims.length!==1||claim.kind!=='policy_preference'||claim.decisionId!==ev.decisionId||claim.subjectActionId!==top!.actionId||claim.contrastActionId!==ev.actual.actionId||claim.scope!=='model_preference'||claim.factIds.length!==1||claim.factIds[0]!==ctxId||!Object.prototype.hasOwnProperty.call(ev.facts,ctxId)){
   unverifiedModelClaimIds.add(claimId);return ev; // No new claim and no heuristic/free-text rewrite.
  }
  claim.text=renderModelPreferenceClaimText(matched?sourceLabel:`技术政策 ${pair?.proposalPolicyId??'未记录'}，产品名未核验`,top!,ev.moveNo,ev.recordId);
  return ev;
 });
 const policyLabels=Object.fromEntries(Object.entries(labels).sort(([a],[b])=>a.localeCompare(b)));
 return freezeCopy({sourceLabel,displayEvidences,policyLabels,cacheDisplayContext:{modelDisplayVersion:1,analysisSeat:source.analysisSeat??null,analysisIdentity:actual,referenceOnly:source.referenceOnly,policyLabels,unverifiedModelClaimIds:[...unverifiedModelClaimIds].sort()}});
}
export interface RecordProductTier {kind:'standard'|'historical'|'mixed'|'unverified';label:string;historicalTiers:readonly (0|1|2)[]}
/** The same frozen classification feeds picker text and filter membership; raw difficulty metadata stays untouched. */
export function projectRecordProductTier(snapshot:SeatSnapshot|undefined,context:SelectionContext={},recordedDifficulties:readonly unknown[]=[]):RecordProductTier {
 const recordedTiers=[...new Set(recordedDifficulties.filter((tier):tier is 0|1|2=>tier===0||tier===1||tier===2))].sort();
 const unknown=():RecordProductTier=>({kind:'unverified',label:'档位未记录或部分身份未核验',historicalTiers:recordedTiers});
 if(!snapshot||snapshot.schemaVersion!==2||!Array.isArray(snapshot.seats)||snapshot.seats.length!==4||snapshot.seats.some(s=>!s||!['human','ai'].includes(s.controller)))return unknown();
 const ai=snapshot.seats.filter(s=>s.controller==='ai');if(!ai.length)return unknown();
 let standard=0;const historical=new Set<0|1|2>();
 for(const seat of ai){
  try {if(describeSeatChoice(seat,context).productTier==='standard'){standard++;continue;}}catch{/* Check only known historical identities below. */}
  if(!seat.policyIdentity||typeof seat.policyIdentity!=='object')return unknown();
  const release=(context.releases??RELEASES).find(r=>r.releaseRef===seat.releaseRef),policy=context.policies?.find(p=>p.policyId===seat.policyIdentity.policyId);
  if(!release||!['product-o-easy-v1','product-o-standard-v1','product-o-hard-v1'].includes(release.releaseRef)||seat.mode!=='local'||!policy||release.proposalPolicyRef!==policy.policyId||canonical(release)!==canonical(seat.release)||canonical(selectionPolicyIdentity(policy))!==canonical(seat.policyIdentity))return unknown();
  historical.add(release.tier==='easy'?0:release.tier==='standard'?1:2);
 }
 const historicalTiers=[...historical].sort();
 if(standard===ai.length)return {kind:'standard',label:'标准',historicalTiers:[]};
 if(standard)return {kind:'mixed',label:'混合历史配置',historicalTiers};
 return {kind:'historical',label:`历史配置（${historicalTiers.map(t=>['初级','中级','高级'][t]).join(' / ')}）`,historicalTiers};
}
