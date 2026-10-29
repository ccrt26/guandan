/**
 * packages/ai/src/nn/observationAudit.ts — T0（REVIEW3-EXEC §4 observation-audit）。
 * 逐块列出 317 维状态 + 68 维动作的字段/位置/来源/可见性/时间；
 * 程序化检查：暗牌不变性（换对手手牌向量必须逐位一致）、公开历史敏感性、
 * pass 位契约（REVIEW5 T0.2 修复：默认写动作块 64；legacy-phys10 仅兼容旧权重）；
 * 信息在场清单（在场/可推导/确实缺失）。
 * 缺失项只登记为后续单因素试验，不自动扩网（§4.5/4.6）。
 */
import { buildDeck, createMatch, DEFAULT_RULES, startGame, RNG, applyMove, bestResponse, type Combo, type GameState } from '@gd/engine';
import { encodeState, encodeAction, STATE_BLOCKS, ACTION_DIM, PHYS_DIM, PASS_KIND_IDX, PASS_ACTION_IDX, KIND_DIM, STATE_DIM, PublicTracker, INPUT_DIM } from './schema';

export interface BlockAudit {
  block: string;
  dim: number;
  position: string;
  source: string;
  visibility: 'self' | 'public' | 'derived';
  timing: string;
}

export interface AuditCheck { name: string; pass: boolean; detail: string }

export interface ObservationAuditResult {
  stateDim: number;
  actionDim: number;
  blocks: BlockAudit[];
  checks: AuditCheck[];
  infoPresence: Array<{ info: string; status: 'present' | 'derivable' | 'absent'; note: string }>;
}

const BASE = STATE_BLOCKS;
function off(...names: string[]): number {
  let o = 0;
  for (const [k, v] of Object.entries(BASE)) {
    if (names.includes(k)) return o;
    o += v as number;
  }
  return o;
}

export function auditBlocks(): BlockAudit[] {
  return [
    { block: 'myHand', dim: BASE.myHand, position: `${off('myHand')}-${off('myHand') + 53}`, source: 'state.hands[seat]', visibility: 'self', timing: '实时' },
    { block: 'unknownPool', dim: BASE.unknownPool, position: `${off('unknownPool')}-${off('unknownPool') + 53}`, source: '2 − 我有 − 公开已出(tracker.played)', visibility: 'derived', timing: '累计' },
    { block: 'trickCards', dim: BASE.trickCards, position: `${off('trickCards')}-${off('trickCards') + 53}`, source: 'state.lastCombo.cards（我领出=全0）', visibility: 'public', timing: '本轮' },
    { block: 'trickMeta', dim: BASE.trickMeta, position: `${off('trickMeta')}-${off('trickMeta') + BASE.trickMeta - 1}`, source: 'lastPlayer 相对座位+待压牌型/主值/张数（控制权）', visibility: 'public', timing: '本轮' },
    { block: 'seatStatus', dim: BASE.seatStatus, position: `${off('seatStatus')}-${off('seatStatus') + 8}`, source: '队友/下家/上家：剩牌/27、报牌≤10、名次/3', visibility: 'public', timing: '实时' },
    { block: 'recentMoves', dim: BASE.recentMoves, position: `${off('recentMoves')}-${off('recentMoves') + BASE.recentMoves - 1}`, source: 'tracker.recent(p)：3 家 × 最近 3 动作（pass/kind/keyRank/size）', visibility: 'public', timing: '最近 3 手' },
    { block: 'levels', dim: BASE.levels, position: `${off('levels')}-${off('levels') + 1}`, source: 'match.levels 本队/对方 (lv−2)/12', visibility: 'public', timing: '本副' },
    { block: 'wilds', dim: BASE.wilds, position: `${off('wilds')}`, source: '我手中红心级牌张数 /2（级牌点数本身未编码）', visibility: 'self', timing: '实时' },
    { block: 'tribute', dim: BASE.tribute, position: `${off('tribute')}-${off('tribute') + 1}`, source: '抗贡、我是否贡者（公开亮明贡牌的归属未编码）', visibility: 'public', timing: '本副' },
    { block: 'action.physical', dim: PHYS_DIM, position: `${STATE_DIM}-${STATE_DIM + 53}`, source: '候选牌张多重集（+= 写入，允许同一物理位 2 张）', visibility: 'self', timing: '决策' },
    { block: 'action.kind', dim: KIND_DIM + 1, position: `${STATE_DIM + PHYS_DIM}-${STATE_DIM + PHYS_DIM + 10}`, source: '牌型 one-hot 10 档 + pass 档（pass 写 PHYS+10=64，REVIEW5 T0.2 修复；legacy-phys10 旧位仅兼容）', visibility: 'self', timing: '决策' },
    { block: 'action.scalars', dim: 3, position: `${STATE_DIM + PHYS_DIM + KIND_DIM + 1}-${STATE_DIM + ACTION_DIM - 1}`, source: 'keyRank/41、size/10、wildAs/2', visibility: 'self', timing: '决策' },
  ];
}

/** 构造两个只有暗牌不同的局面（同一公开信息流） */
function hiddenInfoPair(): { a: GameState; b: GameState; tracker: PublicTracker; seat: number } | null {
  const rng = new RNG(20261027);
  const match = createMatch({ ...DEFAULT_RULES }, rng.next() * 0xffffffff);
  const state = startGame(match);
  const seat = 0;
  // 公开走两手牌（保证 tracker 非空）
  const tracker = new PublicTracker();
  let played = 0;
  while (played < 2 && !state.over) {
    const t = state.turn;
    const combo = bestResponse(state.hands[t].slice(0, 1), state.lastCombo, state.ctx, match.opts);
    if (!combo) { applyMove(state, { pass: true }); continue; }
    const events = applyMove(state, { pass: false, combo });
    tracker.observe(events);
    played += 1;
  }
  const b = {
    ...state, hands: state.hands.map((h, i) => (i === seat ? [...h] : [...h].reverse())) as GameState['hands'],
    trickPlays: state.trickPlays.map((p) => ({ ...p })), finished: [...state.finished],
  } as GameState;
  return { a: state, b, tracker, seat };
}

export function runObservationAudit(): ObservationAuditResult {
  const checks: AuditCheck[] = [];

  // 1. 暗牌不变性：换对手手牌（同 id 集合不同排列=无效果；进一步交换不同牌张才有效果）
  //    这里交换对手间的牌张 id（保持张数与公开流不变）
  const pair = hiddenInfoPair();
  if (pair) {
    const va = new Float32Array(STATE_DIM);
    const vb = new Float32Array(STATE_DIM);
    encodeState(pair.a, pair.seat, pair.tracker, va);
    const swapped = { ...pair.b } as GameState;
    const h1 = [...swapped.hands[1]]; const h3 = [...swapped.hands[3]];
    swapped.hands = [...swapped.hands]; swapped.hands[1] = h3; swapped.hands[3] = h1; // 交换东/西手牌（暗牌信息）
    encodeState(swapped, pair.seat, pair.tracker, vb);
    const same = va.every((v, i) => v === vb[i]);
    checks.push({ name: 'hiddenInfoInvariance', pass: same, detail: same ? '交换对手暗牌后状态向量逐位一致' : '对手暗牌泄漏进状态向量！' });
  }

  // 2. 公开历史敏感性：不同 played 历史 → 向量必须不同
  {
    const pair2 = hiddenInfoPair();
    if (pair2) {
      const v1 = new Float32Array(STATE_DIM);
      const v2 = new Float32Array(STATE_DIM);
      const t2 = new PublicTracker();
      t2.played[3] = 1; // 假设多出过一张（模拟不同历史）
      encodeState(pair2.a, pair2.seat, pair2.tracker, v1);
      encodeState(pair2.a, pair2.seat, t2, v2);
      const diff = v1.some((v, i) => v !== v2[i]);
      checks.push({ name: 'publicHistorySensitivity', pass: diff, detail: diff ? '公开历史变化反映在向量中' : '公开历史未进入向量！' });
    }
  }

  // 3. pass 位契约（REVIEW5 T0.2）：action64 编码 pass 必须写动作块 64、物理区全 0；
  //    默认 legacy-phys10 保留历史位（旧权重兼容，新训练必须显式 action64+迁移）
  {
    const fixedVec = new Float32Array(ACTION_DIM);
    encodeAction(null, fixedVec, 'action64');
    const fixed = fixedVec[PASS_ACTION_IDX] === 1 && fixedVec[PASS_KIND_IDX] === 0
      && fixedVec.slice(0, PHYS_DIM).every((v) => v === 0);
    const legacy = new Float32Array(ACTION_DIM);
    encodeAction(null, legacy);
    const legacyOk = legacy[PASS_KIND_IDX] === 1 && legacy[PASS_ACTION_IDX] === 0;
    checks.push({
      name: 'passBitContract',
      pass: fixed && legacyOk,
      detail: fixed && legacyOk
        ? `action64 编码 pass 写动作块 ${PASS_ACTION_IDX}（物理区全 0）；legacy-phys10（默认）保持历史位 ${PASS_KIND_IDX}`
        : 'pass 编码契约破坏：action64 未写动作块 64 或 legacy 路径失真',
    });
  }

  // 4. 信息在场清单（§4.3）
  const infoPresence: ObservationAuditResult['infoPresence'] = [
    { info: '己方手牌', status: 'present', note: 'myHand 54 位' },
    { info: '队友/对手座位关系', status: 'present', note: 'seatStatus/recentMoves 按 队友/下家/上家 相对排列；trickMeta 含领出者相对座位' },
    { info: '各席剩余张数', status: 'present', note: 'seatStatus count/27（含报牌≤10 位）' },
    { info: '当前轮控制权', status: 'present', note: 'trickCards+trickMeta（lastCombo 空则我领出）' },
    { info: '公开出牌（累计）', status: 'present', note: 'unknownPool 间接编码 2−我有−已出；逐张出牌流仅在 recentMoves 保留最近 3 手/家' },
    { info: '双方级数', status: 'present', note: 'levels 2 位' },
    { info: '级牌点数/谁在台（stage 生效级）', status: 'derivable' as const, note: 'stage 口径下生效级=台上队级数；levels 编码两队级数但 stageTeam 未直接编码，级牌点数仅通过 wilds（我手中红心级牌张数）间接暴露——记为表示缺口（CLEAN2 训练仍用现编码，修复列为后续单因素试验）' },
    { info: '进贡/还贡公开信息', status: 'absent' as const, note: 'tribute 仅 2 位（抗贡/我是否贡者）；公开亮明的贡牌归属未编码（schema 头部 knownLimitations 声明）' },
    { info: '完整逐手历史', status: 'absent' as const, note: '仅最近 3 手/家；更早历史可由 unknownPool+复盘层重建，网络不见。如真实分歧例证明需要更长记忆，列为单因素试验' },
  ];

  return {
    stateDim: STATE_DIM,
    actionDim: ACTION_DIM,
    blocks: auditBlocks(),
    checks,
    infoPresence,
  };
}

void INPUT_DIM; void buildDeck;
