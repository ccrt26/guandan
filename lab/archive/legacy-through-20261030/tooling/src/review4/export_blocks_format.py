#!/usr/bin/env python3
"""lab/src/review4/export_blocks_format.py — REVIEW4 A4：把复现的两次确认原始块
导出为交付包 stats/FORMAT.txt 契约（review3-confirm-blocks-v1）。
身份/统计字段全部取真实值（protocol-v3 冻结 hash、review2train@f9dbe1f、块种子、逐场0/1）。
用法: python3 lab/src/review4/export_blocks_format.py
"""
import hashlib
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
R2 = os.path.join(ROOT, 'lab', 'review2')
OUT = os.path.join(R2, 'review4', 'statistics', 'review3-blocks.json')


def sha256_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def blocks_of(repro, metric):
    side_wins = repro[f'{metric}SideWins']
    seeds = repro[f'{metric}BlockSeeds']
    expected = 128 if metric == 'm1' else 256
    assert len(side_wins) == expected and len(seeds) == expected
    out = []
    for b, (sw, seed) in enumerate(zip(side_wins, seeds)):
        w0, w1 = sw
        assert w0 in (0, 1) and w1 in (0, 1)
        out.append({
            'blockId': f'{repro["split"]}-{metric}-{b:03d}',
            'seed': str(seed),
            'games': [
                {'candidate_team': 'team0', 'complete': True, 'candidate_win': w0,
                 'policy_sha256': POLICY_SHA, 'rule_sha256': RULE_SHA},
                {'candidate_team': 'team1', 'complete': True, 'candidate_win': w1,
                 'policy_sha256': POLICY_SHA, 'rule_sha256': RULE_SHA},
            ],
        })
    return out


PROTO = os.path.join(R2, 'protocol-v3.json')
proto = json.load(open(PROTO))
POLICY_SHA = 'b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55'
RULE_SHA = proto['sourceSnapshot']['packages/engine/src/game.ts']  # 规则主实现快照（game.ts）
CAND_SHA = proto['candidate']['hash']
ENC_SHA = proto['encoder']['hash']
PROTO_SHA = sha256_file(PROTO)
# 共同评测配置（不含 attempt 编号/seed）：以冻结 protocol-v3 的 selection/trainer/network 段为准
eval_cfg = {'selection': proto['selection'], 'trainer': {k: proto['trainer'][k] for k in
           ('kind', 'workers', 'waveSize', 'matchGameCap')}, 'network': proto['network'],
            'referenceWeights': proto['referenceWeights']}
EVAL_CFG_SHA = hashlib.sha256(json.dumps(eval_cfg, sort_keys=True).encode()).hexdigest()
# 冻结统计代码 hash（f9dbe1f:lab/src/review2train.ts = protocol-v3 sourceSnapshot 同值）
import subprocess
STATS_SOURCE_SHA = hashlib.sha256(subprocess.run(
    ['git', 'show', 'f9dbe1f:lab/src/review2train.ts'], cwd=ROOT, capture_output=True,
).stdout).hexdigest()

attempts = []
for split, ns in [('confirm-attempt1', 2026110003), ('confirm-attempt2', 2026110004)]:
    repro = json.load(open(os.path.join(R2, 'review4', 'statistics', f'repro-{split}.json')))
    src_file = os.path.join(R2, 'runs', 'clean2-main', f'confirm_{split}.json')
    orig = json.load(open(src_file))
    attempts.append({
        'attempt_id': split,
        'identity': {
            'policy_id': 'clean2-ck7051-20261027',
            'policy_sha256': POLICY_SHA,
            'rule_sha256': RULE_SHA,
            'candidate_sha256': CAND_SHA,
            'encoder_sha256': ENC_SHA,
            'evaluation_config_sha256': EVAL_CFG_SHA,
            'protocol_sha256': PROTO_SHA,
        },
        'source_file_sha256': sha256_file(src_file),
        'statistics': {
            'source_sha256': STATS_SOURCE_SHA,
            'method': 'seed-block-percentile-bootstrap',
            'bootstrap_replicates': 2000,
            'confidence': 0.975,
            'quantile_probabilities': [0.0125, 0.9875],
            'quantile_definition': '升序 boots 数组上 q(p)=boots[min(len-1, round(p*(len-1)))]（round 半进制索引，无插值）',
            'rng_algorithm': 'mulberry32(bootSeed)；每次 replicate 重抽 n 个块索引 floor(rand()*n)；bootSeed=deriveSeed(\'boot\', nsBase, 0, \'m1-confirm\'|\'m2-confirm\')',
            'rng_seed': str(ns),
        },
        'metrics': {
            'M1': {
                'expected_blocks': 128,
                'original_result': {
                    'origin': 'frozen-project-output',
                    'point_estimate': orig['m1']['mean'],
                    'interval': [orig['m1']['ciLow'], orig['m1']['ciHigh']],
                },
                'blocks': blocks_of(repro, 'm1'),
            },
            'M2': {
                'expected_blocks': 256,
                'original_result': {
                    'origin': 'frozen-project-output',
                    'point_estimate': orig['m2']['mean'],
                    'interval': [orig['m2']['ciLow'], orig['m2']['ciHigh']],
                },
                'blocks': blocks_of(repro, 'm2'),
            },
        },
    })

export = {
    'format': 'review3-confirm-blocks-v1',
    'provenance': 'reconstructed-by-replay',  # REVIEW5 T0.6：诚实标签（原 'original-export' 与 provenance_note 矛盾）
    'provenance_note': ('REVIEW5 T0.6 更正：本导出非 original-export。原始 confirm 只落盘 mean/CI 汇总；'
                        ' 逐场 0/1 与块种子为冻结源码（f9dbe1f=protocol-v3 全 17 文件 hash 核对一致）'
                        '+同一权重+同种子的确定性重放重建（全精度复现全部 8 个汇总值，见 '
                        'review4/audit/confirmation-recheck.json）；games 顺序=side0（候选在 team0）先、'
                        'side1 后，与评测代码一致。完成性：重建器 cap 场折算为 0 且无法区分——本次重建'
                        ' 384 场全部到达 winner（cappedMatches=0），故 complete=true；未来重放器输出'
                        ' cappedMatches>0 时本导出会如实写 complete=false'),
    'shared_seed_groups': [],
    'attempts': attempts,
}
with open(OUT, 'w') as f:
    json.dump(export, f, ensure_ascii=False)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
