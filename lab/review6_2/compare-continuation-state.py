"""Read-only equality check for two actual same-book continuation bootstraps."""
import json, sys, hashlib
from pathlib import Path
import torch

HOME = Path(__file__).resolve().parent
def cp(run):
    directory = HOME / 'runs' / run
    return directory / json.loads((directory / 'latest.json').read_text())['path']
def equal(a, b):
    if torch.is_tensor(a):
        return torch.is_tensor(b) and a.dtype == b.dtype and a.shape == b.shape and torch.equal(a, b)
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(equal(a[k], b[k]) for k in a)
    if isinstance(a, (tuple, list)):
        return type(a) is type(b) and len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    return a == b

phase = sys.argv[1] if len(sys.argv) > 1 else 'p8c'
assert phase in ['p8c', 'p9', 'p9c', 'p10', 'p12']
resource_phase = phase in ['p9', 'p9c']
pooled_phase = phase in ['p10', 'p12']
expected_update = 1400 if resource_phase or pooled_phase else 1000
rows = []
for suffix in (['coverage' if phase == 'p10' else 'dose'] if pooled_phase else ['control', 'resource'] if resource_phase else ['control', 'neural-peers']):
    old_run, new_run = ('r62-p8c-control', 'r62-p10-coverage' if phase == 'p10' else 'r62-p12-dose') if pooled_phase else (('r62-p8c-control' if phase == 'p9c' else 'r62-p8c-neural-peers'), 'r62-' + phase + '-' + suffix) if resource_phase else ('r62-p8-' + suffix, 'r62-p8c-' + suffix)
    before, after = cp(old_run), cp(new_run)
    a = torch.load(before / 'learner.pt', map_location='cpu', weights_only=True)
    b = torch.load(after / 'learner.pt', map_location='cpu', weights_only=True)
    assert a['absoluteUpdate'] == b['absoluteUpdate'] == expected_update
    fresh = json.loads((HOME / 'runs' / new_run / 'manifest.json').read_text())
    labels = json.loads(Path(fresh['config']['teacherSetRef']).read_text())
    added = set(b['teacherExposures']) - set(a['teacherExposures'])
    wanted_added = set(l['labelId'] for l in json.loads((HOME / 'data/explicit-resource-book-001/labels.json').read_text())) if resource_phase and suffix == 'resource' else set()
    if pooled_phase:
        wanted_added = set(l['labelId'] for l in json.loads((HOME / 'data/explicit-resource-book-001/labels.json').read_text()) + json.loads((HOME / 'data/p10-resource-coverage-002/new-labels.json').read_text()))
    assert added == wanted_added and set(b['teacherExposures']) == set(l['labelId'] for l in labels)
    for k in a:
        if k == 'teacherExposures':
            assert {key:b[k][key] for key in a[k]} == a[k]
            assert all(b[k][key] == 0 for key in added)
        elif k != 'identity':
            assert equal(a[k], b[k]), 'learner state differs: ' + k
    x, y = json.loads((before / 'state.json').read_text()), json.loads((after / 'state.json').read_text())
    for k in x:
        if k == 'teacherSetSHA256':
            assert y[k] == hashlib.sha256(Path(fresh['config']['teacherSetRef']).read_bytes()).hexdigest()
            if not added:
                assert x[k] == y[k]
        elif k not in ['identity', 'current']:
            assert x[k] == y[k], 'node state differs: ' + k
    assert {k:v for k,v in x['current'].items() if k != 'weightsPath'} == {k:v for k,v in y['current'].items() if k != 'weightsPath'}
    assert (before / 'weights.f32').read_bytes() == (after / 'weights.f32').read_bytes()
    rows.append(dict(parent=old_run, parentCheckpoint=str(before), runId=new_run, checkpoint=str(after), update=expected_update, newUpdates=0, newSources=0, addedExposuresZero=sorted(added), learnerModelOptimizerRNGExposuresExact=True, nodeQueueCursorAnchorSourceExact=True, weightsSHA256=hashlib.sha256((after / 'weights.f32').read_bytes()).hexdigest()))
result = dict(bothEquivalent=True, rows=rows)
path = HOME / 'receipts' / ('T4-' + phase.upper() + '-actual-bootstrap-equivalence.json')
path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result))
