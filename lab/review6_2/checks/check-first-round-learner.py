"""NAV-S35 fixed finite synthetic test. Existing Mac torch only, no NumPy.
One parameter update in finite-step case; no research dataset, API, or weights.
"""
import argparse
import copy
import hashlib
import json
import pathlib
import sys
import tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import torch
from distill_learner import (DistillLearner, STUDENT_INPUT_CONTRACT, FIRST_ROUND_RECIPE,
    FIRST_TARGET_CANDIDATE_POLICY, FIRST_ROUND_SAMPLE_SCHEMA, FIRST_ROUND_DATASET_SCHEMA,
    FIRST_ROUND_PLAN_SCHEMA, validate_decision, load_frozen_dataset, initial_equivalence, decision_loss)
from distill_checkpoint import commit_checkpoint, restore_checkpoint, read_committed
from first_round_python_fixture import fixture_rows, fixture_identities


def equal(a,b):
    if isinstance(a,torch.Tensor):return isinstance(b,torch.Tensor) and torch.equal(a,b)
    if isinstance(a,dict):return isinstance(b,dict) and a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
    if isinstance(a,(list,tuple)):return type(a)==type(b) and len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a==b


def rejected(fn,fragment):
    try:fn()
    except (ValueError,KeyError) as error:assert fragment in str(error),(fragment,str(error))
    else:raise AssertionError('required rejection: '+fragment)


def fixture():
    identities=fixture_identities(STUDENT_INPUT_CONTRACT,FIRST_TARGET_CANDIDATE_POLICY)
    flat=torch.zeros(174593);flat[108544]=1.;flat[174336]=1.
    # S33's original no-NumPy f32 writer format.
    import array
    data=array.array('f',flat.tolist())
    if sys.byteorder!='little':data.byteswap()
    identities['studentScorer']['weightsSHA256']=hashlib.sha256(data.tobytes()).hexdigest()
    rows=fixture_rows(STUDENT_INPUT_CONTRACT,FIRST_TARGET_CANDIDATE_POLICY,FIRST_ROUND_SAMPLE_SCHEMA,identities['studentParentRef'])
    refs={'dataset':'synthetic@sha256:'+'7'*64,'manifestSHA256':'8'*64,'teacher':'teacher','B':'proposal@sha256:'+'9'*64,
        'parent':identities['studentParentRef'],'parentIdentity':copy.deepcopy(identities['studentScorer']),
        'proposalIdentity':copy.deepcopy(identities['basePolicy']),'inputContract':copy.deepcopy(STUDENT_INPUT_CONTRACT),
        'encoder':STUDENT_INPUT_CONTRACT['encoderVersion'],'candidate':FIRST_TARGET_CANDIDATE_POLICY['candidateSpec'],
        'candidatePolicy':copy.deepcopy(FIRST_TARGET_CANDIDATE_POLICY),'prompt':'prompt','recipe':copy.deepcopy(FIRST_ROUND_RECIPE),
        'sourceRevision':'synthetic','runtimeRef':'synthetic','phase':'formal','seed':35}
    return rows,flat,refs,identities


def make(rows,flat,refs):
    return DistillLearner(rows,flat,refs,35,recipe=FIRST_ROUND_RECIPE,input_contract=STUDENT_INPUT_CONTRACT)


def freeze_fixture(directory,rows,identities):
    path=pathlib.Path(directory)/'dataset';path.mkdir()
    samples=('\n'.join(json.dumps(r,separators=(',',':')) for r in rows)+'\n').encode()
    counts={'demo':0,'keep':0,'train':{'demo':0,'keep':0},'dev':{'demo':0,'keep':0}}
    for r in rows:counts[r['sampleKind']]+=1;counts[r['split']][r['sampleKind']]+=1
    families=[{'sourceFamily':f,'split':f.split('-')[0],'sourceRefs':['source-'+f]} for f in ('train-a','train-b','dev-a','dev-b')]
    manifest={'schema':FIRST_ROUND_DATASET_SCHEMA,'datasetId':'synthetic-only','plan':{'schema':FIRST_ROUND_PLAN_SCHEMA,
        'datasetId':'synthetic-only','purpose':'engineering_fixture','identities':identities,'families':families},
        'identityRefs':{'basePolicy':rows[0]['basePolicyRef'],'teacher':rows[0]['teacherPolicyRef']},
        'samples':{'path':'samples.jsonl','sha256':hashlib.sha256(samples).hexdigest(),'bytes':len(samples),'decisions':len(rows)},
        'counts':{'valid':counts},'qualification':{'eligible':False,'Ndemo':counts['train']['demo']}}
    raw=(json.dumps(manifest,separators=(',',':'))+'\n').encode()
    (path/'samples.jsonl').write_bytes(samples);(path/'manifest.json').write_bytes(raw)
    return {'directory':str(path),'manifestSHA256':hashlib.sha256(raw).hexdigest()}


def load_capture_fixture(filename, expected_sha):
    wrapper=pathlib.Path(filename).absolute()
    assert wrapper.resolve(strict=True)==wrapper and not wrapper.is_symlink()
    raw=wrapper.read_bytes();assert hashlib.sha256(raw).hexdigest()==expected_sha
    spec=json.loads(raw)
    assert spec['schema']=='ohuo-first-round-python-fixture-v1' and spec['datasetEligible'] is False and spec['realTraining'] is False
    def local(relative):
        path=pathlib.PurePosixPath(relative)
        assert not path.is_absolute() and '..' not in path.parts
        target=wrapper.parent.joinpath(*path.parts)
        assert target.resolve(strict=True)==target
        return target
    reference={'directory':str(local(spec['dataset']['directory'])),'manifestSHA256':spec['dataset']['manifestSHA256']}
    manifest=json.loads((pathlib.Path(reference['directory'])/'manifest.json').read_bytes())
    identities=manifest['plan']['identities']
    loaded=load_frozen_dataset(reference,identities,synthetic=True,input_contract=STUDENT_INPUT_CONTRACT)
    parent=local(spec['parentWeightsPath']).read_bytes()
    assert hashlib.sha256(parent).hexdigest()==spec['parentWeightsSHA256']==identities['studentScorer']['weightsSHA256']
    flat=torch.frombuffer(bytearray(parent),dtype=torch.float32).clone()
    _,_,refs,_=fixture()
    refs.update(dataset='capture-fixture@sha256:'+reference['manifestSHA256'],manifestSHA256=reference['manifestSHA256'],
        parent=identities['studentParentRef'],parentIdentity=identities['studentScorer'],proposalIdentity=identities['basePolicy'])
    target=next(r for r in loaded['samples'] if r['decisionId']==spec['targetDecisionId'])
    assert target['sampleKind']=='demo' and target['targetIds']==[spec['targetActionId']]
    assert target['candidateIds']==spec['expectedCandidateIds'] and 8<=target['candidateIds'].index(spec['targetActionId'])<12
    return loaded['samples'],flat,refs,identities,reference,target


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--case',required=True,choices=['training.capture-freeze-smoke','training.finite-step-reload'])
    parser.add_argument('--capture-fixture');parser.add_argument('--fixture-sha256')
    args=parser.parse_args();assert bool(args.capture_fixture)==bool(args.fixture_sha256)
    torch.set_num_threads(1);torch.use_deterministic_algorithms(True)
    capture_reference=None;capture_target=None
    if args.capture_fixture:
        rows,flat,refs,identities,capture_reference,capture_target=load_capture_fixture(args.capture_fixture,args.fixture_sha256)
    else:rows,flat,refs,identities=fixture()
    l=make(rows,flat,refs)
    assert not l.optimizer.state
    l.metrics.append({'kind':'update0','equivalence':initial_equivalence(l),**l.evaluate_milestone()})
    root=pathlib.Path(__file__).resolve().parents[2]/'out'/'S35-finite-python';root.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='fixed-',dir=root) as tmp:
        if args.case=='training.capture-freeze-smoke':
            reference=capture_reference or freeze_fixture(tmp,rows,identities)
            loaded=load_frozen_dataset(reference,identities,synthetic=True,input_contract=STUDENT_INPUT_CONTRACT)
            assert loaded['samples']==rows and loaded['manifest']['qualification']['eligible'] is False
            rejected(lambda:load_frozen_dataset(reference,identities,input_contract=STUDENT_INPUT_CONTRACT),'ineligible')
            rejected(lambda:load_frozen_dataset(reference,identities,synthetic=True),'input/candidate')
            target=capture_target or next(r for r in rows if r.get('direction')=='takeover')
            target_index=target['candidateIds'].index(target['targetIds'][0]);assert 8<=target_index<12
            with torch.no_grad():scores_actual=l.model(torch.tensor(target['candidateFeatures'],dtype=torch.float32)).reshape(-1)
            chosen=min(range(len(scores_actual)),key=lambda i:(-float(scores_actual[i]),target['candidateOriginalIndices'][i]))
            student_action=target['candidateIds'][chosen];assert student_action==target['baseActionId']
            bad=copy.deepcopy(target);bad['targetIds']=['outside']
            rejected(lambda:validate_decision(bad,STUDENT_INPUT_CONTRACT),'target')
            bad=copy.deepcopy(target);bad['schema']='ohuo-distill-decision-candidate-v3'
            mixed=copy.deepcopy(rows);mixed[rows.index(target)]=bad
            rejected(lambda:make(mixed,flat,refs),'recipe/sample')
            k=len(target['candidateIds'])
            scores=torch.tensor([0.]*k+[100.]);mask=torch.tensor([True]*k+[False])
            padded=copy.deepcopy(target);padded['candidateIds'].append('padding')
            assert abs(float(decision_loss(scores,mask,padded,1))-float(decision_loss(scores[:k],mask[:k],target,1)))<1e-7
            result={'rows':len(rows),'K':k,'inputDim':423,'targetIndex':target_index,'studentGreedyActionId':student_action,'candidateIds':target['candidateIds'],'maskedPaddingExcluded':True,'fixtureResearchRejected':True,'finiteUpdates':0,
                    'boundary':'same frozen capture fixture' if capture_reference else 'Python frozen-reader leg only; TS capture/freezer evidence required separately'}
        else:
            before=l.model.flat().clone();l.accumulate(l.demo,l.keep,2)
            gradient=float(l.model.f[0].weight.grad[:,399:].abs().sum());assert gradient>0
            assert abs(l.loss_sums(l.demo,l.keep)['keep'].item())<1e-6
            step=l.step_next(2)
            assert step['optimizerSteps']==1 and step['epochEnded'] and step['milestone'] is False
            assert len(step['demoIds'])==len(l.demo) and len(step['keepIds'])==len(l.keep)==len(l.demo)
            assert (before[:108288].reshape(256,423)[:,399:]!=l.model.f[0].weight.detach()[:,399:]).any() and l.model.f[0].weight.requires_grad
            checkpoint=commit_checkpoint(tmp,l,{'step':step,'datasetEligible':False,'realTraining':False})
            state,facts=read_committed(tmp,checkpoint)
            restored=make(rows,flat,refs);restore_checkpoint(tmp,restored,checkpoint)
            assert equal(restored.capture_state(),l.capture_state()),'exact optimizer/RNG/data/cursor mismatch'
            assert all(n==1 for group in facts['perDecisionExposure'].values() for n in group.values())
            assert restored.next_batch()==l.next_batch() and restored.optimizerSteps==1
            wrong=copy.deepcopy(state);wrong['optimizerSteps']=65
            rejected(lambda:restored.restore_state(wrong),'progress')
            wrong=copy.deepcopy(state);wrong['schema']='ohuo-supervised-state-student423-v1'
            rejected(lambda:restored.restore_state(wrong),'schema')
            wrong=copy.deepcopy(state);pid=next(iter(wrong['optimizer']['state']))
            wrong['optimizer']['state'][pid]['square_avg']=torch.zeros((256,399))
            rejected(lambda:restored.restore_state(wrong),'shape')
            wrong=copy.deepcopy(refs);wrong['phase']='calibration'
            calibration=make(rows,flat,wrong)
            rejected(lambda:calibration.restore_state(state),'frozenRefs')
            fresh=make(rows,flat,refs)
            assert fresh.optimizerSteps==0 and not fresh.optimizer.state and torch.equal(fresh.model.flat(),flat)
            result={'finiteUpdates':1,'memoryColumnRange':[399,422],'memoryGradientL1':gradient,
                    'targetIndex':capture_target['candidateIds'].index(capture_target['targetIds'][0]) if capture_target else 11,
                    'fullTailDemo':len(l.demo),'fullTailKeep':len(l.keep),
                    'optimizerExact':True,'fullCheckpointExact':True,'resumeNextBatchExact':True,'freshFormalUnchangedS0':True,
                    'wrongPhaseAndOldSchemaAnd399OptimizerRejected':True}
    print(json.dumps({'caseId':args.case,'datasetEligible':False,'realTraining':False,'fixture':'same-ts-capture-freeze' if capture_reference else 'synthetic-first-round-423-k12',**result}))

if __name__=='__main__':main()
