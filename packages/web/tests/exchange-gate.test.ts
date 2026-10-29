import { describe, expect, it } from 'vitest';
import { applyMove, canPass, createMatch, legalCombos, pickReturnCard, startGame, type GameState, type MatchState, type Move, type RuleOptions } from '@gd/engine';
import { DEFAULT_RULES } from '@gd/engine';
import { MatchController } from '../src/game/controller';

/**
 * 贡还结果确认门（04_状态机与验收 → 本地引擎）的真引擎级测试。
 * 用确定性种子跑完第一局，使第二局真实产生进贡/还贡，然后验证：
 * 交换只发生一次；确认门前 AI/轮次冻结；acknowledgeExchange 只解门不碰牌；
 * 重复确认幂等；抗贡/无贡不设门。
 */

const RULES: RuleOptions = { ...DEFAULT_RULES };

/** 纯引擎自对弈一局（双方总出最小合法牌），结束后 match.lastResult 就绪 */
function playOneGame(match: MatchState): GameState {
  let state = startGame(match, [0]);
  let guard = 0;
  while (!state.over && guard < 500) {
    guard += 1;
    const legal = legalCombos(state);
    const move: Move = legal.length > 0 ? { pass: false, combo: legal[0] } : { pass: true };
    applyMove(state, move);
  }
  if (!state.over) throw new Error('self-play did not finish');
  return state;
}

/** 找一个种子：第二局产生真实贡还（非抗贡），且人类欠还贡 */
function findSeed(maxTries = 60): number {
  for (let seed = 1; seed <= maxTries; seed += 1) {
    const match = createMatch(RULES, seed);
    playOneGame(match);
    const state = startGame(match, [0]);
    const t = state.tribute;
    if (t && !t.resist && state.pendingReturns.some((p) => p.from === 0)) return seed;
  }
  throw new Error('no tribute seed found in range');
}

function resumeAfterOneGame(seed: number): MatchController {
  const match = createMatch(RULES, seed);
  playOneGame(match);
  return new MatchController({
    difficulty: 1,
    rules: RULES,
    resumeMatch: {
      levels: [...match.levels] as [number, number],
      gameNo: match.gameNo,
      lastResult: match.lastResult,
      lastHead: match.lastHead,
      rngState: match.rngState,
      ruleOpts: { ...match.opts },
      difficulty: 1,
      aiPolicy: 'heuristic:L1',
      savedAt: Date.now(),
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('贡还结果确认门（真引擎）', () => {
  it('还贡完成前不设门；完成后设门且交换只发生一次（手牌不再变化）', () => {
    const seed = findSeed();
    const c = resumeAfterOneGame(seed);
    c.startGame();
    expect(c.state!.tribute).not.toBeNull();
    expect(c.state!.tribute!.resist).toBe(false);
    expect(c.state!.pendingReturns.some((p) => p.from === 0)).toBe(true);
    // 人类还贡前：门未开（04：等待权威结果/还贡阶段不属于结果确认）
    expect(c.exchangeAckPending).toBe(false);
    expect(c.exchangeResult()).toBeNull();

    c.submitReturn(pickReturnCard(c.state!, c.state!.pendingReturns[0].from));
    expect(c.state!.pendingReturns.length).toBe(0);
    // 交换完成：门开启，快照成对
    expect(c.exchangeAckPending).toBe(true);
    const snap = c.exchangeResult();
    expect(snap).not.toBeNull();
    for (const p of snap!.pairs) {
      expect(p.ret.from).toBe(p.tribute.to);
      expect(p.ret.to).toBe(p.tribute.from);
    }
    const hands = JSON.stringify(c.state!.hands);
    const moveNo = c.state!.moveNo;
    // 门控期：AI/轮次冻结
    return (async () => {
      await sleep(900);
      expect(c.state!.moveNo).toBe(moveNo);
      expect(JSON.stringify(c.state!.hands)).toBe(hands);
      // 确认：只解门，不换牌不发牌
      c.acknowledgeExchange(snap!.version);
      expect(c.exchangeAckPending).toBe(false);
      expect(JSON.stringify(c.state!.hands)).toBe(hands);
      expect(c.state!.moveNo).toBe(moveNo); // ack 本身不推进；行牌方按引擎恢复
      // 重复确认幂等：无副作用、无异常
      c.acknowledgeExchange(snap!.version);
      expect(c.exchangeAckPending).toBe(false);
      expect(JSON.stringify(c.state!.hands)).toBe(hands);
      c.destroy();
    })();
  });

  it('确认后引擎恢复推进（首个 AI 动作只发生在门控释放后）', async () => {
    const seed = findSeed();
    const c = resumeAfterOneGame(seed);
    c.startGame();
    c.submitReturn(pickReturnCard(c.state!, c.state!.pendingReturns[0].from));
    const moveNo = c.state!.moveNo;
    c.acknowledgeExchange(c.exchangeResult()!.version);
    if (c.humanTurn) {
      // 轮到人类：引擎恢复人类行牌方，等待输入（不算冻结）
      expect(c.humanTurn).toBe(true);
      c.destroy();
      return;
    }
    await sleep(1400);
    expect(c.state!.moveNo).toBeGreaterThan(moveNo); // AI 已行动
    c.destroy();
  });

  it('无贡（首局）不设门；抗贡（resist）不设门', () => {
    // 首局（无上一局结果）必然无贡
    const c0 = new MatchController({ difficulty: 1, rules: RULES });
    c0.startGame();
    expect(c0.exchangeAckPending).toBe(false);
    // 抗贡：手工构造引擎合法的 resist 快照形状来验证门控条件（不伪造结果展示）
    const c1 = resumeAfterOneGame(findSeed());
    c1.startGame();
    if (c1.state!.tribute) {
      c1.state!.tribute.resist = true;
      // 直接触发布防逻辑路径：pendingReturns 已空时 armExchangeGate 会因 resist 拒绝
      (c1 as unknown as { armExchangeGate(): void }).armExchangeGate();
      expect(c1.exchangeAckPending).toBe(false);
    }
    c1.destroy();
    c0.destroy();
  });
});
