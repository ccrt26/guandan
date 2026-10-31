"""Independent supervised transaction format. Never calls old RL pruning."""
import array
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
    facts = {'schema': 'ohuo-supervised-checkpoint-v1', 'trainingKind': 'supervised_rerank',
             'optimizerSteps': learner.optimizerSteps, 'completedEpochs': learner.epoch,
             'frozenRefs': learner.refs, 'recipe': learner.recipe, 'exposure': learner.exposure_summary(),
             'weightsSHA256': sha((tmp / 'weights.f32').read_bytes()), 'facts': committed_facts}
    write_json_new(tmp / 'state.json', facts)
    files = {p: sha((tmp / p).read_bytes()) for p in ('learner.pt', 'weights.f32', 'state.json')}
    write_json_new(tmp / 'manifest.json', {'schema': 'ohuo-supervised-commit-v1', 'optimizerSteps': learner.optimizerSteps, 'files': files})
    sync_dir(tmp); final = root / name; os.rename(tmp, final); sync_dir(root)
    ref = {'schema': 'ohuo-supervised-pointer-v1', 'path': 'checkpoints/' + name,
           'optimizerSteps': learner.optimizerSteps, 'manifestSHA256': sha((final / 'manifest.json').read_bytes())}
    if publish: publish_checkpoint(run_dir, ref)
    return ref


def publish_checkpoint(run_dir, ref):
    run_dir = pathlib.Path(run_dir); _, facts = read_committed(run_dir, ref)
    latest = read_json((run_dir / 'latest.json').read_bytes()) if (run_dir / 'latest.json').exists() else None
    if latest != ref:
        if latest is not None: replace_json(run_dir / 'previous.json', latest)
        replace_json(run_dir / 'latest.json', ref)
    # Rewriting status is intentional: a prior crash may have published latest
    # but not this mirror. Same-ref recovery must preserve the prior checkpoint.
    replace_json(run_dir / 'status.json', {'trainingKind': 'supervised_rerank', 'latestCompleteCheckpoint': ref,
                                         'optimizerSteps': ref['optimizerSteps'], 'exposure': facts['exposure']})


def read_committed(run_dir, ref):
    root = pathlib.Path(run_dir).resolve(); relative = pathlib.PurePosixPath(ref['path'])
    require(len(relative.parts) == 2 and relative.parts[0] == 'checkpoints' and
            not relative.parts[1].endswith('.tmp'), 'checkpoint pointer path')
    directory = root.joinpath(*relative.parts)
    require(directory.resolve(strict=True) == directory, 'checkpoint symlink')
    mp = directory / 'manifest.json'; require(not mp.is_symlink(), 'manifest symlink')
    raw = mp.read_bytes(); require(sha(raw) == ref['manifestSHA256'], 'checkpoint manifest SHA')
    manifest = read_json(raw)
    require(manifest['schema'] == 'ohuo-supervised-commit-v1' and manifest['optimizerSteps'] == ref['optimizerSteps'], 'checkpoint commit identity')
    require(set(manifest['files']) == {'learner.pt', 'weights.f32', 'state.json'}, 'checkpoint file set')
    for name, expected in manifest['files'].items():
        require(not (directory / name).is_symlink() and sha((directory / name).read_bytes()) == expected, 'checkpoint file SHA')
    facts = read_json((directory / 'state.json').read_bytes())
    require(facts['trainingKind'] == 'supervised_rerank' and facts['optimizerSteps'] == ref['optimizerSteps'] and
            facts['weightsSHA256'] == manifest['files']['weights.f32'], 'checkpoint facts')
    state = torch.load(directory / 'learner.pt', map_location='cpu', weights_only=True)
    require(state['optimizerSteps'] == ref['optimizerSteps'] and state['frozenRefs'] == facts['frozenRefs'], 'checkpoint inner identity')
    from distill_learner import Net
    rng = torch.get_rng_state(); net = Net(); torch.set_rng_state(rng)
    net.load_state_dict(state['model'])
    flat = torch.frombuffer(bytearray((directory / 'weights.f32').read_bytes()), dtype=torch.float32).clone()
    require(torch.equal(net.flat(), flat), 'checkpoint weight/state disagreement')
    return state, facts


def restore_checkpoint(run_dir, learner, reference=None):
    run_dir = pathlib.Path(run_dir); errors = []
    for pointer in ([reference] if reference is not None else ['latest.json', 'previous.json']):
        try:
            ref = pointer if isinstance(pointer, dict) else read_json((run_dir / pointer).read_bytes())
            state, facts = read_committed(run_dir, ref)
        except (OSError, ValueError, KeyError, RuntimeError) as error:
            errors.append(str(error)); continue
        # A changed scientific identity is not corruption and must not seek an older run.
        learner.restore_state(state)
        return {'reference': ref, 'facts': facts, 'recoveredFrom': pointer if isinstance(pointer, str) else 'fixed-reference', 'errors': errors}
    raise ValueError('no complete supervised checkpoint: ' + '; '.join(errors))
