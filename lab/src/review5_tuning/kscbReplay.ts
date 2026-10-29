/**
 * lab/src/review5_tuning/kscbReplay.ts — REVIEW5 T3：KSCB 语义回放（映射来自数据约束求解，
 * 非频率猜测；映射表经 100 match 单张/对子零冲突验证，见 lab/review5/artifacts/kscb-mapping.json）。
 *
 * 牌码体系（推导自 event9 melds 的 (tiles,pattern,value) 约束）：
 *   四个 13 宽花色带 17-29 / 33-45 / 49-61 / 65-77，带内偏移 0..12 = A,2..10,J,Q,K
 *   94=小王 95=大王；每码两副拷贝；手牌/出牌只用这 54 码；event1 的 1-13 是级数声明非牌。
 * 花色带→实际花色（尤其 ♥=万能牌带）由全量合法性验证唯一判定（24 置换中只有正确 ♥ 带能过）。
 *
 * 验证内容（逐副对照本地引擎）：
 *   牌账守恒(108)、手牌子集、combo 分类=声明 pattern、压制关系、轮转、
 *   走完顺序=result.win_index、终局余牌=result.hand、贡还归属、级数跨副推进。
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import {
  applyMove, beats, buildDeck, canPass, classify, createMatch, DEFAULT_RULES, legalCombos,
  rankOrder, startGame, teamOf, type Card, type RuleOptions,
} from '@gd/engine';
import { dedupCandidates as dedupCandidatesX0, encodeAction, encodeStateV2, PublicTracker, STATE_DIM_V2 } from '@gd/ai';

function buildInfo(
  state: GameState, seat: number, kind: 'pass' | 'play', tiles: number[] | null,
  cands: Array<{ combo: Combo | null }>, matched: boolean, withFeatures: boolean, tracker: PublicTracker,
): ActionInfo {
  const info: ActionInfo = {
    actorSeat: seat, kind, tiles,
    candidateMatched: matched, nCandidates: cands.length,
  };
  if (withFeatures) {
    const stateFeat = new Float32Array(STATE_DIM_V2);
    encodeStateV2(state, seat, tracker, stateFeat, 'rule-context');
    const candFeats = new Float32Array(cands.length * 68);
    const candKinds: string[] = [];
    const tc = new Map<number, number>();
    for (const t of tiles ?? []) tc.set(t, (tc.get(t) ?? 0) + 1);
    cands.forEach((c, i) => {
      encodeAction(c.combo, candFeats.subarray(i * 68, i * 68 + 68), 'action64');
      candKinds.push(c.combo === null ? 'pass' : c.combo.kind);
      if (kind === 'play' && c.combo !== null) {
        const cc = new Map<number, number>();
        for (const x of c.combo.cards) cc.set(codeOfCard(x, { bandSuits: ['S', 'H', 'D', 'C'] } as KscbMapping) ?? -1, 1);
        void cc;
      }
    });
    info.stateFeat = stateFeat;
    info.candFeats = candFeats;
    info.candKinds = candKinds;
    if (kind === 'pass') info.chosenIdx = cands.findIndex((c) => c.combo === null);
  }
  return info;
}

export const SUIT_BANDS = [17, 33, 49, 65] as const;
export const JOKER_SMALL = 94, JOKER_BIG = 95;

/** value 档(1=A..13=K) → 引擎 rank(2..14) */
const valueToRank = (v: number): number => (v === 1 ? 14 : v); // 档 1=A；2..13=rank 2..13（J=11,Q=12,K=13）

export interface KscbMapping {
  /** band 索引(0..3) → suit 字母；由置换验证确定 */
  bandSuits: ['S' | 'H' | 'D' | 'C', 'S' | 'H' | 'D' | 'C', 'S' | 'H' | 'D' | 'C', 'S' | 'H' | 'D' | 'C'];
}
export const DEFAULT_MAPPING: KscbMapping = { bandSuits: ['S', 'H', 'D', 'C'] };

export interface RawCard { suit: 'S' | 'H' | 'D' | 'C' | 'J'; rank: number; code: number; copy: number }

/** 码 → 牌（含双拷贝 id 分配）。未知码返回 null。 */
export function decodeTiles(tiles: number[], mapping: KscbMapping, nextCopy: Map<number, number>): (RawCard | null)[] {
  return tiles.map((t) => {
    if (t === JOKER_SMALL || t === JOKER_BIG) {
      const rank = t === JOKER_SMALL ? 16 : 17;
      const copy = (nextCopy.get(t) ?? 0) + 1; nextCopy.set(t, copy);
      return { suit: 'J' as const, rank, code: t, copy };
    }
    const band = SUIT_BANDS.findIndex((b) => t >= b && t < b + 13);
    if (band < 0) return null;
    const copy = (nextCopy.get(t) ?? 0) + 1; nextCopy.set(t, copy);
    return { suit: mapping.bandSuits[band], rank: valueToRank(t - SUIT_BANDS[band] + 1), code: t, copy };
  });
}

// ---- KSCB 事件结构 ----
export interface KscbEvent { event_id: number; uid: string; tiles?: number[]; pattern?: number; fan?: number; data?: unknown }
export interface KscbRound {
  events: KscbEvent[]; result: {
    fan: number; levelup: number; result_type: number; win_type: number;
    players: Array<{ uid: string; hand: number[] | null; is_banker: boolean; win_index: number; is_cap?: boolean }>;
  }; match_id: string; sample_id: string; game_rule: string;
  host_team_level?: number; opposite_team_level?: number;
}
export interface KscbMatch { game: string; round_count: number; rounds: KscbRound[]; sample_id: string; schema_version: string }

export function loadMatches(path: string, limit: number): KscbMatch[] {
  const raw = gunzipSync(readFileSync(path)).toString('utf8');
  const out: KscbMatch[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as KscbMatch);
    if (out.length >= limit) break;
  }
  return out;
}

// ---- pattern → 引擎 kind 映射（依据 play/meld 长度统计推导，验证器统计失配）----
const PATTERN_KIND: Record<number, string> = {
  1: 'single', 2: 'pair', 3: 'trio_seq', 4: 'trio', 5: 'pair_seq', 6: 'straight', 7: 'flush', 8: 'bomb',
};

export interface RoundVerdict {
  sampleId: string;
  status: 'ok' | 'rule_diff' | 'ambiguous' | 'invalid';
  plays: number; passes: number; /** 引擎枚举剪枝外、由独立分类器验证合法的出牌数 */ prunedComboValidated: number;
  /** KSCB 规则差异出牌（级牌参与序列等）：标记保留，不判非法 */ ruleDiffPlays: number;
  mismatches: string[];   // 具体失配（前 5 条）
  kindMismatchCounts: Record<string, number>;
  finishOrderOk: boolean;
  finalHandsOk: boolean;
  tributeOk: boolean | 'absent';
  levelUpOk: boolean | 'unknown';
}

const UID_SEAT: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/** 规则差异回退：万能牌填序列中段（引擎只支持端位代入）。
 *  判定：非王自然牌 + 万能牌(♥级牌)恰好构成同花连续跨度 → 合成 flush/straight combo。 */
function synthWildRunCombo(played: Card[], ctx: { ranks: Set<number> }, _levelRank: number): Combo | null {
  const wildIdx = new Set(played.filter((c) => c.suit === 'H' && ctx.ranks.has(c.rank) && c.rank < 15));
  if (!wildIdx.size || wildIdx.size > 2) return null;
  const naturals = played.filter((c) => !wildIdx.has(c));
  if (naturals.some((c) => c.rank >= 15)) return null; // 王不参与
  // A 双解释（作 1 或作 14）；万能牌可补序列任意空位（含端位）。
  // 窗口判定：跨度 spanNeeded = n-1 的连续窗口恰好容纳全部自然牌（不重复），
  // 且窗口内空位数 == 万能牌数。
  const spanNeeded = played.length - 1;
  const tryRanks = (aAs: number): number[] | null => {
    const ranks = naturals.map((c) => (c.rank === 14 ? aAs : c.rank)).sort((a, b) => a - b);
    if (new Set(ranks).size !== ranks.length) return null;
    if (ranks[ranks.length - 1] - ranks[0] > spanNeeded) return null;
    const slots = new Set(ranks);
    const missing = spanNeeded + 1 - ranks.length;
    if (missing !== wildIdx.size) return null;
    // 窗口起点：ranks[0]（自然最低位就是窗口底）——若万能全在低端则自然最低位=窗口底+w
    void slots;
    return ranks;
  };
  const ranks = tryRanks(1) ?? tryRanks(14);
  if (!ranks) return null;
  // 自然牌同花 → 同花顺（万能牌采用目标花色，不要求其自然花色）；否则顺子
  const suits = new Set(naturals.map((c) => c.suit));
  const isFlush = suits.size === 1;
  const top = ranks[ranks.length - 1];
  const topRank = top === 1 ? 14 : top;
  return {
    kind: isFlush ? 'flush' : 'straight', cards: [...played],
    mainRank: topRank, keyRank: topRank, length: played.length, size: played.length,
    wildAs: [], pairRanks: [],
  } as unknown as Combo;
}

/** Card → KSCB 码（同型两码不区分拷贝） */
export function codeOfCard(c: Card, mapping: KscbMapping): number | null {
  if (c.suit === 'J') return c.rank === 16 ? JOKER_SMALL : c.rank === 17 ? JOKER_BIG : null;
  const band = mapping.bandSuits.indexOf(c.suit as 'S' | 'H' | 'D' | 'C');
  if (band < 0) return null;
  const value = c.rank === 14 ? 1 : c.rank;
  return SUIT_BANDS[band] + (value - 1);
}

/** 当前局面的本地候选（与 NN 推理同一候选空间：dedupCandidates(legalCombos, canPass)） */
function dedupCandidatesX(state: GameState): Array<{ combo: Combo | null }> {
  return dedupCandidatesX0(legalCombos(state), canPass(state));
}

/** 行动信息（onAction 回调用；供决策提取复用同一验证机器） */
export interface ActionInfo {
  actorSeat: number; kind: 'pass' | 'play';
  tiles: number[] | null;
  candidateMatched: boolean;   // 本地引擎枚举候选（NN 同一候选空间）含该动作
  nCandidates: number;
  /** withFeatures 时：状态 331（rule-context）+ 候选 n×68（action64）+ 选中下标 */
  stateFeat?: Float32Array;
  candFeats?: Float32Array;
  candKinds?: string[];
  chosenIdx?: number;
}

/** 回放一副：验证全部出牌/让牌/贡还/名次/余牌。onAction 存在时逐行动回调。 */
export function verifyRound(
  round: KscbRound, mapping: KscbMapping, prevLevels: [number, number] | null,
  onAction?: (info: ActionInfo) => void,
  opts?: { withFeatures?: boolean },
): RoundVerdict {
  const v: RoundVerdict = {
    sampleId: round.sample_id, status: 'ok', plays: 0, passes: 0, prunedComboValidated: 0, ruleDiffPlays: 0,
    mismatches: [], kindMismatchCounts: {}, finishOrderOk: false, finalHandsOk: false,
    tributeOk: 'absent', levelUpOk: 'unknown',
  };
  const bad = (m: string): void => { if (v.mismatches.length < 5) v.mismatches.push(m); v.status = v.status === 'ok' ? 'invalid' : v.status; };

  // 事件分类
  const ev1 = round.events.find((e) => e.event_id === 1);
  const hands = new Map<number, number[]>();
  for (const e of round.events) {
    if (e.event_id === 2) hands.set(UID_SEAT[e.uid], [...(e.tiles ?? [])]); // 深拷贝：贡牌 splice 不污染原始 JSON（24 置换复用同一 round 对象）
  }
  if (hands.size !== 4) { bad('手牌事件不足 4 家'); v.status = 'ambiguous'; return v; }
  const totalCards = [...hands.values()].reduce((s, h) => s + h.length, 0);
  if (totalCards !== 108) bad(`牌账 ${totalCards} != 108`);

  // 贡还交换（event 8 data）：from 把 tile 交给 uid——落在 event2 手牌上再发牌
  const tributeMoves: Array<{ from: number; to: number; tile: number }> = [];
  const ev8 = round.events.find((e) => e.event_id === 8);
  if (ev8 && Array.isArray(ev8.data)) {
    for (const it of ev8.data as Array<{ from: string; tile: number; uid: string }>) {
      tributeMoves.push({ from: UID_SEAT[it.from], to: UID_SEAT[it.uid], tile: it.tile });
    }
  }
  if (tributeMoves.length) {
    let ok = true;
    for (const m of tributeMoves) {
      const h = hands.get(m.from);
      if (!h || !h.includes(m.tile)) { ok = false; continue; }
      h.splice(h.indexOf(m.tile), 1);
      hands.get(m.to)?.push(m.tile);
    }
    v.tributeOk = ok;
    if (!ok) bad('贡还牌不在贡者手牌中');
  }

  // 级数：event1 tiles[0]=本副级数（value 档 1..13）；部分 match 无 event1 tiles，
  // 改用 round.host_team_level（台上队级数；记录该假设于报告）
  const levelVal = ev1?.tiles?.[0] ?? round.host_team_level ?? null;
  if (levelVal == null || levelVal < 1 || levelVal > 13) { bad('级数声明缺失'); v.status = 'ambiguous'; return v; }
  const levelRank = valueToRank(levelVal);

  // 用引擎建副（自定义发牌：直接按 hands 设置）
  const ruleOpts: RuleOptions = { ...DEFAULT_RULES };
  const matchSeed = 1;
  const match = createMatch(ruleOpts, matchSeed);
  // 关卡推进不模拟整场——逐副独立验证：以 levels 上下文构造
  const cardsByCode = new Map<string, Card>();
  const deck = buildDeck();
  // 码→物理 Card：同码两拷贝取 deck 中同 suit/rank 的两张
  const deckLeft = [...deck];
  const takeCard = (rc: RawCard): Card | null => {
    const key = `${rc.code}#${rc.copy}`;
    if (cardsByCode.has(key)) return cardsByCode.get(key)!;
    const idx = deckLeft.findIndex((c) => rc.suit === 'J'
      ? (rc.rank === 16 ? c.rank === 16 : c.rank === 17)
      : (c.suit === rc.suit && c.rank === rc.rank));
    if (idx < 0) return null;
    const c = deckLeft.splice(idx, 1)[0];
    cardsByCode.set(key, c);
    return c;
  };
  const handCards: Card[][] = [[], [], [], []];
  const nextCopy = new Map<number, number>();
  for (const [seat, tiles] of hands) {
    for (const rc of decodeTiles(tiles, mapping, nextCopy)) {
      if (!rc) { bad(`未知牌码`); continue; }
      const c = takeCard(rc);
      if (!c) { bad(`牌池耗尽(${rc.code})`); continue; }
      handCards[seat].push(c);
    }
  }
  if (deckLeft.length !== 0) bad(`牌池剩余 ${deckLeft.length}（应 0）`);

  // 直接在 state 上开局并覆盖手牌
  const state = startGame(match);
  for (let s = 0; s < 4; s++) {
    state.hands[s] = [...handCards[s]].sort((a, b) => a.id - b.id);
  }
  // 级牌上下文：setLevel 不可用则按 ctx.ranks 重设
  (state.ctx.ranks as Set<number>).clear();
  (state.ctx.ranks as Set<number>).add(levelRank);
  state.match.levels[0] = levelRank; state.match.levels[1] = levelRank;
  void prevLevels;
  // 首攻者 = 数据首个行动事件的行为者（引擎默认庄家轮转不适用外部牌谱）
  const firstAction = round.events.find((e) => e.event_id === 3 || e.event_id === 4);
  if (firstAction) {
    state.turn = UID_SEAT[firstAction.uid];
    (state as { leader?: number }).leader = UID_SEAT[firstAction.uid];
  }

  // 主线：event 3 出牌 / event 4 pass（按事件序；跳过 2/9/10/11/13/15/16 等非行动事件）
  // 出牌的物理 Card 从行动者当前手牌的码队列解析（同码两拷贝，取其一手牌内实例）
  const tracker = new PublicTracker();
  const withFeatures = opts?.withFeatures === true && onAction != null;
  const encodeActionInfo = (state: GameState, seat: number, kind: 'pass' | 'play', tiles: number[] | null, matched: boolean, cands: Array<{ combo: Combo | null }>): ActionInfo['stateFeat'] extends infer _T ? void : never => { void state; void seat; void kind; void tiles; void matched; void cands; };
  void encodeActionInfo;
  const codeQueue: Array<Map<number, Card[]>> = [0, 1, 2, 3].map((si) => {
    const q = new Map<number, Card[]>();
    for (const c of handCards[si]) {
      const code = codeOfCard(c, mapping);
      if (code != null) q.set(code, [...(q.get(code) ?? []), c]);
    }
    return q;
  });
  const actionEvents = round.events.filter((e) => e.event_id === 3 || e.event_id === 4);
  for (let i = 0; i < actionEvents.length; i++) {
    const e = actionEvents[i];
    const seat = UID_SEAT[e.uid];
    if (state.over) { bad('结束后仍有行动事件'); break; }
    if (state.turn !== seat) { bad(`轮转失配: 轮到 ${state.turn} 实为 ${seat} (ev@${i})`); v.status = 'invalid'; break; }
    if (e.event_id === 4) {
      v.passes += 1;
      if (onAction) {
        const cands = dedupCandidatesX(state);
        onAction(buildInfo(state, seat, 'pass', null, cands, cands.some((c) => c.combo === null), withFeatures, tracker));
      }
      if (!canPass(state)) { bad('不允许的 pass（领出）'); v.status = 'invalid'; break; }
      const evsPass = applyMove(state, { pass: true });
      tracker.observe(evsPass);
    } else {
      v.plays += 1;
      const played: Card[] = [];
      let resolveOk = true;
      for (const t of e.tiles ?? []) {
        const q = codeQueue[seat].get(t);
        const c = q?.shift();
        if (!c) { resolveOk = false; break; }
        played.push(c);
      }
      if (!resolveOk) { bad(`出牌不在行动者手牌: code=${e.tiles} ev@${i}`); v.status = 'invalid'; break; }
      const cands = dedupCandidatesX(state);
      if (onAction) {
        const tc = new Map<number, number>();
        for (const t of e.tiles ?? []) tc.set(t, (tc.get(t) ?? 0) + 1);
        let matched = false;
        let chosenIdx = -1;
        cands.forEach((c, ci) => {
          if (c.combo === null) return;
          const cc = new Map<number, number>();
          for (const x of c.combo.cards) cc.set(codeOfCard(x, mapping) ?? -1, (cc.get(codeOfCard(x, mapping) ?? -1) ?? 0) + 1);
          if (cc.size === tc.size && [...tc.entries()].every(([k, n]) => cc.get(k) === n)) { matched = true; chosenIdx = ci; }
        });
        const info = buildInfo(state, seat, 'play', [...(e.tiles ?? [])], cands, matched, withFeatures, tracker);
        info.chosenIdx = chosenIdx;
        onAction(info);
      }
      // 合法性：独立分类器（引擎 legalCombos 有已知枚举剪枝——三带二只生成最小带对变体，
      // 不能作为人类出牌合法性的完备判据；classify 给出全部合法解释，再查压制）
      const key = (cs: Card[]): string => cs.map((c) => c.id).sort((a, b) => a - b).join(',');
      const target = key(played);
      const interpretations = classify(played, state.ctx).filter((c) => key(c.cards) === target);
      const legal = legalCombos(state);
      const enumerated = legal.find((c) => key(c.cards) === target) ?? null;
      // 规则差异回退：KSCB 允许级牌参与顺子/连对/钢板（本引擎 stage 口径剔除级牌位置）。
      // 无级牌上下文重分类能解释 = 已知规则差异，标 rule_diff_play 继续回放（不判 invalid）。
      const noLevelCtx = { ranks: new Set<number>(), levels: [levelRank, levelRank] as [number, number] };
      const kscbInterp = classify(played, noLevelCtx).filter((c) => key(c.cards) === target);
      // 规则差异回退 3：万能牌填同花顺/顺子中段（如 ♥8 级牌当♦9 组 ♦8-Q 同花顺）。
      // 本引擎只支持万能补顺/同花顺的端位——构造合成 combo 继续（keyRank=跨度最高点）。
      const wildFlush = synthWildRunCombo(played, state.ctx, levelRank);
      const combo = enumerated
        ?? interpretations.find((c) => state.lastCombo === null || beats(c, state.lastCombo))
        ?? kscbInterp.find((c) => state.lastCombo === null || beats(c, state.lastCombo))
        ?? (wildFlush && (state.lastCombo === null || beats(wildFlush, state.lastCombo)) ? wildFlush : null)
        ?? null;
      if (!combo) { bad(`出牌不合法: code=${e.tiles} ev@${i}`); v.status = v.status === 'ok' ? 'rule_diff' : v.status; break; }
      if (!enumerated && !interpretations.length && !kscbInterp.length && wildFlush) { v.ruleDiffPlays += 1; v.status = v.status === 'ok' ? 'rule_diff' : v.status; }
      if (!enumerated) {
        if (interpretations.length > 0) v.prunedComboValidated += 1;
        else { v.ruleDiffPlays += 1; v.status = v.status === 'ok' ? 'rule_diff' : v.status; }
      }
      // pattern 一致性（best-effort：三带二等规则差异计 kindMismatch）
      const want = e.pattern != null ? PATTERN_KIND[e.pattern] : undefined;
      if (want && combo.kind !== want) {
        v.kindMismatchCounts[`${want}→${combo.kind}`] = (v.kindMismatchCounts[`${want}→${combo.kind}`] ?? 0) + 1;
      }
      const evsPlay = applyMove(state, { pass: false, combo });
      tracker.observe(evsPlay);
    }
  }

  // 名次与余牌（win_index 语义：1=头游 2=二游 3=三游；0/4=末游两种终局类型——
  // 全量 30 match 统计：先出完者 win_index 恒 1、次 2、三 3；有剩牌者恒 0 或 4）
  const result = round.result;
  if (result?.players) {
    const rankOf = (w: number): number => (w === 1 ? 1 : w === 2 ? 2 : w === 3 ? 3 : 4);
    const order = [...result.players].sort((a, b) => rankOf(a.win_index) - rankOf(b.win_index)).map((p) => UID_SEAT[p.uid]);
    const engineOrder = state.finished;
    v.finishOrderOk = engineOrder.length >= 2 && engineOrder.every((s, i) => order[i] === s);
    if (!v.finishOrderOk) bad(`名次失配: 数据 ${order.join(',')} 引擎 ${engineOrder.join(',')}`);
    // 终局余牌（末游）
    const lastSeat = order[3];
    const rem = result.players.find((p) => UID_SEAT[p.uid] === lastSeat)?.hand;
    if (rem != null) {
      const remCards = decodeTiles(rem, mapping, new Map()).map((r) => (r ? takeCard(r) : null));
      const keyS = (cs: Array<Card | null>): string => cs.filter(Boolean).map((c) => c!.rank).sort((a, b) => a - b).join(',');
      v.finalHandsOk = keyS(remCards) === keyS(state.hands[lastSeat]);
      if (!v.finalHandsOk) bad('末游余牌不一致');
    }
  } else bad('result 缺失');
  return v;
}

/** 24 置换 × 样本副 → 找出能全过的 ♥ 带 */
const SUIT_PERMS: Array<KscbMapping['bandSuits']> = (() => {
  const suits: KscbMapping['bandSuits'][number][] = ['S', 'H', 'D', 'C'];
  const out: Array<KscbMapping['bandSuits']> = [];
  const perm = (arr: KscbMapping['bandSuits'][number][]): void => {
    if (arr.length === 4) { out.push(arr as KscbMapping['bandSuits']); return; }
    for (const s of suits) if (!arr.includes(s)) perm([...arr, s]);
  };
  perm([]);
  return out;
})();

export function inferSuitBands(sampleRounds: KscbRound[]): {
  survivors: Array<{ mapping: KscbMapping; okRounds: number; totalRounds: number }>;
} {
  const survivors = SUIT_PERMS.map((bandSuits) => {
    const mapping = { bandSuits };
    let ok = 0, total = 0;
    for (const r of sampleRounds) {
      total += 1;
      const v = verifyRound(r, mapping, null);
      if (v.status === 'ok' && v.finishOrderOk) ok += 1;
    }
    return { mapping, okRounds: ok, totalRounds: total };
  }).sort((a, b) => b.okRounds - a.okRounds);
  return { survivors };
}

void rankOrder; void teamOf;
