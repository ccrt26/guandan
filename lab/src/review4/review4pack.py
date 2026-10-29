#!/usr/bin/env python3
"""lab/src/review4/review4pack.py — REVIEW4 证据包打包（RETURN-4.0 契约）。
zip 根：README/MANIFEST/SHA256SUMS/MISSING/report/protocol/source/prior_review3/
training/evaluation/external/human/coaching/product/reviews。
标准库 zipfile.testzip CRC 自检 + 新目录解压校验全部 manifest hash → package_check.json。
用法: python3 lab/src/review4/review4pack.py [--date 20261028]
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
R2 = os.path.join(ROOT, 'lab', 'review2')
R4 = os.path.join(R2, 'review4')
DATE = sys.argv[sys.argv.index('--date') + 1] if '--date' in sys.argv else datetime.now().strftime('%Y%m%d')
OUT = os.path.join(R4, f'REVIEW4_EVIDENCE_{DATE}.zip')


def sha256(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


# (zip内路径, 磁盘路径|None, origin, 说明)
FILES = []


def add(zip_path, disk_path, origin, note=''):
    if disk_path and os.path.exists(os.path.join(ROOT, disk_path) if not os.path.isabs(disk_path) else disk_path):
        FILES.append((zip_path, os.path.join(ROOT, disk_path) if not os.path.isabs(disk_path) else disk_path, origin, note))
    else:
        FILES.append((zip_path, None, 'missing', note))


# protocol
for f in ['lab/review2/protocol-v3.json', 'lab/review2/protocol-v4-draft.json', 'lab/review2/protocol-v4.json',
          'lab/review2/review4/selection.json', 'lab/review2/review4/parent.json',
          'lab/review2/review4/candidate-lock.json', 'lab/review2/review4/common-endpoint.json',
          'lab/review2/review4/implementation-map.json', 'lab/review2/review2freeze.ts' if False else 'lab/src/review4/review4freeze.ts',
          'lab/review2/COMMANDS.txt']:
    name = os.path.basename(f)
    add(f'protocol/{name}', f, 'derived' if 'draft' in f else 'original')
# 源码（本轮实际改动+冻结快照清单）
for f in ['packages/engine/src/combo.ts', 'packages/engine/src/record.ts', 'packages/ai/src/heuristic.ts',
          'packages/ai/src/nn/schema.ts', 'packages/ai/src/nn/mlp.ts', 'packages/ai/src/nn/neuralSeat.ts',
          'packages/ai/src/nn/nnplayer.ts', 'packages/review/src/decisionReview.ts', 'packages/review/src/coachJson.ts',
          'packages/review/src/teamContext.ts', 'packages/review/src/infoset.ts', 'packages/review/src/counterfactual.ts',
          'packages/review/src/analyzer.ts', 'packages/review/src/nnAdvisor.ts', 'packages/review/src/index.ts',
          'lab/src/review2train.ts', 'lab/src/review2case.ts', 'lab/src/clean1.ts', 'lab/src/wave_worker.ts', 'lab/learner.py',
          'lab/src/review4/review4audit.ts', 'lab/src/review4/review4auditA3.ts', 'lab/src/review4/review4confirmRepro.ts',
          'lab/src/review4/cand_profile_v3.ts', 'lab/src/review4/review4cases.ts', 'lab/src/review4/review4report.ts',
          'lab/src/review4/fcheck.ts', 'lab/src/review4/d1check.ts', 'lab/src/review4/export_blocks_format.py',
          'lab/review2/frozen/review4-snapshot/SHA256SUMS.json', 'lab/review2/run.mjs']:
    add(f'source/{f}', f, 'original')
# prior_review3
for f in ['lab/review2/runs/clean2-main/state.json', 'lab/review2/runs/clean2-main/dev.json',
          'lab/review2/runs/clean2-main/confirm_confirm-attempt1.json', 'lab/review2/runs/clean2-main/confirm_confirm-attempt2.json',
          'lab/review2/runs/clean2-replica/state.json', 'lab/review2/runs/clean2-replica/dev.json',
          'lab/review2/selected/candidate.json', 'lab/review2/runs/llm_ledger.json']:
    add(f'prior_review3/{f}', f, 'original')
for run in ['clean2-main', 'clean2-replica']:
    lp = f'lab/review2/runs/{run}/runtime_ledger.jsonl'
    add(f'prior_review3/{lp}', lp, 'original', '账本原件（尾行可能无换行）')
# training
for run in ['review4-control', 'review4-treatment']:
    add(f'training/{run}/state.json', f'lab/review2/runs/{run}/state.json', 'original')
    add(f'training/{run}/runtime_ledger.jsonl', f'lab/review2/runs/{run}/runtime_ledger.jsonl', 'original')
    for ck in ['ck-0', 'ck-600', 'ck-1200', 'ck-1800']:
        add(f'training/{run}/{ck}_weights.meta.json', f'lab/review2/runs/{run}/{ck}/weights.f32', 'weights-not-included', '大权重仅记 SHA，见 MANIFEST')
# evaluation
for f in ['lab/review2/review4/review4-dev.json', 'lab/review2/review4/review4-confirm.json']:
    add(f'evaluation/{os.path.basename(f)}', f, 'derived')
# A 组审计
for f in ['a0-status.json', 'a0-git-status.txt', 'candidate-boundaries.json', 'observation-collision.json',
          'ledger-reconciliation.json', 'confirmation-recheck.json', 'candidate_profile_v3.json']:
    add(f'evaluation/audit/{f}', f'lab/review2/review4/audit/{f}', 'derived')
# statistics
for f in ['repro-confirm-attempt1.json', 'repro-confirm-attempt2.json', 'review3-blocks.json', 'review3-sensitivity.json']:
    add(f'evaluation/statistics/{f}', f'lab/review2/review4/statistics/{f}', 'derived')
# external / human
for f in ['scalar.json', 'torch-forward.json', 'danzero-converted/manifest.json', 'kscb-structural20.json', 'gate-selftest.json']:
    add(f'external/{f}', f'lab/review2/review4/external/{f}', 'original')
for f in ['FILE_COPIES.SHA256']:
    add(f'external/tools/{f}', f'lab/review2/review4/tools/{f}', 'derived')
# coaching
add('coaching/case-index.json', 'lab/review2/review4/cases/case-index.json', 'original')
for sub in ['semantic-index.json', 'rollout-pilot.json', 'llm-acceptance.json']:
    add(f'coaching/{sub}', f'lab/review2/review4/cases/{sub}', 'original')
add('coaching/facts-summary.json', 'lab/review2/runs/review/review4-semantic-1.0-facts-summary.json', 'derived')
add('coaching/llm-coach-summary.json', 'lab/review2/runs/review/review4-llm-acceptance-1.0-coach-summary.json', 'derived')
import glob
for ev in sorted(glob.glob(f'{R2}/runs/review/r4-*.evidence.json'))[:40]:
    add(f'coaching/evidence/{os.path.basename(ev)}', ev, 'derived')
for cf in sorted(glob.glob(f'{R2}/cache/coach-json-v2/*.json'))[:20]:
    add(f'coaching/cache/{os.path.basename(cf)}', cf, 'original', 'LLM 响应缓存（含验证与渲染）')
# product
add('product/deployed-meta.json', 'packages/web/public/ai/clean2.meta.json', 'original')
add('product/d1check-output.txt', 'lab/review2/review4/audit/d1check-output.txt', 'derived')
# reviews（交付包审查文件不重复打包；标注来源）


def main():
    manifest = {'version': 'REVIEW4-EVIDENCE-1.0', 'generatedAt': datetime.now().isoformat(), 'files': []}
    missing = []
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for zp, dp, origin, note in FILES:
            if dp is None:
                missing.append({'requiredItem': zp, 'status': 'not_run' if 'adapter' in zp else 'unavailable',
                                'reason': note or '本轮未执行/不存在', 'impact': '对应结论缺失', 'lastAttempt': None,
                                'externalActionNeeded': None})
                continue
            data = open(dp, 'rb').read()
            z.writestr(zp, data)
            manifest['files'].append({
                'relativePath': zp, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                'artifactType': 'weights-ref' if origin == 'weights-not-included' else 'json/text',
                'origin': 'original' if origin in ('original', 'weights-not-included') else 'derived',
                'note': note, 'sourceDiskPath': os.path.relpath(dp, ROOT),
            })
        z.writestr('MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=1))
        z.writestr('MISSING.json', json.dumps(missing, ensure_ascii=False, indent=1))
        z.writestr('README.txt', 'REVIEW4 证据包：见 report/REVIEW4_EXECUTION_REPORT.md 与 MANIFEST.json；'
                                 '缺失项在 MISSING.json；zip 经 zipfile.testzip CRC 自检与新目录解压 hash 校验（package_check.json）。\n')
        report = os.path.join(R4, 'REVIEW4_EXECUTION_REPORT.md')
        if os.path.exists(report):
            z.writestr('report/REVIEW4_EXECUTION_REPORT.md', open(report, encoding='utf-8').read())
        # SHA256SUMS（zip 内成员）
        sums = ''.join(f"{f['sha256']}  {f['relativePath']}\n" for f in manifest['files'])
        z.writestr('SHA256SUMS', sums)

    # 自检：CRC + 解压校验
    with zipfile.ZipFile(OUT) as z:
        bad = z.testzip()
        assert bad is None, f'CRC 失败: {bad}'
        with tempfile.TemporaryDirectory() as td:
            z.extractall(td)
            checked = 0
            for f in manifest['files']:
                p = os.path.join(td, f['relativePath'])
                assert os.path.exists(p), f'解压缺失 {f["relativePath"]}'
                assert sha256(p) == f['sha256'], f'hash 不符 {f["relativePath"]}'
                checked += 1
    check = {'zip': os.path.basename(OUT), 'bytes': os.path.getsize(OUT), 'crcOk': True,
             'extractedFilesChecked': checked, 'manifestCount': len(manifest['files']), 'missingCount': len(missing)}
    json.dump(check, open(os.path.join(R4, 'package_check.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(check, ensure_ascii=False))


if __name__ == '__main__':
    main()
