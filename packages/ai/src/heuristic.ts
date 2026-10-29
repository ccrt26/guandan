import {
  type Combo, type GameState, legalCombos, type LevelCtx, teammateOf, teamOf,
  enumerateCombos, comboKey, powerClass, rankOrder,
} from '@gd/engine';
import type { PlayMemory } from './memory';
import { decompose, type Plan } from './planner';
import type { AICapabilities } from './types';
import type { Move } from './types';

export interface DecisionInput {
  state: GameState;
  seat: number;
  caps: AICapabilities;
  memory: PlayMemory | null;
  /** 0..1 随机数源（噪声用） */
  rand: () => number;
  /** 输出各候选的评分项构成（terms；Σ=score）。复盘用，默认关（零开销） */
  explain?: boolean;
}

export interface ScoredMove {
  move: Move;
  combo: Combo | null;
  score: number;
  /** 评分项构成（explain 时输出；总分=Σterms，浮点顺序与累加一致）。供复盘作可验证依据 */
  terms?: ScoreTerm[];
}

export interface ScoreTerm { key: string; label: string; value: number }

/**
 * 启发式决策核心：对每个候选动作打分（降序返回）。
 * 设计原则：
 * - 最小压制（跟牌用刚好压过的牌）
 * - 不拆炸弹 / 不烧万能牌（除非终局或对手冲刺）
 * - 队友配合（队友发力时让牌权，大牌留给对手）
 * - 手数优先（出手次数越少越接近头游）
 */
export function scoreCandidates(input: DecisionInput): ScoredMove[] {
  const { state, seat, caps, memory, rand } = input;
  const explain = input.explain === true;
  /** 计点累加器：非 explain 路径退化为纯累加（零对象分配、浮点顺序不变） */
  const mkAcc = (out: ScoreTerm[]) => {
    let s = 0;
    return {
      add(key: string, label: string, v: number): void { s += v; if (explain) out.push({ key, label, value: +v.toFixed(4) }); },
      get score(): number { return s; },
    };
  };
  const hand = state.hands[seat];
  const toBeat = state.lastCombo;
  const toBeatOwner = state.lastPlayer;
  const mate = teammateOf(seat);
  const myTeam = teamOf(seat);

  let legal = legalCombos(state);
  if (legal.length === 0 && !toBeat) {
    throw new Error('领出无牌可打');
  }

  // 当前全局拆解（领出时用于保持结构）
  let myPlan: Plan | null = null;
  if (caps.planning && hand.length > 0) {
    myPlan = decompose(hand, state.ctx);
  }

  const isBombKind = (c: Combo) => powerClass(c) >= 1;
  const wildCount = (c: Combo) => c.wildAs.length;

  // 对手最小手牌数（终局压力）
  const oppAlive = [0, 1, 2, 3].filter((p) => teamOf(p) !== myTeam && !state.finished.includes(p));
  const minOppCards = oppAlive.length
    ? Math.min(...oppAlive.map((p) => state.hands[p].length))
    : 99;
  const iAmClose = hand.length <= 6;

  interface Cand {
    move: Move;
    combo: Combo | null;
    score: number;
    terms?: ScoreTerm[];
  }
  const cands: Cand[] = [];

  if (!toBeat) {
    // ---- 领出 ----
    for (const c of legal) {
      const terms: ScoreTerm[] = [];
      const A = mkAcc(terms);
      const restLen = hand.length - c.size;
      if (restLen === 0) A.add('finish', '一手出完（直接走人）', 1000);

      if (!caps.planning) {
        // 初级：凭感觉领小牌，偶尔乱领（含炸弹）
        A.add('beginner-lead-low', '初级·领小牌偏好', -(c.keyRank * 0.8));
        A.add('beginner-lead-size', '初级·多出牌', c.size * 0.15);
      } else {
        // 手数：粗略（restLen/4）+ 计划一致性
        const roughHands = restLen === 0 ? 0 : Math.ceil(restLen / 4);
        A.add('hands', `手数成本（剩${restLen}张≈${roughHands}手）`, -(roughHands * 3));
        if (myPlan && myPlan.combos.some((p) => comboKey(p) === comboKey(c))) A.add('plan', '与拆解计划一致', 6);
        // 低牌先出（前期重罚大牌，后期放宽）
        const phase = hand.length / 27;
        A.add('low-first', '低牌先出（大牌折价）', -(c.keyRank * 0.35 * (0.35 + 0.65 * phase)));
        // 多出牌
        A.add('size', '多出牌', c.size * 0.4);
        // 炸弹别乱领
        if (isBombKind(c)) A.add('bomb-lead', '炸弹别乱领', -(minOppCards <= 4 ? 5 : 28));
        // 万能牌别乱用
        A.add('wild', '万能牌别乱用', -(wildCount(c) * 4));
        // 记牌：对手大概率压不住 → 抢牌权（读牌=从让牌行为推断，高级技能）
        if (memory && caps.inference) {
          const oppCanBeat = oppAlive.some((p) => !memory.likelyCannotBeat(p, c));
          if (!oppCanBeat) A.add('read-beat', '读牌：对手大概率压不住（抢牌权）', 8);
        }
        // 对手快走完：领大单/大对压制
        if (minOppCards <= 2 && (c.kind === 'single' || c.kind === 'pair')) {
          A.add('press', '对手将走完·领大单/对压制', c.keyRank * 0.5);
        }
        // 首攻口诀「情况不明对子先行」（中级起的老手常识）
        if (hand.length >= 20 && c.kind === 'pair' && c.keyRank <= 10) A.add('pair-first', '首攻口诀·对子先行', 2.5);
        // 送牌：队友手数少且对手不紧时，领小单/小对喂队友接走
        const mateCards = state.hands[mate].length;
        if (
          mateCards > 0 && mateCards <= 5 && !state.finished.includes(mate) && minOppCards > 5 &&
          (c.kind === 'single' || c.kind === 'pair')
        ) {
          A.add('feed-mate', c.keyRank <= 14 ? '送牌：喂队友（小牌）' : '送牌：大牌不舍得喂', c.keyRank <= 14 ? 8 : -4);
        }
        // 终局封锁：对手报牌阶段领最大单/对封出口，少领长组合
        // 高级按残局决策树把阈值放宽到 4（剩4/5张一手可走）
        const lockThresh = caps.inference ? 4 : 3;
        if (minOppCards <= lockThresh) {
          if (c.kind === 'single' || c.kind === 'pair') {
            A.add('lock', '终局封锁·封出口', (c.keyRank - 14) * (minOppCards <= 2 ? 0.8 : 0.4));
          } else {
            A.add('lock-long', '终局封锁·少领长组合', -6);
          }
        }
        // 高级·算牌：手里是全场剩余最大的单/对（无人能压）→ 抢牌权
        if (caps.inference && memory && (c.kind === 'single' || c.kind === 'pair')) {
          if (isUnbeatable(memory, hand, c, state.ctx)) A.add('unbeatable', '算牌：全场剩余最大（稳牌权）', 10);
        }
        // 我快走完：控制牌权，领大的
        if (iAmClose) A.add('my-close', '自己将走完·领大的控权', c.keyRank * 0.25);
      }
      cands.push({ move: { pass: false, combo: c }, combo: c, score: A.score, terms: explain ? terms : undefined });
    }
  } else {
    // ---- 跟牌 ----
    const ownerIsMate = toBeatOwner === mate;
    const ownerIsOpp = teamOf(toBeatOwner) !== myTeam;
    const ownerClose = state.hands[toBeatOwner].length <= 4 && !state.finished.includes(toBeatOwner);

    if (!caps.planning) {
      // 初级：能压就压（用最小）、对对手有炸爱炸、不会算牌配合。
      // 但底线是新手也懂的常识：炸弹永远不炸队友，队友出大牌时会让。
      for (const c of legal) {
        const terms: ScoreTerm[] = [];
        const A = mkAcc(terms);
        A.add('beginner-follow-base', '初级·能压就压（越小越好）', 20 - (c.keyRank - toBeat.keyRank) * 0.8);
        if (isBombKind(c)) A.add('beginner-bomb', ownerIsMate ? '底线：不炸队友' : '初级·对手的牌想炸', ownerIsMate ? -60 : 6);
        if (ownerIsMate) {
          if (toBeat.keyRank >= 20) A.add('beginner-mate-big', '队友的级牌/王不硬压', -16);
          if (c.keyRank >= 20) A.add('beginner-mate-over', '不拿大牌顶队友', -10);
        }
        cands.push({ move: { pass: false, combo: c }, combo: c, score: A.score, terms: explain ? terms : undefined });
      }
      {
        const terms: ScoreTerm[] = [];
        const A = mkAcc(terms);
        A.add('beginner-pass', ownerIsMate && toBeat.keyRank >= 20 ? '让队友的大牌走' : '不出（基础）', ownerIsMate && toBeat.keyRank >= 20 ? 12 : 8);
        cands.push({ move: { pass: true }, combo: null, score: A.score, terms: explain ? terms : undefined });
      }
    } else {
      // Pass 候选
      {
        const terms: ScoreTerm[] = [];
        const A = mkAcc(terms);
        if (ownerIsOpp && ownerClose) A.add('pass-danger', '对手冲刺·让牌危险', -30);
        if (ownerIsOpp && iAmClose && legal.length > 0) A.add('pass-my-close', '自己将走完却让牌', -12);
        if (ownerIsMate && caps.cooperation) A.add('let-mate', '让队友走（配合）', 12);
        cands.push({ move: { pass: true }, combo: null, score: A.score, terms: explain ? terms : undefined });
      }

      for (const c of legal) {
        const terms: ScoreTerm[] = [];
        const A = mkAcc(terms);
        A.add('base', '跟牌基础分', 15);
        const restLen = hand.length - c.size;
        if (restLen === 0) A.add('finish', '一手出完（直接走人）', 1000);
        // 最小压制：超出的牌力是浪费
        A.add('minimal', '最小压制（超出牌力是浪费）', -((c.keyRank - toBeat.keyRank) * 1.1));
        // 同型才可比；炸弹已由 powerClass 处理
        if (isBombKind(c)) {
          const urgent = minOppCards <= 4 || restLen <= 4;
          const blockBig = ownerIsOpp && toBeat.size >= 5; // 对手大倾倒值得炸
          A.add('bomb-use', urgent ? '炸弹：时机紧迫值得炸' : '炸弹：时机未到（抑制）', -(urgent ? 6 : blockBig && caps.inference ? 14 : 32));
        }
        A.add('wild', '万能牌消耗', -(wildCount(c) * 5));
        // 相对手数：只有让手数变多的打法才受罚（避免无脑消极）
        const roughBefore = Math.ceil(hand.length / 4);
        const roughHands = restLen === 0 ? 0 : Math.ceil(restLen / 4);
        A.add('hands-delta', `手数变化（${roughBefore}→${roughHands}）`, -((roughHands - roughBefore) * 6));

        if (ownerIsMate && caps.cooperation) {
          // 压队友：重罚，除非自己能走或显著推进
          A.add('beat-mate', '压队友（配合纪律）', -26);
          if (restLen === 0) A.add('finish-override', '自己能直接走（豁免）', 1040);
          else if (roughHands <= 1) {
            // 粗估 ceil(rest/4) 会把零散牌高估成"一手跑完"，用真实拆解确认
            const rest = hand.filter((card) => !c.cards.some((p) => p.id === card.id));
            const exact = decompose(rest, state.ctx).hands;
            A.add('relay-confirm', exact <= 1 ? '真实拆解确认只剩一手（接力）' : '拆解后不止一手（让队友走）', exact <= 1 ? 30 : 4);
          }
          else if (c.kind === toBeat.kind && c.keyRank - toBeat.keyRank <= 2 && roughHands <= 2) A.add('relay-cheap', '小顶接力', 10);
        }
        if (ownerIsOpp) {
          if (ownerClose) A.add('block-close', '对手冲刺·压住', 22);
          // 读牌（高级技能）：推断身后玩家是否压得过，干净赢下这一轮
          if (memory && caps.inference) {
            const laterPlayers = laterActorSeats(state, seat);
            const someoneCanBeat = laterPlayers.some(
              (p) => !state.finished.includes(p) && !memory.likelyCannotBeat(p, c),
            );
            if (!someoneCanBeat) A.add('read-behind', '读牌：身后无人能压（干净赢轮）', 10);
          }
          // 高级·算牌：用无敌牌压，稳赢不亏
          if (caps.inference && memory && !isBombKind(c) && isUnbeatable(memory, hand, c, state.ctx)) A.add('unbeatable', '算牌：无敌牌压制', 8);
          // 高级·终局推进：赢了这轮后只剩一手 → 连续冲游
          if (caps.inference && restLen > 0 && Math.ceil(restLen / 4) <= 1) A.add('endgame', '终局推进：赢轮后仅剩一手', 18);
        }
        // 不拆牌纪律：避免破坏计划中的炸弹 / 长组合（温和版）
        if (myPlan) {
          const cKey = comboKey(c);
          for (const pc of myPlan.combos) {
            if (comboKey(pc) === cKey) break;
            const shared = c.cards.some((card) => pc.cards.some((p) => p.id === card.id));
            if (!shared) continue;
            if (pc.kind === 'bomb' || pc.kind === 'joker_bomb' || pc.kind === 'flush') A.add('break-bomb', `不拆牌纪律：破坏计划中的${pc.kind === 'flush' ? '同花顺' : '炸弹'}`, -12);
            else if (pc.kind === 'straight' || pc.kind === 'pair_seq' || pc.kind === 'trio_seq') A.add('break-seq', '不拆牌纪律：破坏计划中的长组合', -5);
            break;
          }
        }
        cands.push({ move: { pass: false, combo: c }, combo: c, score: A.score, terms: explain ? terms : undefined });
      }
    }
  }

  // 噪声：低级别 AI 随机波动（分析口径 noise=0 时为 0；explain 仍记入 terms 保持 Σ=score）
  for (const cand of cands) {
    const noise = rand() * caps.noise * 70;
    cand.score += noise;
    if (explain && noise !== 0) cand.terms?.push({ key: 'noise', label: '级别随机噪声', value: +noise.toFixed(4) });
  }

  cands.sort((a, b) => b.score - a.score);
  return cands;
}

export function decideMove(input: DecisionInput): Move {
  const scored = scoreCandidates(input);
  return pickMove(scored, input.caps.noise, input.rand);
}

/**
 * 选牌策略：高噪声档位（初级）有概率"随手"——在分数差距较大（≤30）的
 * 候选池里随机挑，模拟新手不上心的真实失误（次优但绝不非法/非理性）。
 */
export function pickMove(scored: ScoredMove[], noise: number, rand: () => number): Move {
  if (scored.length === 0) return { pass: true };
  if (noise >= 0.2 && scored.length > 1 && rand() < noise) {
    const best = scored[0].score;
    const pool: number[] = [];
    for (let i = 0; i < scored.length && i < 10; i++) {
      if (best - scored[i].score <= 30) pool.push(i);
    }
    if (pool.length > 1) return scored[pool[Math.floor(rand() * pool.length)]].move;
  }
  return scored[0].move;
}

/** 本轮在我之后还有行动机会的座位 */
function laterActorSeats(state: GameState, seat: number): number[] {
  // 从 seat+1 顺时针到 lastPlayer（不含 seat）
  const out: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const p = (seat + i) & 3;
    if (p === state.lastPlayer) break;
    out.push(p);
  }
  return out;
}

/**
 * 算牌：这张单/对是否是全场剩余最大（除我手里外没有更大的牌能压它）。
 * 只有记牌+推断能力开启时调用。
 */
function isUnbeatable(
  memory: PlayMemory,
  hand: import('@gd/engine').Card[],
  c: Combo,
  ctx: LevelCtx,
): boolean {
  if (c.kind !== 'single' && c.kind !== 'pair') return false;
  const myOrder = rankOrder(c.mainRank, ctx);
  // 统计我手里比它大的牌（要排除），其余全是别人手里的威胁
  const mineBigger = hand.filter((card) => rankOrder(card.rank, ctx) > myOrder).length;
  let biggerLeft = 0;
  for (let r = 2; r <= 17; r++) {
    if (rankOrder(r, ctx) > myOrder) biggerLeft += memory.remainingOfRank(r);
  }
  return biggerLeft - mineBigger <= 0;
}

/** 判断某时刻是否为「关键决策」（高级档 rollout 触发条件） */
export function isKeyDecision(state: GameState, seat: number, candidates: Combo[]): boolean {
  const hand = state.hands[seat];
  const minOpp = Math.min(
    ...[0, 1, 2, 3]
      .filter((p) => teamOf(p) !== teamOf(seat) && !state.finished.includes(p))
      .map((p) => state.hands[p].length),
  );
  if (minOpp <= 8) return true;
  if (hand.length <= 8) return true;
  // 是否在考虑炸弹/同花顺/王炸
  if (candidates.some((c) => powerClass(c) >= 1)) return true;
  // 是否在压队友
  if (state.lastCombo && state.lastPlayer === teammateOf(seat)) return true;
  return false;
}

/** 供 rollout / 模拟用的轻量枚举包装（避免每步全量枚举） */
export function candidateCombos(state: GameState): Combo[] {
  return legalCombos(state);
}

export { enumerateCombos };
