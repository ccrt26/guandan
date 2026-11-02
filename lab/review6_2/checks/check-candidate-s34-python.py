"""candidate.same-set-smoke Python leg: generated engineering fixture only.
No optimizer, model, weights, network, training loop, or environment setup.
"""
import copy
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import torch
from distill_learner import load_frozen_dataset, validate_decision, decision_loss

assert len(sys.argv) == 2, 'one fixed same-set fixture required'
fixture = pathlib.Path(sys.argv[1]).resolve(strict=True)
assert fixture.name == 'python-input.json' and fixture.parent.name.startswith('S34-same-set-')
assert fixture.parent.parent.name == 'S34-candidate-same-set'
assert fixture.parent.parent.parent.name == 'out' and fixture.parent.parent.parent.parent.name == 'lab'
input_value = json.loads(fixture.read_text())
loaded = load_frozen_dataset(input_value['dataset'], input_value['identities'], synthetic=True)
assert len(loaded['samples']) == 1 and loaded['manifest']['qualification']['eligible'] is False
row = loaded['samples'][0]
ids = row['candidateIds']
k = len(ids)
assert 8 < k <= 12 and row['targetIds'] == [input_value['target']]
target = ids.index(input_value['target'])
assert target >= 8, 'must exercise a new initial slot, not an old first-eight target'
x, q = validate_decision(row)
assert tuple(x.shape) == (k, 399) and tuple(q.shape) == (k,)
scores = torch.zeros(k)
mask = torch.ones(k, dtype=torch.bool)
assert torch.isfinite(decision_loss(scores, mask, row, 1))
mask[target] = False
try:
    decision_loss(scores, mask, row, 1)
    raise AssertionError('masked-out teacher target accepted')
except ValueError as error:
    assert 'target outside effective mask' in str(error)
for bad in [dict(row, candidatePolicy=None), dict(row, candidateIds=ids + ['extra'] * 13)]:
    try:
        validate_decision(bad)
        raise AssertionError('incomplete policy or over-cap K accepted')
    except ValueError:
        pass
legacy = copy.deepcopy(row)
legacy.pop('candidatePolicy')
legacy.update(schema='ohuo-distill-decision-v2', candidateSpecRef='ohuo-frozen-c8-expand4-v1')
for field in ['candidateIds', 'candidateOriginalIndices', 'candidateFeatures', 'rawQ']:
    legacy[field] = legacy[field][:8]
legacy['targetIds'] = [legacy['candidateIds'][0]]
legacy['baseActionId'] = legacy['candidateIds'][0]
assert tuple(validate_decision(legacy)[0].shape) == (8, 399)
print(json.dumps({'checkId': 'candidate.same-set-smoke', 'leg': 'python-read-mask',
                  'status': 'passed', 'K': k, 'targetIndex': target,
                  'candidateIds': ids, 'targetIds': row['targetIds'],
                  'datasetEligible': False, 'python': sys.version,
                  'executable': sys.executable, 'torch': torch.__version__,
                  'optimizerSteps': 0, 'realTraining': False}))
