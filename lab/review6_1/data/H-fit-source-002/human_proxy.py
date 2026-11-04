#!/usr/bin/env python3
"""One preregistered three-epoch behavior fit; exact equivalence-set likelihood.
Uses the existing CPU Torch runtime and standard library. No NumPy is required.
The training entry is added only after data and source contracts are verified.
"""
import argparse
import array
import hashlib
import importlib.util
import json
import math
import os
import random
import sys
import subprocess
import time
from collections import Counter, defaultdict
from pathlib import Path
import torch

STATE_DIM, ACTION_DIM, INPUT_DIM = 331, 68, 399

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write_new(path, value):
    with open(path, 'x', encoding='utf8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')

def checked_targets(indices, count):
    if not indices or len(set(indices)) != len(indices) or any(type(i) is not int or i < 0 or i >= count for i in indices):
        raise ValueError('invalid equivalence target set')
    return indices

def target_nll(scores, indices):
    checked_targets(indices, scores.numel())
    return -torch.logsumexp(torch.log_softmax(scores.reshape(-1), dim=0)[indices], dim=0)

def frequency_probabilities(kinds, prior):
    counts = Counter(kinds)
    normalizer = sum(prior[kind] for kind in counts)
    if normalizer <= 0:
        raise ValueError('frequency baseline has no legal support')
    probabilities = [prior[kind] / normalizer / counts[kind] for kind in kinds]
    if abs(sum(probabilities) - 1) > 1e-10:
        raise ValueError('frequency baseline is not normalized')
    return probabilities

def read_dataset(path, metadata):
    if sys.byteorder != 'little':
        raise ValueError('this frozen f32 contract requires little-endian runtime')
    raw = bytearray(Path(path).read_bytes())
    values = torch.frombuffer(raw, dtype=torch.float32)
    if not torch.isfinite(values).all():
        raise ValueError('nonfinite feature data')
    offset, decisions = 0, []
    for row in metadata:
        state = values[offset:offset + STATE_DIM]
        offset += STATE_DIM
        n_float, t_float = values[offset:offset + 2].tolist()
        offset += 2
        n, t = int(n_float), int(t_float)
        if n_float != n or t_float != t or n < 1 or t < 1 or t > n or n != row['nCandidates']:
            raise ValueError('candidate/target count mismatch')
        original = values[offset:offset + t].tolist()
        indices = [int(value) for value in original]
        if original != indices or checked_targets(indices, n) != row['targetIndices']:
            raise ValueError('target index identity mismatch')
        offset += t
        actions = values[offset:offset + n * ACTION_DIM].reshape(n, ACTION_DIM)
        offset += n * ACTION_DIM
        if state.numel() != STATE_DIM or len(row['kinds']) != n:
            raise ValueError('feature metadata shape mismatch')
        decisions.append((state, actions, indices))
    if offset != values.numel():
        raise ValueError('unexpected trailing or missing f32 values')
    return decisions

def input_tensor(decision):
    state, actions, _ = decision
    return torch.cat((state.expand(actions.shape[0], STATE_DIM), actions), dim=1)

def load_inputs(manifest_path):
    manifest = json.loads(Path(manifest_path).read_text())
    if manifest['schemaVersion'] != 'r6-H-feature-manifest-v1' or manifest['trainingUpdates'] != 0 or manifest['parent']['inputDim'] != INPUT_DIM:
        raise ValueError('unqualified H feature manifest')
    for file in manifest['files'] + manifest['sourceFiles']:
        if sha(file['path']) != file['sha256']:
            raise ValueError('H input or source changed')
    directory = Path(manifest_path).resolve().parent
    metadata = {split: json.loads((directory / (split + '-metadata.json')).read_text()) for split in ('train', 'dev', 'holdout')}
    source_splits, seen = {}, set()
    for split, rows in metadata.items():
        if len(rows) != manifest['counts'][split]:
            raise ValueError('H input denominator mismatch')
        for row in rows:
            if row['decisionId'] in seen:
                raise ValueError('duplicate H decision')
            seen.add(row['decisionId'])
            old = source_splits.setdefault(row['sourceMatchId'], split)
            if old != split:
                raise ValueError('source match crosses H splits')
    datasets = {split: read_dataset(directory / (split + '.f32'), rows) for split, rows in metadata.items()}
    parent = torch.frombuffer(bytearray((directory / 'clean-parent.f32').read_bytes()), dtype=torch.float32).clone()
    if parent.numel() != 168449 or not torch.isfinite(parent).all() or sha(directory / 'clean-parent.f32') != manifest['parent']['weightsSHA256']:
        raise ValueError('clean migrated parent mismatch')
    return manifest, metadata, datasets, parent

def load_network(source, parent):
    spec = importlib.util.spec_from_file_location('review6_frozen_proxy_network', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    model = module.Net(INPUT_DIM)
    model.load_flat(parent)
    return model

def parent_equivalence(model, dataset, probe):
    maximum = 0.0
    with torch.no_grad():
        for row in probe['rows']:
            actual = model(input_tensor(dataset[row['index']])).reshape(-1)
            expected = torch.tensor(row['scores'], dtype=torch.float32)
            if actual.shape != expected.shape:
                raise ValueError('parent forward shape mismatch')
            maximum = max(maximum, float((actual - expected).abs().max()))
    if maximum > 1e-5:
        raise ValueError('TS/Python parent forward mismatch')
    return maximum

def match_bootstrap(rows, baseline, replicates, coverage, seed):
    groups = defaultdict(lambda: [0.0, 0])
    for row in rows:
        groups[row['sourceMatchId']][0] += row['nll'] - row[baseline]
        groups[row['sourceMatchId']][1] += 1
    ordered = [groups[key] for key in sorted(groups)]
    if len(ordered) < 2:
        raise ValueError('insufficient source clusters')
    sums = torch.tensor([row[0] for row in ordered], dtype=torch.float64)
    counts = torch.tensor([row[1] for row in ordered], dtype=torch.float64)
    generator = torch.Generator().manual_seed(seed)
    indices = torch.randint(len(ordered), (replicates, len(ordered)), generator=generator)
    draws = sums[indices].sum(1) / counts[indices].sum(1)
    alpha = (1 - coverage) / 2
    low, high = torch.quantile(draws, torch.tensor([alpha, 1 - alpha], dtype=torch.float64)).tolist()
    return {'point': float(sums.sum() / counts.sum()), 'low': low, 'high': high, 'sourceMatches': len(ordered), 'replicates': replicates, 'coverage': coverage, 'method': 'percentile_source_match_cluster_pooled_decision_mean'}

def quality_decision(metrics, gates):
    reasons = []
    for baseline in ('uniform', 'frequency'):
        if not metrics['intervals'][baseline]['high'] < 0:
            reasons.append('nll_difference_not_supported_' + baseline)
    for name in ('pass', 'nonpass', 'mate_control', 'bomb', 'takeover'):
        row = metrics['slices'][name]
        if row['n'] < gates['stratumMinimumDecisions'] or row['sourceMatches'] < gates['stratumMinimumSourceMatches']:
            reasons.append('insufficient_stratum_' + name)
        elif row['nll'] - row['frequency'] > gates['stratumMaximumNllWorseThanFrequencyBaselineNats']:
            reasons.append('stratum_worse_than_frequency_' + name)
    for observed, predicted, name in ((metrics['observedPassShare'], metrics['meanPredictedPassProbability'], 'pass'), (1 - metrics['observedPassShare'], 1 - metrics['meanPredictedPassProbability'], 'nonpass')):
        if observed >= gates['observedClassShareTrigger'] and predicted < gates['minimumMeanProbabilityForTriggeredClass']:
            reasons.append('predicted_class_probability_collapse_' + name)
    return {'ready': not reasons, 'reasons': reasons, 'scope': 'behavior proxy on the pinned legal-prefix subset only'}

def batched_set_nll(scores, lengths, targets):
    if len(lengths) != len(targets) or not lengths or sum(lengths) != scores.numel():
        raise ValueError('invalid loss batch')
    offset, losses = 0, []
    for n, target in zip(lengths, targets):
        losses.append(target_nll(scores[offset:offset + n], target))
        offset += n
    return torch.stack(losses).mean()

def batch_loss(model, dataset, indices):
    decisions = [dataset[i] for i in indices]
    scores = model(torch.cat([input_tensor(row) for row in decisions])).reshape(-1)
    return batched_set_nll(scores, [row[1].shape[0] for row in decisions], [row[2] for row in decisions])

def save_f32_new(path, values):
    data = array.array('f', values.tolist())
    if sys.byteorder != 'little':
        data.byteswap()
    with open(path, 'xb') as stream:
        data.tofile(stream)
        stream.flush(); os.fsync(stream.fileno())

def summarize(rows):
    n = len(rows)
    return {'n': n, 'sourceMatches': len({row['sourceMatchId'] for row in rows}), **{key: sum(row[key] for row in rows) / n if n else None for key in ('nll', 'uniform', 'frequency', 'correctTop1')}}

def evaluate(model, dataset, metadata, prior, output):
    rows, raw_scores = [], []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(dataset), 32):
            decisions = dataset[start:start + 32]
            scores = model(torch.cat([input_tensor(row) for row in decisions])).reshape(-1)
            offset = 0
            for j, decision in enumerate(decisions):
                meta, targets = metadata[start + j], decision[2]
                n = decision[1].shape[0]
                logits = scores[offset:offset + n]; offset += n
                raw_scores.extend(logits.tolist())
                probabilities = torch.softmax(logits, dim=0)
                confidence, top = probabilities.max(0)
                baseline = frequency_probabilities(meta['kinds'], prior)
                if any(meta['kinds'][i] != meta['actualKind'] for i in targets):
                    raise ValueError('target equivalence changes declared kind')
                is_pass = meta['actualKind'] == 'pass'
                pass_probability = sum(float(probabilities[i]) for i, kind in enumerate(meta['kinds']) if kind == 'pass')
                rows.append({'decisionId': meta['decisionId'], 'sourceMatchId': meta['sourceMatchId'], 'actualKind': meta['actualKind'], 'strata': meta['strata'], 'nCandidates': n,
                             'nll': float(target_nll(logits, targets)), 'uniform': math.log(n / len(targets)), 'frequency': -math.log(sum(baseline[i] for i in targets)),
                             'observedPass': is_pass, 'predictedPassProbability': pass_probability, 'hardTop1Pass': meta['kinds'][int(top)] == 'pass',
                             'correctTop1': int(top) in targets, 'top1Confidence': float(confidence)})
    save_f32_new(str(output) + '-logits.f32', torch.tensor(raw_scores, dtype=torch.float32))
    with open(str(output) + '-rows.jsonl', 'x', encoding='utf8') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
    return rows

def evaluation_metrics(rows, recipe):
    base = summarize(rows)
    n = len(rows)
    masks = {'pass': lambda row: row['observedPass'], 'nonpass': lambda row: not row['observedPass'],
             'mate_control': lambda row: row['strata']['mateControl'], 'bomb': lambda row: row['actualKind'] in ('bomb', 'joker_bomb'), 'takeover': lambda row: row['strata']['takeover']}
    slices = {name: summarize([row for row in rows if predicate(row)]) for name, predicate in masks.items()}
    kinds = {kind: summarize([row for row in rows if row['actualKind'] == kind]) for kind in sorted({row['actualKind'] for row in rows})}
    observed = sum(row['observedPass'] for row in rows) / n
    mean_predicted = sum(row['predictedPassProbability'] for row in rows) / n
    hard = sum(row['hardTop1Pass'] for row in rows) / n
    pass_bins, top_bins = [], []
    for b in range(10):
        for field, outcome, result in (('predictedPassProbability', 'observedPass', pass_bins), ('top1Confidence', 'correctTop1', top_bins)):
            group = [row for row in rows if min(9, int(row[field] * 10)) == b]
            result.append({'bin': b, 'n': len(group), 'meanProbability': sum(row[field] for row in group) / len(group) if group else None, 'observedShare': sum(row[outcome] for row in group) / len(group) if group else None})
    result = {**base, 'slices': slices, 'actionKinds': kinds,
              'intervals': {name: match_bootstrap(rows, name, recipe['bootstrapReplicates'], recipe['twoSidedCoverage'], recipe['bootstrapSeed']) for name in ('uniform', 'frequency')},
              'observedPassShare': observed, 'meanPredictedPassProbability': mean_predicted, 'hardTop1PassShare': hard, 'hardTop1PassMinusObserved': hard - observed,
              'hardTop1ClassAbsent': {'pass': hard == 0 and observed >= .05, 'nonpass': hard == 1 and 1 - observed >= .05},
              'calibration': {'passBrier': sum((row['predictedPassProbability'] - row['observedPass']) ** 2 for row in rows) / n, 'passBins': pass_bins, 'top1Bins': top_bins,
                              'top1ECE': sum(row['n'] / n * abs(row['meanProbability'] - row['observedShare']) for row in top_bins if row['n'])}}
    result['quality'] = quality_decision(result, recipe['qualityGates'])
    return result

def validate_worker_launch(args, contract):
    if Path(args.output).resolve() != Path(contract['outputDirectory']).resolve():
        raise ValueError('H output identity differs from the once-only contract')
    if not args.launch_receipt:
        raise ValueError('direct Python fit has no guarded launch receipt')
    if sha(contract['guardPath']) != contract['guardSHA256']:
        raise ValueError('frozen H worker guard changed')
    checked = subprocess.run([contract['nodeAbsolutePath'], contract['guardPath'], 'verify-worker-launch', args.launch_receipt], capture_output=True, text=True, timeout=10)
    if checked.returncode != 0:
        raise ValueError('H original budget/approval/anchor guard rejected: ' + checked.stderr.strip())
    launch = json.loads(checked.stdout)
    if launch['stageStatus'] != 'H_worker_launch_authorized' or launch['parentPid'] != os.getppid() or launch['contractSHA256'] != sha(args.contract):
        raise ValueError('H worker is not a child of its authorized original-budget launch')
    for key, actual in (('outputDirectory', args.output), ('trainerPath', __file__), ('manifestPath', args.manifest), ('networkSourcePath', args.network_source)):
        if Path(launch[key]).resolve() != Path(actual).resolve():
            raise ValueError('H worker argument identity changed: ' + key)
    return launch

def load_contract(args):
    contract = json.loads(Path(args.contract).read_text())
    if contract['epochs'] != 3 or contract['fits'] != 1 or contract['batchSize'] != 32 or contract['device'] != 'cpu' or contract['torchThreads'] != 2:
        raise ValueError('H once-only fixed recipe changed')
    if args.mode == 'fit':
        validate_worker_launch(args, contract)
    for entry in contract['pinnedFiles']:
        if sha(entry['path']) != entry['sha256']:
            raise ValueError('frozen H contract source/input changed: ' + entry['path'])
    if sha(__file__) != contract['trainerSHA256'] or sha(args.network_source) != contract['networkSourceSHA256'] or sha(args.manifest) != contract['manifestSHA256']:
        raise ValueError('H was not executed from the frozen source/input')
    torch.manual_seed(contract['seed']); random.seed(contract['seed']); torch.use_deterministic_algorithms(True)
    return contract

def preflight(args):
    started = time.monotonic()
    contract = load_contract(args)
    manifest, metadata, datasets, parent = load_inputs(args.manifest)
    model = load_network(args.network_source, parent)
    maximum = parent_equivalence(model, datasets['train'], json.loads(Path(args.probe).read_text()))
    before = model.flat().clone()
    t0 = time.monotonic()
    count = min(64, len(datasets['train']))
    for start in range(0, count, 32):
        model.zero_grad(); loss = batch_loss(model, datasets['train'], list(range(start, min(start + 32, count))))
        loss.backward()
        if not torch.isfinite(loss) or any(parameter.grad is None or not torch.isfinite(parameter.grad).all() for parameter in model.parameters()):
            raise ValueError('H preflight loss/gradient nonfinite')
    elapsed = time.monotonic() - t0
    if not torch.equal(before, model.flat()):
        raise ValueError('preflight mutated clean parent')
    train_estimate = elapsed / count * len(datasets['train']) * 3
    evaluation_estimate = elapsed / count * (len(datasets['dev']) + len(datasets['holdout']))
    conservative = max(120., 2 * (train_estimate + evaluation_estimate))
    result = {'stageStatus': 'preflight_passed', 'at': time.time(), 'fitId': contract['fitId'], 'manifestSHA256': sha(args.manifest), 'contractSHA256': sha(args.contract),
              'python': sys.executable, 'torch': str(torch.__version__), 'device': 'cpu', 'torchThreads': torch.get_num_threads(), 'parentForwardMaximumAbsoluteDifference': maximum,
              'benchmarkTrainDecisions': count, 'benchmarkForwardBackwardSeconds': elapsed, 'trainingUpdates': 0, 'parametersUnchanged': True,
              'estimatedFullFitSeconds': conservative, 'shutdownReserveSeconds': 120, 'planningOverheadFraction': .25, 'requiredReservationSeconds': math.ceil((conservative + 120) * 1.25),
              'totalPreflightSeconds': time.monotonic() - started, 'heldoutModelScoresOpened': False}
    write_new(args.output, result)
    return result

def fit(args):
    started = time.monotonic()
    contract = load_contract(args)
    manifest, metadata, datasets, parent = load_inputs(args.manifest)
    out = Path(args.output)
    out.mkdir(exist_ok=True)
    opened = out / 'fit-opened.json'
    identity = {'fitId': contract['fitId'], 'contractSHA256': sha(args.contract), 'manifestSHA256': sha(args.manifest), 'parentSHA256': manifest['parent']['weightsSHA256']}
    if opened.exists():
        prior_opened = json.loads(opened.read_text())
        if any(prior_opened[key] != value for key, value in identity.items()):
            raise ValueError('cannot replace or restart the once-only fit')
    else:
        write_new(opened, {**identity, 'at': time.time(), 'epochs': 3, 'freshTrainingDecisions': len(datasets['train']), 'heldoutModelScoresOpened': False})
    model = load_network(args.network_source, parent)
    optimizer = torch.optim.RMSprop(model.parameters(), lr=1e-4, alpha=.9, eps=1e-5, momentum=0, centered=False, weight_decay=0)
    epoch, updates = 0, 0
    for number in range(1, 4):
        meta_path = out / ('checkpoint-epoch%d.json' % number)
        if meta_path.exists():
            checkpoint_meta = json.loads(meta_path.read_text())
            if checkpoint_meta['contractSHA256'] != identity['contractSHA256'] or sha(checkpoint_meta['path']) != checkpoint_meta['sha256']:
                raise ValueError('resume checkpoint identity changed')
            checkpoint = torch.load(checkpoint_meta['path'], map_location='cpu', weights_only=True)
            model.load_state_dict(checkpoint['model']); optimizer.load_state_dict(checkpoint['optimizer']); torch.set_rng_state(checkpoint['torchRng'])
            epoch, updates = checkpoint['epoch'], checkpoint['updates']
        elif (out / ('epoch%d-opened.json' % number)).exists():
            raise ValueError('incomplete epoch: do not silently replay updates or restart the once-only fit')
    model.train()
    while epoch < 3:
        epoch += 1
        write_new(out / ('epoch%d-opened.json' % epoch), {**identity, 'epoch': epoch, 'startingUpdates': updates, 'at': time.time()})
        generator = torch.Generator().manual_seed(contract['seed'] + epoch)
        order = torch.randperm(len(datasets['train']), generator=generator).tolist()
        total, epoch_started = 0., time.monotonic()
        for start in range(0, len(order), 32):
            indices = order[start:start + 32]
            optimizer.zero_grad(); loss = batch_loss(model, datasets['train'], indices)
            loss.backward()
            if not torch.isfinite(loss) or any(parameter.grad is None or not torch.isfinite(parameter.grad).all() for parameter in model.parameters()):
                raise ValueError('nonfinite H loss/gradient')
            optimizer.step(); updates += 1
            if any(not torch.isfinite(parameter).all() for parameter in model.parameters()):
                raise ValueError('nonfinite H parameters')
            total += float(loss.detach()) * len(indices)
        checkpoint_path = out / ('checkpoint-epoch%d.pt' % epoch)
        with open(checkpoint_path, 'xb') as stream:
            torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'torchRng': torch.get_rng_state(), 'epoch': epoch, 'updates': updates, **identity}, stream)
            stream.flush(); os.fsync(stream.fileno())
        receipt = {**identity, 'epoch': epoch, 'updates': updates, 'meanTrainNll': total / len(order), 'epochSeconds': time.monotonic() - epoch_started, 'path': str(checkpoint_path.resolve()), 'sha256': sha(checkpoint_path)}
        write_new(out / ('checkpoint-epoch%d.json' % epoch), receipt)
        print(json.dumps(receipt, allow_nan=False), flush=True)
    final = model.flat()
    weights_path = out / 'H-epoch3.f32'
    if not weights_path.exists():
        save_f32_new(weights_path, final)
    elif not torch.equal(torch.frombuffer(bytearray(weights_path.read_bytes()), dtype=torch.float32), final):
        raise ValueError('completed H weights changed')
    quality_path = out / 'proxy-quality.json'
    if quality_path.exists():
        return json.loads(quality_path.read_text())
    quality_opened = out / 'quality-opened.json'
    if quality_opened.exists():
        raise ValueError('quality read was interrupted; independently reconcile the same frozen scores, never refit')
    write_new(quality_opened, {**identity, 'weightsSHA256': sha(weights_path), 'at': time.time(), 'epochsCompleted': epoch, 'updates': updates})
    prior = defaultdict(lambda: 1.)
    for row in metadata['train']:
        prior[row['actualKind']] += 1.
    write_new(out / 'frequency-prior.json', {'fitSplit': 'train', 'smoothing': 1, 'countsPlusOne': dict(prior), 'normalization': 'unique legal kinds, then uniform among candidates of that kind'})
    reports = {}
    for split in ('dev', 'holdout'):
        rows = evaluate(model, datasets[split], metadata[split], prior, out / split)
        reports[split] = evaluation_metrics(rows, contract)
        write_new(out / (split + '-metrics.json'), reports[split])
    result = {**identity, 'stageStatus': 'H_quality_measured', 'epochs': epoch, 'trainingUpdates': updates, 'uniqueTrainingDecisions': len(datasets['train']), 'trainingExposures': 3 * len(datasets['train']),
              'weightsPath': str(weights_path.resolve()), 'weightsSHA256': sha(weights_path), 'parameterDeltaL2': float(torch.linalg.vector_norm(final - parent)), 'totalExecutionSeconds': time.monotonic() - started,
              'role': 'behavior_proxy', 'humanSource': 'author_reported', 'skill': 'unknown', 'playerDisjointness': 'unknown', 'samplingMode': 'legal_softmax_temperature1',
              'scope': 'fresh legal-prefix, candidate-covered behavior only; no whole-match human compatibility or player skill claim', 'dev': reports['dev'], 'holdout': reports['holdout'], 'ready': reports['holdout']['quality']['ready']}
    write_new(quality_path, result)
    return result

def selftest():
    scores = torch.zeros(3, requires_grad=True)
    loss = target_nll(scores, [0, 1])
    loss.backward()
    assert abs(float(loss.detach()) + math.log(2 / 3)) < 1e-6
    assert scores.grad[0] < 0 and scores.grad[1] < 0 and scores.grad[2] > 0
    probabilities = frequency_probabilities(['pass', 'pair', 'pair'], {'pass': .5, 'pair': .5})
    assert probabilities == [.5, .25, .25]
    for invalid in ([], [0, 0], [3]):
        try:
            target_nll(torch.zeros(3), invalid)
            raise AssertionError('malformed target accepted')
        except ValueError:
            pass
    rows = [{'sourceMatchId': 'a', 'nll': 0., 'baseline': 2.}] + [{'sourceMatchId': 'b', 'nll': .2, 'baseline': 0.} for _ in range(9)]
    interval = match_bootstrap(rows, 'baseline', 20000, .975, 61)
    assert abs(interval['point'] + .02) < 1e-10 and interval['high'] > 0
    gates = {'stratumMinimumDecisions': 30, 'stratumMinimumSourceMatches': 5, 'stratumMaximumNllWorseThanFrequencyBaselineNats': .1, 'observedClassShareTrigger': .05, 'minimumMeanProbabilityForTriggeredClass': .01}
    valid = {'intervals': {'uniform': {'high': -.01}, 'frequency': {'high': -.01}}, 'slices': {key: {'n': 30, 'sourceMatches': 5, 'nll': 1., 'frequency': 1.} for key in ('pass', 'nonpass', 'mate_control', 'bomb', 'takeover')}, 'observedPassShare': .5, 'meanPredictedPassProbability': .5}
    assert quality_decision(valid, gates)['ready']
    import copy
    bad = copy.deepcopy(valid); bad['intervals']['frequency']['high'] = 0
    assert not quality_decision(bad, gates)['ready']
    bad = copy.deepcopy(valid); bad['slices']['bomb']['sourceMatches'] = 4
    assert not quality_decision(bad, gates)['ready']
    bad = copy.deepcopy(valid); bad['meanPredictedPassProbability'] = .999
    assert not quality_decision(bad, gates)['ready']
    batch_scores = torch.tensor([0., 0., 0., 4., 4.], requires_grad=True)
    batch_loss = batched_set_nll(batch_scores, [3, 2], [[0, 1], [0]])
    assert abs(float(batch_loss.detach()) - (math.log(1.5) + math.log(2)) / 2) < 1e-6
    batch_loss.backward()
    assert batch_scores.grad[0] < 0 < batch_scores.grad[2] and batch_scores.grad[3] < 0 < batch_scores.grad[4]
    from types import SimpleNamespace
    for args, contract in ((SimpleNamespace(output='/tmp/other-H-output', launch_receipt=None), {'outputDirectory': '/tmp/expected-H-output'}), (SimpleNamespace(output='/tmp/expected-H-output', launch_receipt=None), {'outputDirectory': '/tmp/expected-H-output'})):
        try:
            validate_worker_launch(args, contract)
            raise AssertionError('unguarded direct Python fit accepted')
        except ValueError:
            pass
    return {'stageStatus': 'selftest_passed', 'tests': ['equivalence_set_loss_and_gradient', 'normalized_same_support_frequency_baseline', 'invalid_targets_reject', 'source_cluster_pooled_bootstrap', 'quality_gate_controls', 'batched_equivalence_loss_and_gradient', 'direct_worker_wrong_output_and_missing_launch_reject'], 'trainingUpdates': 0, 'humanDataRead': False}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['selftest', 'preflight', 'fit'])
    parser.add_argument('--contract'); parser.add_argument('--manifest'); parser.add_argument('--network-source'); parser.add_argument('--probe'); parser.add_argument('--output')
    parser.add_argument('--launch-receipt')
    args = parser.parse_args()
    torch.set_num_threads(2)
    if args.mode == 'selftest':
        print(json.dumps(selftest(), allow_nan=False))
    elif args.mode == 'preflight':
        print(json.dumps(preflight(args), allow_nan=False))
    else:
        result = fit(args)
        print(json.dumps({'stageStatus': result['stageStatus'], 'epochs': result['epochs'], 'trainingUpdates': result['trainingUpdates'], 'ready': result['ready']}, allow_nan=False))

if __name__ == '__main__':
    main()
