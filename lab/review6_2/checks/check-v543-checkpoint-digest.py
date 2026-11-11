"""Finite synthetic checkpoint I/O checks. No learner updates or research input."""
import json
import pathlib
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'lab/review6_2'))
import torch
import distill_checkpoint as cp
from distill_learner import Net, sha


def fixture():
    model = Net(399)
    state = {'schema': 'ohuo-supervised-state-v1', 'optimizerSteps': 0,
             'frozenRefs': {'source': 'synthetic-only'}, 'model': model.state_dict()}
    return SimpleNamespace(model=model, optimizerSteps=0, epoch=0, first_round=False,
                           input_contract=None, refs=state['frozenRefs'], recipe={},
                           capture_state=lambda: state, exposure_summary=lambda: {})


def rejects(call, fragment):
    try:
        call()
    except ValueError as error:
        assert fragment in str(error), str(error)
    else:
        raise AssertionError('missing rejection: ' + fragment)


def main():
    with tempfile.TemporaryDirectory(prefix='v543-checkpoint-') as temporary:
        root = pathlib.Path(temporary).resolve()
        original_read = pathlib.Path.read_bytes
        reads = []
        def read(path):
            raw = original_read(path)
            if path.name == 'weights.f32':
                reads.append(raw)
            return raw
        with patch.object(pathlib.Path, 'read_bytes', read), patch.object(cp, 'sha', wraps=cp.sha) as digest:
            ref = cp.commit_checkpoint(root, fixture(), {'synthetic': True}, publish=False)
        assert len(reads) == 1, ('transaction weights reads', len(reads))
        assert sum(call.args[0] == reads[0] for call in digest.call_args_list) == 1, 'duplicate weights hash'
        directory = root / ref['path']
        facts = json.loads((directory / 'state.json').read_bytes())
        manifest = json.loads((directory / 'manifest.json').read_bytes())
        assert facts['weightsSHA256'] == manifest['files']['weights.f32'] == sha(reads[0])
        # New transaction publication still fully validates the persisted model.
        with patch.object(torch, 'load', wraps=torch.load) as load:
            cp.publish_checkpoint(root, ref)
        assert load.call_count == 1
        state, checked = cp.read_committed(root, ref)
        assert state['optimizerSteps'] == 0 and checked == facts
        # A changed file is rejected, even if the original transaction wrote it.
        weights_path = directory / 'weights.f32'
        original = weights_path.read_bytes()
        changed = bytearray(original); changed[0] ^= 1; weights_path.write_bytes(changed)
        rejects(lambda: cp.publish_checkpoint(root, ref), 'checkpoint file SHA')
        # Updating outer hashes cannot bypass weight/state agreement.
        facts['weightsSHA256'] = sha(changed)
        cp.replace_json(directory / 'state.json', facts)
        for name in ('weights.f32', 'state.json'):
            manifest['files'][name] = sha((directory / name).read_bytes())
        cp.replace_json(directory / 'manifest.json', manifest)
        changed_ref = {**ref, 'manifestSHA256': sha((directory / 'manifest.json').read_bytes())}
        rejects(lambda: cp.publish_checkpoint(root, changed_ref), 'checkpoint weight/state disagreement')
        print(json.dumps({'case': 'v543_checkpoint_digest', 'constructionWeightReads': 1,
                          'constructionWeightHashes': 1, 'coldPublishLoads': 1,
                          'committedReadback': True, 'changedBytesRejected': True,
                          'weightStateMismatchRejected': True, 'optimizerUpdates': 0}))


if __name__ == '__main__':
    main()
