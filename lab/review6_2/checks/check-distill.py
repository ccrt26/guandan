#!/usr/bin/env python3
"""The three bounded v5.2 B10 synthetic cases. No default real assets.
local-load-only requires explicit accepted file paths/hashes and never forwards.
engineering-load-only keeps the original ineligible fixture and real parent separate.
"""
import argparse
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile
import torch
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'lab/review6_2'))


def fixture():
    from distill_learner import Net
    torch.manual_seed(29); net = Net(); flat = net.flat().clone(); rows = []
    for split, count in [('train', 35), ('dev', 3)]:
        for kind in ['demo', 'keep']:
            for i in range(count):
                k = 2 + i % 2; x = torch.zeros(k, 399)
                for a in range(k): x[a, 0] = .1 * (i + 1) * (a + 1); x[a, 4] = a - .5
                with torch.no_grad(): q = net(x).reshape(-1).tolist()
                ids = ['a' + str(a) for a in range(k)]; b = max(range(k), key=lambda a: q[a])
                row = {'sampleKind': kind, 'sampleClass': 'target' if kind == 'demo' else 'ordinary',
                       'decisionId': f'{split}-{kind}-{i}', 'sourceFamily': split + '-f' + str(i % 3),
                       'split': split, 'candidateIds': ids, 'candidateOriginalIndices': list(range(k)),
                       'candidateFeatures': x.tolist(), 'rawQ': q, 'baseActionId': ids[b]}
                if kind == 'demo': row.update(targetIds=[ids[(b + 1) % k]], labelKind='teacher_action')
                rows.append(row)
    return rows, flat, {'dataset': {'id': 'synthetic-only', 'sha256': 'd' * 64},
        'B': {'id': 'synthetic-B', 'sha256': hashlib.sha256(engineering_flat_bytes(flat)).hexdigest()},
        'encoder': 'gd-lab-schema-v4', 'candidate': 'ohuo-frozen-c8-expand4-v1',
        'teacher': 'synthetic', 'prompt': 'synthetic', 'code': 'synthetic'}


def same(a, b):
    if isinstance(a, torch.Tensor): assert torch.equal(a, b), 'tensor differs'
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a: same(a[k], b[k])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b): same(x, y)
    else: assert a == b, (a, b)


def node_fixture(name):
    env = {**os.environ, 'B10_TEST_PYTHON': sys.executable}
    result = subprocess.run(['node', '--import', 'tsx', str(ROOT / 'lab/review6_2/checks/fixtures' / name)],
                            cwd=ROOT, env=env, text=True, capture_output=True)
    if result.returncode: raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


def run(case):
    from distill_learner import decision_loss, DistillLearner
    from distill_checkpoint import commit_checkpoint, restore_checkpoint, publish_checkpoint
    rows, flat, refs = fixture()
    if case == 'loss-mask':
        demo = {'sampleKind': 'demo', 'candidateIds': ['a', 'b'], 'targetIds': ['b']}
        keep = {'sampleKind': 'keep', 'rawQ': [0., 0.]}
        s = torch.zeros(2, requires_grad=True); mask = torch.ones(2, dtype=torch.bool)
        assert abs(decision_loss(s, mask, demo, 1).item() - math.log(2)) < 1e-6
        assert abs(decision_loss(s, mask, keep, 1).item()) < 1e-6
        for row in [demo, keep]:
            padded = {**row, 'candidateIds': ['a', 'b', 'pad']}
            if row['sampleKind'] == 'keep': padded['rawQ'] = [0., 0., 999.]
            assert torch.equal(decision_loss(s, mask, row, 1), decision_loss(torch.tensor([0., 0., 999.]),
                                torch.tensor([True, True, False]), padded, 1))
        try:
            decision_loss(s, torch.tensor([False, True]), {**demo, 'targetIds': ['a']}, 1)
            raise AssertionError('invalid target accepted')
        except ValueError: pass
        small = [r for r in rows if r['split'] == 'train' and int(r['decisionId'].split('-')[-1]) < 3]
        a = DistillLearner(small, flat, refs, seed=7); b = DistillLearner(small, flat, refs, seed=7)
        d = [r for r in small if r['sampleKind'] == 'demo']; k = [r for r in small if r['sampleKind'] == 'keep']
        la = a.accumulate(d, k, 3); lb = b.accumulate(d, k, 2)
        assert la['decisions'] == lb['decisions'] == 6
        for name in ['demo', 'keep', 'total']: assert abs(la[name] - lb[name]) < 1e-6
        maximum = 0.
        for p, q in zip(a.model.parameters(), b.model.parameters()):
            maximum = max(maximum, float((p.grad - q.grad).abs().max()))
            assert torch.allclose(p.grad, q.grad, atol=1e-6, rtol=1e-5)
        wrong = DistillLearner(small, flat, refs, seed=7); wrong.model.zero_grad()
        for ds, ks in [(d[:2], k[:2]), (d[2:], k[2:])]: wrong.loss_sums(ds, ks)['total_mean'].mul(.5).backward()
        assert any(not torch.allclose(p.grad, q.grad, atol=1e-6, rtol=1e-5) for p, q in zip(a.model.parameters(), wrong.model.parameters()))
        return {'ce': math.log(2), 'kl': 0, 'tailDecisions': 6, 'microbatchGradientMaxAbs': maximum, 'atol': 1e-6, 'rtol': 1e-5}
    if case == 'optimizer-isolation':
        a = DistillLearner(rows, flat, refs, seed=7); before = a.parent.flat().clone(); first = a.next_batch()
        assert not ({p.data_ptr() for p in a.model.parameters()} & {p.data_ptr() for p in a.parent.parameters()})
        assert {id(p) for g in a.optimizer.param_groups for p in g['params']} == {id(p) for p in a.model.parameters()}
        assert a.evaluate_dev()['keepDriftRate'] == 0
        a.step_next(physical_decisions=2)
        assert torch.equal(before, a.parent.flat()); assert not torch.equal(before, a.model.flat())
        assert all(not p.requires_grad and p.grad is None for p in a.parent.parameters())
        assert a.optimizer.param_groups[0]['lr'] == 1e-4 and a.optimizerSteps == 1
        assert a.next_batch()[0] != first[0]
        # NUM-2: finite scores/gradients/parameters can still overflow RMSprop's
        # square accumulator. Reject before reporting a committed step/exposure.
        huge_x = torch.zeros(2, 399); huge_x[:, 0] = torch.tensor([1e25, -1e25])
        sparse = torch.zeros(168449); sparse[102400] = sparse[168192] = 1
        common = {'sampleClass': 'ordinary', 'sourceFamily': 'overflow-fixture', 'split': 'train',
                  'candidateIds': ['a', 'b'], 'candidateOriginalIndices': [0, 1],
                  'candidateFeatures': huge_x.tolist(), 'rawQ': [0., 0.], 'baseActionId': 'a'}
        extreme = DistillLearner([{**common, 'sampleKind': 'demo', 'decisionId': 'overflow-demo',
                    'labelKind': 'teacher_action', 'targetIds': ['b']},
                    {**common, 'sampleKind': 'keep', 'decisionId': 'overflow-keep'}], sparse, refs, seed=7)
        try: extreme.step_next(1); raise AssertionError('nonfinite optimizer state accepted')
        except ValueError as error: assert str(error) == 'nonfinite optimizer state'
        assert extreme.optimizerSteps == 0 and extreme.exposure_summary()['demo']['total'] == 0
        return {'studentSteps': 1, 'BUnchanged': True, 'nonfiniteOptimizerRejectedBeforeCommit': True, 'driver': node_fixture('b10-student.ts')}
    full = DistillLearner(rows, flat, refs, seed=7)
    full.step_next(physical_decisions=2); full.step_next(physical_decisions=2)
    expected = full.capture_state(); expected_rng = torch.get_rng_state().clone()
    split = DistillLearner(rows, flat, refs, seed=7)
    out = ROOT / 'lab/out/B10'; out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='resume-', dir=out) as directory:
        initial = commit_checkpoint(pathlib.Path(directory), split, {'kind': 'initial', 'synthetic': True})
        split.step_next(physical_decisions=2)
        ref = commit_checkpoint(pathlib.Path(directory), split, {'kind': 'resume', 'synthetic': True}, publish=False)
        # Host has committed ref, then process died before publication. Fixed
        # recovery must not select the stale latest mirror or spend another step.
        assert json.loads((pathlib.Path(directory) / 'latest.json').read_text()) == initial
        (pathlib.Path(directory) / 'checkpoints' / 'u999999-incomplete.tmp').mkdir()
        restored = DistillLearner(rows, flat, refs, seed=7); restore_checkpoint(pathlib.Path(directory), restored, ref)
        publish_checkpoint(pathlib.Path(directory), ref)
        publish_checkpoint(pathlib.Path(directory), ref)
        assert json.loads((pathlib.Path(directory) / 'latest.json').read_text()) == ref
        assert json.loads((pathlib.Path(directory) / 'previous.json').read_text()) == initial, 'idempotent publish must not self-reference previous'
        assert json.loads((pathlib.Path(directory) / 'status.json').read_text())['optimizerSteps'] == 1
        assert restored.optimizerSteps == 1; restored.step_next(physical_decisions=2)
        same(expected, restored.capture_state()); assert torch.equal(expected_rng, torch.get_rng_state())
        assert restored.optimizerSteps == 2 and restored.exposure_summary()['demo']['unique'] == 35
        assert restored.last_step['decisions'] == 6
        wrong = DistillLearner(rows, flat, {**refs, 'prompt': 'changed'}, seed=7)
        try: restore_checkpoint(pathlib.Path(directory), wrong); raise AssertionError('changed refs accepted')
        except ValueError: pass
        assert ref['optimizerSteps'] == 1
    return {'uninterruptedSteps': 2, 'restoredSteps': 2, 'exactStateEqual': True, 'tailDecisions': 6,
            'temporaryIncompleteIgnored': True, 'commitBeforePublishRecovered': True, 'idempotentMirror': True, 'host': node_fixture('b10-host.ts')}


def local_load(args):
    from distill_learner import load_frozen_dataset, read_json, sha, require, Net
    require(all([args.dataset, args.manifest_sha256, args.parent_path, args.parent_sha256]),
            'local-load-only requires explicit accepted dataset and parent paths/SHA')
    manifest = read_json((pathlib.Path(args.dataset) / 'manifest.json').read_bytes())
    data = load_frozen_dataset({'directory': args.dataset, 'manifestSHA256': args.manifest_sha256},
                               manifest['plan']['identities'])
    parent = pathlib.Path(args.parent_path).read_bytes()
    require(sha(parent) == args.parent_sha256 == manifest['plan']['identities']['basePolicy']['weightsSHA256'], 'parent identity mismatch')
    model = Net(); model.load_flat(torch.frombuffer(bytearray(parent), dtype=torch.float32).clone())
    return {'loadedDecisions': len(data['samples']), 'loadedParameters': model.flat().numel(),
            'optimizerSteps': 0, 'forwardPasses': 0, 'scope': 'load-only, not update0 or training'}


def engineering_path(value):
    from distill_learner import require
    path = pathlib.Path(value)
    if not path.is_absolute(): path = ROOT / path
    require(path.is_relative_to(ROOT) and '..' not in path.parts, 'engineering path outside repository')
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'engineering path symlink')
    require(path == path.resolve(), 'engineering path is not canonical')
    return path


def engineering_inputs(args):
    """Validate fixed fixture and registered parent metadata, without reading weights.
    The surrounding M9 receipt binds the actual accepted index/inputs and authority.
    """
    from distill_learner import load_frozen_dataset, read_json, sha, require
    require(all([args.dataset, args.manifest_sha256, args.parent_path, args.parent_sha256]),
            'engineering-load-only requires explicit accepted dataset and parent paths/SHA')
    directory = engineering_path(args.dataset)
    require(directory == ROOT / 'deliverables/ohuo-batches/B09/fixture/dataset', 'engineering fixture path mismatch')
    mp, sp = engineering_path(directory / 'manifest.json'), engineering_path(directory / 'samples.jsonl')
    raw = mp.read_bytes(); manifest = read_json(raw)
    require(manifest['plan']['purpose'] == 'engineering_fixture', 'engineering_fixture purpose required')
    require(manifest['qualification']['eligible'] is False, 'engineering fixture requires eligible=false')
    manifest_sha = sha(raw)
    require(manifest_sha == args.manifest_sha256 == 'd10099ff80b33a613357410dfd768f0a1f77332a439e927eb686fe14c2b868e1',
            'engineering manifest SHA mismatch')
    samples = sp.read_bytes(); samples_sha = sha(samples)
    require(samples_sha == '53e5154f22ffddf2e7304ccb694625f2ede8615b94dc9d3d1b083d12e9b5243e' and len(samples) == 27401,
            'engineering samples SHA/bytes mismatch')
    data = load_frozen_dataset({'directory': str(directory), 'manifestSHA256': manifest_sha},
                               manifest['plan']['identities'], synthetic=True)
    counts = [len(row['candidateIds']) for row in data['samples']]
    require(data['manifest']['datasetId'] == 'B09-synthetic' and len(data['samples']) == 3 and counts == [3, 2, 3],
            'engineering fixture identity/counts changed')
    index_path = engineering_path(ROOT / 'lab/model-index.json')
    index_raw = index_path.read_bytes(); index = read_json(index_raw)
    require(index.get('schemaVersion') == 'gd-model-index-v1', 'registered parent index schema')
    policy_id = 'r62-p8c-control-u1400-greedy'
    entries = [p for p in index['policies'] if p.get('policyId') == policy_id]
    require(len(entries) == 1, 'registered parent policy identity missing/ambiguous')
    parent = entries[0]
    expected = {'inputDim': 399, 'parameterCount': 168449,
                'architectureId': 'mlp-tanh-256x256-scalar-v1',
                'weightsLayoutVersion': 'f32le-layer-w-row-major-then-b-v1',
                'weightsSHA256': 'd05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081'}
    require(all(parent.get(key) == value for key, value in expected.items()), 'registered parent metadata/identity mismatch')
    node_path = 'lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32'
    require(parent.get('weightsPathOrUrl', {}).get('nodePath') == node_path, 'registered parent path mismatch')
    parent_path = engineering_path(args.parent_path)
    require(parent_path == ROOT / node_path, 'engineering parent path mismatch')
    require(args.parent_sha256 == parent['weightsSHA256'], 'engineering declared parent identity mismatch')
    require(sys.byteorder == 'little', 'engineering f32le requires little-endian runtime')
    return {'data': data, 'directory': directory, 'manifestSHA256': manifest_sha,
            'samplesSHA256': samples_sha, 'candidateCounts': counts, 'parentPath': parent_path,
            'parent': parent, 'modelIndexSHA256': sha(index_raw)}


def engineering_flat_bytes(flat):
    # Byte view preserves f32 bits/order without a NumPy bridge or float recast.
    return bytes(flat.view(torch.uint8).tolist())


def engineering_load(args):
    from distill_learner import sha, require, Net
    checked = engineering_inputs(args)
    # Only now read the separately authorized, fixed real parent in place.
    parent = checked['parentPath'].read_bytes()
    require(len(parent) == 673796 and sha(parent) == checked['parent']['weightsSHA256'],
            'engineering parent content SHA/bytes mismatch')
    flat = torch.frombuffer(bytearray(parent), dtype=torch.float32).clone()
    require(flat.numel() == 168449 and bool(torch.isfinite(flat).all()), 'engineering finite parent flat required')
    model = Net(); model.load_flat(flat)
    loaded_flat = model.flat(); loaded = engineering_flat_bytes(loaded_flat)
    require(loaded_flat.numel() == 168449 and loaded == parent, 'engineering load-flat roundtrip mismatch')
    return {'checkId': 'B10.engineering-load-only', 'mode': 'engineering_load_only',
            'actualPython': {'executable': sys.executable, 'version': sys.version}, 'actualTorch': torch.__version__,
            'datasetId': 'B09-synthetic', 'datasetPath': str(checked['directory']),
            'datasetRef': {'id': 'B09-synthetic', 'sha256': checked['manifestSHA256']},
            'manifestSHA256': checked['manifestSHA256'], 'samplesSHA256': checked['samplesSHA256'],
            'loadedDecisions': len(checked['data']['samples']), 'candidateCounts': checked['candidateCounts'],
            'modelIndexSHA256': checked['modelIndexSHA256'],
            'actualParentPolicyRef': {'policyId': checked['parent']['policyId'], 'weightsSHA256': sha(parent)},
            'actualParentPath': str(checked['parentPath']), 'actualParentSHA256': sha(parent), 'actualParentBytes': len(parent),
            'loadedParameters': loaded_flat.numel(), 'loadedFlatSHA': sha(loaded),
            'fixtureParentPolicyRef': checked['data']['manifest']['plan']['identities']['basePolicy'],
            'fixtureParentBindingUnchanged': True, 'datasetPurpose': 'engineering_fixture', 'datasetEligible': False,
            'stage4EligibilityEstablished': False, 'scientificPairCompatibility': 'not_asserted',
            'forwardPasses': 0, 'optimizerSteps': 0, 'realAssets': True, 'realTraining': False,
            'scope': 'separate engineering fixture/parent load-only; not scientific pairing, update0 or training'}


def main(argv=None):
    parser = argparse.ArgumentParser(); parser.add_argument('--case', choices=['loss-mask', 'optimizer-isolation', 'resume-two-step', 'local-load-only', 'engineering-load-only'], required=True)
    for name in ['dataset', 'manifest-sha256', 'parent-path', 'parent-sha256']: parser.add_argument('--' + name)
    args = parser.parse_args(argv)
    torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.use_deterministic_algorithms(True)
    if args.case == 'engineering-load-only':
        result = engineering_load(args); mode = 'engineering_load_only'
    elif args.case == 'local-load-only':
        result = local_load(args); mode = 'local_load_only'
    else:
        result = run(args.case); mode = 'finite_synthetic'
    print(json.dumps({'checkId': 'B10.' + args.case, 'passed': True, 'mode': mode,
                      'realAssets': args.case in ('local-load-only', 'engineering-load-only'), 'realTraining': False, 'result': result}, allow_nan=False))


if __name__ == '__main__':
    main()
