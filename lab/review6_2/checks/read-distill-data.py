#!/usr/bin/env python3
"""B09 read-only cross-language fixture check, not a learner or label finder.
Use the transferred unchanged dataset and expected-readback.json. No candidate
re-enumeration, forward pass, teacher request, gradient, or source scanning.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def read_json(data):
    def invalid_constant(value):
        raise ValueError('non-finite JSON constant: ' + value)
    return json.loads(data, parse_constant=invalid_constant)


def readback(dataset, manifest_sha256, expected_path):
    directory = Path(dataset).resolve(strict=True)
    manifest_path = directory / 'manifest.json'
    require(not manifest_path.is_symlink(), 'manifest symlink')
    raw = manifest_path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == manifest_sha256, 'manifest identity')
    manifest = read_json(raw)
    require(manifest['schema'] == 'ohuo-distill-dataset-v2', 'manifest schema')
    require(manifest['samples']['path'] == 'samples.jsonl', 'sample path')
    sample_path = directory / 'samples.jsonl'
    require(not sample_path.is_symlink(), 'sample symlink')
    data = sample_path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == manifest['samples']['sha256'], 'sample identity')
    require(len(data) == manifest['samples']['bytes'], 'sample bytes')
    require(not data or data.endswith(b'\n'), 'truncated sample')
    samples = [read_json(line) for line in data.splitlines()]
    require(len(samples) == manifest['samples']['decisions'], 'sample count')
    ids, contexts, groups = set(), set(), []
    counts = {'demo': 0, 'keep': 0, 'train': {'demo': 0, 'keep': 0}, 'dev': {'demo': 0, 'keep': 0}}
    for sample in samples:
        require(sample['schema'] == 'ohuo-distill-decision-v2', 'sample schema')
        kind, split = sample['sampleKind'], sample['split']
        require(kind in ('demo', 'keep') and split in ('train', 'dev'), 'sample branch')
        require(sample['decisionId'] not in ids and sample['contextSHA256'] not in contexts, 'duplicate decision/context')
        ids.add(sample['decisionId']); contexts.add(sample['contextSHA256'])
        candidates = sample['candidateIds']; k = len(candidates)
        require(1 <= k <= 8 and len(set(candidates)) == k, 'candidate ids')
        original_indices = sample['candidateOriginalIndices']
        require(len(original_indices) == k and len(set(original_indices)) == k, 'original index group/uniqueness')
        require(all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 9007199254740991 and value == int(value) for value in original_indices), 'original index semantic integer')
        require(len(sample['candidateCanonicalIds']) == k and len(set(sample['candidateCanonicalIds'])) == k, 'canonical ids')
        require(len(sample['candidateFeatures']) == k and len(sample['rawQ']) == k, 'candidate group')
        require(all(len(row) == 399 for row in sample['candidateFeatures']), '399 input')
        require(all(type(value) in (int, float) and math.isfinite(value)
                    for row in sample['candidateFeatures'] for value in row), 'finite features')
        require(all(type(value) in (int, float) and math.isfinite(value) for value in sample['rawQ']), 'finite rawQ')
        require(sample['baseActionId'] in candidates, 'B action')
        require(sample['basePolicyRef'] == manifest['identityRefs']['basePolicy'], 'B identity')
        if kind == 'demo':
            targets = sample['targetIds']
            require(targets and len(set(targets)) == len(targets) and set(targets) <= set(candidates), 'demo targets')
            require(sample['labelKind'] == 'teacher_action' and sample['executionKind'] in ('committed', 'offline_suggested'), 'teacher branch')
            require(sample['teacherPolicyRef'] == manifest['identityRefs']['teacher'], 'teacher identity')
        else:
            require(all(key not in sample for key in ('targetIds', 'teacherPolicyRef', 'labelKind', 'executionKind', 'labelSourceRef')), 'keep has teacher fields')
        counts[kind] += 1; counts[split][kind] += 1
        group = {key: sample[key] for key in ('decisionId', 'sampleKind', 'split', 'candidateIds', 'candidateOriginalIndices', 'candidateFeatures', 'rawQ')}
        if kind == 'demo':
            group['targetIds'] = sample['targetIds']
        groups.append(group)
    require(counts == manifest['counts']['valid'], 'valid counts')
    require(len(samples) + len(manifest['exclusions']) == manifest['counts']['attempted'], 'exclusion count')
    expected = read_json(Path(expected_path).read_bytes())
    require(expected == {'datasetId': manifest['datasetId'], 'manifestSHA256': manifest_sha256, 'groups': groups}, 'expected ID/order/numeric readback')
    return {'checkId': 'B09.python_readback', 'passed': True, 'datasetId': manifest['datasetId'],
            'manifestSHA256': manifest_sha256, 'groups': len(groups), 'candidateCounts': [len(g['candidateIds']) for g in groups],
            'scope': 'same frozen synthetic fixture; no teacher/candidates/parameters'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--expected', required=True)
    args = parser.parse_args()
    print(json.dumps(readback(args.dataset, args.manifest_sha256, args.expected), ensure_ascii=False))
