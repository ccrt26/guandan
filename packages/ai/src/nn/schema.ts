/**
 * packages/ai/src/nn/schema.ts — 神经网络输入编码（唯一权威实现：训练采样/陪练/复盘共用）。
 *
 * 设计依据：docs/TRAINING_PLAN.md §5（经 2026-10-25 外部交叉审核后的 schema 要求）。
 * 红线：只用「自己手牌 + 公开信息」。已知限制（v1 轮未编码，如实记录）：
 *  - 进贡/还贡公开亮明的牌的归属信息未编码（unknownPool 不区分"已知在某家"与"完全未知"）；
 *  - pass 只表示选择不压，不作为"压不过"的硬约束。
 */
import type { Card, Combo, GameState, Suit } from '@gd/engine';
import { rankOrder } from '@gd/engine';

export const SCHEMA_VERSION = 'gd-lab-schema-v1';

// ---- 物理牌索引：54 = 52(S/H/D/C × 2..14) + 小王(52) + 大王(53) ----
const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export function physIdx(c: Card): number {
  if (c.suit === 'J') return c.rank === 16 ? 52 : 53;
  return SUITS.indexOf(c.suit) * 13 + (c.rank - 2);
}
export const PHYS_DIM = 54;
/** 两副牌每种物理牌恰 2 张 */
export const DECK_COPIES = 2;

// ---- 牌型枚举（与引擎 ComboKind 一一对应，顺序固定）+ pass ----
export const KINDS = [
  'single', 'pair', 'trio', 'trio_pair', 'straight',
  'pair_seq', 'trio_seq', 'bomb', 'flush', 'joker_bomb',
] as const;
export const KIND_DIM = KINDS.length; // 10
export const PASS_KIND_IDX = KIND_DIM; // 10（档位编号：pass 是第 11 档）
/** 动作块内 pass one-hot 的正确位置（REVIEW5 T0.2 修复：54+10=64）。
 *  历史实现误写 PASS_KIND_IDX=10（物理块 S12 位）。
 *  默认保持 'legacy-phys10'：现存全部已部署/已训练权重（schema v1/v2）都是旧编码，
 *  默认翻转会静默错读（Ch7.2：不把新编码混到旧 modelVersion 下）。
 *  新训练/新政策包必须显式 'action64' + SCHEMA_VERSION_V3/V4 + migratePassEncoding 迁移。 */
export const PASS_ACTION_IDX = PHYS_DIM + PASS_KIND_IDX; // 64
export type PassEncoding = 'legacy-phys10' | 'action64';
export const DEFAULT_PASS_ENCODING: PassEncoding = 'legacy-phys10';
export function kindIdx(kind: string): number { return KINDS.indexOf(kind as (typeof KINDS)[number]); }

// ---- 归一化常量 ----
export const MAX_ORDER = 41; // rankOrder：普通 2..14，级牌 20+rank(22..34)，小王 40，大王 41
export const MAX_SIZE = 10;  // 一手最大张数（两副同点炸弹 8、三连对/钢板 6、顺/同花 5）

// ---- 相对座位：0=队友 1=下家 2=上家 ----
export function relSeat(seat: number, other: number): number {
  const d = (other - seat + 4) & 3;
  return d === 2 ? 0 : d === 1 ? 1 : 2;
}

// ---- 动作块（每个候选 68 维）----
export const ACTION_DIM = PHYS_DIM + (KIND_DIM + 1) + 1 + 1 + 1; // 54+11+3 = 68

/** 编码一个候选动作（combo 或 pass），写入 out 从 0 开始。
 *  passAt='action64'（默认，REVIEW5 T0.2 起）：pass 写 out[64]（kind 块第 11 档）。
 *  passAt='legacy-phys10'：历史错位编码（pass 写物理块第 10 槽=S12），仅供
 *  未迁移旧权重的等价验证与历史回放，不得用于新训练。 */
export function encodeAction(src: Combo | null, out: Float32Array, passAt: PassEncoding = DEFAULT_PASS_ENCODING): void {
  if (!src) {
    out[passAt === 'legacy-phys10' ? PASS_KIND_IDX : PASS_ACTION_IDX] = 1;
    return;
  }
  for (const c of src.cards) out[physIdx(c)] += 1;
  const k = kindIdx(src.kind);
  if (k >= 0) out[PHYS_DIM + k] = 1;
  out[PHYS_DIM + KIND_DIM + 1] = src.keyRank / MAX_ORDER;
  out[PHYS_DIM + KIND_DIM + 2] = src.size / MAX_SIZE;
  out[PHYS_DIM + KIND_DIM + 3] = src.wildAs.length / 2;
}

// ---- 历史动作记录（紧凑 14 维/条：kind10 + pass1 + keyRank1 + size1 + none1）----
export const MOVE_REC_DIM = KIND_DIM + 4;
export interface MoveRec { pass: boolean; kindIdx: number; keyRank: number; size: number }
export const NONE_REC: MoveRec = { pass: false, kindIdx: -1, keyRank: 0, size: 0 };

// ---- 状态块布局（维度由常量求和，改字段自动重算）----
export const STATE_BLOCKS = {
  myHand: PHYS_DIM,
  unknownPool: PHYS_DIM,
  trickCards: PHYS_DIM,
  trickMeta: 3 + KIND_DIM + 1 + 1,            // declarerRel + kind + keyRank + size
  seatStatus: 3 * 3,                          // ×(队友/下家/上家)：count/27、报牌≤10、finishOrder/3
  recentMoves: 3 * 3 * MOVE_REC_DIM,          // 3 家 × 最近 3 动作
  levels: 2,                                  // 本队/对方级数 (lv-2)/12
  wilds: 1,                                   // 我手中万能牌张数 /2
  tribute: 2,                                 // 抗贡、我是否贡者
} as const;
export const STATE_DIM = Object.values(STATE_BLOCKS).reduce((a, b) => a + b, 0); // 317
export const INPUT_DIM = STATE_DIM + ACTION_DIM;                                 // 385

// ---- REVIEW4-F：编码 v2（331 状态 + 68 动作 = 399）----
// 新增规则上下文信息组：生效级牌 13 维 one-hot（点数 2..14 与 rankOrder 规则定义一致）
// + 我方是否在台 1 维。布局：旧状态 0..316 原位；新 14 维 317..330；动作块 331..398。
export const SCHEMA_VERSION_V2 = 'gd-lab-schema-v2';
export const RULE_CTX_DIM = 14;
export const RULE_CTX_OFFSET = STATE_DIM; // 317
export const STATE_DIM_V2 = STATE_DIM + RULE_CTX_DIM; // 331
export const INPUT_DIM_V2 = STATE_DIM_V2 + ACTION_DIM; // 399

/** 生效级牌上下文（公开信息）：stage=台上队级数；both=双方级数皆级牌（取本队） */
export function ruleContextOf(state: GameState, seat: number): { levelRank: number | null; myTeamOnStage: boolean } {
  const myTeam = seat & 1;
  if (state.ctx.ranks.size === 0) return { levelRank: null, myTeamOnStage: false };
  const stageTeam = state.stageTeam ?? 0;
  const levelRank = state.match.levels[stageTeam] ?? null;
  return { levelRank, myTeamOnStage: stageTeam === myTeam };
}

/** 把 14 维规则上下文写入 out[RULE_CTX_OFFSET..]；fill='zero' 为对照组（恒 0） */
export function encodeRuleContext(state: GameState, seat: number, out: Float32Array, fill: 'zero' | 'rule-context'): void {
  if (fill === 'zero') return;
  const { levelRank, myTeamOnStage } = ruleContextOf(state, seat);
  if (levelRank != null && levelRank >= 2 && levelRank <= 14) {
    out[RULE_CTX_OFFSET + (levelRank - 2)] = 1;
  }
  out[RULE_CTX_OFFSET + 13] = myTeamOnStage ? 1 : 0;
}

/** v2 状态编码：v1 317 维 + 14 维规则上下文（fill 决定 control/treatment） */
export function encodeStateV2(
  state: GameState, seat: number, tracker: PublicTracker, out: Float32Array,
  fill: 'zero' | 'rule-context',
): Float32Array {
  encodeState(state, seat, tracker, out.subarray(0, STATE_DIM) as unknown as Float32Array);
  encodeRuleContext(state, seat, out, fill);
  return out;
}

/** v1(385) 父权重 → v2(399) 首层列重映射：旧状态列原位、新 14 列零、动作列右移 14 */
export function remapV1WeightsToV2(flatV1: Float32Array): Float32Array {
  const IN1 = INPUT_DIM, H = 256;
  const w1Len1 = H * IN1, b1Len = H;
  const total1 = flatV1.length;
  const total2 = total1 + H * RULE_CTX_DIM; // 仅首层增列，其余层不变
  const out = new Float32Array(total2);
  const w1o1 = 0, b1o1 = w1Len1;                    // v1: W1(0..H*385) b1(H*385..+H)
  const w1o2 = 0, b1o2 = H * INPUT_DIM_V2;          // v2: W1(0..H*399) b1(+H)
  // 偏置与其余层：v1 偏置在 b1o1；v1 其余层在 b1o1+H 起
  out.set(flatV1.subarray(b1o1, b1o1 + b1Len), b1o2); // b1
  out.set(flatV1.subarray(b1o1 + b1Len, total1), b1o2 + b1Len); // 其余层原样
  // 首层逐列：v1 列 j（0..384）→ v2 列 j<317 ? j : j+14
  for (let h = 0; h < H; h++) {
    for (let j1 = 0; j1 < IN1; j1++) {
      const j2 = j1 < STATE_DIM ? j1 : j1 + RULE_CTX_DIM;
      out[w1o2 + h * INPUT_DIM_V2 + j2] = flatV1[w1o1 + h * IN1 + j1];
    }
    // 新 14 列保持 0
  }
  return out;
}

// ---- REVIEW5 T0.2：pass 编码修复的版本与权重迁移 ----
// v3 = 385 维布局 + pass 写动作块 64；v4 = 399 维布局 + pass 写动作块 64。
// 旧权重（v1/v2 编码训练）必须经 migratePassEncoding 迁移后才可与 action64 编码共用；
// 迁移本身不改变任何输入的首层加权和与 Q（旧 pass 列 10 的权重被复制到列 64，原列保留）。
export const SCHEMA_VERSION_V3 = 'gd-lab-schema-v3';
export const SCHEMA_VERSION_V4 = 'gd-lab-schema-v4';

/** 旧编码（pass@phys10）权重 → 新编码（pass@action64）权重：首层每个隐单元
 *  把动作块列 stateDim+10 的权重复制到 stateDim+64，其余全部不变。
 *  对旧编码输入：非 pass 从不写 64、pass 恰写 10=1 → 迁移后 Q 逐位不变（含 float 顺序，
 *  因为 0 权重项是精确零加）。返回新数组，不改入参。 */
export function migratePassEncoding(
  flat: Float32Array, inputDim: number, stateDim: number, hidden = 256,
): Float32Array {
  const expected = hidden * inputDim + hidden + hidden * hidden + hidden + hidden + 1;
  if (flat.length !== expected) {
    throw new Error(`migratePassEncoding: 参数量 ${flat.length} != ${expected}（inputDim=${inputDim}, hidden=${hidden}）`);
  }
  const out = flat.slice();
  for (let h = 0; h < hidden; h++) {
    const row = h * inputDim;
    out[row + stateDim + PASS_ACTION_IDX] = flat[row + stateDim + PASS_KIND_IDX];
  }
  return out;
}

/** 纯函数：由公开信息编码状态。tracker 维护已出牌与各座位历史（公开事件驱动）。 */
export function encodeState(
  state: GameState, seat: number, tracker: PublicTracker, out: Float32Array,
): Float32Array {
  out.fill(0);
  let o = 0;
  const ctx = state.ctx;
  const myHand = state.hands[seat];

  // 1. myHand
  for (const c of myHand) out[o + physIdx(c)] += 1;
  o += PHYS_DIM;

  // 2. unknownPool = 2 - 我有 - 公开已出（注意：不含进贡亮明归属的区分，见文件头限制）
  for (let i = 0; i < PHYS_DIM; i++) out[o + i] = DECK_COPIES - out[i] - tracker.played[i];
  o += PHYS_DIM;

  // 3+4. 待压牌（null=我领出 → 全 0）
  const tb = state.lastCombo;
  if (tb) {
    for (const c of tb.cards) out[o + physIdx(c)] += 1;
    o += PHYS_DIM;
    const d = relSeat(seat, state.lastPlayer);
    out[o + d] = 1;
    const k = kindIdx(tb.kind);
    if (k >= 0) out[o + 3 + k] = 1;
    out[o + 3 + KIND_DIM] = tb.keyRank / MAX_ORDER;
    out[o + 3 + KIND_DIM + 1] = tb.size / MAX_SIZE;
    o += STATE_BLOCKS.trickMeta;
  } else {
    o += PHYS_DIM + STATE_BLOCKS.trickMeta;
  }

  // 5. 三家状态（队友/下家/上家）
  for (let r = 0; r < 3; r++) {
    const p = (seat + [2, 1, 3][r]) & 3;
    const n = state.hands[p].length;
    out[o] = n / 27;
    out[o + 1] = n > 0 && n <= 10 ? 1 : 0;
    const fo = state.finished.indexOf(p);
    out[o + 2] = fo >= 0 ? (fo + 1) / 3 : 0;
    o += 3;
  }

  // 6. 每家最近 3 个动作（新→旧）
  for (let r = 0; r < 3; r++) {
    const p = (seat + [2, 1, 3][r]) & 3;
    const recs = tracker.recent(p);
    for (let s = 0; s < 3; s++) {
      const rec = recs[s] ?? NONE_REC;
      if (rec.kindIdx < 0) { out[o + MOVE_REC_DIM - 1] = 1; }
      else {
        if (rec.pass) out[o + KIND_DIM] = 1;
        else {
          out[o + rec.kindIdx] = 1;
          out[o + KIND_DIM + 1] = rec.keyRank / MAX_ORDER;
          out[o + KIND_DIM + 2] = rec.size / MAX_SIZE;
        }
      }
      o += MOVE_REC_DIM;
    }
  }

  // 7. 级数（本队/对方）
  const myTeam = seat & 1;
  out[o] = (state.match.levels[myTeam] - 2) / 12;
  out[o + 1] = (state.match.levels[1 - myTeam] - 2) / 12;
  o += 2;

  // 8. 我手中万能牌张数（红心级牌）
  let wilds = 0;
  for (const c of myHand) if (c.suit === 'H' && ctx.ranks.has(c.rank) && c.rank < 15) wilds += 1;
  out[o] = wilds / 2; o += 1;

  // 9. 贡局上下文
  const tr = state.tribute;
  if (tr) {
    out[o] = tr.resist ? 1 : 0;
    out[o + 1] = tr.tributes.some((t) => t.from === seat) ? 1 : 0;
  }
  o += 2;

  if (o !== STATE_DIM) throw new Error(`schema 布局错位: ${o} != ${STATE_DIM}`);
  return out;
}

/** 每个玩家一份（四家记忆严格隔离，只由公开事件驱动） */
export class PublicTracker {
  readonly played = new Uint8Array(PHYS_DIM);
  private rings: MoveRec[][] = [[], [], [], []];

  observe(events: { type: string; player?: number; combo?: Combo | null }[]): void {
    for (const ev of events) {
      if (ev.type === 'play' && ev.combo) {
        for (const c of ev.combo.cards) this.played[physIdx(c)] += 1;
        this.push(ev.player!, {
          pass: false, kindIdx: kindIdx(ev.combo.kind),
          keyRank: ev.combo.keyRank, size: ev.combo.size,
        });
      } else if (ev.type === 'pass') {
        this.push(ev.player!, { pass: true, kindIdx: KIND_DIM - 1, keyRank: 0, size: 0 });
      }
    }
  }
  private push(seat: number, rec: MoveRec): void {
    const r = this.rings[seat];
    r.unshift(rec);
    if (r.length > 3) r.length = 3;
  }
  recent(seat: number): MoveRec[] { return this.rings[seat]; }
  reset(): void {
    this.played.fill(0);
    this.rings = [[], [], [], []];
  }
}

/** schema 描述（随权重包一起导出） */
export function schemaDescriptor(): { version: string; passEncoding: PassEncoding; [k: string]: unknown } {
  return {
    version: SCHEMA_VERSION,
    passEncoding: 'legacy-phys10',
    inputDim: INPUT_DIM,
    stateDim: STATE_DIM,
    actionDim: ACTION_DIM,
    blocks: STATE_BLOCKS,
    kinds: KINDS,
    passKindIdx: PASS_KIND_IDX,
    passActionIdx: PASS_ACTION_IDX,
    normalization: { maxOrder: MAX_ORDER, maxSize: MAX_SIZE, deckCopies: DECK_COPIES },
    knownLimitations: [
      '进贡/还贡公开亮明牌的归属未编码（unknownPool 不区分已知在某家/完全未知）',
      'pass 仅表示选择不压，不作压不过的硬约束',
    ],
  };
}

/** 组装完整输入 = 状态 317 + 动作 68（rankOrder 导入保留供调试期校验用） */
export function buildInput(state: GameState, seat: number, tracker: PublicTracker, action: Combo | null, passAt: PassEncoding = DEFAULT_PASS_ENCODING): Float32Array {
  const v = encodeState(state, seat, tracker, new Float32Array(INPUT_DIM));
  encodeAction(action, v.subarray(STATE_DIM), passAt);
  return v;
}

/** v2 组装：状态 331（含 14 维规则上下文）+ 动作 68（动作块起点 331） */
export function buildInputV2(
  state: GameState, seat: number, tracker: PublicTracker, action: Combo | null,
  fill: 'zero' | 'rule-context', passAt: PassEncoding = DEFAULT_PASS_ENCODING,
): Float32Array {
  const v = new Float32Array(INPUT_DIM_V2);
  encodeStateV2(state, seat, tracker, v, fill);
  encodeAction(action, v.subarray(STATE_DIM_V2), passAt);
  return v;
}

/** v2 schema 描述（随权重包导出） */
export function schemaDescriptorV2(fill: 'zero' | 'rule-context') {
  return {
    ...schemaDescriptor(),
    version: SCHEMA_VERSION_V2,
    inputDim: INPUT_DIM_V2,
    stateDim: STATE_DIM_V2,
    ruleContext: { dim: RULE_CTX_DIM, offset: RULE_CTX_OFFSET, fill, layout: '生效级牌 one-hot 13 (2..14) + 我方在台 1' },
  };
}

/** REVIEW5 T0.2 新版描述：v3=385 布局 + pass@64；v4=399 布局 + pass@64 */
export function schemaDescriptorV3() {
  return { ...schemaDescriptor(), version: SCHEMA_VERSION_V3, passEncoding: 'action64' as PassEncoding };
}
export function schemaDescriptorV4(fill: 'zero' | 'rule-context') {
  return {
    ...schemaDescriptorV2(fill), version: SCHEMA_VERSION_V4, passEncoding: 'action64' as PassEncoding,
  };
}

void rankOrder;
