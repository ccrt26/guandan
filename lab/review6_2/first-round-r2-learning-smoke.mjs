import assert from 'node:assert/strict';
import * as contract from './first-round-contract.mjs';
assert.equal(typeof contract.validateFirstRoundR2Recipe,'function','r2 recipe behavior absent');
const recipe=contract.FIRST_ROUND_R2_RECIPE;
assert.equal(contract.validateFirstRoundR2Recipe(recipe),recipe);
const shape=contract.firstRoundTrainingShape(recipe,'formal',65,65);
assert.equal(shape.Uepoch,3);assert.equal(shape.maxOptimizerSteps,null);assert.equal(shape.observationEveryUpdates,3);
assert.equal(contract.firstRoundTrainingShape(recipe,'calibration',65,65).maxOptimizerSteps,1);
assert.equal(contract.firstRoundTrainingShape(contract.FIRST_ROUND_RECIPE,'formal',16,16).maxOptimizerSteps,64);
assert.throws(()=>contract.validateFirstRoundR2Recipe({...recipe,maxUpdates:64}),/unsupported/);
const mk=(ce,train,changed=0)=>({demoCE:ce,keepKL:0,keepDriftRate:0,greedyChangedCount:changed,train:{demoCE:train,totalObjective:train},directionMetrics:Object.fromEntries(['pass','takeover'].map(d=>[d,{demoCE:ce,count:2,greedyAgreementCount:1,sourceFamilyIds:['a','b']}]))});
const baseline=mk(1,1), previous=baseline;
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(.9,.8,1),weightsChanged:true}).decision,'candidate');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(.9,.8),weightsChanged:true}).decision,'continue');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(1.1,.8),weightsChanged:true}).reason,'development_deterioration_risk');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(.9,1),weightsChanged:true}).reason,'no_training_progress');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(.9,.8),weightsChanged:false}).reason,'weights_unchanged');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous,current:mk(NaN,.8),weightsChanged:true}).decision,'diagnostic_stop');
assert.equal(contract.decideFirstRoundR2Learning({baseline,previous:mk(.8,.9),current:mk(.9,.8,1),weightsChanged:true}).reason,'development_deterioration_risk','development risk precedes first greedy change');
console.log('PASS r2 natural-epoch shape / no total optimizer cap / fixed stopping evidence / legacy recipe preserved');
const {selectFirstRoundR2Checkpoint}=await import('./first-round-selection.mjs');
const point=(n,m)=>({checkpoint:{optimizerSteps:n,manifestSHA256:String(n+1).padStart(64,'0')},metrics:{...m,optimizerSteps:n,completedEpochs:n/3,weightsSHA256:String(n+2).padStart(64,'0')}});
const points=[point(0,baseline),point(3,mk(.9,.8,1))];
assert.equal(selectFirstRoundR2Checkpoint(points,[{checkpointSHA256:points[1].checkpoint.manifestSHA256,status:'accepted'}]).status,'selected');
assert.equal(selectFirstRoundR2Checkpoint(points,[]).status,'pending_behavior_review');
assert.equal(selectFirstRoundR2Checkpoint([...points,point(6,mk(.8,.7,2))],[]).reason,'r2_updates_after_scientific_stop');
// Read only selected pure Python definitions with AST; do not import Torch or run a model.
const {spawnSync}=await import('node:child_process');
const py=spawnSync('/Users/ccrt/game/guandan/lab/.venv/bin/python3',['-c',String.raw`
import ast,math,random,hashlib,json
from collections import defaultdict
from pathlib import Path
source=Path('lab/review6_2/distill_learner.py').read_text();tree=ast.parse(source)
names={'require','sha','make_epoch_order','validate_first_round_r2_progress'}
ns={'math':math,'random':random,'hashlib':hashlib,'defaultdict':defaultdict,'json':json}
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name in names:exec(compile(ast.Module(body=[node],type_ignores=[]),'<real-pure-functions>','exec'),ns)
demo=[{'decisionId':'d'+str(i),'sourceFamily':'f'+str(i%2)} for i in range(65)]
keep=[{'decisionId':'k'+str(i),'sourceFamily':'f'+str(i%2)} for i in range(65)]
for steps in [0,1,2,3,4,6,201]:
 epoch,part=divmod(steps,3);cursor=32*part;cycle=epoch if cursor else max(0,epoch-1)
 order=ns['make_epoch_order'](demo,7,epoch,0);ko=ns['make_epoch_order'](keep,7,0,cycle)
 exp={'demo':{r['decisionId']:epoch for r in demo},'keep':{r['decisionId']:epoch for r in keep}}
 for kind,rows,indices in [('demo',demo,order[:cursor]),('keep',keep,ko[:cursor])]:
  for i in indices:exp[kind][rows[i]['decisionId']]+=1
 state={'optimizerSteps':steps,'epoch':epoch,'demoCursor':cursor,'demoOrder':order,'keepCycle':cycle,'keepOrder':ko,'keepCursor':cursor if cursor else 65 if epoch else 0,'exposures':exp}
 ns['validate_first_round_r2_progress'](state,demo,keep,7,None)
 state['exposures']['demo']['d0']+=1
 try:ns['validate_first_round_r2_progress'](state,demo,keep,7,None)
 except ValueError:pass
 else:raise AssertionError('corrupt exposure accepted')
print('PASS actual Python resume/exposure functions across multi-step epochs, including >64 updates; no model run')
`],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
assert.equal(py.status,0,py.stderr);process.stdout.write(py.stdout);
const {firstRoundCoverage}=await import('./first-round-qualification.mjs');
const families=Array.from({length:4},(_,i)=>({sourceFamily:'f'+i,split:i<2?'train':'dev'}));
const rows=[];
for(const f of families)for(let i=0;i<20;i++){
 const id=f.sourceFamily+'-'+i;
 const common={sourceFamily:f.sourceFamily,split:f.split,candidateSpecRef:'first-target-offer12-v1',candidateIds:['p','t'],candidateCanonicalIds:['pass','takeover'],candidateFeatures:[Array(423).fill(0),Array(423).fill(0)]};
 rows.push({...common,decisionId:'d'+id,contextSHA256:'d'+id,sampleKind:'demo',sampleClass:'target',evidenceGrade:'provisional_screened',targetIds:[i%2?'p':'t']});
 rows.push({...common,decisionId:'k'+id,contextSHA256:'k'+id,sampleKind:'keep',sampleClass:'ordinary'});
}
assert.equal(firstRoundCoverage(rows,families).eligible,false,'legacy bounded contract unchanged');
assert.equal(firstRoundCoverage(rows,families,{id:'first-round-common-view-r2',revisionRef:'science@sha256:'+'a'.repeat(64)}).eligible,true,'explicit r2 removes 16/8 arithmetic quotas, not evidence checks');
assert.throws(()=>firstRoundCoverage(rows,families,{id:'fake',revisionRef:'x'}),/unsupported/);
console.log('PASS explicit protocol-bound coverage arithmetic; legacy caps preserved only for historical datasets');

const glm={releaseRef:'glm',promptRef:'frozen'},ds={releaseRef:'ds',promptRef:'frozen'};
assert.equal(contract.isFirstRoundTeachingTerminalFor({teacher:glm,status:'failed'},glm),true);
assert.equal(contract.isFirstRoundTeachingTerminalFor({teacher:glm,status:'success'},glm),true);
assert.equal(contract.isFirstRoundTeachingTerminalFor({teacher:ds,status:'success'},glm),false);
assert.equal(contract.isFirstRoundTeachingTerminalFor({teacher:ds,commonView:{routingRole:'independent-review'}},ds),false);
assert.equal(contract.isFirstRoundTeachingTerminalFor({teacher:ds,commonView:{routingRole:'model-substitution'}},ds),true);
console.log('PASS frozen-teacher routing, not success cherry-picking; independent review never a teaching label');

const selectedRows=[0,1,2].map(i=>({key:{i},inputSHA256:'h'+i,split:'train',blockFamilyId:'f'}));
const subset=contract.firstRoundOwnedLabelRows(selectedRows,{split:'train',familyIds:['f']},{role:'model-substitution',selected:[selectedRows[2],selectedRows[0]]});
assert.deepEqual(subset.map(r=>r.key.i),[0,2]);
console.log('PASS secondary terminal index uses frozen subset in original selection order');
