/**
 * lab/src/human_probe.ts — KSCB 人类牌谱探针（REVIEW3-EXEC §8.2）。
 * decode：资产校验→事件结构统计→牌码映射可得性检查。
 * 当前如实状态：README（中英文）、KSPlay/DanKS 代码（hex 牌码体系）、公开检索
 * 均未提供 KSCB 整数牌码（1-95）→花色点数的映射表；按 §8.2"不能凭牌码频率猜
 * 一份表后直接训练/诊断"，decode 记 blocked（映射来源缺失），diagnose 不执行。
 * 已确认（有来源）：event_id 3=出牌、4=PASS（README 原文）；event 2=每人 27 张
 * 初始手牌（结构：tiles 长度恒 27）；result 字段（win_index/win_type/score/levelup）
 * 语义来自 README。deck 守恒等结构校验在映射可得后执行。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const DATA = join(R2, 'assets', 'kscb-guandan', '1e5c5d1b7634a4eb973ad3364a46ef494074e205', 'guandan_matches.jsonl.gz');

function run(phase: string): number {
  if (!existsSync(DATA)) { console.error('KSCB 数据不存在（先下载校验）'); return 4; }
  const outDir = join(R2, 'human');
  mkdirSync(outDir, { recursive: true });

  // 资产哈希 + 事件统计（流式，python3 标准库 gzip；轻量 ≤12 match 栺本）
  const stats = spawnSync('python3', ['-c', `
import gzip, json, hashlib
from collections import Counter
p = ${JSON.stringify(DATA)}
ev, tiles, rounds, matches = Counter(), set(), 0, 0
hand_lens = Counter()
with gzip.open(p, 'rt') as f:
    for i, line in enumerate(f):
        if i >= 12: break
        matches += 1
        d = json.loads(line)
        rounds += d['round_count']
        for r in d['rounds']:
            for e in r['events']:
                ev[e['event_id']] += 1
                for t in e.get('tiles', []): tiles.add(t)
                if e['event_id'] == 2: hand_lens[len(e.get('tiles', []))] += 1
print(json.dumps({'matches': matches, 'rounds': rounds, 'eventCounts': dict(sorted(ev.items())), 'tileUniverse': len(tiles), 'tileRange': [min(tiles), max(tiles)], 'event2HandLens': dict(hand_lens)}))
`], { encoding: 'utf8', timeout: 300000 });
  const structure = stats.status === 0 ? JSON.parse(stats.stdout.trim().split('\n').pop()!) : { error: String(stats.stderr).slice(0, 200) };

  if (phase === 'decode') {
    const result = {
      phase: 'decode', at: new Date().toISOString(),
      asset: { bytes: 0, sha256: createHash('sha256').update(readFileSync(DATA)).digest('hex'), source: 'CardKS@1e5c5d1 (KSCB/data/guandan_matches.jsonl.gz)' },
      documentedEvents: { '3': '出牌（README 原文）', '4': 'PASS（README 原文）' },
      structuralFindings: structure,
      mappingProvenance: {
        checked: ['KSCB/README.md', 'KSCB/README.zh-CN.md', 'KSPlay guandan 代码（hex 0x01xx 牌码体系，与 KSCB 1-95 十进制不一致）', 'DanKS guandan 代码（同上）', '公开检索（CardKS/KSCB 无结果）'],
        conclusion: '整数牌码→花色点数映射无公开来源；作者 hex 牌码体系与数据文件不一致或存在未发布转换层',
      },
      blockingReason: '无映射来源——按 §8.2 禁止频率猜表；重放守恒校验（108 张/轮）需先有候选映射',
      unlockConditions: ['作者提供映射表或解码代码路径', '或从 KSCB 生成管线源码（未公开部分）取得 tiles 转换层'],
      budget: { probeComputeMsCap: 1800000, usedSampleMatches: 12 },
      status: 'decode_blocked_at_mapping',
    };
    writeFileSync(join(outDir, 'decode.json'), JSON.stringify(result, null, 1));
    console.log(`decode: 受阻于映射来源（结构统计已落盘）。详见 ${join(outDir, 'decode.json')}`);
    return 4;
  }
  if (phase === 'diagnose') {
    const dec = existsSync(join(outDir, 'decode.json')) ? JSON.parse(readFileSync(join(outDir, 'decode.json'), 'utf8')) : null;
    if (!dec || dec.status !== 'decode_ok') {
      console.error(`diagnose: 前置不满足（decode=${dec?.status ?? '未运行'}）——不产生覆盖率/排名统计`);
      return 4;
    }
    console.error('decode 通过路径未实现（本轮未达此前置）');
    return 3;
  }
  console.error('phase 需为 decode|diagnose');
  return 2;
}

const argv = process.argv.slice(2);
const phaseIdx = argv.indexOf('--phase');
if (process.argv[1] && process.argv[1].includes('human_probe')) {
  process.exit(run(phaseIdx >= 0 ? argv[phaseIdx + 1] : ''));
}
export { run };
