"""Independent supervised transaction format. Never calls old RL pruning."""
import array
import copy
import io
import json
import os
import pathlib
import sys
import uuid
import torch
from distill_learner import require, sha, read_json


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def write_json_new(path, value):
    with open(path, 'x', encoding='utf8') as out:
        json.dump(value, out, sort_keys=True, separators=(',', ':'), allow_nan=False)
        out.write('\n'); out.flush(); os.fsync(out.fileno())


def replace_json(path, value):
    tmp = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    write_json_new(tmp, value); os.replace(tmp, path); sync_dir(path.parent)


def commit_checkpoint(run_dir, learner, committed_facts, *, publish=True):
    run_dir = pathlib.Path(run_dir); root = run_dir / 'checkpoints'; root.mkdir(parents=True, exist_ok=True)
    require(root.absolute() == root.resolve(), 'checkpoint symlink root')
    name = f'u{learner.optimizerSteps:06d}-{uuid.uuid4().hex[:12]}'; tmp = root / (name + '.tmp'); tmp.mkdir()
    state = learner.capture_state()
    with open(tmp / 'learner.pt', 'xb') as out: torch.save(state, out); out.flush(); os.fsync(out.fileno())
    weights = array.array('f', learner.model.flat().tolist())
    if sys.byteorder != 'little': weights.byteswap()
    with open(tmp / 'weights.f32', 'xb') as out: weights.tofile(out); out.flush(); os.fsync(out.fileno())
    weights_sha256 = sha((tmp / 'weights.f32').read_bytes())
    facts = {'schema': 'ohuo-supervised-checkpoint-first-round-v2' if learner.first_round else 'ohuo-supervised-checkpoint-student423-v1' if learner.input_contract is not None else 'ohuo-supervised-checkpoint-v1',
             **({'inputContract': learner.input_contract} if learner.input_contract is not None else {}), 'trainingKind': 'supervised_rerank',
             'optimizerSteps': learner.optimizerSteps, 'completedEpochs': learner.epoch,
             'frozenRefs': learner.refs, 'recipe': learner.recipe, 'exposure': learner.exposure_summary(),
             'weightsSHA256': weights_sha256, 'facts': committed_facts}
    if learner.first_round:
        facts['perDecisionExposure'] = state['exposures']
    write_json_new(tmp / 'state.json', facts)
    # Reuse only this transaction's digest; publication still validates disk.
    files = {p: weights_sha256 if p == 'weights.f32' else sha((tmp / p).read_bytes())
             for p in ('learner.pt', 'weights.f32', 'state.json')}
    write_json_new(tmp / 'manifest.json', {'schema': 'ohuo-supervised-commit-v1', 'optimizerSteps': learner.optimizerSteps, 'files': files})
    sync_dir(tmp); final = root / name; os.rename(tmp, final); sync_dir(root)
    ref = {'schema': 'ohuo-supervised-pointer-v1', 'path': 'checkpoints/' + name,
           'optimizerSteps': learner.optimizerSteps, 'manifestSHA256': sha((final / 'manifest.json').read_bytes())}
    if publish: publish_checkpoint(run_dir, ref)
    return ref


def publish_checkpoint(run_dir, ref, *, _validation_cache=None):
    run_dir = pathlib.Path(run_dir)
    checked = _check_committed_files(run_dir, ref)
    # This worker may have just restored this exact transaction. Recheck all
    # current bytes and file identities before reusing only its validated facts.
    if (_validation_cache is not None and _validation_cache.get('reference') == ref and
            _validation_cache.get('fingerprint') == checked[3]):
        facts = copy.deepcopy(_validation_cache['facts'])
    else:
        _, facts = _read_checked_state(ref, checked)
        _remember_validation(_validation_cache, ref, checked[3], facts)
    latest = read_json((run_dir / 'latest.json').read_bytes()) if (run_dir / 'latest.json').exists() else None
    if latest != ref:
        if latest is not None: replace_json(run_dir / 'previous.json', latest)
        replace_json(run_dir / 'latest.json', ref)
    # Rewriting status is intentional: a prior crash may have published latest
    # but not this mirror. Same-ref recovery must preserve the prior checkpoint.
    replace_json(run_dir / 'status.json', {'trainingKind': 'supervised_rerank', 'latestCompleteCheckpoint': ref,
                                         'optimizerSteps': ref['optimizerSteps'], 'exposure': facts['exposure']})


def _check_committed_files(run_dir, ref):
    root = pathlib.Path(run_dir).resolve(); relative = pathlib.PurePosixPath(ref['path'])
    require(len(relative.parts) == 2 and relative.parts[0] == 'checkpoints' and
            not relative.parts[1].endswith('.tmp'), 'checkpoint pointer path')
    directory = root.joinpath(*relative.parts)
    require(directory.resolve(strict=True) == directory, 'checkpoint symlink')
    mp = directory / 'manifest.json'; require(not mp.is_symlink(), 'manifest symlink')
    def identity(path):
        stat = path.stat()
        return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    def read_file(path):
        require(not path.is_symlink(), 'checkpoint file symlink')
        before = identity(path); raw = path.read_bytes()
        require(not path.is_symlink() and identity(path) == before, 'checkpoint file changed during validation')
        return raw, before
    raw, manifest_identity = read_file(mp)
    require(sha(raw) == ref['manifestSHA256'], 'checkpoint manifest SHA')
    manifest = read_json(raw)
    require(manifest['schema'] == 'ohuo-supervised-commit-v1' and manifest['optimizerSteps'] == ref['optimizerSteps'], 'checkpoint commit identity')
    require(set(manifest['files']) == {'learner.pt', 'weights.f32', 'state.json'}, 'checkpoint file set')
    files = {}; identities = {}
    for name, expected in manifest['files'].items():
        files[name], identities[name] = read_file(directory / name)
        require(sha(files[name]) == expected, 'checkpoint file SHA')
    fingerprint = (str(directory), identity(root)[:2], identity(directory)[:2], manifest_identity,
                   ref['manifestSHA256'], tuple((name, identities[name], manifest['files'][name]) for name in sorted(files)))
    return directory, manifest, files, fingerprint


def _remember_validation(cache, ref, fingerprint, facts):
    if cache is not None:
        cache.clear()
        cache.update(reference=copy.deepcopy(ref), fingerprint=fingerprint, facts=copy.deepcopy(facts))


def read_committed(run_dir, ref, *, _validation_cache=None):
    checked = _check_committed_files(run_dir, ref)
    state, facts = _read_checked_state(ref, checked)
    _remember_validation(_validation_cache, ref, checked[3], facts)
    return state, facts


def _read_checked_state(ref, checked):
    _, manifest, files, _ = checked
    facts = read_json(files['state.json'])
    require(facts['trainingKind'] == 'supervised_rerank' and facts['optimizerSteps'] == ref['optimizerSteps'] and
            facts['weightsSHA256'] == manifest['files']['weights.f32'], 'checkpoint facts')
    state = torch.load(io.BytesIO(files['learner.pt']), map_location='cpu', weights_only=True)
    require(state['optimizerSteps'] == ref['optimizerSteps'] and state['frozenRefs'] == facts['frozenRefs'], 'checkpoint inner identity')
    from distill_learner import Net, input_dimension, is_first_round, STUDENT_INPUT_CONTRACT
    input_contract = state.get('inputContract')
    input_dim = input_dimension(input_contract)
    first_round = is_first_round(state.get('recipe'))
    expected_state = 'ohuo-supervised-state-first-round-v2' if first_round else 'ohuo-supervised-state-student423-v1' if input_contract is not None else 'ohuo-supervised-state-v1'
    expected_facts = 'ohuo-supervised-checkpoint-first-round-v2' if first_round else 'ohuo-supervised-checkpoint-student423-v1' if input_contract is not None else 'ohuo-supervised-checkpoint-v1'
    if first_round:
        require(input_contract == STUDENT_INPUT_CONTRACT and facts.get('recipe') == state.get('recipe') and
                facts.get('perDecisionExposure') == state.get('exposures'), 'first-round checkpoint facts mismatch')
    require(state.get('schema') == expected_state and facts.get('schema') == expected_facts and
            facts.get('inputContract') == input_contract, 'checkpoint explicit input identity mismatch')
    rng = torch.get_rng_state(); net = Net(input_dim); torch.set_rng_state(rng)
    net.load_state_dict(state['model'])
    flat = torch.frombuffer(bytearray(files['weights.f32']), dtype=torch.float32).clone()
    require(torch.equal(net.flat(), flat), 'checkpoint weight/state disagreement')
    return state, facts


def restore_checkpoint(run_dir, learner, reference=None, *, _validation_cache=None):
    run_dir = pathlib.Path(run_dir); errors = []
    for pointer in ([reference] if reference is not None else ['latest.json', 'previous.json']):
        try:
            ref = pointer if isinstance(pointer, dict) else read_json((run_dir / pointer).read_bytes())
            state, facts = read_committed(run_dir, ref, _validation_cache=_validation_cache)
        except (OSError, ValueError, KeyError, RuntimeError) as error:
            errors.append(str(error)); continue
        # A changed scientific identity is not corruption and must not seek an older run.
        learner.restore_state(state)
        return {'reference': ref, 'facts': facts, 'recoveredFrom': pointer if isinstance(pointer, str) else 'fixed-reference', 'errors': errors}
    raise ValueError('no complete supervised checkpoint: ' + '; '.join(errors))
