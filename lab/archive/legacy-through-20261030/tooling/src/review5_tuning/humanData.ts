/**
 * lab/src/review5_tuning/humanData.ts — REVIEW5 T3：KSCB 语义回放全流程。
 * 输出（lab/review5/artifacts/）：
 *   t3-semantic-report.json  逐场逐副验证结果+失败分类
 *   t3-match-manifest.json   100 场 60/20/20 拆分（SHA256(sourceSha+matchId+ns) 稳定排序）
 *   t3-coverage.json         决策提取与候选覆盖率（H_human 数据门）
 * 映射：54 码约束求解表（kscb-mapping.json）+ band1=♥（24 置换验证唯一幸存组）
 * 运行：npx tsx lab/src/review5_tuning/humanData.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canPass, classify, createMatch, DEFAULT_RULES, legalCombos, startGame, applyMove,
  type Card, type GameState,
} from '@gd/engine';
import { NeuralDecider, dedupCandidates as dedupX } from '@gd/ai';
import { loadMatches, verifyRound, DEFAULT_MAPPING, codeOfCard, decodeTiles, SUIT_BANDS, JOKER_SMALL, JOKER_BIG, type KscbRound, type RoundVerdict } from './kscbReplay';

const REPO = join(import.meta.dirname, '..', '..', '..');
const ART = join(REPO, 'lab', 'review5', 'artifacts');
const DATA = join(REPO, 'lab', 'review2', 'assets', 'kscb-guandan', '1e5c5d1b7634a4eb973ad3364a46ef494074e205', 'guandan_matches.jsonl.gz');
const SOURCE_SHA = '72377a12553c85c2f3ecdc7fede553ef1382ac5465179606a623bc61f9648cfa';

// ---- 拆分规则（EXECUTION_PLAN §6）：first20=已见；其余按 SHA256(sourceSha:matchId:review5-human-v1) 升序取 80 ----
function selectManifest(matches: Array<{ idx: number; id: string }>): { train: string[]; dev: string[]; holdout: string[] } {
  const first20 = matches.slice(0, 20).map((m) => m.id);
  const rest = matches.slice(20).map((m) => ({
    id: m.id,
    h: createHash('sha256').update(`${SOURCE_SHA}:${m.id}:review5-human-v1`).digest('hex'),
  })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  const next80 = rest.slice(0, 80).map((m) => m.id);
  const train = [...first20, ...next80.slice(0, 40)];
  const dev = next80.slice(40, 60);
  const holdout = next80.slice(60, 80);
  return { train, dev, holdout };
}

function main(): void {
  mkdirSync(ART, { recursive: true });
  const t0 = Date.now();
  const matches = loadMatches(DATA, 1305);
  console.log(`加载 ${matches.length} match`);
  const ids = matches.slice(0, 100).map((m, i) => ({ idx: i, id: m.sample_id })); // 拆分全集=回放的 100 场
  const manifest = selectManifest(ids);
  const splitOf = new Map<string, string>([
    ...manifest.train.map((id) => [id, 'train'] as const),
    ...manifest.dev.map((id) => [id, 'dev'] as const),
    ...manifest.holdout.map((id) => [id, 'holdout'] as const),
  ]);

  // 逐场逐副验证（整场 100 match；round 数按拆分记录）
  const allVerdicts: Array<RoundVerdict & { matchId: string; split: string }> = [];
  const decisions: ExtractedDecision[] = [];
  let replayedMatches = 0;
  for (const m of matches.slice(0, 100)) {
    const split = splitOf.get(m.sample_id) ?? 'unassigned';
    let levelRank = 2;
    for (const r of m.rounds) {
      const ev1 = r.events.find((e) => e.event_id === 1);
      const lv = ev1?.tiles?.[0] ?? r.host_team_level ?? null;
      levelRank = lv != null && lv >= 1 && lv <= 13 ? (lv === 1 ? 14 : lv) : levelRank;
      const v = verifyRound(r, DEFAULT_MAPPING, null, (info) => {
        decisions.push({ matchId: m.sample_id, sampleId: r.sample_id, split, ...info });
      });
      allVerdicts.push({ ...v, matchId: m.sample_id, split });
      void levelRank;
    }
    replayedMatches += 1;
  }

  // 汇总
  const byStatus: Record<string, number> = {};
  for (const v of allVerdicts) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
  const ruleDiffPlays = allVerdicts.reduce((s, v) => s + v.ruleDiffPlays, 0);
  const prunedEnum = allVerdicts.reduce((s, v) => s + v.prunedComboValidated, 0);
  const totalPlays = allVerdicts.reduce((s, v) => s + v.plays, 0);
  const quarantined = allVerdicts.filter((v) => v.mismatches.length > 0 || !v.finishOrderOk || !v.finalHandsOk);
  const decTotal = decisions.length;
  const decMatched = decisions.filter((d) => d.candidateMatched).length;
  const bySplit = (sp: string) => {
    const ds = decisions.filter((d) => d.split === sp);
    return { decisions: ds.length, matched: ds.filter((d) => d.candidateMatched).length };
  };
  const report = {
    at: new Date().toISOString(),
    source: { path: DATA, sha256: SOURCE_SHA, matchesTotal: matches.length, replayedMatches },
    suitBandDetermination: 'band1(33-45)=♥（24 置换验证：band1=H 的 6 个置换全过核心验证，其余 18 个在万能牌局大量失败）；其余三带 S/D/C 可互换（合法性不可区分，行为等价）',
    mappingEvidence: 'lab/review5/artifacts/kscb-mapping.json（100 match 单张 value 零冲突 + 132 对子一致）',
    rounds: { total: allVerdicts.length, byStatus, fullyValidated: byStatus.ok ?? 0, ruleDiff: byStatus.rule_diff ?? 0, invalid: byStatus.invalid ?? 0, ambiguous: byStatus.ambiguous ?? 0 },
    plays: { total: totalPlays, ruleDiffPlays, prunedEnumValidated: prunedEnum },
    quarantine: quarantined.slice(0, 20).map((q) => ({ sampleId: q.sampleId, status: q.status, mismatches: q.mismatches })),
    split: { train: manifest.train.length, dev: manifest.dev.length, holdout: manifest.holdout.length,
      rule: 'first20=已见(训练/开发混合,不进新盲留出)；其余按 SHA256(source:matchId:review5-human-v1) 升序取 80：first20+40=train，60-80=dev，80-100=holdout' },
    decisions: {
      total: decTotal, matched: decMatched, coverage: decTotal ? +(decMatched / decTotal).toFixed(4) : 0,
      train: bySplit('train'), dev: bySplit('dev'), holdout: bySplit('holdout'),
      passDecisions: decisions.filter((d) => d.kind === 'pass').length,
      playDecisions: decisions.filter((d) => d.kind === 'play').length,
    },
    humanIdentity: { humanSource: 'author_reported', skill: 'unverified', targetPopulation: 'unknown', playerDisjointness: 'unverified（P1-P4 为局内标识，无跨 match 玩家身份）' },
    computeSec: +((Date.now() - t0) / 1000).toFixed(1),
  };
  writeFileSync(join(ART, 't3-semantic-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(ART, 't3-match-manifest.json'), JSON.stringify({
    at: report.at, sourceSha: SOURCE_SHA, namespace: 'review5-human-v1', ...manifest,
    splitHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  }, null, 2));
  writeFileSync(join(ART, 't3-coverage.json'), JSON.stringify(report.decisions, null, 2));
  console.log(JSON.stringify({
    rounds: report.rounds, plays: report.plays, decisions: report.decisions, computeSec: report.computeSec,
  }, null, 1));
}

void main();
void NeuralDecider; void SUIT_BANDS; void JOKER_SMALL; void JOKER_BIG;
