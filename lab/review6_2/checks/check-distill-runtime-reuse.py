"""Bounded runtime reuse fixtures. Synthetic tensors only; no research inputs."""
import argparse
import copy
import importlib.util
import json
import pathlib
import os
import shlex
import subprocess
import tempfile
import sys
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'lab/review6_2'))
import torch
import distill_learner as dl

torch.set_num_threads(2)

def fixture():
    spec = importlib.util.spec_from_file_location('first_round_fixture', pathlib.Path(__file__).with_name('check-first-round-learner.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    rows, flat, refs, identities = module.fixture()
    refs['recipe'] = copy.deepcopy(dl.FIRST_ROUND_R2_RECIPE)
    net = dl.Net(423); net.load_flat(flat)
    with torch.no_grad():
        for row in rows:
            row['provenance']['samplingRef'] = 'synthetic@sha256:' + 'a' * 64
            q = net(torch.tensor(row['candidateFeatures'])).reshape(-1).tolist()
            row['rawQ'] = q
            row['baseActionId'] = row['candidateIds'][min(range(len(q)), key=lambda i: (-q[i], row['candidateOriginalIndices'][i]))]
    return rows, flat, refs, identities


def make(rows, flat, refs):
    return dl.DistillLearner(rows, flat, refs, 35, recipe=refs['recipe'], input_contract=dl.STUDENT_INPUT_CONTRACT)


def reference_metrics(learner):
    import array
    weights = array.array('f', learner.model.flat().tolist())
    if sys.byteorder != 'little': weights.byteswap()
    return {**learner.evaluate_dev(), 'weightsSHA256': dl.sha(weights.tobytes()),
            'train': learner.evaluate_split('train'),
            'families': {split: {family: learner.evaluate_split(split, family)
                for family in sorted({r['sourceFamily'] for r in learner.rows if r['split'] == split})}
                for split in ('train', 'dev')}}


def evaluation():
    rows, flat, refs, _ = fixture(); learner = make(rows, flat, refs)
    expected = reference_metrics(learner)
    calls = []
    handle = learner.model.register_forward_hook(lambda *args: calls.append(1))
    actual = learner.evaluate_milestone(); handle.remove()
    assert actual == expected, 'pooled/family metrics or ordering changed'
    assert len(calls) == len(rows), ('milestone forward count', len(calls), len(rows))
    # A changed model must be evaluated afresh; no outputs survive an invocation.
    with torch.no_grad():
        learner.model.f[0].weight[0,399] = .5
        learner.model.f[2].weight[0,0] = .5
        learner.model.f[4].weight[0,0] = .5
    expected = reference_metrics(learner)
    assert expected['demoCE'] != actual['demoCE'], 'fixture mutation must affect outputs'
    assert learner.evaluate_milestone() == expected
    # Update0 must execute both equivalence checks on the shared outputs.
    fresh = make(rows, flat, refs); calls = []
    handle = fresh.model.register_forward_hook(lambda *args: calls.append(1))
    initial = fresh.evaluate_milestone(check_initial=True); handle.remove()
    assert len(calls) == len(rows) and initial['equivalence']['decisions'] == len(rows)
    fresh.rows[0]['rawQ'][0] += .1
    rejected(lambda: fresh.evaluate_milestone(check_initial=True), 'rawQ differs')
    fresh.rows[0]['rawQ'][0] -= .1; fresh.rows[0]['baseActionId'] = 'a1'
    rejected(lambda: fresh.evaluate_milestone(check_initial=True), 'greedy differs')
    print(json.dumps({'case': 'evaluation', 'decisions': len(rows), 'milestoneForwards': len(calls), 'metricsExact': True, 'update0Forwards':len(calls), 'equivalenceRejections':True}))


def rejected(fn, fragment):
    try: fn()
    except ValueError as error: assert fragment in str(error), str(error)
    else: raise AssertionError('missing rejection: ' + fragment)


def static_inputs():
    rows, flat, refs, _ = fixture()
    with patch.object(dl, 'validate_decision', wraps=dl.validate_decision) as validate:
        learner = make(rows, flat, refs)
        learner.evaluate_milestone()
        stats = learner.accumulate(learner.demo, learner.keep, 2)
        learner.evaluate_milestone()
        assert validate.call_count == len(rows), ('frozen input validations', validate.call_count, len(rows))
    # Compare a fresh autograd graph against the original public loss path.
    reference = make(rows, flat, refs); ds, ks = [], []
    for source, out in ((reference.demo, ds), (reference.keep, ks)):
        for row in source:
            x, _ = dl.validate_decision(row, reference.input_contract)
            scores = reference.model(x).reshape(-1)
            out.append(dl.decision_loss(scores, torch.ones_like(scores, dtype=torch.bool), row, 1))
    d, k = torch.stack(ds).sum() / len(ds), torch.stack(ks).sum() / len(ks)
    (d + k).backward()
    assert abs(stats['total'] - float((d + k).detach())) < 1e-6
    for a, b in zip(learner.model.parameters(), reference.model.parameters()):
        assert torch.allclose(a.grad, b.grad, atol=1e-6, rtol=1e-5), 'gradient changed'
    # A second backward must build a fresh graph and reproduce the same gradient.
    before = [p.grad.clone() for p in learner.model.parameters()]
    learner.accumulate(learner.demo, learner.keep, 1)
    assert all(torch.allclose(p.grad, g, atol=1e-6, rtol=1e-5) for p, g in zip(learner.model.parameters(), before))
    bad = copy.deepcopy(rows[0]); bad['candidateFeatures'][0][0] = float('nan')
    rejected(lambda: learner.loss_sums([bad], learner.keep[:1]), 'float32 input')
    bad = learner.demo[0]; old = bad['targetIds']; bad['targetIds'] = ['missing']
    rejected(lambda: learner.loss_sums([bad], learner.keep[:1]), 'target')
    bad['targetIds'] = old
    old_index = bad['candidateOriginalIndices'][0]; bad['candidateOriginalIndices'][0] = False
    rejected(lambda: learner.loss_sums([bad], learner.keep[:1]), 'original indices')
    bad['candidateOriginalIndices'][0] = old_index
    old_feature = bad['candidateFeatures'][11][399]; bad['candidateFeatures'][11][399] = True
    rejected(lambda: learner.loss_sums([bad], learner.keep[:1]), 'float32 input')
    bad['candidateFeatures'][11][399] = old_feature
    # Static cache size is bounded by this learner, and owns no autograd graph.
    static_tensors = [value for item in learner._prepared_decisions.values() for value in vars(item).values() if isinstance(value, torch.Tensor)]
    assert all(not t.requires_grad and t.grad_fn is None for t in static_tensors)
    static_bytes = sum(t.numel() * t.element_size() for t in static_tensors)
    # A restore rechecks its scientific identity and reuses only unchanged input.
    saved = learner.capture_state()
    with patch.object(dl, 'validate_decision', wraps=dl.validate_decision) as validate:
        learner.restore_state(saved)
        assert validate.call_count == 0
    rejected(lambda: learner.restore_state({**saved, 'dataDigest':'changed'}), 'dataDigest changed')
    learner.model.double()
    assert learner.evaluate_milestone()['demoCount'] == 4
    with torch.no_grad(): next(learner.model.parameters()).fill_(float('nan'))
    rejected(lambda: learner.evaluate_milestone(), 'nonfinite valid scores')
    print(json.dumps({'case': 'static_inputs', 'frozenValidations': len(rows), 'freshGradientEquivalent': True,
                      'changedInputsRejected': True, 'dtypeRevalidated': True, 'nonfiniteScoresRejected': True, 'staticTensorBytes':static_bytes, 'cachedAutogradGraphs':0}))


def checkpoint_worker():
    output = ROOT / 'lab/out/v542-runtime-reduction-m2d3nt4l/learner'
    output.mkdir(parents=True, exist_ok=True)
    root = pathlib.Path(tempfile.mkdtemp(prefix='worker-', dir=output))
    wrapper = root / 'owned-worker.py'
    wrapper.write_text("""import atexit,json,os,pathlib,sys
sys.path.insert(0, %r)
import torch
import distill_learner as dl
assert pathlib.Path(sys.argv[-1]).resolve() == pathlib.Path(dl.__file__).resolve()
counts = {'loads':0,'nets':0,'forwards':0,'validations':0}
count_path = pathlib.Path(%r).joinpath(str(os.getpid())+'.counts.json')
def counted(owner,name,key):
    original=getattr(owner,name)
    def call(*args,**kwargs):
        counts[key]+=1
        count_path.write_text(json.dumps(counts))
        return original(*args,**kwargs)
    setattr(owner,name,call)
counted(torch,'load','loads')
counted(dl.Net,'__init__','nets')
counted(dl.Net,'forward','forwards')
counted(dl,'validate_decision','validations')
atexit.register(lambda: count_path.write_text(json.dumps(counts)))
dl.worker_main()
""" % (str(ROOT / 'lab/review6_2'), str(root)))
    launcher = root / 'python-launcher'
    launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(wrapper)) + ' "$@"\n')
    launcher.chmod(0o700)
    env = {key: os.environ[key] for key in ('PATH','LANG','LC_ALL','LC_CTYPE','TZ') if key in os.environ}
    env.update(B10_TEST_PYTHON=str(launcher), B10_FIXTURE_OUTPUT_ROOT=str(root))
    result = subprocess.run(['node','--import','tsx',str(ROOT / 'lab/review6_2/checks/fixtures/b10-host.ts')],
                            cwd=ROOT, env=env, text=True, capture_output=True)
    (root / 'host.stdout').write_text(result.stdout); (root / 'host.stderr').write_text(result.stderr)
    assert result.returncode == 0, result.stdout + result.stderr
    counts = [json.loads(p.read_text()) for p in sorted(root.glob('*.counts.json'), key=lambda p: p.stat().st_mtime_ns)]
    assert len(counts) == 3, counts
    assert [c['loads'] for c in counts] == [1, 1, 1], ('initial, resume, mirror-only torch.load', counts)
    assert counts[0]['forwards'] == 10, ('four update0, two gradient, four milestone forwards', counts[0])
    assert counts[0]['validations'] == 4, ('loader/learner frozen construction', counts[0])
    print(json.dumps({'case':'checkpoint_worker','root':str(root),'realTSConsumerHost':True,
                      'counts':counts,'commitBeforePublishRecovery':True,'partialMirrorsRepaired':True}))


class ProtocolWorker:
    def __init__(self, fixture_root):
        self.root = fixture_root
        self.child = subprocess.Popen([str(fixture_root / 'python-launcher'), '-u', str(ROOT / 'lab/review6_2/distill_learner.py')],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert json.loads(self.child.stdout.readline())['kind'] == 'ready'

    def request(self, command):
        self.child.stdin.write(json.dumps(command) + '\n'); self.child.stdin.flush()
        return json.loads(self.child.stdout.readline())

    def count(self):
        return json.loads((self.root / (str(self.child.pid) + '.counts.json')).read_text())

    def close(self, error=False):
        if not error: assert self.request({'kind':'close'})['kind'] == 'closed'
        self.child.stdin.close()
        stderr = self.child.stderr.read(); code = self.child.wait(timeout=10)
        assert code == (1 if error else 0), (code, stderr)


def checkpoint_boundaries(fixture_root):
    fixture_root = pathlib.Path(fixture_root).resolve()
    assert fixture_root.is_relative_to(ROOT / 'lab/out/v542-runtime-reduction-m2d3nt4l/learner')
    host = json.loads((fixture_root / 'host.stdout').read_text()); host_root = pathlib.Path(host['root'])
    run = host_root / 'runs/run'; ref = json.loads((run / 'latest.json').read_text())
    manifest = json.loads((host_root / 'dataset/manifest.json').read_text())
    summary = json.loads((run / 'summary.json').read_text())
    parent = host_root / 'repo/lab/out/synthetic/B.f32'
    command = {'kind':'init','dataset':{'directory':str(host_root / 'dataset'), 'manifestSHA256':dl.sha((host_root / 'dataset/manifest.json').read_bytes())},
               'identities':manifest['plan']['identities'],'synthetic':True,'parentPath':str(parent),'parentSHA256':dl.sha(parent.read_bytes()),
               'frozenRefs':summary['frozenRefs'],'seed':7,'recipe':dl.RECIPE,'restartRef':None,'runDir':str(run),'checkpoint':ref}
    worker = ProtocolWorker(fixture_root); assert worker.request(command)['kind'] == 'initialized'
    previous = (run / 'previous.json').read_bytes()
    publish = {'kind':'publish','checkpoint':ref}
    assert worker.request(publish)['kind'] == 'published'
    # Missing status is a partial mirror, not a new transaction.
    (run / 'status.json').unlink()
    assert worker.request(publish)['kind'] == 'published'
    assert (run / 'previous.json').read_bytes() == previous
    assert json.loads((run / 'status.json').read_text())['optimizerSteps'] == 2
    assert worker.count()['loads'] == 1, worker.count()
    directory = run / ref['path']
    # Replacing any exact file, even with the same bytes, must do a cold check.
    for expected_loads, name in enumerate(('manifest.json','learner.pt','weights.f32','state.json'), 2):
        path = directory / name; replacement = path.with_name(name + '.fixture-replace')
        replacement.write_bytes(path.read_bytes()); replacement.replace(path)
        assert worker.request(publish)['kind'] == 'published'
        assert worker.count()['loads'] == expected_loads, (name, worker.count())
    worker.close()
    # Every changed byte is checked again on the actual worker publish command.
    for name in ('manifest.json','learner.pt','weights.f32','state.json'):
        worker = ProtocolWorker(fixture_root); assert worker.request(command)['kind'] == 'initialized'
        path = directory / name; original = path.read_bytes(); path.write_bytes(original + b'!')
        reply = worker.request(publish)
        assert reply['kind'] == 'error' and 'SHA' in reply['reason'], (name, reply)
        worker.close(error=True); path.write_bytes(original)
    # Correct outer hashes never substitute for the inner identity check.
    for mismatch in ('identity', 'weights'):
        worker = ProtocolWorker(fixture_root); assert worker.request(command)['kind'] == 'initialized'
        originals = {p.name:p.read_bytes() for p in directory.iterdir()}
        changed = copy.deepcopy(ref); commit = json.loads(originals['manifest.json'])
        if mismatch == 'identity':
            import io
            state = torch.load(io.BytesIO(originals['learner.pt']), weights_only=True)
            state['frozenRefs']['prompt'] = 'changed-synthetic-identity'
            torch.save(state, directory / 'learner.pt')
            commit['files']['learner.pt'] = dl.sha((directory / 'learner.pt').read_bytes())
        else:
            weights = bytearray(originals['weights.f32']); weights[0] ^= 1
            (directory / 'weights.f32').write_bytes(weights)
            facts = json.loads(originals['state.json']); facts['weightsSHA256'] = dl.sha(weights)
            (directory / 'state.json').write_text(json.dumps(facts))
            for name in ('weights.f32','state.json'): commit['files'][name] = dl.sha((directory / name).read_bytes())
        (directory / 'manifest.json').write_text(json.dumps(commit))
        changed['manifestSHA256'] = dl.sha((directory / 'manifest.json').read_bytes())
        reply = worker.request({'kind':'publish','checkpoint':changed})
        want = 'checkpoint inner identity' if mismatch == 'identity' else 'checkpoint weight/state disagreement'
        assert reply == {'kind':'error','reason':want}, reply
        assert worker.count()['loads'] == 2
        worker.close(error=True)
        for name, data in originals.items(): (directory / name).write_bytes(data)
    # A fresh commit has never been disk-validated and must not use restore facts.
    fresh = pathlib.Path(tempfile.mkdtemp(prefix='fresh-commit-', dir=fixture_root))
    worker = ProtocolWorker(fixture_root)
    assert worker.request({**command,'checkpoint':None,'runDir':str(fresh)})['kind'] == 'initialized'
    initial = worker.request({'kind':'save'})['checkpoint']
    assert worker.count()['loads'] == 0
    assert worker.request({'kind':'publish','checkpoint':initial})['kind'] == 'published'
    assert worker.count()['loads'] == 1
    stepped = worker.request({'kind':'step','expectedStep':1,'physicalDecisions':1})['checkpoint']
    assert worker.count()['loads'] == 1
    assert worker.request({'kind':'publish','checkpoint':stepped})['kind'] == 'published'
    assert worker.count()['loads'] == 2
    assert worker.request({'kind':'publish','checkpoint':stepped})['kind'] == 'published'
    assert worker.count()['loads'] == 2
    worker.close()
    print(json.dumps({'case':'checkpoint_boundaries','root':str(fixture_root),'sameRefAndPartialMirrorLoads':1,
                      'allFourFileReplacementsCold':True,'allFourCorruptionsRejected':True,
                      'innerIdentityAndWeightsRejected':True,'newCommitFirstDiskValidationPreserved':True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--case', choices=['evaluation', 'static_inputs', 'checkpoint_worker', 'checkpoint_boundaries'], required=True)
    parser.add_argument('--fixture-root')
    args = parser.parse_args()
    if args.case == 'checkpoint_boundaries': checkpoint_boundaries(args.fixture_root)
    else: globals()[args.case]()
