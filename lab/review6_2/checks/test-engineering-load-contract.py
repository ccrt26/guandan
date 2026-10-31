#!/usr/bin/env python3
"""Finite B10 engineering guards only; never supplies or loads parent weights.
Registry/site/authorization binding is checked separately by the integration owner.
"""
import argparse
from contextlib import ExitStack
import importlib.util
import json
import pathlib
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('check_distill_contract', pathlib.Path(__file__).with_name('check-distill.py'))
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)
import distill_learner as learner

DATASET = 'deliverables/ohuo-batches/B09/fixture/dataset'
MANIFEST_SHA = 'd10099ff80b33a613357410dfd768f0a1f77332a439e927eb686fe14c2b868e1'
SAMPLES_SHA = '53e5154f22ffddf2e7304ccb694625f2ede8615b94dc9d3d1b083d12e9b5243e'
PARENT = 'lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32'
PARENT_SHA = 'd05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081'


class EngineeringLoadContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='engineering-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        shutil.copytree(ROOT / DATASET, self.root / DATASET)
        (self.root / 'lab').mkdir()
        shutil.copyfile(ROOT / 'lab/model-index.json', self.root / 'lab/model-index.json')
        self.args = argparse.Namespace(dataset=DATASET, manifest_sha256=MANIFEST_SHA,
                                       parent_path=PARENT, parent_sha256=PARENT_SHA)
        stack = self.enterContext(ExitStack())
        stack.enter_context(patch.object(CHECK, 'ROOT', self.root))
        # These traps are intentional: this suite must not exercise model work
        # or the numerical/resume cases, even if dispatch accidentally changes.
        for owner, name in ((CHECK, 'run'), (CHECK, 'fixture'), (learner, 'Net'), (learner, 'DistillLearner')):
            stack.enter_context(patch.object(owner, name, side_effect=AssertionError('forbidden model/numerical work: ' + name)))
        read_bytes = pathlib.Path.read_bytes
        def guarded_read(path):
            if path.suffix == '.f32':
                raise AssertionError('protected parent read during input-only contract test')
            return read_bytes(path)
        stack.enter_context(patch.object(pathlib.Path, 'read_bytes', guarded_read))

    def feature(self, name):
        self.assertTrue(callable(getattr(CHECK, name, None)), 'missing fixed engineering feature: ' + name)
        return getattr(CHECK, name)

    def test_fixed_dispatch_rejects_missing_inputs_without_numerical_fallback(self):
        # A missing selector or accidental default-resume dispatch must fail.
        with self.assertRaisesRegex(ValueError, 'explicit'):
            self.feature('main')(['--case', 'engineering-load-only'])

    def test_original_fixture_validates_without_parent_or_scientific_pairing(self):
        # Missing synthetic=True would reject this exact original fixture.
        checked = self.feature('engineering_inputs')(self.args)
        self.assertEqual(checked['manifestSHA256'], MANIFEST_SHA)
        self.assertEqual(checked['samplesSHA256'], SAMPLES_SHA)
        self.assertEqual(checked['candidateCounts'], [3, 2, 3])
        self.assertEqual(len(checked['data']['samples']), 3)
        manifest = checked['data']['manifest']
        self.assertEqual(manifest['plan']['purpose'], 'engineering_fixture')
        self.assertIs(manifest['qualification']['eligible'], False)
        self.assertEqual(manifest['plan']['identities']['basePolicy']['weightsSHA256'], 'b' * 64)
        self.assertEqual(checked['parentPath'], self.root / PARENT)
        self.assertFalse((self.root / PARENT).exists(), 'test must never provide substitute parent weights')

    def test_bad_fixture_identity_rejects_before_protected_parent_read(self):
        load = self.feature('engineering_load')
        mp, sp = self.root / DATASET / 'manifest.json', self.root / DATASET / 'samples.jsonl'
        original_m, original_s = mp.read_bytes(), sp.read_bytes()
        for kind, diagnostic in [('purpose', 'engineering_fixture'), ('eligible', 'eligible=false'),
                                 ('manifest', 'manifest SHA'), ('samples', 'samples SHA')]:
            with self.subTest(kind=kind):
                mp.write_bytes(original_m); sp.write_bytes(original_s)
                if kind in ('purpose', 'eligible'):
                    value = json.loads(original_m)
                    if kind == 'purpose': value['plan']['purpose'] = 'stage4'
                    else: value['qualification']['eligible'] = True
                    mp.write_text(json.dumps(value))
                elif kind == 'manifest': mp.write_bytes(original_m + b' ')
                else: sp.write_bytes(original_s + b' ')
                with self.assertRaisesRegex(ValueError, diagnostic): load(self.args)

    def test_bad_registered_parent_or_declared_identity_rejects_before_read(self):
        load = self.feature('engineering_load')
        index_path = self.root / 'lab/model-index.json'
        original = index_path.read_bytes()
        for field, value in [('inputDim', 385), ('parameterCount', 164865),
                             ('architectureId', 'changed'), ('weightsLayoutVersion', 'changed'),
                             ('policyId', 'not-the-fixed-parent'), ('weightsSHA256', 'a' * 64)]:
            with self.subTest(field=field):
                index = json.loads(original)
                parent = next(p for p in index['policies'] if p['policyId'] == 'r62-p8c-control-u1400-greedy')
                parent[field] = value
                index_path.write_text(json.dumps(index))
                with self.assertRaisesRegex(ValueError, 'registered parent'): load(self.args)
        index_path.write_bytes(original)
        self.args.parent_sha256 = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'parent identity'): load(self.args)

    def test_escape_wrong_path_and_parent_component_symlink_reject_before_read(self):
        load = self.feature('engineering_load')
        for path in ['../outside/weights.f32', 'packages/web/public/ai/clean2.f32']:
            with self.subTest(path=path):
                self.args.parent_path = path
                with self.assertRaisesRegex(ValueError, 'path'): load(self.args)
        self.args.parent_path = PARENT
        runs = self.root / 'lab/review6_2/runs'
        runs.parent.mkdir(parents=True)
        target = self.root / 'symlink-target'; target.mkdir()
        runs.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'): load(self.args)
        runs.unlink(); runs.mkdir()
        parent = self.root / PARENT; parent.parent.mkdir(parents=True)
        parent.symlink_to(target / 'nonexistent-weights.f32')
        with self.assertRaisesRegex(ValueError, 'symlink'): load(self.args)

    def test_unchanged_default_research_loader_rejects_same_engineering_fixture(self):
        directory = self.root / DATASET
        manifest = json.loads((directory / 'manifest.json').read_bytes())
        with self.assertRaisesRegex(ValueError, 'diagnostic/ineligible dataset forbidden'):
            learner.load_frozen_dataset({'directory': str(directory), 'manifestSHA256': MANIFEST_SHA},
                                        manifest['plan']['identities'])

    def test_f32_bytes_preserve_bits_without_numpy(self):
        # EL-C1: only six public finite f32 bit patterns, no Net or parent asset.
        # +0, -0, +1, -2.5, smallest positive subnormal, largest finite positive.
        expected = bytes.fromhex('00000000 00000080 0000803f 000020c0 01000000 ffff7f7f')
        flat = CHECK.torch.frombuffer(bytearray(expected), dtype=CHECK.torch.float32).clone()
        with patch.object(CHECK.torch.Tensor, 'numpy', side_effect=AssertionError('NumPy bridge forbidden')):
            self.assertEqual(self.feature('engineering_flat_bytes')(flat), expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
