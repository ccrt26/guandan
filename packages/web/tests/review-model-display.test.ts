import {it} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RELEASES,type FrozenAISeat,type SeatSnapshot} from '../../ai/src/policy/seats';
import type {ResolvedPolicy} from '../../ai/src/policy/resolve';
import type {DecisionReview} from '../../review/src/decisionReview';
import {fnvId,renderModelPreferenceClaimText} from '../../review/src/decisionReview';
import {renderFactCards,buildCoachJsonMessages,acceptCoachResponse,makeCoachCache,readCoachCache} from '../../review/src/coachJson';
import {selectionPolicyIdentity} from '../src/game/ai-selection';
import {projectReviewModelDisplay,projectRecordProductTier} from '../src/game/review-model-display';
const policies=JSON.parse(readFileSync(new URL('../../../lab/model-index.json',import.meta.url),'utf8')).policies;
const context={policies};
const c=policies[1],o=policies[0];
const seat=(policy:typeof c,releaseRef:string):FrozenAISeat=>({controller:'ai',mode:'local',releaseRef,release:RELEASES.find(r=>r.releaseRef===releaseRef)!,policyIdentity:selectionPolicyIdentity(policy)} as FrozenAISeat);
const current=seat(c,'ohuo-1030-b-v1'),old=seat(o,'product-o-hard-v1');
const seats:SeatSnapshot={schemaVersion:2,seats:[old,{controller:'human'},current,old]};
// Memory-only resolved-policy-shaped input: no createNetwork/load/weights execution.
const source={analysisPolicy:{identity:current.policyIdentity,descriptor:c} as ResolvedPolicy,analysisSeat:2,frozenSeats:seats,referenceOnly:false};
function evidence():DecisionReview {
 const decisionId='synthetic# m1',claimId=fnvId(`pp-${decisionId}-model`);
 return {decisionId,recordId:'synthetic',recordHash:'synthetic-hash',moveNo:1,seat:0,replayStatus:'exact',verifiedPrefixEnd:1,
 ruleContext:{levelMode:'shared',stageTeam:null,levelsBefore:[2,2],version:'fake-rule'},observation:{hash:'fake',basis:'synthetic'},
 actual:{actionId:'a0',pass:true,physicalCards:[],declaration:null,wildAs:[],legal:true,coverage:{status:'exact',index:1}},
 candidates:{setHash:'fake-set',candidateVersion:c.candidateSpecId,encoderVersion:c.encoder.encoderVersion,n:2,ranking:[{actionId:'a1',text:'候选甲',score:1},{actionId:'a0',text:'不出',score:0}]},
 policy:{proposalPolicyId:c.policyId,weightHash:c.weightsSHA256},heuristic:{topActionId:null,note:null,perItemBreakdown:false},
 singleStep:{actual:{actionId:'a0',label:'实际打法',sourceId:'synthetic-actual',text:'不出',remainingCards:4,wildsSpent:0,factIds:[]},alternatives:[]},rollouts:[],
 claims:[{claimId,kind:'policy_preference',decisionId,subjectActionId:'a1',contrastActionId:'a0',factIds:['f1-ctx'],scope:'model_preference',text:'old technical model sentence'}],
 heuristicBreakdowns:[],claimLevel:'model_preference',conflicts:[],missing:[],expressionScope:'建议非事实',facts:{'f1-ctx':'当前先核对行动者与公开牌权'},actionTexts:{a0:'不出',a1:'候选甲'}} as DecisionReview;
}
const rawFor=(ev:DecisionReview)=>JSON.stringify({summary:'以下陈述原谱事实；策略优劣尚未验证。',lessons:[{decisionId:ev.decisionId,actionIds:['a1'],factIds:['f1-ctx'],claimIds:[ev.claims[0].claimId],claimLevel:'model_preference',title:'建议来源',text:ev.claims[0].text}]});
it('naming B: analysisSeat rather than actor/viewer owns product projection; scientific inputs remain unchanged',()=>{
 const ev=evidence(),before=JSON.stringify(ev),projection=projectReviewModelDisplay([ev],source,context),out=projection.displayEvidences[0];
 assert.equal(projection.sourceLabel,'ohuo-v1-1031');assert.equal(projection.policyLabels[ev.decisionId].label,'ohuo-v1-1031');
 assert.equal(out.claims[0].text,renderModelPreferenceClaimText('ohuo-v1-1031',ev.candidates!.ranking[0],1,'synthetic'));
 const undo=structuredClone(out);undo.claims[0].text=ev.claims[0].text;assert.deepEqual(undo,ev);assert.equal(JSON.stringify(ev),before);
 assert(Object.isFrozen(projection)&&Object.isFrozen(out.claims));assert.equal(projection.cacheDisplayContext.analysisSeat,2);
});
it('naming B: wrong/null pair, wrong frozen identity, old O and reference-only cannot acquire current name',()=>{
 for(const policy of [null,{proposalPolicyId:c.policyId,weightHash:null},{proposalPolicyId:c.policyId,weightHash:'f'.repeat(64)},{proposalPolicyId:'wrong',weightHash:c.weightsSHA256}]){
  const ev={...evidence(),policy},p=projectReviewModelDisplay([ev],source,context);assert.deepEqual(p.policyLabels,{});assert(!p.displayEvidences[0].claims[0].text.includes('ohuo-v1-1031'));
 }
 for(const patch of [{analysisSeat:0,analysisPolicy:{identity:old.policyIdentity,descriptor:o} as ResolvedPolicy},{analysisSeat:null},{analysisPolicy:null},{frozenSeats:undefined},{analysisPolicy:{identity:{...current.policyIdentity,encoderVersion:'wrong'},descriptor:c} as ResolvedPolicy}]){
  const p=projectReviewModelDisplay([evidence()],{...source,...patch},context);assert.equal(p.sourceLabel,'本地分析模型（产品身份未核验）');assert.deepEqual(p.policyLabels,{});
 }
 const fixed=projectReviewModelDisplay([evidence()],{...source,referenceOnly:true},context);assert.equal(fixed.sourceLabel,'固定 O 参照（非历史模型）');assert.deepEqual(fixed.policyLabels,{});
});
it('naming B: expected missing/heteromorphic claim quarantined, legitimate no-model/degraded not falsely blocked',()=>{
 const ev=evidence(),expected=ev.claims[0].claimId;
 for(const claims of [[],[{...ev.claims[0],factIds:['other']}],[{...ev.claims[0],subjectActionId:'a0'}]]){
  const input={...ev,claims},before=JSON.stringify(input),p=projectReviewModelDisplay([input],source,context);assert.deepEqual(p.cacheDisplayContext.unverifiedModelClaimIds,[expected]);assert.deepEqual(p.displayEvidences[0].claims,claims);assert.equal(JSON.stringify(input),before);
 }
 for(const change of [{policy:null,candidates:null},{replayStatus:'ambiguous' as const},{replayStatus:'invalid' as const},{verifiedPrefixEnd:0}]){
  const p=projectReviewModelDisplay([{...ev,...change,claims:[]}],source,context);assert.deepEqual(p.cacheDisplayContext.unverifiedModelClaimIds,[]);
  const unexpected=projectReviewModelDisplay([{...ev,...change}],source,context);assert.deepEqual(unexpected.cacheDisplayContext.unverifiedModelClaimIds,[expected]);assert.deepEqual(unexpected.displayEvidences[0].claims,ev.claims);
 }
});
it('naming B: exact projected sentence reaches cards/messages/strict accept/cache; wrong prose/pair and old cache fail',()=>{
 const ev=evidence(),p=projectReviewModelDisplay([ev],source,context),out=p.displayEvidences[0],sentence=out.claims[0].text;
 assert(renderFactCards(p.displayEvidences,0,p.policyLabels).includes(`模型排序（ohuo-v1-1031`));
 const messages=buildCoachJsonMessages(p.displayEvidences,[],0,p.policyLabels);assert(messages[1].content.includes(sentence));
 assert(acceptCoachResponse(rawFor(out),p.displayEvidences));assert.equal(acceptCoachResponse(rawFor(out).replace('ohuo-v1-1031','invented-model'),p.displayEvidences),null);
 const wrongLabels={[ev.decisionId]:{proposalPolicyId:c.policyId,weightHash:'0'.repeat(64),label:'invented-model'}};assert(!renderFactCards(p.displayEvidences,0,wrongLabels).includes('invented-model'));
 const oldCache=makeCoachCache(rawFor(ev),[ev],{}),oldBytes=oldCache;assert.equal(readCoachCache(oldCache,p.displayEvidences,p.cacheDisplayContext),null);assert.equal(oldCache,oldBytes);
 const store=new Map<string,string>();store.set('fake',makeCoachCache(rawFor(out),p.displayEvidences,p.cacheDisplayContext));assert(readCoachCache(store.get('fake')!,p.displayEvidences,p.cacheDisplayContext));
});
it('naming B: picker same frozen classification drives pure standard, old O, mixed and unknown without metadata rewrite',()=>{
 const frame=(rows:SeatSnapshot['seats']):SeatSnapshot=>({schemaVersion:2,seats:rows});
 const pure=projectRecordProductTier(frame([{controller:'human'},current,current,current]),context);assert.equal(pure.kind,'standard');assert.deepEqual(pure.historicalTiers,[]);
 const legacy=projectRecordProductTier(frame([{controller:'human'},old,old,old]),context);assert.equal(legacy.kind,'historical');assert.deepEqual(legacy.historicalTiers,[2]);
 const mixed=projectRecordProductTier(seats,context);assert.equal(mixed.kind,'mixed');assert.equal(mixed.label,'混合历史配置');assert.deepEqual(mixed.historicalTiers,[2]);
 for(const broken of [[null,current,current,current],[{...old,policyIdentity:undefined},current,current,current]]){const p=projectRecordProductTier({schemaVersion:2,seats:broken} as unknown as SeatSnapshot,context,[2]);assert.equal(p.kind,'unverified');assert.deepEqual(p.historicalTiers,[2]);}
 assert.equal(projectRecordProductTier(undefined,context).kind,'unverified');const recorded=[null,2,2,2];const before=JSON.stringify(recorded),missing=projectRecordProductTier(undefined,context,recorded);assert.equal(missing.kind,'unverified');assert.deepEqual(missing.historicalTiers,[2]);assert.equal(JSON.stringify(recorded),before);assert.equal(projectRecordProductTier(frame([{controller:'human'},current,{...old,policyIdentity:{...old.policyIdentity,encoderVersion:'unknown'}},current]),context).kind,'unverified');
});
