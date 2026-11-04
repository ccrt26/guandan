"""M7 grouped CE/KL reranker. No RL queues, implicit paths, or teacher calls.
CPU only; the existing task host verifies authority before starting this worker.
"""
import copy
import array
import hashlib
import json
import math
import pathlib
import random
import re
import struct
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


# Exact Python mirror of first-round-contract.mjs, not a new training recipe.
FIRST_ROUND_RECIPE = {'recipeId': 'first-round-partner-control-fixed64-v1', 'optimizer': 'RMSprop',
    'alpha': .9, 'eps': 1e-5, 'momentum': 0, 'centered': False, 'weightDecay': 0,
    'learningRate': 1e-4, 'temperature': 1, 'keepWeight': 1, 'demoBatch': 32, 'keepBatch': 32,
    'maxUpdates': 64, 'calibrationUpdates': 1, 'checkpointUpdates': [0, 16, 32, 64],
    'maxSharedOptimizerSteps': 130, 'initialization': 'fixed-parent-new-optimizer'}
FIRST_ROUND_R2_RECIPE = {**{k: v for k, v in FIRST_ROUND_RECIPE.items() if k not in ('maxUpdates', 'checkpointUpdates', 'maxSharedOptimizerSteps')},
    'recipeId': 'first-round-common-view-learning-v2', 'observationUnit': 'complete-dataset-epoch',
    'stoppingRule': 'first-round-common-view-learning-stop-v1'}

def is_first_round_r2(recipe):
    return isinstance(recipe, dict) and recipe.get('recipeId') == FIRST_ROUND_R2_RECIPE['recipeId']

FIRST_ROUND_SAMPLE_SCHEMA = 'ohuo-distill-decision-first-round-v4'
FIRST_ROUND_DATASET_SCHEMA = 'ohuo-distill-dataset-first-round-v4'
FIRST_ROUND_PLAN_SCHEMA = 'ohuo-distill-plan-first-round-v3'
FIRST_ROUND_PURPOSE = 'first-round-partner-control'


def is_first_round(recipe):
    return isinstance(recipe, dict) and recipe.get('recipeId') in (FIRST_ROUND_RECIPE['recipeId'], FIRST_ROUND_R2_RECIPE['recipeId'])


def first_round_shape(recipe, phase, ndemo, nkeep):
    # Full recipe validation, including restart evidence, happens at admission.
    require(is_first_round(recipe), 'first-round recipe required')
    if is_first_round_r2(recipe):
        require(type(ndemo) is int and ndemo > 0 and type(nkeep) is int and nkeep == ndemo, 'r2 sample count')
        require(phase in ('calibration', 'formal'), 'first-round phase')
        return {'Uepoch': math.ceil(ndemo / 32), 'maxOptimizerSteps': 1 if phase == 'calibration' else None,
                'milestoneUpdates': [0, 1] if phase == 'calibration' else None}
    require(type(ndemo) is int and 0 < ndemo <= 16 and type(nkeep) is int and nkeep == ndemo,
            'first-round sample count')
    require(phase in ('calibration', 'formal'), 'first-round phase')
    return {'Uepoch': 1, 'maxOptimizerSteps': 1 if phase == 'calibration' else 64,
            'milestoneUpdates': [0, 1] if phase == 'calibration' else [0, 16, 32, 64]}


# Explicit input identity for S33. This does not authorize a new dataset,
# candidate budget, recipe, run, or research qualification (S34/S35 own those).
STUDENT_INPUT_CONTRACT = {
    'schema': 'student-input399plus24-v1', 'encoderVersion': 'student-input399plus24-v1',
    'inputLayout': 'legacy399_then_publicMemory24',
    'baseEncoderRef': {'schema': 'v2', 'ctxFill': 'rule-context', 'passEncoding': 'action64',
                       'encoderVersion': 'gd-lab-schema-v4'},
    'segments': [{'role': 'legacy-state', 'offset': 0, 'length': 331},
                 {'role': 'legacy-action', 'offset': 331, 'length': 68},
                 {'role': 'public-memory', 'offset': 399, 'length': 24}],
    'memorySchemaId': 'public-high-card-memory-v1',
    'relativeSeatOrder': ['self', 'partner', 'upper', 'lower'],
    'slotOrder': ['J', 'Q', 'K', 'LEVEL_OTHER', 'SJ', 'BJ'],
    'normalizationDivisors': [8, 8, 8, 8, 2, 2]}


def input_dimension(input_contract):
    if input_contract is None: return 399
    require(input_contract == STUDENT_INPUT_CONTRACT, 'unsupported explicit student input contract')
    return 423


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
    expected = copy.deepcopy(FIRST_ROUND_R2_RECIPE if is_first_round_r2(recipe) else FIRST_ROUND_RECIPE if is_first_round(recipe) else RECIPE)
    if is_first_round(recipe) and not is_first_round_r2(recipe):
        require(type(recipe.get('centered')) is bool and all(type(recipe.get(k)) in (int, float)
                for k, v in FIRST_ROUND_RECIPE.items() if type(v) in (int, float)) and
                isinstance(recipe.get('checkpointUpdates'), list) and
                all(type(n) is int for n in recipe['checkpointUpdates']), 'first-round recipe scalar types')
    if recipe.get('learningRate') == 3e-5:
        require(isinstance(restart_ref, dict) and restart_ref.get('id') and
                len(restart_ref.get('sha256', '')) == 64, 'single restart evidence required')
        expected['learningRate'] = 3e-5
    require(recipe == expected, 'unsupported supervised recipe')


FIRST_TARGET_CANDIDATE_POLICY = {
    'candidateSpec': 'first-target-offer12-v1',
    'enumSpec': {'id': 'full-house-attachment-ranks-v1',
                 'enumerationMode': 'all_supported_attachment_ranks'}}
LEGACY_CANDIDATE_POLICY = {
    'candidateSpec': 'ohuo-frozen-c8-expand4-v1',
    'enumSpec': {'id': 'cand-suit-v3', 'enumerationMode': 'legacy_best_pair'}}


def candidate_contract(value):
    policy = value.get('candidatePolicy')
    fresh = value.get('candidateSpecRef') == FIRST_TARGET_CANDIDATE_POLICY['candidateSpec']
    require((fresh and policy == FIRST_TARGET_CANDIDATE_POLICY) or
            (not fresh and policy is None), 'complete candidate policy/schema required')
    return fresh


def first_round_direction(row):
    ids, canonical, targets = row.get('candidateIds'), row.get('candidateCanonicalIds'), row.get('targetIds')
    require(isinstance(ids, list) and isinstance(canonical, list) and len(ids) == len(canonical) and
            len(set(canonical)) == len(canonical) and all(isinstance(c, str) and c for c in canonical),
            'first-round canonical mapping')
    require(isinstance(targets, list) and targets and len(set(targets)) == len(targets) and
            all(t in ids for t in targets), 'first-round target mapping')
    directions = {'pass' if canonical[ids.index(t)] == 'pass' else 'takeover' for t in targets}
    require(len(directions) == 1 and row.get('direction') in directions, 'first-round direction mismatch')
    return next(iter(directions))


def validate_designed_augmentation(value):
    # Exact mirror of designed-provenance.mjs; metadata is not source evidence.
    keys = {'schema', 'previousDatasetRef', 'selectionRef', 'ordinarySelectionRef'}
    require(isinstance(value, dict) and set(value) == keys and
            value['schema'] == 'ohuo-designed-augmentation-v1', 'designed_augmentation')
    for key in ('previousDatasetRef', 'selectionRef', 'ordinarySelectionRef'):
        ref = value[key]
        require(isinstance(ref, str) and re.fullmatch(r'.+@sha256:[a-f0-9]{64}', ref) and
                not re.search(r'(^|[/:_-])latest($|[/:@_-])', ref, re.I), 'designed_augmentation')
    require(value['selectionRef'] != value['ordinarySelectionRef'], 'designed_augmentation')
    return value


def validate_designed_provenance(value):
    keys = {'sourceKind', 'sourceRef', 'sourceIndexRef', 'sourceSHA256', 'replaySHA256', 'inputSHA256', 'samplingRef'}
    require(isinstance(value, dict) and set(value) == keys and
            value['sourceKind'] == 'designed-synthetic', 'designed_provenance')
    for key in ('sourceRef', 'sourceIndexRef', 'samplingRef'):
        ref = value[key]
        require(isinstance(ref, str) and re.fullmatch(r'.+@sha256:[a-f0-9]{64}', ref) and
                not re.search(r'(^|[/:_-])latest($|[/:@_-])', ref, re.I), 'designed_provenance')
    require(all(isinstance(value[key], str) and re.fullmatch(r'[a-f0-9]{64}', value[key])
                for key in ('sourceSHA256', 'replaySHA256', 'inputSHA256')), 'designed_provenance')
    return value


def validate_first_round_research_protocol(value):
    # Shared original R2 predicate for both the recipe and designed-plan readers.
    require(isinstance(value, dict) and set(value) == {'id', 'revisionRef'} and
            value['id'] == 'first-round-common-view-r2' and isinstance(value['revisionRef'], str) and
            re.fullmatch(r'.+@sha256:[a-f0-9]{64}', value['revisionRef']), 'r2 dataset explicit protocol')
    return value


def validate_designed_augmentation_plan(plan):
    require(plan.get('schema') == FIRST_ROUND_PLAN_SCHEMA, 'designed first-round plan required')
    augmentation = validate_designed_augmentation(plan.get('designedAugmentation'))
    validate_first_round_research_protocol(plan.get('researchProtocol'))
    require('cumulativeSampling' not in plan, 'designed augmentation requires r2 only')
    return augmentation


def validate_first_round_designed_binding(plan, row, retained=None):
    augmentation = None
    if 'designedAugmentation' in plan:
        augmentation = validate_designed_augmentation_plan(plan)
    provenance = row.get('provenance')
    if isinstance(provenance, dict) and 'sourceKind' in provenance:
        validate_designed_provenance(provenance)
        require(augmentation is not None, 'designed plan required')
        if retained is not None and row.get('decisionId') in retained:
            require(row == retained[row['decisionId']], 'designed retained_changed')
            return
        require(provenance['samplingRef'] == plan.get('samplingRef'), 'designed sampling reference')
        require(provenance['sourceIndexRef'] == plan.get('sourceIndexRef'), 'designed source index reference')


def validate_designed_evidence(evidence, plan, samples, exclusions, raw_lines):
    # Reader integrity only. H/freezer still own the original source/ledger join.
    # Retention hashes use original UTF-8 JSONL bytes, never Python float rendering.
    def need(ok, reason):
        require(ok, 'designed_evidence_' + reason)
    def hex_sha(value):
        return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value)
    def fixed(value):
        return isinstance(value, str) and re.fullmatch(r'.+@sha256:[a-f0-9]{64}', value) and not re.search(r'(^|[/:_-])latest($|[/:@_-])', value, re.I)
    def exact(value, keys):
        return isinstance(value, dict) and set(value) == set(keys)
    def file_ref(value):
        return exact(value, ('id', 'sha256')) and isinstance(value['id'], str) and value['id'].strip() and not re.search(r'(^|[/:_-])latest($|[/:@_-])', value['id'], re.I) and hex_sha(value['sha256'])
    def identified(rows):
        return all(isinstance(r, dict) and isinstance(r.get('decisionId'), str) and r['decisionId'] for r in rows) and len({r['decisionId'] for r in rows}) == len(rows)
    a = validate_designed_augmentation_plan(plan)
    fields = {'schema', 'previousDatasetRef', 'previousManifestSHA256', 'previousSamplesSHA256', 'retainedSamples',
              'selectionRef', 'productionRef', 'populationRef', 'selectedMetadataRef', 'exclusionsRef',
              'preselectedDemoMetadata', 'ordinarySelectionRef', 'ordinaryProductionRef', 'ordinaryPopulationRef',
              'ordinaryCandidateMetadata', 'newDemoIds', 'addedKeepIds'}
    e = evidence
    need(exact(e, fields) and e['schema'] == 'ohuo-designed-augmentation-evidence-v1', 'shape')
    need(all(e[key] == a[key] for key in ('previousDatasetRef', 'selectionRef', 'ordinarySelectionRef')) and
         e['productionRef'] == plan.get('samplingRef'), 'plan')
    need(all(hex_sha(e[key]) for key in ('previousManifestSHA256', 'previousSamplesSHA256')) and
         all(file_ref(e[key]) for key in ('populationRef', 'selectedMetadataRef', 'exclusionsRef', 'ordinaryPopulationRef')) and
         fixed(e['productionRef']) and fixed(e['ordinaryProductionRef']) and fixed(plan.get('sourceIndexRef')), 'references')
    need(all(isinstance(e[key], list) for key in ('retainedSamples', 'preselectedDemoMetadata', 'ordinaryCandidateMetadata', 'newDemoIds', 'addedKeepIds')) and
         isinstance(samples, list) and isinstance(exclusions, list) and isinstance(raw_lines, list) and len(raw_lines) == len(samples), 'arrays')
    need(all(identified(rows) for rows in (samples, e['retainedSamples'], e['preselectedDemoMetadata'], e['ordinaryCandidateMetadata'])) and
         all(all(isinstance(i, str) and i for i in e[key]) and len(set(e[key])) == len(e[key]) for key in ('newDemoIds', 'addedKeepIds')), 'duplicate')
    need(all(isinstance(line, bytes) and read_json(line) == row for line, row in zip(raw_lines, samples)), 'sample_bytes')
    by_id = {row['decisionId']: (row, line) for row, line in zip(samples, raw_lines)}
    retained = {}
    prior_lines = []
    for r in e['retainedSamples']:
        need(exact(r, ('decisionId', 'sampleSHA256')) and hex_sha(r['sampleSHA256']), 'retained_shape')
        pair = by_id.get(r['decisionId'])
        need(pair is not None and sha(pair[1]) == r['sampleSHA256'], 'retained_changed')
        retained[r['decisionId']] = read_json(pair[1])
        prior_lines.append(pair[1])
    need([s['decisionId'] for s in samples[:len(retained)]] == [r['decisionId'] for r in e['retainedSamples']], 'retained_order')
    need(sha(b''.join(line + b'\n' for line in prior_lines)) == e['previousSamplesSHA256'], 'retained_file_hash')
    demo = {}
    for m in e['preselectedDemoMetadata']:
        need(exact(m, ('decisionId', 'key', 'inputSHA256', 'sourceRef', 'sourceIndexRef', 'sourceSHA256', 'replaySHA256', 'sourceFamily')) and
             isinstance(m['sourceFamily'], str) and m['sourceFamily'] and isinstance(m['key'], dict) and
             all(hex_sha(m[k]) for k in ('inputSHA256', 'sourceSHA256', 'replaySHA256')) and
             fixed(m['sourceRef']) and fixed(m['sourceIndexRef']) and m['sourceIndexRef'] == plan['sourceIndexRef'] and m['decisionId'] not in retained, 'demo_metadata')
        demo[m['decisionId']] = m
    ordinary = {}
    for rank, m in enumerate(e['ordinaryCandidateMetadata']):
        need(exact(m, ('decisionId', 'key', 'inputSHA256', 'rank', 'sourceFamily', 'sourceRef', 'contextSHA256')) and
             type(m['rank']) is int and m['rank'] == rank and isinstance(m['sourceFamily'], str) and m['sourceFamily'] and
             isinstance(m['key'], dict) and fixed(m['sourceRef']) and hex_sha(m['inputSHA256']) and hex_sha(m['contextSHA256']), 'ordinary_metadata')
        ordinary[m['decisionId']] = m
    new_demo_ids, added_keep_ids = [], []
    for row in samples:
        if row['decisionId'] in retained:
            continue
        p = row.get('provenance')
        if row.get('sampleKind') == 'demo':
            m = demo.get(row['decisionId'])
            validate_designed_provenance(p)
            need(m is not None and row.get('split') == 'train' and row.get('sampleClass') == 'target' and
                 row.get('executionKind') == 'offline_suggested' and row.get('sourceFamily') == m['sourceFamily'] and
                 row.get('sourceRef') == m['sourceRef'] and row.get('key') == m['key'] and
                 all(p[k] == m[k] for k in ('inputSHA256', 'sourceRef', 'sourceIndexRef', 'sourceSHA256', 'replaySHA256')) and
                 p['samplingRef'] == plan['samplingRef'], 'demo_binding')
            new_demo_ids.append(row['decisionId'])
        else:
            m = ordinary.get(row['decisionId'])
            need(m is not None and row.get('sampleKind') == 'keep' and row.get('split') == 'train' and row.get('sampleClass') == 'ordinary' and
                 isinstance(p, dict) and 'sourceKind' not in p and p.get('samplingRef') == plan['samplingRef'] and
                 p.get('inputSHA256') == m['inputSHA256'] and all(row.get(k) == m[k] for k in ('sourceFamily', 'sourceRef', 'contextSHA256', 'key')), 'keep_binding')
            added_keep_ids.append(row['decisionId'])
    need(new_demo_ids == e['newDemoIds'] and added_keep_ids == e['addedKeepIds'], 'growth')
    for m in demo.values():
        failed = [x for x in exclusions if isinstance(x, dict) and x.get('sourceKind') == 'designed-synthetic' and
                  x.get('decisionId') == m['decisionId'] and x.get('sourceRef') == m['sourceRef'] and x.get('sourceSHA256') == m['sourceSHA256']]
        need(len(failed) == (0 if m['decisionId'] in new_demo_ids else 1), 'full_denominator')
        if failed:
            need(isinstance(failed[0].get('reason'), str) and failed[0]['reason'].strip(), 'full_denominator')
    old_keep = [r['decisionId'] for r in samples[:len(retained)] if r.get('split') == 'train' and r.get('sampleKind') == 'keep']
    need([m['decisionId'] for m in e['ordinaryCandidateMetadata'][:len(old_keep)]] == old_keep, 'retained_keep_prefix')
    eligible = [m['decisionId'] for m in e['ordinaryCandidateMetadata'] if m['decisionId'] not in set(old_keep)]
    need(added_keep_ids == eligible[:len(added_keep_ids)], 'keep_prefix')
    train_demo_count = sum(s.get('split') == 'train' and s.get('sampleKind') == 'demo' for s in samples)
    need(len(added_keep_ids) <= train_demo_count - len(old_keep), 'keep_count')
    return retained


def validate_first_round_row(row, input_contract):
    require(input_contract == STUDENT_INPUT_CONTRACT, 'first-round explicit423 required')
    keys = {'schema', 'sampleKind', 'sampleClass', 'decisionId', 'sourceFamily', 'sourceRef', 'split', 'key',
            'observationRef', 'contextSHA256', 'encoderVersion', 'candidateSpecRef', 'candidatePolicy',
            'candidateIds', 'candidateOriginalIndices', 'candidateCanonicalIds', 'candidateFeatures', 'rawQ',
            'proposalRawQ', 'baseActionId', 'basePolicyRef', 'studentParentRef', 'qualityFlags', 'provenance'}
    if row.get('sampleKind') == 'demo':
        keys.update(('targetIds', 'teacherPolicyRef', 'labelKind', 'executionKind', 'labelSourceRef',
                     'evidenceGrade', 'direction', 'validationRef'))
    require(set(row) == keys, 'first-round sample fields')
    require(row['schema'] == FIRST_ROUND_SAMPLE_SCHEMA and candidate_contract(row), 'first-round sample schema')
    provenance = row['provenance']
    require(isinstance(provenance, dict), 'first-round provenance')
    if 'sourceKind' in provenance:
        validate_designed_provenance(provenance)
        require(row['split'] == 'train' and row['sampleKind'] == 'demo' and row['sampleClass'] == 'target' and
                row.get('executionKind') == 'offline_suggested', 'designed sample branch')
        require(provenance['sourceRef'] == row['sourceRef'], 'designed source reference')
    else:
        require(set(provenance) == {'inputSHA256', 'recordSHA256', 'matchSHA256', 'samplingRef'} and
                all(isinstance(provenance[key], str) and re.fullmatch(r'[a-f0-9]{64}', provenance[key])
                    for key in ('inputSHA256', 'recordSHA256', 'matchSHA256')) and
                isinstance(provenance['samplingRef'], str) and
                re.fullmatch(r'.+@sha256:[a-f0-9]{64}', provenance['samplingRef']), 'first-round natural provenance')
    require(isinstance(row['studentParentRef'], str) and
            re.fullmatch(r'.+@sha256:[a-f0-9]{64}', row['studentParentRef']), 'first-round student parent reference')
    require(len(row['candidateCanonicalIds']) == len(row['candidateIds']) and
            len(set(row['candidateCanonicalIds'])) == len(row['candidateIds']) and
            all(isinstance(v, str) and v for v in row['candidateCanonicalIds']), 'first-round canonical mapping')
    require(len(row['proposalRawQ']) == len(row['candidateIds']) and
            all(type(v) in (int, float) and math.isfinite(v) for v in row['proposalRawQ']), 'first-round proposal scores')
    for values in row['candidateFeatures']:
        require(len(values) == 423, 'first-round feature shape')
        for value in values:
            require(type(value) in (int, float) and math.isfinite(value) and abs(value) <= 3.4028234663852886e38 and
                    struct.unpack('<f', struct.pack('<f', value))[0] == value, 'first-round finite float32 input')
    if row['sampleKind'] == 'demo':
        require(row['sampleClass'] == 'target' and row['evidenceGrade'] in ('provisional_screened', 'strong_supported'),
                'first-round demo evidence grade')
        ref = row['validationRef']
        require(isinstance(ref, dict) and set(ref) == {'id', 'sha256'} and isinstance(ref['id'], str) and ref['id'] and
                isinstance(ref['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', ref['sha256']), 'first-round validation reference')
        first_round_direction(row)
    else:
        require(row['sampleKind'] == 'keep' and row['sampleClass'] == 'ordinary', 'first-round ordinary keep required')


def validate_first_round_identities(identities, input_contract):
    require(input_contract == STUDENT_INPUT_CONTRACT and identities.get('encoderConfig') == input_contract and
            identities.get('encoderVersion') == input_contract['encoderVersion'] and candidate_contract(identities),
            'first-round input/candidate identity')
    parent = identities.get('studentScorer', {})
    require(set(parent) == {'schema', 'policyId', 'modelVersion', 'architectureId', 'weightsLayoutVersion',
            'parameterCount', 'inputDim', 'weightsPathOrUrl', 'weightsSHA256', 'encoder', 'tieBreakId'} and
            parent.get('schema') == 'ohuo-student-scorer-v1' and
            all(isinstance(parent.get(k), str) and parent[k].strip() for k in ('policyId', 'modelVersion')) and
            isinstance(parent.get('weightsPathOrUrl'), dict) and
            set(parent['weightsPathOrUrl']).issubset({'nodePath', 'assetUrl'}) and
            all(isinstance(v, str) and v and not pathlib.PurePosixPath(v).is_absolute() and '..' not in v.split('/')
                for v in parent['weightsPathOrUrl'].values()) and parent.get('inputDim') == 423 and
            parent.get('parameterCount') == 174593 and parent.get('encoder') == input_contract and
            parent.get('architectureId') == 'mlp-tanh-256x256-scalar-v1' and
            parent.get('weightsLayoutVersion') == 'f32le-layer-w-row-major-then-b-v1' and
            parent.get('tieBreakId') == 'first-candidate-v1' and
            isinstance(parent.get('weightsSHA256'), str) and re.fullmatch(r'[a-f0-9]{64}', parent['weightsSHA256']),
            'first-round S0 descriptor identity')
    require(identities.get('basePolicy', {}).get('inputDim') == 399 and
            identities['basePolicy'].get('encoderVersion') == 'gd-lab-schema-v4' and
            identities.get('proposalEncoderConfig') == {'schema': 'v2', 'ctxFill': 'rule-context', 'passEncoding': 'action64'},
            'first-round B399 proposal identity')
    require(isinstance(identities.get('studentParentRef'), str) and
            re.fullmatch(r'.+@sha256:[a-f0-9]{64}', identities['studentParentRef']), 'first-round parent reference')
    ref = identities.get('migrationReceiptRef')
    require(isinstance(ref, dict) and set(ref) == {'id', 'sha256'} and isinstance(ref['id'], str) and ref['id'] and
            isinstance(ref['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', ref['sha256']), 'first-round migration reference')


def validate_first_round_dataset_rows(rows, families, research, r2=False):
    # Recheck frozen arithmetic at the Python boundary. The original TS freezer
    # alone resolves hard-check/screen evidence; these checks never create it.
    bound = {f['sourceFamily']: f['split'] for f in families}
    require(len(bound) == len(families) and all(s in ('train', 'dev') for s in bound.values()), 'first-round family binding')
    counts = {s: {'demo': 0, 'keep': 0} for s in ('train', 'dev')}
    family_demo = defaultdict(int)
    directions = {s: {d: set() for d in ('pass', 'takeover')} for s in counts}
    groups = defaultdict(list)
    for row in rows:
        require(bound.get(row['sourceFamily']) == row['split'], 'first-round family split')
        counts[row['split']][row['sampleKind']] += 1
        if row['sampleKind'] == 'demo':
            family_demo[row['sourceFamily']] += 1
            directions[row['split']][first_round_direction(row)].add(row['sourceFamily'])
            raw = b''.join(struct.pack('<f', value) for values in row['candidateFeatures'] for value in values)
            key = (row['candidateSpecRef'], tuple(row['candidateCanonicalIds']), raw)
            if row['evidenceGrade'] == 'strong_supported':
                targets = {row['candidateCanonicalIds'][row['candidateIds'].index(t)] for t in row['targetIds']}
                require(all(targets.intersection(other) for other in groups[key]), 'student_information_gap/label_conflict')
                groups[key].append(targets)
    if r2:
        require(0 < counts['train']['demo'] == counts['train']['keep'], 'r2 sample balance')
        if research:
            require(0 < counts['dev']['demo'] == counts['dev']['keep'] and all(len(directions[s][d]) > 1 for s in counts for d in ('pass', 'takeover')), 'r2 bidirectional multi-source coverage')
        return
    require(0 < counts['train']['demo'] == counts['train']['keep'] <= 16 and
            all(n <= 8 for n in family_demo.values()), 'first-round sample count')
    if research:
        require(len(bound) == 4 and all(list(bound.values()).count(s) == 2 for s in counts), 'first-round two train/two dev families')
        require(0 < counts['dev']['demo'] == counts['dev']['keep'] <= 16, 'first-round dev sample count')
        require(all(len(directions[s][d]) >= 2 for s in counts for d in ('pass', 'takeover')), 'first-round direction coverage')


def validate_first_round_progress(state, demo, keep, seed, limit):
    steps = state['optimizerSteps']
    require(type(steps) is int and 0 <= steps <= limit and state['epoch'] == steps and
            state['demoCursor'] == 0, 'first-round progress')
    require(state['demoOrder'] == (make_epoch_order(demo, seed, steps, 0) if steps < limit else []) and
            state['keepCycle'] == max(0, steps - 1) and state['keepCursor'] == (len(keep) if steps else 0) and
            state['keepOrder'] == make_epoch_order(keep, seed, 0, max(0, steps - 1)), 'first-round progress order')
    require(state['exposures'] == {'demo': {r['decisionId']: steps for r in demo},
                                    'keep': {r['decisionId']: steps for r in keep}}, 'first-round exposure')



def validate_first_round_r2_progress(state, demo, keep, seed, limit):
    steps = state['optimizerSteps']; U = math.ceil(len(demo) / 32)
    require(type(steps) is int and steps >= 0 and (limit is None or steps <= limit), 'r2 checkpoint steps')
    epoch, partial = divmod(steps, U); cursor = partial * 32
    require(state['epoch'] == epoch and state['demoCursor'] == cursor, 'r2 checkpoint cursor')
    order = make_epoch_order(demo, seed, epoch, 0)
    cycle = epoch if cursor else max(0, epoch - 1)
    keep_order = make_epoch_order(keep, seed, 0, cycle)
    require(state['demoOrder'] == order and state['keepCycle'] == cycle and state['keepOrder'] == keep_order and
            state['keepCursor'] == (cursor if cursor else len(keep) if epoch else 0), 'r2 checkpoint order')
    expected = {'demo': {r['decisionId']: epoch for r in demo}, 'keep': {r['decisionId']: epoch for r in keep}}
    for kind, rows, indices in [('demo', demo, order[:cursor]), ('keep', keep, keep_order[:cursor])]:
        for i in indices: expected[kind][rows[i]['decisionId']] += 1
    require(state['exposures'] == expected, 'r2 checkpoint exact exposure')

def validate_decision(row, input_contract=None):
    input_dim = input_dimension(input_contract)
    if input_contract is not None:
        require(row.get('encoderVersion') == input_contract['encoderVersion'], 'student row encoder mismatch')
    require(row.get('sampleKind') in ('demo', 'keep') and row.get('split') in ('train', 'dev'), 'sample branch')
    fresh = candidate_contract(row)
    if row.get('schema') == FIRST_ROUND_SAMPLE_SCHEMA:
        validate_first_round_row(row, input_contract)
    elif fresh:
        require(row.get('schema') == 'ohuo-distill-decision-candidate-v3', 'candidate sample schema')
    ids = row.get('candidateIds', []); k = len(ids)
    require(1 <= k <= (12 if fresh else 8) and all(isinstance(i, str) and i for i in ids) and len(set(ids)) == k, 'candidate IDs')
    original = row.get('candidateOriginalIndices', [])
    require(len(original) == k and len(set(original)) == k and
            all(type(i) is int and 0 <= i <= 9007199254740991 for i in original), 'candidate original indices')
    x = torch.tensor(row.get('candidateFeatures', []), dtype=torch.float32)
    q = torch.tensor(row.get('rawQ', []), dtype=torch.float32)
    require(x.shape == (k, input_dim) and q.shape == (k,) and torch.isfinite(x).all() and
            torch.isfinite(q).all(), 'finite Kx399/rawQ required' if input_dim == 399 else 'finite Kx423/rawQ required')
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


def _same_static_value(before, current):
    # Python equality alone treats False == 0 and True == 1. Preserve the
    # original strict numeric/type rejection when mutable caller data changes.
    if before is current: return True
    if type(before) is not type(current): return False
    if isinstance(before, dict):
        return before.keys() == current.keys() and all(_same_static_value(value, current[key]) for key, value in before.items())
    if isinstance(before, (list, tuple)):
        return len(before) == len(current) and all(_same_static_value(a, b) for a, b in zip(before, current))
    return before == current


class _PreparedDecision:
    """Private static inputs only; never scores, losses or an autograd graph."""
    def __init__(self, row, input_contract, device='cpu', dtype=torch.float32):
        x, q = validate_decision(row, input_contract)
        self.row = copy.deepcopy(row); self.input_contract = copy.deepcopy(input_contract)
        self.x = x.to(device=device, dtype=dtype); self.q = q.to(device=device, dtype=dtype)
        require(torch.isfinite(self.x).all() and torch.isfinite(self.q).all(), 'nonfinite converted decision input')
        self.mask = torch.ones(len(q), dtype=torch.bool, device=device)
        self.targets = torch.tensor([row['candidateIds'].index(t) for t in row.get('targetIds', [])],
                                    dtype=torch.long, device=device)

    def matches(self, row, input_contract, device, dtype):
        return _same_static_value(self.row, row) and _same_static_value(self.input_contract, input_contract) and self.x.device == torch.device(device) and self.x.dtype == dtype

    def loss(self, scores, temperature):
        require(temperature == 1, 'unsupported temperature')
        scores = scores.reshape(-1)
        require(scores.shape == self.q.shape, 'candidate score alignment')
        s = scores[self.mask] / temperature
        require(torch.isfinite(s).all(), 'nonfinite valid scores')
        if self.row['sampleKind'] == 'demo':
            return -torch.logsumexp(torch.log_softmax(s, dim=0)[self.targets], dim=0)
        log_b = torch.log_softmax(self.q[self.mask] / temperature, dim=0)
        return (log_b.exp() * (log_b - torch.log_softmax(s, dim=0))).sum()


def load_frozen_dataset(reference, expected_identities, *, synthetic=False, input_contract=None, r2=False):
    directory = pathlib.Path(reference['directory'])
    require(directory.absolute() == directory.resolve(strict=True), 'dataset symlink/path')
    mp, sp = directory / 'manifest.json', directory / 'samples.jsonl'
    require(not mp.is_symlink() and not sp.is_symlink(), 'dataset file symlink')
    raw = mp.read_bytes(); require(sha(raw) == reference['manifestSHA256'], 'manifest SHA mismatch')
    fresh = candidate_contract(expected_identities)
    m = read_json(raw)
    first_round = m.get('schema') == FIRST_ROUND_DATASET_SCHEMA
    if first_round:
        validate_first_round_identities(expected_identities, input_contract)
        require(m['plan'].get('schema') == FIRST_ROUND_PLAN_SCHEMA, 'first-round plan schema')
        if 'designedAugmentation' in m['plan']:
            validate_designed_augmentation_plan(m['plan'])
    else:
        require('designedAugmentation' not in m['plan'], 'designed first-round plan required')
        require(input_contract is None, 'legacy dataset input contract')
        require(m.get('schema') == ('ohuo-distill-dataset-candidate-v3' if fresh else 'ohuo-distill-dataset-v2'), 'dataset schema')
    if fresh and not first_round:
        require(m['plan'].get('schema') == 'ohuo-distill-plan-candidate-v2' and
                m['plan']['purpose'] == 'engineering_fixture' and
                m['qualification']['eligible'] is False, 'candidate engineering-only contract')
    require(m['plan']['identities'] == expected_identities, 'dataset identities changed')
    require(m['samples']['path'] == 'samples.jsonl', 'samples path')
    data = sp.read_bytes()
    require(sha(data) == m['samples']['sha256'] and len(data) == m['samples']['bytes'], 'sample SHA/bytes mismatch')
    require(not data or data.endswith(b'\n'), 'incomplete sample line')
    rows = [read_json(line) for line in data.splitlines()]
    require(len(rows) == m['samples']['decisions'], 'decision count mismatch')
    retained = None
    if first_round and 'designedAugmentation' in m['plan']:
        retained = validate_designed_evidence(m.get('designedEvidence'), m['plan'], rows, m.get('exclusions'),
                                             data.split(b'\n')[:-1] if data else [])
        require(not m['qualification']['eligible'] or m['designedEvidence']['newDemoIds'], 'designed no new valid demo')
    else:
        require('designedEvidence' not in m, 'designed unexpected evidence')
    if synthetic:
        require(m['plan']['purpose'] == 'engineering_fixture' and (not first_round or m['qualification']['eligible'] is False), 'synthetic fixture required')
    else:
        require(m['plan']['purpose'] == (FIRST_ROUND_PURPOSE if first_round else 'stage4') and m['qualification']['eligible'] is True,
                'diagnostic/ineligible dataset forbidden')
    counts = {'demo': 0, 'keep': 0, 'train': {'demo': 0, 'keep': 0}, 'dev': {'demo': 0, 'keep': 0}}
    ids, contexts = set(), set()
    families = {f['sourceFamily']: f for f in m['plan']['families']}
    prepared_decisions = []
    for row in rows:
        prepared_decisions.append(_PreparedDecision(row, input_contract))
        require(candidate_contract(row) == fresh and row.get('schema') ==
                (FIRST_ROUND_SAMPLE_SCHEMA if first_round else 'ohuo-distill-decision-candidate-v3' if fresh else 'ohuo-distill-decision-v2'), 'sample schema')
        if first_round:
            require(row['studentParentRef'] == expected_identities['studentParentRef'], 'sample student parent changed')
            validate_first_round_designed_binding(m['plan'], row, retained)
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
    if first_round:
        protocol = m['plan'].get('researchProtocol')
        if r2:
            validate_first_round_research_protocol(protocol)
        else:
            require(protocol is None, 'r2 dataset requires matching recipe')
        validate_first_round_dataset_rows(rows, m['plan']['families'], not synthetic, r2)
    return {'manifest': m, 'samples': rows, 'reference': dict(reference), '_prepared_decisions': prepared_decisions}


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
    def __init__(self, samples, parent_flat, frozen_refs, seed, recipe=None, restart_ref=None, input_contract=None, *, _prepared_decisions=None):
        self.input_contract = copy.deepcopy(input_contract); self.input_dim = input_dimension(self.input_contract)
        if self.input_contract is not None:
            require(frozen_refs.get('inputContract') == self.input_contract, 'frozen student input identity required')
        self.recipe = copy.deepcopy(recipe or RECIPE); validate_recipe(self.recipe, restart_ref)
        self.first_round = is_first_round(self.recipe)
        self.r2 = is_first_round_r2(self.recipe)
        require(type(seed) is int and seed >= 0, 'fixed nonnegative seed')
        self.seed = seed; self.refs = copy.deepcopy(frozen_refs); self.restart_ref = copy.deepcopy(restart_ref)
        self.rows = copy.deepcopy(samples)
        require(len({r['decisionId'] for r in self.rows}) == len(self.rows), 'duplicate decision')
        self._prepared_decisions = {}
        for index, row in enumerate(self.rows):
            prepared = _prepared_decisions[index] if _prepared_decisions is not None and index < len(_prepared_decisions) else None
            if not isinstance(prepared, _PreparedDecision) or not prepared.matches(row, self.input_contract, 'cpu', torch.float32):
                prepared = _PreparedDecision(row, self.input_contract)
            self._prepared_decisions[id(row)] = prepared
        self.demo = [r for r in self.rows if r['split'] == 'train' and r['sampleKind'] == 'demo']
        self.keep = [r for r in self.rows if r['split'] == 'train' and r['sampleKind'] == 'keep']
        require(self.demo and self.keep, 'nonempty train demo/keep required')
        require(all((r.get('schema') == FIRST_ROUND_SAMPLE_SCHEMA) == self.first_round for r in self.rows), 'recipe/sample schema mismatch')
        if self.first_round:
            self.shape = first_round_shape(self.recipe, self.refs.get('phase'), len(self.demo), len(self.keep))
            require(self.input_contract == STUDENT_INPUT_CONTRACT and self.refs.get('recipe') == self.recipe and
                    self.refs.get('seed') == seed and self.refs.get('encoder') == self.input_contract['encoderVersion'] and
                    self.refs.get('candidatePolicy') == FIRST_TARGET_CANDIDATE_POLICY and
                    self.refs.get('candidate') == FIRST_TARGET_CANDIDATE_POLICY['candidateSpec'] and
                    self.refs.get('B') != self.refs.get('parent') and self.refs.get('parent') and
                    self.refs.get('parentIdentity', {}).get('inputDim') == 423 and
                    self.refs.get('proposalIdentity', {}).get('inputDim') == 399 and
                    all(r['studentParentRef'] == self.refs['parent'] for r in self.rows), 'first-round frozen parent/proposal binding')
        self.data_digest = sha(json.dumps(self.rows, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
        torch.manual_seed(seed); random.seed(seed)
        self.model = Net(self.input_dim); self.model.load_flat(parent_flat.clone())
        self.parent = Net(self.input_dim); self.parent.load_flat(parent_flat.clone()); self.parent.requires_grad_(False); self.parent.eval()
        self.optimizer = make_optimizer(self.model)
        for group in self.optimizer.param_groups: group['lr'] = self.recipe['learningRate']
        self.optimizerSteps = 0; self.epoch = 0; self.demoCursor = 0; self.keepCursor = 0; self.keepCycle = 0
        self.demoOrder = make_epoch_order(self.demo, seed, 0, 0); self.keepOrder = make_epoch_order(self.keep, seed, 0, 0)
        self.exposures = {'demo': {r['decisionId']: 0 for r in self.demo}, 'keep': {r['decisionId']: 0 for r in self.keep}}
        self.last_step = None; self.metrics = []; self.physical_limit = 32

    def _decision_inputs(self, row):
        parameter = next(self.model.parameters())
        prepared = self._prepared_decisions.get(id(row))
        if prepared is None or not prepared.matches(row, self.input_contract, parameter.device, parameter.dtype):
            fresh = _PreparedDecision(row, self.input_contract, parameter.device, parameter.dtype)
            # Caller-supplied rows are validated every time; only owned frozen
            # decisions occupy this bounded cache. A mutation is revalidated.
            if prepared is not None: self._prepared_decisions[id(row)] = fresh
            prepared = fresh
        return prepared

    def next_batch(self):
        if self.first_round:
            if self.shape['maxOptimizerSteps'] is not None and self.optimizerSteps >= self.shape['maxOptimizerSteps']: return [], []
        elif self.epoch >= self.recipe['maxEpochs']: return [], []
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
                prepared = self._decision_inputs(row); scores = self.model(prepared.x).reshape(-1)
                out.append(prepared.loss(scores, self.recipe['temperature']))
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
            self.demoOrder = make_epoch_order(self.demo, self.seed, self.epoch, 0) if self.r2 or self.epoch < (self.shape['maxOptimizerSteps'] if self.first_round else 3) else []
        self.last_step = {**stats, 'optimizerSteps': self.optimizerSteps, 'epochEnded': ended,
                          'completedEpochs': self.epoch, 'demoIds': [self.demo[i]['decisionId'] for i in d],
                          'keepIds': [self.keep[i]['decisionId'] for i in k]}
        if self.first_round:
            self.last_step['milestone'] = (self.last_step['epochEnded'] or self.refs.get('phase') == 'calibration') if self.r2 else self.optimizerSteps in self.shape['milestoneUpdates']
        return copy.deepcopy(self.last_step)

    def exposure_summary(self):
        return {kind: {'unique': sum(n > 0 for n in values.values()), 'total': sum(values.values()),
                       'repeats': sum(max(0, n - 1) for n in values.values())} for kind, values in self.exposures.items()}

    def _evaluation_rows(self, split=None, family=None, check_initial=False):
        with torch.no_grad():
            for row in self.rows:
                if split is not None and row['split'] != split or family is not None and row['sourceFamily'] != family: continue
                prepared = self._decision_inputs(row); s = self.model(prepared.x).reshape(-1)
                value = float(prepared.loss(s, self.recipe['temperature']))
                require(math.isfinite(value), 'nonfinite dev metric')
                best = min(range(len(s)), key=lambda i: (-float(s[i]), row['candidateOriginalIndices'][i]))
                yield row, value, row['candidateIds'][best], float((s - prepared.q).abs().max()) if check_initial else None

    def _summarize_evaluation(self, observations):
        demos, keeps, dis, changed = [], [], [], []; hits = 0
        directional = {name: {'values': [], 'hits': 0, 'families': set()} for name in ('pass', 'takeover')}
        greedy_changed = 0
        for row, value, action, _ in observations:
            if row['sampleKind'] == 'demo':
                demos.append(value)
                if self.first_round:
                    direction = directional[first_round_direction(row)]
                    direction['values'].append(value); direction['hits'] += action in row['targetIds']
                    direction['families'].add(row['sourceFamily']); greedy_changed += action != row['baseActionId']
                if row.get('sampleClass') == 'target' and row['baseActionId'] not in row['targetIds']:
                    dis.append(value); hits += action in row['targetIds']
            else:
                keeps.append(value)
                if action != row['baseActionId']: changed.append(row['decisionId'])
        avg = lambda xs: sum(xs) / len(xs) if xs else None
        result = {'optimizerSteps': self.optimizerSteps, 'completedEpochs': self.epoch, 'demoCE': avg(demos),
                'keepKL': avg(keeps), 'totalObjective': avg(demos) + self.recipe['keepWeight'] * avg(keeps) if demos and keeps else None, 'demoCount': len(demos), 'targetDisagreementCE': avg(dis), 'targetDisagreementHits': hits,
                'targetDisagreementCount': len(dis), 'targetHitRate': hits / len(dis) if dis else None,
                'keepDriftRate': len(changed) / len(keeps) if keeps else None, 'keepCount': len(keeps),
                'changedKeepCount': len(changed), 'changedKeepSampleIds': sorted(changed, key=lambda s: sha(s.encode()))[:12]}
        if self.first_round:
            result['directionMetrics'] = {name: {'demoCE': avg(item['values']), 'count': len(item['values']),
                'greedyAgreementCount': item['hits'], 'sourceFamilyIds': sorted(item['families'])}
                for name, item in directional.items()}
            result['greedyChangedCount'] = greedy_changed
        return result

    def evaluate_split(self, split, family=None):
        return self._summarize_evaluation(self._evaluation_rows(split, family))

    def evaluate_dev(self):
        return self.evaluate_split('dev')

    def evaluate_milestone(self, check_initial=False):
        # One forward per row at these exact weights. Keep scalar observations
        # only for this invocation; pooled and family folds retain row order.
        observations = list(self._evaluation_rows(check_initial=check_initial))
        equivalence = _initial_equivalence_from_observations(observations) if check_initial else None
        grouped = {split: [] for split in ('train', 'dev')}
        families = {split: defaultdict(list) for split in grouped}
        for item in observations:
            row = item[0]; grouped[row['split']].append(item)
            families[row['split']][row['sourceFamily']].append(item)
        weights = array.array('f', self.model.flat().tolist())
        if sys.byteorder != 'little': weights.byteswap()
        return {**self._summarize_evaluation(grouped['dev']),
                **({'weightsSHA256': sha(weights.tobytes())} if self.r2 else {}),
                **({'equivalence': equivalence} if check_initial else {}),
                'train': self._summarize_evaluation(grouped['train']),
                'families': {split: {family: self._summarize_evaluation(families[split][family])
                    for family in sorted(families[split])} for split in grouped}}

    def capture_state(self):
        return copy.deepcopy({'schema': 'ohuo-supervised-state-first-round-v2' if self.first_round else 'ohuo-supervised-state-student423-v1' if self.input_contract is not None else 'ohuo-supervised-state-v1',
            **({'inputContract': self.input_contract} if self.input_contract is not None else {}), 'trainingKind': 'supervised_rerank',
            'model': self.model.state_dict(), 'optimizer': self.optimizer.state_dict(),
            'torchRNG': torch.get_rng_state(), 'pythonRNG': random.getstate(), 'seed': self.seed,
            'recipe': self.recipe, 'restartRef': self.restart_ref, 'frozenRefs': self.refs, 'dataDigest': self.data_digest,
            'physicalLimit': self.physical_limit, 'optimizerSteps': self.optimizerSteps, 'epoch': self.epoch, 'demoOrder': self.demoOrder,
            'demoCursor': self.demoCursor, 'keepOrder': self.keepOrder, 'keepCursor': self.keepCursor,
            'keepCycle': self.keepCycle, 'exposures': self.exposures, 'lastStep': self.last_step, 'metrics': self.metrics})

    def restore_state(self, state):
        expected_schema = 'ohuo-supervised-state-first-round-v2' if self.first_round else 'ohuo-supervised-state-student423-v1' if self.input_contract is not None else 'ohuo-supervised-state-v1'
        require(state.get('schema') == expected_schema and state.get('trainingKind') == 'supervised_rerank', 'supervised checkpoint schema')
        require(state.get('inputContract') == self.input_contract, 'checkpoint input contract changed')
        for name, value in (('frozenRefs', self.refs), ('dataDigest', self.data_digest), ('recipe', self.recipe),
                            ('seed', self.seed), ('restartRef', self.restart_ref)):
            require(state.get(name) == value, 'checkpoint ' + name + ' changed')
        U = math.ceil(len(self.demo) / 32); steps = state['optimizerSteps']
        if self.r2:
            validate_first_round_r2_progress(state, self.demo, self.keep, self.seed, self.shape['maxOptimizerSteps'])
        elif self.first_round:
            validate_first_round_progress(state, self.demo, self.keep, self.seed, self.shape['maxOptimizerSteps'])
        else:
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
        if self.first_round:
            require(len(state['optimizer']['param_groups']) == 1, 'first-round optimizer group')
            parameters = state['optimizer']['param_groups'][0]['params']
            require(set(state['optimizer']['state']) == (set(parameters) if steps else set()), 'first-round complete optimizer state')
        for group in state['optimizer']['param_groups']:
            require(all(group[k] == v for k, v in {'lr': self.recipe['learningRate'], 'alpha': .9, 'eps': 1e-5,
                    'momentum': 0, 'centered': False, 'weight_decay': 0}.items()), 'checkpoint optimizer recipe')
        for values in state['optimizer']['state'].values():
            require(values['step'].item() == steps and all(not isinstance(v, torch.Tensor) or torch.isfinite(v).all()
                    for v in values.values()), 'checkpoint optimizer state')
        require(type(state['physicalLimit']) is int and 1 <= state['physicalLimit'] <= 32, 'checkpoint physical batch')
        if self.input_contract is not None:
            # RMSprop.load_state_dict itself does not reject mismatched tensor
            # dimensions. Reject old399 accumulators before touching live state.
            parameter_ids = [p for group in state['optimizer']['param_groups'] for p in group['params']]
            parameters = list(self.model.parameters())
            require(len(parameter_ids) == len(parameters) and len(set(parameter_ids)) == len(parameter_ids), 'checkpoint optimizer parameter identities')
            require(set(state['optimizer']['state']).issubset(set(parameter_ids)), 'checkpoint optimizer unknown parameter')
            for pid, parameter in zip(parameter_ids, parameters):
                for name, value in state['optimizer']['state'].get(pid, {}).items():
                    if isinstance(value, torch.Tensor) and name != 'step':
                        require(value.shape == parameter.shape, 'checkpoint optimizer input shape mismatch')
        self.physical_limit = state['physicalLimit']
        self.model.load_state_dict(state['model']); self.optimizer.load_state_dict(state['optimizer'])
        require(all(torch.isfinite(p).all() for p in self.model.parameters()), 'checkpoint nonfinite weights')
        for name in ('optimizerSteps', 'epoch', 'demoOrder', 'demoCursor', 'keepOrder', 'keepCursor', 'keepCycle', 'exposures', 'metrics'):
            setattr(self, name, copy.deepcopy(state[name]))
        self.last_step = copy.deepcopy(state['lastStep']); torch.set_rng_state(state['torchRNG']); random.setstate(state['pythonRNG'])
        # Identity checks above remain mandatory. Reuse static inputs only if
        # this learner's exact rows, input contract, device and dtype still match.
        for row in self.rows: self._decision_inputs(row)


def _initial_equivalence_from_observations(observations):
    maximum = 0.
    for row, _, action, difference in observations:
        maximum = max(maximum, difference)
        require(action == row['baseActionId'], 'update0 greedy differs from frozen B')
    require(maximum <= 1e-5, 'update0 frozen rawQ differs from parent forward')
    return {'maximumRawQAbsoluteDifference': maximum, 'decisions': len(observations), 'greedyIdentical': True, 'atol': 1e-5}


def initial_equivalence(learner):
    return _initial_equivalence_from_observations(list(learner._evaluation_rows(check_initial=True)))


def worker_main():
    sys.modules.setdefault('distill_learner', sys.modules[__name__])
    from distill_checkpoint import commit_checkpoint, restore_checkpoint, publish_checkpoint
    torch.set_num_threads(2); torch.set_num_interop_threads(1); torch.use_deterministic_algorithms(True)
    learner = None; run_dir = None; checkpoint_validation = {}
    def reply(value): print(json.dumps(value, separators=(',', ':'), allow_nan=False), flush=True)
    # Actual optional dependency identity is reported by this already-owned
    # worker. Missing NumPy is valid; a broken installed dependency is not.
    try:
        import numpy
        numpy_version = str(numpy.__version__)
    except ModuleNotFoundError as error:
        if error.name != 'numpy':
            raise
        numpy_version = None
    reply({'kind': 'ready', 'python': sys.executable, 'torch': str(torch.__version__),
           'version': sys.version.split()[0], 'numpyVersion': numpy_version,
           'torchVersion': str(torch.__version__)})
    for line in sys.stdin:
        try:
            command = read_json(line); kind = command['kind']
            if kind == 'init':
                require(learner is None, 'already initialized')
                data = load_frozen_dataset(command['dataset'], command['identities'], synthetic=command['synthetic'], input_contract=command.get('inputContract'), r2=is_first_round_r2(command.get('recipe')))
                parent = pathlib.Path(command['parentPath']).read_bytes()
                require(sha(parent) == command['parentSHA256'], 'parent SHA changed')
                if is_first_round(command['recipe']):
                    identities, refs = command['identities'], command['frozenRefs']
                    require(data['manifest']['schema'] == FIRST_ROUND_DATASET_SCHEMA and
                            refs.get('parent') == identities['studentParentRef'] and
                            refs.get('parentIdentity') == identities['studentScorer'] and
                            refs.get('proposalIdentity') == identities['basePolicy'] and
                            command['parentSHA256'] == identities['studentScorer']['weightsSHA256'], 'worker first-round parent binding')
                flat = torch.frombuffer(bytearray(parent), dtype=torch.float32).clone()
                learner = DistillLearner(data['samples'], flat, command['frozenRefs'], command['seed'], command['recipe'], command.get('restartRef'), command.get('inputContract'), _prepared_decisions=data['_prepared_decisions'])
                del data, parent, flat
                run_dir = pathlib.Path(command['runDir']); require(run_dir.resolve() == run_dir.absolute(), 'run symlink')
                if command.get('checkpoint') is not None: restore_checkpoint(run_dir, learner, command['checkpoint'], _validation_cache=checkpoint_validation)
                else: learner.metrics.append({'kind': 'update0', **learner.evaluate_milestone(check_initial=True)})
                reply({'kind': 'initialized', 'optimizerSteps': learner.optimizerSteps, 'metrics': learner.metrics,
                       'exposure': learner.exposure_summary(), 'Uepoch': math.ceil(len(learner.demo) / 32)})
            elif kind == 'step':
                require(learner is not None and command['expectedStep'] == learner.optimizerSteps + 1, 'step sequence')
                result = learner.step_next(command['physicalDecisions'])
                if result.get('milestone', result['epochEnded']):
                    learner.metrics.append({'kind': 'milestone' if learner.first_round else 'epoch', **learner.evaluate_milestone()})
                ref = commit_checkpoint(run_dir, learner, {'step': result, 'metrics': learner.metrics}, publish=False)
                reply({'kind': 'stepped', 'checkpoint': ref, 'step': result, 'metrics': learner.metrics, 'exposure': learner.exposure_summary()})
            elif kind == 'save':
                require(learner is not None, 'initialize first')
                ref = commit_checkpoint(run_dir, learner, {'metrics': learner.metrics}, publish=False)
                reply({'kind': 'saved', 'checkpoint': ref, 'metrics': learner.metrics, 'exposure': learner.exposure_summary()})
            elif kind == 'publish':
                require(learner is not None and command['checkpoint']['optimizerSteps'] == learner.optimizerSteps, 'publish step sequence')
                publish_checkpoint(run_dir, command['checkpoint'], _validation_cache=checkpoint_validation); reply({'kind': 'published'})
            elif kind == 'close': reply({'kind': 'closed'}); return
            else: raise ValueError('unsupported supervised command')
        except Exception as error:
            reply({'kind': 'error', 'reason': str(error)}); raise SystemExit(1)
    raise SystemExit('controller disconnected')


if __name__ == '__main__': worker_main()
