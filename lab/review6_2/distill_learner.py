"""M7 grouped CE/KL reranker. No RL queues, implicit paths, or teacher calls.
CPU only; the existing task host verifies authority before starting this worker.
"""
import copy
import hashlib
import json
import math
import pathlib
import random
import sys
from collections import defaultdict
import torch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'review6'))
from training_core import Net, make_optimizer
from human_proxy import target_nll

RECIPE = {'recipeId': 'supervised-rerank-v1', 'optimizer': 'RMSprop', 'alpha': .9,
          'eps': 1e-5, 'momentum': 0, 'centered': False, 'weightDecay': 0,
          'learningRate': 1e-4, 'temperature': 1, 'keepWeight': 1,
          'demoBatch': 32, 'keepBatch': 32, 'maxEpochs': 3,
          'initialization': 'fixed-parent-new-optimizer'}


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(data):
    def invalid(value):
        raise ValueError('nonfinite JSON ' + value)
    return json.loads(data, parse_constant=invalid)


def validate_recipe(recipe, restart_ref=None):
    expected = dict(RECIPE)
    if recipe.get('learningRate') == 3e-5:
        require(isinstance(restart_ref, dict) and restart_ref.get('id') and
                len(restart_ref.get('sha256', '')) == 64, 'single restart evidence required')
        expected['learningRate'] = 3e-5
    require(recipe == expected, 'unsupported supervised recipe')


def validate_decision(row):
    require(row.get('sampleKind') in ('demo', 'keep') and row.get('split') in ('train', 'dev'), 'sample branch')
    ids = row.get('candidateIds', []); k = len(ids)
    require(1 <= k <= 8 and all(isinstance(i, str) and i for i in ids) and len(set(ids)) == k, 'candidate IDs')
    original = row.get('candidateOriginalIndices', [])
    require(len(original) == k and len(set(original)) == k and
            all(type(i) is int and 0 <= i <= 9007199254740991 for i in original), 'candidate original indices')
    x = torch.tensor(row.get('candidateFeatures', []), dtype=torch.float32)
    q = torch.tensor(row.get('rawQ', []), dtype=torch.float32)
    require(x.shape == (k, 399) and q.shape == (k,) and torch.isfinite(x).all() and
            torch.isfinite(q).all(), 'finite Kx399/rawQ required')
    require(row.get('baseActionId') in ids, 'base action missing')
    require(isinstance(row.get('decisionId'), str) and row['decisionId'] and
            isinstance(row.get('sourceFamily'), str) and row['sourceFamily'], 'decision/family identity')
    if row['sampleKind'] == 'demo':
        target = row.get('targetIds', [])
        require(target and len(set(target)) == len(target) and all(t in ids for t in target), 'target IDs outside C')
        require(row.get('labelKind') == 'teacher_action', 'only teacher_action supported')
    else:
        require(all(key not in row for key in ('targetIds', 'teacherPolicyRef', 'labelKind',
                                               'executionKind', 'labelSourceRef')), 'keep teacher fields forbidden')
    return x, q


def load_frozen_dataset(reference, expected_identities, *, synthetic=False):
    directory = pathlib.Path(reference['directory'])
    require(directory.absolute() == directory.resolve(strict=True), 'dataset symlink/path')
    mp, sp = directory / 'manifest.json', directory / 'samples.jsonl'
    require(not mp.is_symlink() and not sp.is_symlink(), 'dataset file symlink')
    raw = mp.read_bytes(); require(sha(raw) == reference['manifestSHA256'], 'manifest SHA mismatch')
    m = read_json(raw); require(m.get('schema') == 'ohuo-distill-dataset-v2', 'dataset schema')
    require(m['plan']['identities'] == expected_identities, 'dataset identities changed')
    require(m['samples']['path'] == 'samples.jsonl', 'samples path')
    data = sp.read_bytes()
    require(sha(data) == m['samples']['sha256'] and len(data) == m['samples']['bytes'], 'sample SHA/bytes mismatch')
    require(not data or data.endswith(b'\n'), 'incomplete sample line')
    rows = [read_json(line) for line in data.splitlines()]
    require(len(rows) == m['samples']['decisions'], 'decision count mismatch')
    if synthetic:
        require(m['plan']['purpose'] == 'engineering_fixture', 'synthetic fixture required')
    else:
        require(m['plan']['purpose'] == 'stage4' and m['qualification']['eligible'] is True,
                'diagnostic/ineligible dataset forbidden')
    counts = {'demo': 0, 'keep': 0, 'train': {'demo': 0, 'keep': 0}, 'dev': {'demo': 0, 'keep': 0}}
    ids, contexts = set(), set()
    families = {f['sourceFamily']: f for f in m['plan']['families']}
    for row in rows:
        validate_decision(row)
        require(row.get('schema') == 'ohuo-distill-decision-v2', 'sample schema')
        require(row['decisionId'] not in ids and row['contextSHA256'] not in contexts, 'duplicate context/decision')
        ids.add(row['decisionId']); contexts.add(row['contextSHA256'])
        family = families.get(row['sourceFamily'])
        require(family and family['split'] == row['split'] and row['sourceRef'] in family['sourceRefs'], 'family split/source mismatch')
        require(row['encoderVersion'] == expected_identities['encoderVersion'] and
                row['candidateSpecRef'] == expected_identities['candidateSpecRef'], 'sample encoder/candidate changed')
        require(row['basePolicyRef'] == m['identityRefs']['basePolicy'], 'base identity changed')
        if row['sampleKind'] == 'demo':
            require(row['teacherPolicyRef'] == m['identityRefs']['teacher'] and
                    row['executionKind'] in ('committed', 'offline_suggested'), 'teacher identity/terminal')
        counts[row['sampleKind']] += 1; counts[row['split']][row['sampleKind']] += 1
    require(counts == m['counts']['valid'] and counts['train']['demo'] == m['qualification']['Ndemo'], 'frozen counts changed')
    require(m['datasetId'] == m['plan']['datasetId'], 'dataset ID changed')
    return {'manifest': m, 'samples': rows, 'reference': dict(reference)}


def decision_loss(scores, valid_mask, sample, temperature):
    require(temperature == 1, 'unsupported temperature')
    scores = scores.reshape(-1)
    require(valid_mask.dtype == torch.bool and valid_mask.shape == scores.shape and
            bool(valid_mask.any()), 'empty/invalid candidate mask')
    valid = torch.nonzero(valid_mask, as_tuple=False).reshape(-1).tolist()
    s = scores[valid_mask] / temperature
    require(torch.isfinite(s).all(), 'nonfinite valid scores')
    if sample['sampleKind'] == 'demo':
        ids = sample['candidateIds']; require(len(ids) == scores.numel(), 'candidate score alignment')
        require(sample.get('targetIds') and len(set(sample['targetIds'])) == len(sample['targetIds']), 'target set')
        targets = []
        for value in sample['targetIds']:
            require(value in ids and ids.index(value) in valid, 'target outside effective mask')
            targets.append(valid.index(ids.index(value)))
        return target_nll(s, targets)
    require(sample['sampleKind'] == 'keep', 'unsupported sample kind')
    q = torch.as_tensor(sample['rawQ'], dtype=scores.dtype, device=scores.device).detach()
    require(q.shape == scores.shape and torch.isfinite(q[valid_mask]).all(), 'rawQ/mask alignment')
    log_b = torch.log_softmax(q[valid_mask] / temperature, dim=0)
    return (log_b.exp() * (log_b - torch.log_softmax(s, dim=0))).sum()


def make_epoch_order(rows, seed, epoch, cycle):
    families = defaultdict(list)
    for index, row in enumerate(rows): families[row['sourceFamily']].append(index)
    queues = []
    for family in sorted(families):
        values = list(families[family])
        seed_bytes = json.dumps([seed, epoch, cycle, family], separators=(',', ':')).encode()
        random.Random(int(sha(seed_bytes), 16)).shuffle(values); queues.append(values)
    return [q[i] for i in range(max(map(len, queues), default=0)) for q in queues if i < len(q)]


class DistillLearner:
    def __init__(self, samples, parent_flat, frozen_refs, seed, recipe=None, restart_ref=None):
        self.recipe = copy.deepcopy(recipe or RECIPE); validate_recipe(self.recipe, restart_ref)
        require(type(seed) is int and seed >= 0, 'fixed nonnegative seed')
        self.seed = seed; self.refs = copy.deepcopy(frozen_refs); self.restart_ref = copy.deepcopy(restart_ref)
        self.rows = copy.deepcopy(samples)
        require(len({r['decisionId'] for r in self.rows}) == len(self.rows), 'duplicate decision')
        for row in self.rows: validate_decision(row)
        self.demo = [r for r in self.rows if r['split'] == 'train' and r['sampleKind'] == 'demo']
        self.keep = [r for r in self.rows if r['split'] == 'train' and r['sampleKind'] == 'keep']
        require(self.demo and self.keep, 'nonempty train demo/keep required')
        self.data_digest = sha(json.dumps(self.rows, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
        torch.manual_seed(seed); random.seed(seed)
        self.model = Net(); self.model.load_flat(parent_flat.clone())
        self.parent = Net(); self.parent.load_flat(parent_flat.clone()); self.parent.requires_grad_(False); self.parent.eval()
        self.optimizer = make_optimizer(self.model)
        for group in self.optimizer.param_groups: group['lr'] = self.recipe['learningRate']
        self.optimizerSteps = 0; self.epoch = 0; self.demoCursor = 0; self.keepCursor = 0; self.keepCycle = 0
        self.demoOrder = make_epoch_order(self.demo, seed, 0, 0); self.keepOrder = make_epoch_order(self.keep, seed, 0, 0)
        self.exposures = {'demo': {r['decisionId']: 0 for r in self.demo}, 'keep': {r['decisionId']: 0 for r in self.keep}}
        self.last_step = None; self.metrics = []; self.physical_limit = 32

    def next_batch(self):
        if self.epoch >= self.recipe['maxEpochs']: return [], []
        d = self.demoOrder[self.demoCursor:self.demoCursor + 32]
        k = []; cursor = self.keepCursor; cycle = self.keepCycle; order = self.keepOrder
        for _ in d:
            if cursor == len(order):
                cycle += 1; order = make_epoch_order(self.keep, self.seed, 0, cycle); cursor = 0
            k.append(order[cursor]); cursor += 1
        return d, k

    def loss_sums(self, demo, keep):
        ds, ks = [], []
        for source, out in ((demo, ds), (keep, ks)):
            for row in source:
                require(row['split'] == 'train', 'only train enters gradients')
                x, _ = validate_decision(row); scores = self.model(x).reshape(-1)
                out.append(decision_loss(scores, torch.ones_like(scores, dtype=torch.bool), row, self.recipe['temperature']))
        require(ds and ks, 'nonempty demo/keep microbatch')
        d, k = torch.stack(ds).sum(), torch.stack(ks).sum()
        return {'demo': d, 'keep': k, 'total_mean': d / len(ds) + self.recipe['keepWeight'] * k / len(ks)}

    def accumulate(self, demo, keep, physical_decisions):
        require(len(demo) == len(keep) and 1 <= len(demo) <= 32 and type(physical_decisions) is int and
                physical_decisions >= 1, 'effective batch counts')
        self.optimizer.zero_grad(); stats = {'demo': 0., 'keep': 0., 'decisions': len(demo) + len(keep)}
        for offset in range(0, len(demo), physical_decisions):
            sums = self.loss_sums(demo[offset:offset + physical_decisions], keep[offset:offset + physical_decisions])
            loss = sums['demo'] / len(demo) + self.recipe['keepWeight'] * sums['keep'] / len(keep)
            require(torch.isfinite(loss), 'nonfinite loss'); loss.backward()
            stats['demo'] += float(sums['demo'].detach()) / len(demo)
            stats['keep'] += float(sums['keep'].detach()) / len(keep)
        require(all(p.grad is not None and torch.isfinite(p.grad).all() for p in self.model.parameters()), 'nonfinite gradient')
        stats['total'] = stats['demo'] + self.recipe['keepWeight'] * stats['keep']
        stats['gradientNorm'] = math.sqrt(sum(float(p.grad.double().square().sum()) for p in self.model.parameters()))
        return stats

    def step_next(self, physical_decisions=32):
        d, k = self.next_batch(); require(d, 'epoch limit reached')
        physical = min(physical_decisions, self.physical_limit); reductions = []
        while True:
            try:
                stats = self.accumulate([self.demo[i] for i in d], [self.keep[i] for i in k], physical)
                break
            except RuntimeError as error:
                # Retry only pre-update allocation failures; keep the exact same
                # sampled decisions, normalization, recipe and optimizer step.
                if not isinstance(error, torch.OutOfMemoryError) and 'out of memory' not in str(error).lower(): raise
                if physical == 1: raise
                self.optimizer.zero_grad(set_to_none=True); physical = max(1, physical // 2); reductions.append(physical)
        self.physical_limit = physical
        before = self.model.flat().clone()
        self.optimizer.step()
        require(all((not isinstance(value, torch.Tensor) or torch.isfinite(value).all()) and
                    (not isinstance(value, (int, float)) or math.isfinite(value))
                    for state in self.optimizer.state.values() for value in state.values()), 'nonfinite optimizer state')
        stats.update(physicalDecisions=physical, memoryReductions=reductions,
                     parameterDeltaNorm=float(torch.linalg.vector_norm(self.model.flat().double() - before.double())))
        require(all(torch.isfinite(p).all() for p in self.model.parameters()), 'nonfinite updated parameters')
        for kind, indices, rows in (('demo', d, self.demo), ('keep', k, self.keep)):
            for i in indices: self.exposures[kind][rows[i]['decisionId']] += 1
        for _ in k:
            if self.keepCursor == len(self.keepOrder):
                self.keepCycle += 1; self.keepOrder = make_epoch_order(self.keep, self.seed, 0, self.keepCycle); self.keepCursor = 0
            self.keepCursor += 1
        self.demoCursor += len(d); self.optimizerSteps += 1
        ended = self.demoCursor == len(self.demoOrder)
        if ended:
            self.epoch += 1; self.demoCursor = 0
            self.demoOrder = make_epoch_order(self.demo, self.seed, self.epoch, 0) if self.epoch < 3 else []
        self.last_step = {**stats, 'optimizerSteps': self.optimizerSteps, 'epochEnded': ended,
                          'completedEpochs': self.epoch, 'demoIds': [self.demo[i]['decisionId'] for i in d],
                          'keepIds': [self.keep[i]['decisionId'] for i in k]}
        return copy.deepcopy(self.last_step)

    def exposure_summary(self):
        return {kind: {'unique': sum(n > 0 for n in values.values()), 'total': sum(values.values()),
                       'repeats': sum(max(0, n - 1) for n in values.values())} for kind, values in self.exposures.items()}

    def evaluate_split(self, split, family=None):
        demos, keeps, dis, changed = [], [], [], []; hits = 0
        with torch.no_grad():
            for row in self.rows:
                if row['split'] != split or family is not None and row['sourceFamily'] != family: continue
                x, _ = validate_decision(row); s = self.model(x).reshape(-1)
                value = float(decision_loss(s, torch.ones_like(s, dtype=torch.bool), row, self.recipe['temperature']))
                require(math.isfinite(value), 'nonfinite dev metric')
                best = min(range(len(s)), key=lambda i: (-float(s[i]), row['candidateOriginalIndices'][i]))
                action = row['candidateIds'][best]
                if row['sampleKind'] == 'demo':
                    demos.append(value)
                    if row.get('sampleClass') == 'target' and row['baseActionId'] not in row['targetIds']:
                        dis.append(value); hits += action in row['targetIds']
                else:
                    keeps.append(value)
                    if action != row['baseActionId']: changed.append(row['decisionId'])
        avg = lambda xs: sum(xs) / len(xs) if xs else None
        return {'optimizerSteps': self.optimizerSteps, 'completedEpochs': self.epoch, 'demoCE': avg(demos),
                'keepKL': avg(keeps), 'totalObjective': avg(demos) + self.recipe['keepWeight'] * avg(keeps) if demos and keeps else None, 'demoCount': len(demos), 'targetDisagreementCE': avg(dis), 'targetDisagreementHits': hits,
                'targetDisagreementCount': len(dis), 'targetHitRate': hits / len(dis) if dis else None,
                'keepDriftRate': len(changed) / len(keeps) if keeps else None, 'keepCount': len(keeps),
                'changedKeepCount': len(changed), 'changedKeepSampleIds': sorted(changed, key=lambda s: sha(s.encode()))[:12]}

    def evaluate_dev(self):
        return self.evaluate_split('dev')

    def evaluate_milestone(self):
        # Recompute the same full train set at update 0 and each epoch, not the
        # last minibatch. Family diagnostics are separate from pooled means.
        return {**self.evaluate_dev(), 'train': self.evaluate_split('train'),
                'families': {split: {family: self.evaluate_split(split, family)
                    for family in sorted({r['sourceFamily'] for r in self.rows if r['split'] == split})}
                    for split in ('train', 'dev')}}

    def capture_state(self):
        return copy.deepcopy({'schema': 'ohuo-supervised-state-v1', 'trainingKind': 'supervised_rerank',
            'model': self.model.state_dict(), 'optimizer': self.optimizer.state_dict(),
            'torchRNG': torch.get_rng_state(), 'pythonRNG': random.getstate(), 'seed': self.seed,
            'recipe': self.recipe, 'restartRef': self.restart_ref, 'frozenRefs': self.refs, 'dataDigest': self.data_digest,
            'physicalLimit': self.physical_limit, 'optimizerSteps': self.optimizerSteps, 'epoch': self.epoch, 'demoOrder': self.demoOrder,
            'demoCursor': self.demoCursor, 'keepOrder': self.keepOrder, 'keepCursor': self.keepCursor,
            'keepCycle': self.keepCycle, 'exposures': self.exposures, 'lastStep': self.last_step, 'metrics': self.metrics})

    def restore_state(self, state):
        require(state.get('schema') == 'ohuo-supervised-state-v1' and state.get('trainingKind') == 'supervised_rerank', 'supervised checkpoint schema')
        for name, value in (('frozenRefs', self.refs), ('dataDigest', self.data_digest), ('recipe', self.recipe),
                            ('seed', self.seed), ('restartRef', self.restart_ref)):
            require(state.get(name) == value, 'checkpoint ' + name + ' changed')
        U = math.ceil(len(self.demo) / 32); steps = state['optimizerSteps']
        require(type(steps) is int and 0 <= steps <= 3 * U, 'checkpoint steps')
        require(state['epoch'] == steps // U and state['demoCursor'] == 32 * (steps % U), 'checkpoint epoch/step/cursor consistency')
        require(state['demoOrder'] == (make_epoch_order(self.demo, self.seed, state['epoch'], 0) if state['epoch'] < 3 else []), 'checkpoint demo order')
        require(state['keepOrder'] == make_epoch_order(self.keep, self.seed, 0, state['keepCycle']), 'checkpoint keep order')
        require(0 <= state['keepCursor'] <= len(state['keepOrder']), 'checkpoint keep cursor')
        require(state['exposures'].keys() == self.exposures.keys() and
                all(state['exposures'][k].keys() == self.exposures[k].keys() for k in self.exposures), 'checkpoint exposure identities')
        require(all(type(n) is int and n >= 0 for counts in state['exposures'].values() for n in counts.values()), 'checkpoint exposure values')
        require(sum(state['exposures']['demo'].values()) == sum(state['exposures']['keep'].values()) ==
                state['epoch'] * len(self.demo) + state['demoCursor'], 'checkpoint committed exposure totals')
        for group in state['optimizer']['param_groups']:
            require(all(group[k] == v for k, v in {'lr': self.recipe['learningRate'], 'alpha': .9, 'eps': 1e-5,
                    'momentum': 0, 'centered': False, 'weight_decay': 0}.items()), 'checkpoint optimizer recipe')
        for values in state['optimizer']['state'].values():
            require(values['step'].item() == steps and all(not isinstance(v, torch.Tensor) or torch.isfinite(v).all()
                    for v in values.values()), 'checkpoint optimizer state')
        require(type(state['physicalLimit']) is int and 1 <= state['physicalLimit'] <= 32, 'checkpoint physical batch')
        self.physical_limit = state['physicalLimit']
        self.model.load_state_dict(state['model']); self.optimizer.load_state_dict(state['optimizer'])
        require(all(torch.isfinite(p).all() for p in self.model.parameters()), 'checkpoint nonfinite weights')
        for name in ('optimizerSteps', 'epoch', 'demoOrder', 'demoCursor', 'keepOrder', 'keepCursor', 'keepCycle', 'exposures', 'metrics'):
            setattr(self, name, copy.deepcopy(state[name]))
        self.last_step = copy.deepcopy(state['lastStep']); torch.set_rng_state(state['torchRNG']); random.setstate(state['pythonRNG'])


def initial_equivalence(learner):
    maximum = 0.
    with torch.no_grad():
        for row in learner.rows:
            x, q = validate_decision(row); s = learner.model(x).reshape(-1)
            maximum = max(maximum, float((s - q).abs().max()))
            pick = min(range(len(s)), key=lambda i: (-float(s[i]), row['candidateOriginalIndices'][i]))
            require(row['candidateIds'][pick] == row['baseActionId'], 'update0 greedy differs from frozen B')
    require(maximum <= 1e-5, 'update0 frozen rawQ differs from parent forward')
    return {'maximumRawQAbsoluteDifference': maximum, 'decisions': len(learner.rows), 'greedyIdentical': True, 'atol': 1e-5}


def worker_main():
    sys.modules.setdefault('distill_learner', sys.modules[__name__])
    from distill_checkpoint import commit_checkpoint, restore_checkpoint, publish_checkpoint
    torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.use_deterministic_algorithms(True)
    learner = None; run_dir = None
    def reply(value): print(json.dumps(value, separators=(',', ':'), allow_nan=False), flush=True)
    reply({'kind': 'ready', 'python': sys.executable, 'torch': str(torch.__version__)})
    for line in sys.stdin:
        try:
            command = read_json(line); kind = command['kind']
            if kind == 'init':
                require(learner is None, 'already initialized')
                data = load_frozen_dataset(command['dataset'], command['identities'], synthetic=command['synthetic'])
                parent = pathlib.Path(command['parentPath']).read_bytes()
                require(sha(parent) == command['parentSHA256'], 'parent SHA changed')
                flat = torch.frombuffer(bytearray(parent), dtype=torch.float32).clone()
                learner = DistillLearner(data['samples'], flat, command['frozenRefs'], command['seed'], command['recipe'], command.get('restartRef'))
                run_dir = pathlib.Path(command['runDir']); require(run_dir.resolve() == run_dir.absolute(), 'run symlink')
                if command.get('checkpoint') is not None: restore_checkpoint(run_dir, learner, command['checkpoint'])
                else: learner.metrics.append({'kind': 'update0', 'equivalence': initial_equivalence(learner), **learner.evaluate_milestone()})
                reply({'kind': 'initialized', 'optimizerSteps': learner.optimizerSteps, 'metrics': learner.metrics,
                       'exposure': learner.exposure_summary(), 'Uepoch': math.ceil(len(learner.demo) / 32)})
            elif kind == 'step':
                require(learner is not None and command['expectedStep'] == learner.optimizerSteps + 1, 'step sequence')
                result = learner.step_next(command['physicalDecisions'])
                if result['epochEnded']: learner.metrics.append({'kind': 'epoch', **learner.evaluate_milestone()})
                ref = commit_checkpoint(run_dir, learner, {'step': result, 'metrics': learner.metrics}, publish=False)
                reply({'kind': 'stepped', 'checkpoint': ref, 'step': result, 'metrics': learner.metrics, 'exposure': learner.exposure_summary()})
            elif kind == 'save':
                require(learner is not None, 'initialize first')
                ref = commit_checkpoint(run_dir, learner, {'metrics': learner.metrics}, publish=False)
                reply({'kind': 'saved', 'checkpoint': ref, 'metrics': learner.metrics, 'exposure': learner.exposure_summary()})
            elif kind == 'publish':
                require(learner is not None and command['checkpoint']['optimizerSteps'] == learner.optimizerSteps, 'publish step sequence')
                publish_checkpoint(run_dir, command['checkpoint']); reply({'kind': 'published'})
            elif kind == 'close': reply({'kind': 'closed'}); return
            else: raise ValueError('unsupported supervised command')
        except Exception as error:
            reply({'kind': 'error', 'reason': str(error)}); raise SystemExit(1)
    raise SystemExit('controller disconnected')


if __name__ == '__main__': worker_main()
