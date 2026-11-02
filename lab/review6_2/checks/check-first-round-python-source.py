"""Finite supplemental AST/pure checks only. Does not import or emulate torch."""
import ast
import copy
import hashlib
import json
import math
import pathlib
import random
import re
import struct
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'distill_learner.py'
NAMES = {'RECIPE', 'STUDENT_INPUT_CONTRACT', 'FIRST_ROUND_RECIPE', 'FIRST_ROUND_SAMPLE_SCHEMA',
         'FIRST_ROUND_DATASET_SCHEMA', 'FIRST_ROUND_PLAN_SCHEMA', 'FIRST_ROUND_PURPOSE',
         'FIRST_TARGET_CANDIDATE_POLICY', 'LEGACY_CANDIDATE_POLICY'}
FUNCTIONS = {'require', 'sha', 'read_json', 'input_dimension', 'validate_recipe', 'candidate_contract',
             'is_first_round', 'first_round_shape', 'first_round_direction',
             'validate_first_round_row', 'validate_first_round_identities',
             'validate_first_round_progress', 'validate_first_round_dataset_rows', 'make_epoch_order'}
tree = ast.parse(SOURCE.read_text(), feature_version=(3, 9))
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in FUNCTIONS or
         isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in NAMES for t in n.targets)]
ns = dict(copy=copy, hashlib=hashlib, json=json, math=math, random=random, re=re, struct=struct, pathlib=pathlib, defaultdict=defaultdict)
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), ns)

def reject(fn, fragment):
    try: fn()
    except (ValueError, KeyError) as error:
        assert fragment in str(error), (fragment, str(error))
    else: raise AssertionError('expected rejection: ' + fragment)

# Removing recipe dispatch, phase limit, directional canonical binding, or
# progress/exposure consistency makes these checks fail; no mock model used.
r = ns['FIRST_ROUND_RECIPE']
assert r['recipeId'] == 'first-round-partner-control-fixed64-v1'
ns['validate_recipe'](r)
assert ns['first_round_shape'](r, 'formal', 16, 16) == {'maxOptimizerSteps':64, 'milestoneUpdates':[0,16,32,64], 'Uepoch':1}
assert ns['first_round_shape'](r, 'calibration', 1, 1)['maxOptimizerSteps'] == 1
for bad in [dict(r, maxEpochs=3), dict(r, maxUpdates=65), dict(r, keepWeight=0), dict(r, learningRate=3e-5)]:
    reject(lambda: ns['validate_recipe'](bad), 'recipe' if bad.get('learningRate') != 3e-5 else 'restart')
ns['validate_recipe'](dict(r,learningRate=3e-5), {'id':'restart','sha256':'a'*64})
ns['validate_recipe'](ns['RECIPE'])
for n,k in [(0,0),(17,17),(3,2)]: reject(lambda: ns['first_round_shape'](r,'formal',n,k),'count')
row={'candidateIds':['a','b'], 'candidateCanonicalIds':['pass','play'], 'targetIds':['b'], 'direction':'takeover'}
assert ns['first_round_direction'](row)=='takeover'
reject(lambda:ns['first_round_direction'](dict(row,direction='pass')),'direction')
reject(lambda:ns['first_round_direction'](dict(row,targetIds=['c'])),'target')
demo=[{'decisionId':'d','sourceFamily':'f'}]; keep=[{'decisionId':'k','sourceFamily':'f'}]
for step in [0,1,3,16,32,64]:
    cycle=max(0,step-1)
    state={'optimizerSteps':step,'epoch':step,'demoCursor':0,'demoOrder':ns['make_epoch_order'](demo,3,step,0) if step<64 else [],
           'keepCycle':cycle,'keepCursor':1 if step else 0,'keepOrder':ns['make_epoch_order'](keep,3,0,cycle),
           'exposures':{'demo':{'d':step},'keep':{'k':step}}}
    ns['validate_first_round_progress'](state,demo,keep,3,64)
    reject(lambda:ns['validate_first_round_progress'](dict(state,epoch=step+1),demo,keep,3,64),'progress')
    reject(lambda:ns['validate_first_round_progress'](dict(state,exposures={'demo':{'d':step+1},'keep':{'k':step}}),demo,keep,3,64),'exposure')
# Exercise the actual production next_batch method beyond the old3-epoch cap.
from types import SimpleNamespace
learner_class=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='DistillLearner')
next_method=next(n for n in learner_class.body if isinstance(n,ast.FunctionDef) and n.name=='next_batch')
exec(compile(ast.Module(body=[next_method],type_ignores=[]),str(SOURCE),'exec'),ns)
for step in [0,1,3,16,32,63,64]:
    cycle=max(0,step-1)
    cursor=SimpleNamespace(first_round=True,optimizerSteps=step,shape={'maxOptimizerSteps':64},
        demoOrder=[0] if step<64 else [],demoCursor=0,keepOrder=[0],keepCursor=1 if step else 0,
        keepCycle=cycle,keep=keep,seed=3)
    assert ns['next_batch'](cursor)==(([0],[0]) if step<64 else ([],[]))
from first_round_python_fixture import fixture_rows, fixture_identities
identities=fixture_identities(ns['STUDENT_INPUT_CONTRACT'],ns['FIRST_TARGET_CANDIDATE_POLICY'])
ns['validate_first_round_identities'](identities,ns['STUDENT_INPUT_CONTRACT'])
reject(lambda:ns['validate_first_round_identities'](dict(identities,proposalEncoderConfig=identities['encoderConfig']),ns['STUDENT_INPUT_CONTRACT']),'proposal')
reject(lambda:ns['validate_first_round_identities'](dict(identities,basePolicy=identities['studentScorer']),ns['STUDENT_INPUT_CONTRACT']),'proposal')
rows=fixture_rows(ns['STUDENT_INPUT_CONTRACT'],ns['FIRST_TARGET_CANDIDATE_POLICY'],ns['FIRST_ROUND_SAMPLE_SCHEMA'],identities['studentParentRef'])
for row in rows:ns['validate_first_round_row'](row,ns['STUDENT_INPUT_CONTRACT'])
reject(lambda:ns['validate_first_round_row'](rows[0],None),'explicit423')
reject(lambda:ns['validate_first_round_row'](dict(rows[0],evidenceGrade='ambiguous'),ns['STUDENT_INPUT_CONTRACT']),'grade')
reject(lambda:ns['validate_first_round_row'](dict(rows[0],validationRef={}),ns['STUDENT_INPUT_CONTRACT']),'validation')
reject(lambda:ns['validate_first_round_row'](dict(rows[1],evidenceGrade='strong_supported'),ns['STUDENT_INPUT_CONTRACT']),'fields')
# New data path must independently recompute small-round coverage, and cannot
# use an eligible bit to bypass missing directions or strong-label conflicts.
ns['validate_first_round_dataset_rows'](rows,[{'sourceFamily':f,'split':f.split('-')[0]} for f in ('train-a','train-b','dev-a','dev-b')],True)
missing=copy.deepcopy(rows)
for row in missing:
    if row['sampleKind']=='demo' and row['sourceFamily']=='dev-b':row.update(direction='takeover',targetIds=['a11'])
reject(lambda:ns['validate_first_round_dataset_rows'](missing,[{'sourceFamily':f,'split':f.split('-')[0]} for f in ('train-a','train-b','dev-a','dev-b')],True),'direction')
conflict=copy.deepcopy(rows)
for row in conflict:
    if row['sampleKind']=='demo':row['evidenceGrade']='strong_supported'
reject(lambda:ns['validate_first_round_dataset_rows'](conflict,[{'sourceFamily':f,'split':f.split('-')[0]} for f in ('train-a','train-b','dev-a','dev-b')],True),'label_conflict')
reject(lambda:ns['validate_recipe'](dict(r,keepWeight=True)),'recipe')
bad_parent=copy.deepcopy(identities);bad_parent['studentScorer']['policyId']=''
reject(lambda:ns['validate_first_round_identities'](bad_parent,ns['STUDENT_INPUT_CONTRACT']),'descriptor')
# Match the exact reviewed JavaScript recipe, including unknown-key rejection.
import subprocess
recipe_path=pathlib.Path(__file__).resolve().parents[5]/'S35/work/lab/review6_2/first-round-contract.mjs'
if recipe_path.is_file():
    js=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {FIRST_ROUND_RECIPE as r} from '"+recipe_path.as_uri()+"'; console.log(JSON.stringify(r))"],text=True))
    assert js==r,'Python and owner JavaScript recipe differ'
# Fixed Python worker/checkpoint dispatch, not an execution claim.
worker=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='worker_main')
worker_text=ast.get_source_segment(SOURCE.read_text(),worker)
assert "input_contract=command.get('inputContract')" in worker_text
assert "result.get('milestone', result['epochEnded'])" in worker_text
checkpoint=(ROOT/'distill_checkpoint.py').read_text()
assert '.numpy(' not in checkpoint
assert 'ohuo-supervised-checkpoint-first-round-v2' in checkpoint
assert "facts['perDecisionExposure'] = state['exposures']" in checkpoint
print(json.dumps({'caseId':'training.round-contract-smoke','layer':'Python AST/pure supplemental only','torchExecuted':False,'realTraining':False,'status':'PASS'}))
