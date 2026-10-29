import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MLP,FROZEN_CHAMPION_IDENTITY} from '@gd/ai';
import {buildDecisionReviews,buildTeamContext} from '@gd/review';
import {fileHash} from './product-artifacts';

/** Explicit development measurement, performed by verify-product. Export never calls it. */
export function measureProductExamples(directory:string){
 const weightPath=resolve('packages/web/public/ai/clean2.f32'),weightsHash=fileHash(weightPath);
 if(weightsHash!=='b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55')throw new Error('frozen baseline weights mismatch');
 const raw=readFileSync(weightPath),weights=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),mlp=new MLP(1);mlp.setWeights(weights);
 const cases=JSON.parse(readFileSync(resolve(directory,'development-examples.json'),'utf8'));
 const selected=[...['yield','takeover','remaining_structure','plan_invalidated'].flatMap(category=>[1,2,3].map(n=>`${category}-${n}`)),'evidence_insufficient-1'];
 const examples=selected.map(id=>{
  const example=cases.find((c:{caseId:string})=>c.caseId===id);if(!example)throw new Error('prelocked example missing');
  const recordPath=resolve(directory,'records',id+'.json'),{record}=JSON.parse(readFileSync(recordPath,'utf8'));
  const actor=record.moves.find((m:{moveNo:number})=>m.moveNo===example.moveNo).player,acting={...record,humanSeat:actor};
  const evidence=buildDecisionReviews(acting,{moves:[example.moveNo],maxPoints:1,mlp,modelVersion:FROZEN_CHAMPION_IDENTITY.policyId,weightHash:weightsHash,encoder:{candidateCompat:'v2',passEncoding:'legacy-phys10'}})[0];
  const team=buildTeamContext(acting,example.moveNo);
  return {id,category:example.category,recordSha256:fileHash(recordPath),kind:id.startsWith('evidence_')?'evidence_insufficient':'development_example',
   baselinePolicy:FROZEN_CHAMPION_IDENTITY.policyId,baselineScope:'hard tier greedy single-step preference, not a supported strategic label',baselineAction:evidence.candidates?.ranking[0]?.text??null,candidateAction:null,actualAction:evidence.singleStep.actual.text,
   teamGoal:team?.publicPlan[0]?.goal??'观察公开牌权与团队名次，策略优劣尚未验证',resourceImpact:`实际动作后行动者剩 ${evidence.singleStep.actual.remainingCards} 张；参考拆分不是最优证明`,
   changeCondition:team?.publicPlan[0]?.triggerConditions.join('；')??'当前控权席或公开余牌数变化时重新比较',evidenceStatus:'development_only_strategy_unverified',evidence};
 });
 const results=JSON.parse(readFileSync(resolve(directory,'product-acceptance.json'),'utf8'));
 const measurement={schemaVersion:'r6-product-examples-v1',measuredAt:new Date().toISOString(),sourceDirectory:directory,selectionRule:'first three fixed indices per four categories, plus evidence_insufficient-1; no success selection',weightsHash,examples};
 const status={schemaVersion:'r61-product-display-v1',at:measurement.measuredAt,webPreviewId:'review6-facts-ui-20261028-03',sourceDirectory:directory,actualPolicyId:FROZEN_CHAMPION_IDENTITY.policyId,weightsHash,
  facts:{baseCases:60,expectedCards:240,passedCards:results.passedCards,expectedAssertions:results.expectedAssertions,checkedAssertions:results.checkedAssertions,missingAssertions:results.missingAssertions,errorAssertions:results.errorAssertions},
  candidatePolicyId:null,skills:{baselineSupported:null,candidateSupported:null,expectedFamilies:60},severe:{completed:null,expectedFamilies:24,confirmedBad:null},matches:{pointDifference:null,lowerBound:null},
  developmentExamples:examples.map(({evidence,...row})=>row),scope:'有限开发事实回归；不是新题协作能力、完整比赛或真人水平成绩',playingPolicyUpdated:false};
 for(const [name,data] of [['development-example-evidence.json',measurement],['product-display.json',status]] as const)writeFileSync(resolve(directory,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
}
