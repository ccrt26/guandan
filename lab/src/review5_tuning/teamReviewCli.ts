/**
 * REVIEW5 T1 CLI：四席队伍关键事件复盘证据导出（与 packages/review teamReview 同源）。
 * 用法: npx tsx lab/src/review5_tuning/teamReviewCli.ts <record.json> [--viewer 0] [--out out.json]
 * 输出: 事件证据（actor/actionId/目标/替代/条件路线）+ 事故包（政策身份绑定）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameRecord } from '@gd/engine';
import { buildTeamReview, exportIncidentPackage } from '@gd/review';

const argv = process.argv.slice(2);
const recPath = argv[0];
const vIdx = argv.indexOf('--viewer');
const viewer = vIdx >= 0 ? Number(argv[vIdx + 1]) : undefined;
const oIdx = argv.indexOf('--out');
if (!recPath) { console.error('用法: teamReviewCli.ts <record.json> [--viewer 0] [--out out.json]'); process.exit(2); }
const rec = JSON.parse(readFileSync(recPath, 'utf8')) as GameRecord;
const tr = buildTeamReview(rec, viewer != null ? { viewerSeat: viewer } : {});
const out = {
  ...tr,
  incidentPackages: tr.events.map((e) => exportIncidentPackage(rec, e, {
    policyId: 'frozenChampion-clean2-ck7051-encv1-candv2',
    modelVersion: 'clean2-ck7051-20261027', encoderVersion: 'gd-lab-schema-v1', candidateVersion: 'cand-dedup-v2',
  })),
};
const outPath = oIdx >= 0 ? argv[oIdx + 1] : join(import.meta.dirname, '..', '..', 'review5', 'artifacts', 't1-team-review.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`四席复盘: ${tr.events.length} 个队伍关键事件（viewer=${tr.viewerSeat}）→ ${outPath}`);
for (const e of tr.events) console.log(`  m${e.moveNo} actor=${e.actorSeat} ${e.category} ${e.actual.actionId}`);
