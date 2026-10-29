/**
 * lab/src/review2case.ts — R3（REVIEW3-EXEC §3.2/3.3/3.4）：review 子命令真实现。
 *   npx tsx lab/src/review2case.ts --cases <file> [--mode facts|coach|sampled]
 *     [--samples 64] [--max-moves 3] [--max-actions 3] [--max-api-calls 6] [--out-dir D]
 *
 * facts   ：离线生成/读取对局记录 → 校验+回放分级+分析 → DecisionReview 证据 JSON
 *           （含 clean1 ck180 模型排序与单次确定性续打；无任何 LLM 调用）。
 * coach   ：facts 之后做结构化 LLM 短篇讲解（JSON 输出+ID 校验+最多一次重试），
 *           缓存键覆盖 record/evidence/rule/candidate/encoder/policy/weight/prompt 版本；
 *           LLM 账本跨阶段累计（lab/review2/runs/llm_ledger.json），超限拒绝调用。
 * sampled ：R4 信息集比较（默认 64 份暗牌分配，实际/替代配对，g 主指标）。
 *
 * 退出码：0=成功 1=失败 2=参数错误 4=前置条件不满足（如 LLM 配置不可得）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  applyMove, createMatch, DEFAULT_RULES, RNG, Recorder, startGame,
  type GameRecord, type Combo,
} from '@gd/engine';
import { createAI, guardMove, NeuralDecider, NEURAL_MODEL_VERSION, type MLP } from '@gd/ai';
import {
  analyzeGame, buildDecisionReviews, classifyReplay, replay, runCounterfactual,
  validateRecord, normalizeRecord, type DecisionReview, type RolloutEvidence,
  runInfosetCompare, defaultRoots, INFOSET_SENSITIVITY_POLICY,
  buildCoachJsonMessages, parseCoachJson, validateCoachJson, buildRetryMessages,
  COACH_JSON_PROMPT_VERSION, renderFactCards, type CoachJsonOutput, type CoachValidationError,
} from '@gd/review';
import { MLP as LabMLP } from './mlp';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');

// ---------- 参数 ----------
function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  const spec = new Set(['cases', 'mode', 'samples', 'max-moves', 'max-actions', 'max-api-calls', 'out-dir']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { console.error(`位置参数不支持: ${a}`); process.exit(2); }
    const key = a.slice(2);
    if (!spec.has(key)) { console.error(`未知参数: ${a}`); process.exit(2); }
    const v = argv[++i];
    if (v === undefined) { console.error(`--${key} 缺值`); process.exit(2); }
    out[key] = v;
  }
  if (!out.cases) { console.error('需要 --cases <file>'); process.exit(2); }
  out.mode ??= 'facts';
  if (!['facts', 'coach', 'sampled'].includes(out.mode)) { console.error(`未知 mode: ${out.mode}`); process.exit(2); }
  return out;
}

// ---------- 离线真实对局生成（学生席位与对手可用不同难度，产生真实分歧） ----------
export function generateRecord(
  seed: number,
  studentDiff: 0 | 1 | 2 = 0,
  oppDiff: 0 | 1 | 2 = 1,
  humanSeat = 0,
): GameRecord {
  const rng = new RNG(seed);
  const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
  const state = startGame(match);
  const diffs = [0, 1, 2, 3].map((s) => (s === humanSeat ? studentDiff : oppDiff)) as (0 | 1 | 2)[];
  const rec = new Recorder({
    schemaVersion: 2,
    id: `gen-${seed.toString(36)}`,
    matchId: `genmatch-${seed.toString(36)}`,
    createdAt: seed, // 确定性时间戳（离线生成的可复现身份）
    ruleOpts: match.opts,
    levelsBefore: state.levelsBefore,
    stageTeam: state.stageTeam,
    leader: state.leader,
    humanSeat,
    difficulties: diffs,
    aiPolicies: [0, 1, 2, 3].map((s) => `autopilot:L${diffs[s]}`),
    initialHands: state.hands.map((h) => [...h]),
  });
  const ais = [0, 1, 2, 3].map((s) => {
    const a = createAI(s, diffs[s], rng.next() * 0xffffffff);
    a.reset(state, match.opts);
    return a;
  });
  let guardCount = 0;
  while (!state.over && guardCount++ < 2000) {
    const turn = state.turn;
    const toBeat = state.lastCombo;
    const mv = guardMove(state, ais[turn].decide(state) as never);
    const events = applyMove(state, mv as never);
    rec.record(turn, mv, state.hands, toBeat); // 出牌后记录（handsAfter=牌后张数；mover/toBeat 预先取）
    ais.forEach((a) => a.observe(events, toBeat));
  }
  if (!state.result) throw new Error(`生成对局未正常终局（seed=${seed}，guard=${guardCount}）`);
  return rec.finish(state.result);
}

// ---------- 模型 ----------
function loadModel(): { mlp: MLP; weightHash: string } {
  const p = join(ROOT, 'packages', 'web', 'public', 'ai', 'clean2.f32'); // P12 修正：部署已切 clean2，版本标签与权重必须同源
  const buf = readFileSync(p);
  const mlp = new LabMLP(1);
  mlp.setWeights(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
  return { mlp, weightHash: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}

/** 指定手号的模型首选（回放到该时点） */
/** D4：NN 主续打工厂（每世界每分支新建四席 NeuralDecider，公开记忆事件流驱动） */
function nnContinuation(mlp: import('@gd/ai').MLP, ruleOpts: unknown) {
  return {
    policyId: `neural:${(globalThis as Record<string, unknown>).__R4_MODEL_VERSION ?? 'deployed'}（四席主续打）`,
    makePlayers: () => [0, 1, 2, 3].map((seat) => {
      const d = new NeuralDecider(seat, mlp, 0, () => 0);
      return {
        decide: (state: never) => d.decide(state).move,
        observe: (events: never[]) => d.observe(events),
      };
    }),
  };
}

/** D4：heuristic:mid 敏感性续打工厂 */
function heuristicContinuation(ruleOpts: unknown) {
  return {
    policyId: INFOSET_SENSITIVITY_POLICY,
    makePlayers: () => [0, 1, 2, 3].map((seat) => {
      const a = createAI(seat, 1, 20261028 + seat);
      let started = false;
      return {
        decide: (state: never) => {
          if (!started) { a.reset(state, ruleOpts as never); started = true; }
          return a.decide(state);
        },
        observe: (events: never[], toBeat: unknown) => a.observe(events, toBeat as never),
      };
    }),
  };
}

function modelTopAt(record: GameRecord, moveNo: number, mlp: MLP): { actionId: string; combo: Combo | null } | null {
  const seat = record.humanSeat ?? 0;
  const decider = new NeuralDecider(seat, mlp, 0, () => 0);
  for (const frame of replay(record)) {
    if (frame.move.moveNo === moveNo && frame.move.player === seat) {
      const d = decider.decide(frame.state, { wantRanking: true });
      const top = d.ranking![0];
      if (!top) return null;
      return {
        actionId: `${top.combo === null ? 'pass' : 'model'}#${top.combo === null ? '' : top.combo.cards.map((c) => `${c.suit}${c.rank}`).sort().join(',')}`,
        combo: top.combo,
      };
    }
    decider.observe(frame.events);
  }
  return null;
}

// ---------- LLM ----------
interface LlmConfig { baseUrl: string; apiKey: string; model: string }
async function llmConfig(): Promise<LlmConfig | null> {
  const env = process.env;
  if (env.GD_LLM_BASE_URL && env.GD_LLM_KEY && env.GD_LLM_MODEL) {
    return { baseUrl: env.GD_LLM_BASE_URL, apiKey: env.GD_LLM_KEY, model: env.GD_LLM_MODEL };
  }
  try {
    const r = await fetch('http://localhost:8787/api/import-zcode', { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json() as LlmConfig;
      if (j.baseUrl && j.apiKey && j.model) return j;
    }
  } catch { /* 代理未启动 */ }
  return null;
}

async function callLlm(cfg: LlmConfig, messages: Array<{ role: string; content: string }>): Promise<string> {
  const isAnthropic = /\/api\/anthropic/.test(cfg.baseUrl);
  if (!isAnthropic) throw new Error(`仅支持 Anthropic 兼容端点（当前 ${cfg.baseUrl}）`);
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.model, max_tokens: 2048, stream: false,
      thinking: { type: 'disabled' },
      ...(sys ? { system: sys } : {}), messages: msgs,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json() as { content: Array<{ type: string; text?: string }> };
  return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

// ---------- LLM 账本（跨阶段累计） ----------
interface LedgerEntry { ts: string; caseId: string; purpose: string; ok: boolean; retried: boolean; elapsedMs: number }
function readLedger(): { totalCalls: number; entries: LedgerEntry[] } {
  const p = join(R2, 'runs', 'llm_ledger.json');
  if (!existsSync(p)) return { totalCalls: 0, entries: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}
function writeLedger(l: { totalCalls: number; entries: LedgerEntry[] }): void {
  mkdirSync(join(R2, 'runs'), { recursive: true });
  writeFileSync(join(R2, 'runs', 'llm_ledger.json'), JSON.stringify(l, null, 1));
}

// ---------- 主流程 ----------
interface CaseSpec {
  id: string;
  provenance: string;
  reason?: string;
  expect?: string;
  generate?: { seed: number; student?: 0 | 1 | 2; others?: 0 | 1 | 2 };
  /** D6 测试专用故障注入：从模型候选丢弃匹配 comboKey 前缀（exact+uncovered 门验收专用） */
  faultDropComboKeyPrefix?: string[];
  /** 指定证据决策手（默认自动选分歧/亮点） */
  moves?: number[];
  from?: string;
  /** P8：外部记录文件（浏览器导出的真实对局 JSON；读入后过 validateRecord+normalizeRecord） */
  recordFile?: string;
}

async function main() {
  const args = parseArgs();
  const packPath = join(ROOT, args.cases);
  if (!existsSync(packPath)) { console.error(`case pack 不存在: ${args.cases}`); process.exit(2); }
  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as { version: string; cases: CaseSpec[] };
  const outDir = args['out-dir'] ?? join(R2, 'runs', 'review');
  mkdirSync(outDir, { recursive: true });

  const maxApiCalls = Number(args['max-api-calls'] ?? pack.budget?.maxApiCalls ?? 6);
  // REVIEW4-D6：周期化预算——pack.budget.cycle 存在时，额度按该 cycle 累计（旧周期不清零不挪用）；
  // 无 cycle 的旧包保持全局累计语义
  const cycle = pack.budget?.cycle as string | undefined;
  const cycleUsed = (l: { entries: Array<Record<string, unknown>> }): number =>
    cycle ? l.entries.filter((e) => e.cycleId === cycle).length : -1;
  const samples = Number(args.samples ?? 64);
  const maxMoves = Number(args['max-moves'] ?? 3);
  const maxActions = Number(args['max-actions'] ?? 3);
  const { mlp, weightHash } = loadModel();

  const results: Array<Record<string, unknown>> = [];
  const generatedRecords = new Map<string, GameRecord>();
  let llmCallsUsed = 0;
  let anyCoachOk = false;

  for (const c of pack.cases) {
    const entry: Record<string, unknown> = { caseId: c.id, provenance: c.provenance };
    if (c.provenance === 'unavailable') {
      entry.status = 'unavailable';
      entry.reason = c.reason ?? '材料不可得';
      results.push(entry);
      continue;
    }
    if (!c.generate && !c.from && !c.recordFile) {
      entry.status = 'test-covered';
      entry.note = '断言位于包内语义测试（r1_fixes/replay_strict 等），本 CLI 不重复执行';
      results.push(entry);
      continue;
    }
    try {
      if (!c.generate && !c.from && !c.recordFile) { entry.status = 'no-spec'; results.push(entry); continue; }
      const seed = c.generate?.seed;
      const fromRecord = c.from ? generatedRecords.get(c.from) : undefined;
      const recordPath = c.recordFile && existsSync(join(ROOT, c.recordFile))
        ? join(ROOT, c.recordFile)
        : c.recordFile && existsSync(join(dirname(packPath), c.recordFile)) ? join(dirname(packPath), c.recordFile) : null;
      const record0 = recordPath
        ? normalizeRecord(JSON.parse(readFileSync(recordPath, 'utf8')) as GameRecord)
        : fromRecord ?? generateRecord(seed!, c.generate?.student ?? 0, c.generate?.others ?? 1);
      if (c.recordFile) {
        const v0 = validateRecord(record0);
        if (!v0.ok) throw new Error(`recordFile 未过完整性校验: ${v0.reason}`);
      }
      if (seed !== undefined) generatedRecords.set(c.id, record0);
      if (c.from) entry.derivedFrom = c.from;
      const v = validateRecord(record0);
      if (!v.ok) throw new Error(`生成记录未过完整性校验: ${v.reason}`);
      const record = normalizeRecord(record0);
      const replayClass = classifyReplay(record);
      const analysis = analyzeGame(record);

      // 证据对象（分歧 1-2 手 + 亮点 1 手）+ 双来源续打（单次确定性 + 信息集抽样）
      const counterfactuals = await runCounterfactual(record, analysis.moves, { maxDecisions: maxMoves });
      const rollouts = new Map<number, RolloutEvidence[]>();
      for (const cf of counterfactuals) {
        rollouts.set(cf.moveNo, [{
          mode: 'single_deterministic',
          rootSourceId: cf.sourceId,
          continuationPolicyId: cf.continuationPolicyId,
          samples: 1,
          seedsDigest: 'rng:0xd5c9a7(noise=0)',
          actualOutcomeText: cf.actualOutcome,
          alternativeOutcomeText: cf.alternativeOutcome,
          metricActual: cf.gActual,
          metricAlternative: cf.gAlternative,
          truncated: cf.truncated,
        }]);
      }
      const evidences = buildDecisionReviews(record, {
        mlp, modelVersion: NEURAL_MODEL_VERSION, weightHash, analysis, replayClass, rollouts,
        faultDropComboKeyPrefix: c.faultDropComboKeyPrefix, moves: c.moves,
      });
      // coach 模式附加信息集第二来源（双来源并列/方向冲突检测，自办项 6/P9）
      if (args.mode === 'coach') {
        for (const e of evidences) {
          if (e.replayStatus !== 'exact') continue;
          const mvC = analysis.moves.find((m) => m.moveNo === e.moveNo);
          if (!mvC) continue;
          try {
            const roots = defaultRoots(record, e.moveNo, { actionId: e.actual.actionId, combo: mvC.pass ? null : mvC.playedCombo });
            if (roots.length < 2) continue;
            // D4：主续打=已验证强 NN（部署权重，每世界每分支新建四席）
            const cmp = runInfosetCompare(record, e.moveNo, roots, { samples: 64, continuation: nnContinuation(mlp, record.ruleOpts) });
            rollouts.get(e.moveNo)?.push({
              mode: 'infoset_sampled', rootSourceId: '对局记录+neural主续打', continuationPolicyId: cmp.continuationPolicyId,
              samples: cmp.worldsCompleted, seedsDigest: `isHash:${cmp.informationSetHash.slice(0, 8)}·${cmp.samplerVersion}`,
              actualOutcomeText: `g 均值 ${cmp.roots[0]?.gMean ?? '-'}`,
              alternativeOutcomeText: cmp.roots.length > 1 ? cmp.roots.slice(1).map((r) => `${r.text} g=${r.gMean}`).join('；') : '无不同替代（启发式与实际同选）',
              metricActual: cmp.roots[0]?.gMean, metricAlternative: cmp.roots[1]?.gMean,
              truncated: cmp.roots.some((r) => r.truncated > 0), assumptionNote: cmp.assumptionNote,
            });
          } catch { /* 信息集结构异常：如实不挂 */ }
        }
        // 重建证据（rollouts 更新后 conflicts/claimLevel 重算）
        const rebuilt = buildDecisionReviews(record, {
          mlp, modelVersion: NEURAL_MODEL_VERSION, weightHash, analysis, replayClass, rollouts,
          faultDropComboKeyPrefix: c.faultDropComboKeyPrefix, moves: c.moves,
        });
        evidences.splice(0, evidences.length, ...rebuilt);
      }

      const caseOut: Record<string, unknown> = {
        recordId: record.id,
        recordSeed: seed ?? null,
        recordFile: c.recordFile ?? null,
        replayStatus: replayClass.status,
        stats: analysis.stats,
        evidences,
      };

      if (args.mode === 'sampled') {
        // R4：对证据里的分歧手做信息集抽样（≤maxMoves 手、每手 ≤maxActions 根动作）
        const infosetResults = [];
        for (const e of evidences.slice(0, maxMoves)) {
          const mv = analysis.moves.find((m) => m.moveNo === e.moveNo)!;
          const actualCombo = mv.pass ? null : mv.playedCombo;
          const actualId = e.actual.actionId;
          const modelTop = e.candidates && e.candidates.ranking.length > 1 ? modelTopAt(record, e.moveNo, mlp) : null;
          const roots = defaultRoots(record, e.moveNo, { actionId: actualId, combo: actualCombo }, modelTop).slice(0, maxActions);
          // D4：主续打=NN；H 敏感性只对前 2 个课点（配对重用相同世界）
          const cmp = runInfosetCompare(record, e.moveNo, roots, { samples, continuation: nnContinuation(mlp, record.ruleOpts) });
          if (infosetResults.length < 2) {
            try {
              cmp.sensitivityHeuristicMid = runInfosetCompare(record, e.moveNo, roots, { samples, continuation: heuristicContinuation(record.ruleOpts) });
            } catch { /* 敏感性不可算：如实缺 */ }
          }
          infosetResults.push(cmp);
        }
        caseOut.infoset = infosetResults;
        caseOut.infosetNote = `主续打=neural:${NEURAL_MODEL_VERSION}；H 敏感性=${INFOSET_SENSITIVITY_POLICY}`;
      }

      const evidencePath = join(outDir, `${c.id}.evidence.json`);
      writeFileSync(evidencePath, JSON.stringify({ pack: pack.version, case: c.id, ...caseOut }, null, 1));
      entry.status = 'ok';
      entry.evidence = evidencePath;
      entry.moves = evidences.map((e) => e.moveNo);

      if (args.mode === 'coach') {
        const ledger = readLedger();
        const used = cycle ? cycleUsed(ledger) : ledger.totalCalls;
        const budgetLeft = maxApiCalls - used;
        if (budgetLeft <= 0) {
          entry.coach = { status: 'budget_exhausted', note: `${cycle ? `周期 ${cycle}` : 'LLM 账本'}累计 ${used} 次，已达上限 ${maxApiCalls}（跨阶段不清零、不挪用旧周期）` };
        } else {
          const cfg = await llmConfig();
          if (!cfg) {
            entry.coach = { status: 'llm_unavailable', note: '代理(8787)未启动且无 GD_LLM_* 环境变量' };
          } else {
            // 缓存键：全版本维度
            const overview = [
              record.result
                ? `终局：${record.result.finishOrder.map((p, i) => `${['头游', '二游', '三游', '末游'][i]}=座位${p}`).join('、')}；${record.result.winnerTeam === 0 ? '学生队(南/北)胜' : '对方胜'}`
                : '构造局剧本片段：无终局结算（provenance=constructed，全局事实以证据卡为准）',
              `学生共 ${analysis.stats.total} 手（无牌可跟 ${analysis.stats.forced}、未覆盖 ${analysis.stats.uncovered}、分歧较大 ${analysis.stats.divergent}——描述统计）`,
            ];
            const cacheKey = createHash('sha256').update(JSON.stringify({
              v: 2, // REVIEW5 T2：升版——校验器语义变化（六负例拒绝）使旧缓存失效
              pack: pack.version, caseId: c.id, recordHash: evidences[0]?.recordHash,
              prompt: COACH_JSON_PROMPT_VERSION, model: NEURAL_MODEL_VERSION, weightHash,
              validator: 'review5-t2-negatives-v1',
              evidenceHashes: evidences.map((e) => e.recordHash + e.decisionId + e.observation.hash),
            })).digest('hex');
            const cacheDir = join(R2, 'cache', `coach-${COACH_JSON_PROMPT_VERSION}`);
            mkdirSync(cacheDir, { recursive: true });
            const cachePath = join(cacheDir, `${cacheKey.slice(0, 24)}.json`);
            if (existsSync(cachePath)) {
              // REVIEW5 T2：缓存命中必须用当前校验器重验（失败缓存不得被算作成功命中；
              // 校验器/prompt 版本变化经 cacheKey 与 versions 字段共同失效）
              let cached: { parsed?: unknown; errors?: unknown[] } = {};
              try { cached = JSON.parse(readFileSync(cachePath, 'utf8')) as typeof cached; } catch { cached = {}; }
              const revalErrors = cached.parsed
                ? validateCoachJson(cached.parsed, evidences)
                : [{ kind: 'schema', detail: '缓存内容无法解析' } as CoachValidationError];
              if (revalErrors.length === 0) {
                entry.coach = { status: 'cache_hit', path: cachePath, revalidated: true };
                anyCoachOk = true;
              } else {
                entry.coach = { status: 'cache_hit_unverified', path: cachePath, revalErrors: revalErrors.slice(0, 3) as unknown as CoachValidationError[], note: '缓存被当前校验器拒绝——不作为成功，需重新生成' };
              }
            } else {
              const messages = buildCoachJsonMessages(evidences, overview);
              const t0 = Date.now();
              const raw1 = await callLlm(cfg, messages);
              llmCallsUsed += 1;
              ledger.totalCalls += 1; if (cycle) void 0;
              let parsed: CoachJsonOutput | null = parseCoachJson(raw1);
              let errors: CoachValidationError[] = parsed ? validateCoachJson(parsed, evidences) : [{ kind: 'schema', detail: '无法解析为 JSON' }];
              let retried = false;
              if (errors.length > 0 && ledger.totalCalls < maxApiCalls) {
                const raw2 = await callLlm(cfg, buildRetryMessages(messages, raw1, errors));
                retried = true;
                llmCallsUsed += 1;
                ledger.totalCalls += 1; if (cycle) void 0;
                parsed = parseCoachJson(raw2);
                errors = parsed ? validateCoachJson(parsed, evidences) : [{ kind: 'schema', detail: '重试后仍无法解析' }];
              }
              const elapsedMs = Date.now() - t0;
              ledger.entries.push({ ts: new Date().toISOString(), cycleId: cycle ?? null, caseId: c.id, purpose: 'coach-json', ok: errors.length === 0, retried, elapsedMs });
              writeLedger(ledger);
              const cacheRecord = {
                cacheKey, request: { model: cfg.model, thinking: 'disabled', temperature: null, seed: null, max_tokens: 2048 },
                retried, errors, elapsedMs, createdAt: new Date().toISOString(),
                versions: { prompt: COACH_JSON_PROMPT_VERSION, encoder: evidences[0]?.candidates?.encoderVersion, candidate: evidences[0]?.candidates?.candidateVersion, policy: NEURAL_MODEL_VERSION, weightHash },
                factCards: renderFactCards(evidences),
                parsed, raw: (parsed ? JSON.stringify(parsed) : raw1).slice(0, 8000),
              };
              writeFileSync(cachePath, JSON.stringify(cacheRecord, null, 1));
              entry.coach = errors.length === 0
                ? { status: 'validated', path: cachePath, retried, elapsedMs, calls: retried ? 2 : 1 }
                : { status: 'rejected_degraded_to_facts', path: cachePath, errors, retried };
              if (errors.length === 0) anyCoachOk = true;
            }
          }
        }
      }
      results.push(entry);
    } catch (e) {
      entry.status = 'error';
      entry.error = String(e);
      results.push(entry);
    }
  }

  const summaryPath = join(outDir, `${pack.version}-${args.mode}-summary.json`);
  writeFileSync(summaryPath, JSON.stringify({
    pack: pack.version, mode: args.mode, at: new Date().toISOString(),
    llmCallsUsed, ledgerTotal: readLedger().totalCalls,
    cases: results,
  }, null, 1));
  console.log(`review(${args.mode}) 完成 → ${summaryPath}（LLM 本次调用 ${llmCallsUsed}，账本累计 ${readLedger().totalCalls}）`);
  const failed = results.filter((r) => r.status === 'error');
  if (failed.length > 0) process.exit(1);
  if (args.mode === 'coach' && !anyCoachOk
    && results.some((r) => (r.coach as { status?: string } | undefined)?.status === 'llm_unavailable')) {
    process.exit(4); // 前置条件不满足：LLM 配置不可得
  }
}

if (process.argv[1] && process.argv[1].includes('review2case')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
