"""NAV-S33 only: actual learner finite synthetic memory/backprop and reload.
Requires the existing local torch environment. Never starts worker/research.
"""
import argparse
import copy
import json
import pathlib
import sys
import tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import torch
from distill_learner import DistillLearner, STUDENT_INPUT_CONTRACT
from distill_checkpoint import commit_checkpoint, restore_checkpoint, read_committed


def fixture(d=423):
    x = [[0.] * d, [0.] * d]
    if d == 423: x[1][399] = 1.
    else: x[1][0] = 1.
    common = {'split': 'train', 'candidateIds': ['a0', 'a1'], 'candidateOriginalIndices': [0, 1],
              'candidateFeatures': x, 'rawQ': [0., 0.], 'baseActionId': 'a0', 'sourceFamily': 's33-fixture'}
    rows = [{**copy.deepcopy(common), 'sampleKind': 'demo', 'decisionId': 'd',
             'targetIds': ['a1'], 'labelKind': 'teacher_action'},
            {**copy.deepcopy(common), 'sampleKind': 'keep', 'decisionId': 'k'}]
    if d == 423:
        for row in rows: row['encoderVersion'] = 'student-input399plus24-v1'
    flat = torch.zeros(256*d+256+256*256+256+256+1)
    flat[256*d+256] = 1.  # W2[0,0]
    flat[256*d+256+256*256+256] = 1.  # W3[0]
    return rows, flat


def learner(d=423):
    rows, flat = fixture(d)
    contract = copy.deepcopy(STUDENT_INPUT_CONTRACT) if d == 423 else None
    refs = {'fixture': 's33', **({'inputContract': contract} if contract else {})}
    return DistillLearner(rows, flat, refs, 33, input_contract=contract)


def equal(a, b):
    if isinstance(a, torch.Tensor): return isinstance(b, torch.Tensor) and torch.equal(a, b)
    if isinstance(a, dict): return isinstance(b, dict) and a.keys() == b.keys() and all(equal(a[k], b[k]) for k in a)
    if isinstance(a, (tuple, list)): return type(a) is type(b) and len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    return a == b


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', required=True, choices=['student.memory-wire', 'student.load-resume-smoke'])
    args = parser.parse_args()
    torch.set_num_threads(1); torch.use_deterministic_algorithms(True)
    l = learner(); assert not l.optimizer.state, 'fresh optimizer must be empty'
    if args.case == 'student.memory-wire':
        l.accumulate(l.demo, l.keep, 1)
        gradient = float(l.model.f[0].weight.grad[0,399]); assert gradient != 0 and torch.isfinite(torch.tensor(gradient))
        before = l.model.f[0].weight[0,399].item(); l.step_next(1)
        after = l.model.f[0].weight[0,399].item(); assert before != after
        assert all(p.requires_grad for p in l.model.parameters())
        result = {'memoryColumn': 399, 'gradient': gradient, 'before': before, 'after': after, 'finiteUpdates': 1}
    else:
        l.step_next(1)
        output = l.model(torch.tensor(l.demo[0]['candidateFeatures'])).detach().clone()
        root = pathlib.Path(__file__).resolve().parents[2] / 'out' / 'S33-finite-student'
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='checkpoint-', dir=root) as directory:
            ref = commit_checkpoint(directory, l, {'engineeringFixture': True, 'datasetEligible': False})
            state, facts = read_committed(directory, ref)
            restored = learner(); restore_checkpoint(directory, restored, ref)
            assert equal(restored.capture_state(), l.capture_state()), 'complete model/optimizer/RNG/cursor state differs'
            assert torch.equal(output, restored.model(torch.tensor(restored.demo[0]['candidateFeatures'])).detach())
            assert state['inputContract'] == STUDENT_INPUT_CONTRACT == facts['inputContract']
            wrong = learner(399)
            try: wrong.restore_state(state)
            except ValueError: pass
            else: raise AssertionError('423 checkpoint must not restore into399')
            try: restored.restore_state(wrong.capture_state())
            except ValueError: pass
            else: raise AssertionError('399 checkpoint must not restore into423')
        result = {'fullCheckpointReload': True, 'optimizerExact': True, 'outputExact': True, 'crossSchemaRejected': True}
    print(json.dumps({'caseId': args.case, 'datasetEligible': False, 'realTraining': False, 'fixture': 'synthetic-sentinel', **result}))


if __name__ == '__main__': main()
