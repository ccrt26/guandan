import {
  applyMove, beats, bestResponse, buildDeck, canPass, checkRecordIntegrity, classify, completeReturn, createMatch, describeCombo,
  legalCombos, newRecordId, pickReturnCard, RECORD_SCHEMA_VERSION, Recorder, sortedHandCopy, startGame,
  type Card, type Combo, type EngineEvent, type GameRecord, type GameResult, type GameState,
  type MatchState, type RuleOptions, RNG,
} from '@gd/engine';
import { createAI, createNeuralAI, decideMove, MLP, mulberry32, NEURAL_MODEL_VERSION, NeuralDecider, PlayMemory, scoreCandidates, type NeuralTier } from '@gd/ai';
import type { AIPlayer, Difficulty, Move } from '@gd/ai';
import { clearCurrentMatch, loadCurrentMatch, saveCurrentMatch, saveRecord, updateStats, type ActiveGameSave, type MatchSave } from './storage';
import {
  copyJson, freezeExchange, readExchange, restoreInitialGame, snapshotInitialGame,
  type ExchangeHistoryEntry, type ExchangeResult,
} from './exchange';

export const HUMAN_SEAT = 0;
export const SEAT_NAMES = ['你', '东家', '队友', '西家'];

/** 历史只是展示元数据；损坏项丢弃，不能使有效活动牌局崩溃或改变其确认门。 */
function restoreExchangeHistory(value: unknown, matchId: string, gameNo: number): readonly ExchangeHistoryEntry[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const deck = buildDeck();
  const isSeat = (seat: unknown): seat is number => Number.isInteger(seat) && Number(seat) >= 0 && Number(seat) < 4;
  const transfer = (raw: unknown): { from: number; to: number; card: Card } | null => {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as { from?: unknown; to?: unknown; card?: Partial<Card> | null };
    if (!isSeat(item.from) || !isSeat(item.to) || item.from === item.to || !item.card
      || !Number.isInteger(item.card.id)) return null;
    const canonical = deck[item.card.id!];
    if (!canonical || item.card.suit !== canonical.suit || item.card.rank !== canonical.rank) return null;
    return { from: item.from, to: item.to, card: { ...canonical } };
  };
  const accepted = new Map<string, ExchangeHistoryEntry>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<ExchangeHistoryEntry>;
    if (!Number.isSafeInteger(entry.gameNo) || entry.gameNo! < 1 || entry.gameNo! > gameNo
      || !isSeat(entry.leader) || typeof entry.version !== 'string'
      || (entry.confirmedAt !== null && (!Number.isSafeInteger(entry.confirmedAt)
        || entry.confirmedAt! < 0 || entry.confirmedAt! > 8.64e15))
      || !Array.isArray(entry.pairs) || entry.pairs.length < 1 || entry.pairs.length > 2) continue;
    const pairs: ExchangeResult['pairs'][number][] = [];
    const givers = new Set<number>(), receivers = new Set<number>(), entities = new Set<number>();
    for (const pair of entry.pairs) {
      const tribute = transfer(pair?.tribute), ret = transfer(pair?.ret);
      if (!tribute || !ret || ret.from !== tribute.to || ret.to !== tribute.from
        || ret.card.rank < 2 || ret.card.rank > 10 || givers.has(tribute.from) || receivers.has(tribute.to)
        || entities.has(tribute.card.id) || entities.has(ret.card.id)) break;
      givers.add(tribute.from); receivers.add(tribute.to);
      entities.add(tribute.card.id); entities.add(ret.card.id);
      pairs.push({ tribute, ret });
    }
    if (pairs.length !== entry.pairs.length || [...givers].some((seat) => receivers.has(seat))) continue;
    const version = `${matchId}/${entry.gameNo}/${JSON.stringify({ pairs, leader: entry.leader })}`;
    if (entry.version !== version || accepted.has(version)) continue;
    accepted.set(version, freezeExchange({ pairs, leader: entry.leader, gameNo: entry.gameNo!,
      version, confirmedAt: entry.confirmedAt! }));
  }
  return Object.freeze([...accepted.values()]);
}

export interface ControllerOptions {
  difficulty: Difficulty;
  rules: RuleOptions;
  aiDelayMs?: number;
  /** 实验性神经陪练（试用）：传入 armA_end 权重后，三个 AI 座位改用神经模型；
   *  加载或决策异常时回退启发式并计数（neuralFallbacks）。不替换正式三档默认。 */
  neuralOpponents?: ArrayBufferLike;
  /** D1 三档（难度只作用于两个对手席位；队友固定贪心）；缺省=hard（贪心）保持旧行为 */
  neuralTier?: NeuralTier;
  /** 神经权重加载失败原因（App 层 fetch 失败时传入；UI 横幅+记录如实标注回退） */
  neuralLoadError?: string;
  /** 开发期自动驾驶（?autopilot=1）：AI 代打人类座位跑完整局，用于冒烟测试。
   *  仅 DEV 构建可开启；代打走与对手完全相同的决策通路（只用公开信息，无作弊面）。 */
  autopilot?: boolean;
  /** 新档恢复当前局的交换快照与动作；旧局末档继续下一局。 */
  resumeMatch?: MatchSave;
}

/**
 * 对局控制器：驱动引擎 + 三个 AI + 人类输入，产出对局记录。
 * React 通过 subscribe/useSyncExternalStore 订阅版本号重渲染。
 */
export class MatchController {
  match: MatchState;
  state: GameState | null = null;
  readonly difficulty: Difficulty;
  /** 当前轮各家最新动作（null=未行动）；用于中央出牌区展示 */
  tableCombos: (Combo | 'pass' | null)[] = [null, null, null, null];
  /** 当前轮按出牌顺序记录；完成轮次保留到下一轮实际首出 */
  currentTrick: { player: number; item: Combo | 'pass' }[] = [];
  private completedTrickVisible = false;
  humanMemory: PlayMemory;
  /** 人类席位神经首选（提示行用；部署权重，独立公开 tracker） */
  hintNeural: NeuralDecider | null = null;
  record: GameRecord | null = null;
  thinking = false;
  lastGameResult: GameResult | null = null;

  private players = new Map<number, AIPlayer>();
  /** 神经陪练回退次数（异常时回启发式；>0 时 UI 可提示） */
  neuralFallbacks = 0;
  /** 最近一次回退原因（本局 UI 横幅用；null=无回退） */
  lastNeuralFallbackReason: string | null = null;
  /** 本局各席位实际策略（'human' | 'neural:<ver>' | 'heuristic:L<d>' | 'heuristic:L<d>(fallback)'），随记录存档 */
  currentPolicies: string[] = ['human', 'heuristic', 'heuristic', 'heuristic'];
  private recorder: Recorder | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private opts: ControllerOptions & { aiDelayMs: number };
  private rng = new RNG((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  private reviveBound = (): void => this.reviveIfStalled();
  private readonly matchId: string;
  private savedRevision: string | null;
  private resumeGame: ActiveGameSave | undefined;
  private activeGame: ActiveGameSave | undefined;
  private replaying = false;
  private exchangeSnapshot: ExchangeResult | null = null;
  private verifiedExchangeVersion: string | null = null;
  private exchangeHands = '';
  private acknowledgedVersion: string | null = null;
  private history: readonly ExchangeHistoryEntry[] = Object.freeze([]);
  private exchangeValidationError: string | null = null;
  private exchangeActionError: string | null = null;
  private recoveryError: string | null = null;

  constructor(opts: ControllerOptions) {
    this.opts = { aiDelayMs: opts.autopilot ? 100 : 600, ...opts };
    this.difficulty = opts.difficulty;
    const save = opts.resumeMatch;
    this.matchId = save?.matchId ?? `m${newRecordId()}-${Math.random().toString(36).slice(2)}`;
    this.savedRevision = save?.snapshotRevision ?? null;
    this.resumeGame = save?.activeGame ? copyJson(save.activeGame) : undefined;
    this.history = restoreExchangeHistory(save?.exchangeHistory, this.matchId, save?.gameNo ?? 0);
    // 旧局末档升级为官方 stage 口径；新半局档本来即为 stage。
    const rules: RuleOptions = { ...(save?.ruleOpts ?? opts.rules) };
    if (rules.levelMode !== 'stage') rules.levelMode = 'stage';
    this.match = createMatch(rules, save?.rngState ?? this.rng.next() * 0xffffffff);
    if (save) {
      this.match.levels = [...save.levels] as [number, number];
      this.match.gameNo = save.gameNo;
      this.match.lastHead = save.lastHead;
      this.match.lastResult = save.lastResult;
    }
    this.humanMemory = PlayMemory.fromStart({ ranks: new Set([2]), levels: [2, 2] });
    // 宿主休眠/标签挂起会吞掉已排定的计时器（AI 回合卡死）；唤醒/聚焦事件触发时自愈
    if (typeof window !== 'undefined') {
      for (const ev of ['visibilitychange', 'focus', 'pageshow'] as const) {
        window.addEventListener(ev, this.reviveBound);
      }
    }
  }

  /** 若卡在 AI 回合（thinking 状态没有计时器会推进），重排一次调度；健康时是无害重置 */
  reviveIfStalled(): void {
    if (!this.state || this.state.over) return;
    if (this.thinking) this.scheduleNext();
  }

  /** 当前比赛快照：交换完成后的起点＋动作；局末则只保留比赛进度。 */
  matchSavePoint(): MatchSave {
    return {
      levels: [...this.match.levels] as [number, number],
      gameNo: this.match.gameNo,
      lastResult: this.match.lastResult,
      lastHead: this.match.lastHead,
      rngState: this.match.rngState,
      ruleOpts: { ...this.match.opts },
      difficulty: this.difficulty,
      aiPolicy: this.opts.neuralOpponents ? `neural-tier:${this.opts.neuralTier ?? 'hard'}` : `heuristic:L${this.difficulty}`,
      savedAt: Date.now(),
      matchId: this.matchId,
      ...(this.savedRevision ? { snapshotRevision: this.savedRevision } : {}),
      exchangeHistory: this.history,
      ...(this.activeGame && this.state && !this.state.over ? { activeGame: copyJson(this.activeGame) } : {}),
    };
  }

  get autopilotOn(): boolean {
    return this.opts.autopilot === true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  /** 开始新的一局（保留比赛级数）。人类收贡须自选还牌：还贡阶段完成前不开始记录与出牌。 */
  startGame(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.aiTimer = this.watchdog = null;
    this.thinking = false;
    this.exchangeAckPending = false;
    this.exchangeSnapshot = null;
    this.verifiedExchangeVersion = null;
    this.exchangeHands = '';
    this.acknowledgedVersion = null;
    this.exchangeValidationError = this.exchangeActionError = this.recoveryError = null;
    this.activeGame = undefined;
    if (!this.ownsLocalSnapshot()) {
      this.state = null;
      this.notify();
      return;
    }
    const resume = this.resumeGame;
    this.resumeGame = undefined;
    // 还贡选择权只属于人类座位；自动驾驶（?autopilot=1）全席自动还
    let state: GameState;
    try {
      if (resume && resume.schemaVersion !== 1) throw new Error('不支持的续局版本');
      state = resume ? restoreInitialGame(resume.initial, this.match)
        : startGame(this.match, this.autopilotOn ? [] : [HUMAN_SEAT]);
      if (resume && (!resume.recorderMeta || !Array.isArray(resume.moves)
        || resume.recorderMeta.matchId !== this.matchId
        || resume.recorderMeta.leader !== state.leader
        || JSON.stringify(resume.recorderMeta.initialHands) !== JSON.stringify(state.hands)
        || JSON.stringify(resume.recorderMeta.levelsBefore) !== JSON.stringify(state.levelsBefore)
        || JSON.stringify(resume.recorderMeta.ruleOpts) !== JSON.stringify(this.match.opts))) {
        throw new Error('续局记录与交换后起点不一致');
      }
    } catch (error) {
      this.state = null;
      this.recoveryError = `本地续局恢复失败：${String(error)}`;
      this.exchangeAckPending = true;
      this.notify();
      return;
    }
    this.state = state;
    this.tableCombos = [null, null, null, null];
    this.currentTrick = [];
    this.completedTrickVisible = false;
    this.players.clear();
    const seats = this.autopilotOn ? [0, 1, 2, 3] : [1, 2, 3];
    this.lastNeuralFallbackReason = null;
    this.currentPolicies = ['human', 'heuristic', 'heuristic', 'heuristic'];
    const tier: NeuralTier = this.opts.neuralTier ?? 'hard';
    // D1 语义：难度只作用于两个对手席位（东1/西3）；队友（北2）固定满血贪心。
    // 档位随机流：matchSeed 派生（确定性、可复现，不用时间/座位序号之外的熵）
    const tierRand = mulberry32((this.match.rngState ^ (this.match.gameNo * 0x9e37) ^ 0x71ea) >>> 0);
    for (const seat of seats) {
      let ai: AIPlayer;
      if (this.opts.neuralOpponents && seat !== HUMAN_SEAT) {
        const seatTier: NeuralTier = seat === 2 ? 'hard' : tier; // 队友恒贪心
        try {
          ai = createNeuralAI(seat, this.opts.neuralOpponents, seatTier, tierRand);
          this.currentPolicies[seat] = seat === 2
            ? `neural:${NEURAL_MODEL_VERSION}`
            : `neural-tier:${seatTier}:${NEURAL_MODEL_VERSION}`;
        } catch (e) {
          this.neuralFallbacks += 1;
          this.lastNeuralFallbackReason = String(e);
          console.warn('[neural] 加载失败，回退启发式：', e);
          ai = createAI(seat, this.opts.difficulty, (this.rng.next() * 0xffffffff) | 0);
          this.currentPolicies[seat] = `heuristic:L${this.opts.difficulty}(fallback)`;
        }
      } else {
        ai = createAI(seat, this.opts.difficulty, (this.rng.next() * 0xffffffff) | 0);
        this.currentPolicies[seat] = seat === HUMAN_SEAT
          ? (this.autopilotOn ? `autopilot:L${this.opts.difficulty}` : 'human')
          : `heuristic:L${this.opts.difficulty}`;
      }
      ai.reset(state, this.match.opts);
      this.players.set(seat, ai);
    }
    if (this.opts.neuralLoadError) {
      // App 层权重加载失败：三席全部回退启发式——横幅与记录如实标注（不只写 console）。
      // 放在循环之后，避免被普通启发式分支覆盖 (fallback) 标记。
      this.neuralFallbacks += 1;
      this.lastNeuralFallbackReason = this.opts.neuralLoadError;
      this.currentPolicies = this.currentPolicies.map((p, i) =>
        i === 0 ? p : `heuristic:L${this.opts.difficulty}(fallback)`);
    }
    this.humanMemory = PlayMemory.fromStart(state.ctx);
    // 人类席位神经首选（提示"新 AI 首选"行用）：与对手共用部署权重，独立公开信息 tracker
    if (this.opts.neuralOpponents) {
      try {
        const w = new Float32Array(this.opts.neuralOpponents);
        const mlp = new MLP(1);
        mlp.setWeights(w);
        this.hintNeural = new NeuralDecider(HUMAN_SEAT, mlp, 0, () => 0);
      } catch { this.hintNeural = null; }
    } else this.hintNeural = null;
    this.recorder = null; // 还贡全部完成后才开记录（initialHands 口径=还贡后手牌，与回放契约一致）
    this.lastGameResult = null;
    if (state.pendingReturns.length === 0) this.beginPlay(resume);
    this.acknowledgedVersion = resume?.acknowledgedVersion ?? null;
    this.armExchangeGate();
    if (resume && !this.exchangeError) {
      this.replaying = true;
      try {
        if (resume.moves.length && this.exchangeAckPending) throw new Error('未确认交换的存档含出牌动作');
        for (const move of resume.moves) {
          this.validateRestoredMove(move);
          this.step(move);
        }
      } catch (error) {
        this.recoveryError = `本地续局恢复失败：${String(error)}`;
        this.exchangeAckPending = true;
      } finally { this.replaying = false; }
    }
    if (!this.exchangeError) this.persistActiveGame();
    this.notify();
    this.scheduleNext();
  }

  /**
   * 贡还结果确认门（04_状态机与验收 → 本地引擎映射，详见 docs/ui/UI-TRIBUTE-GATE-MAPPING.md）。
   * 进贡+还贡交换由引擎完成且只完成一次；此门只冻结「AI 推进/轮次启动」，
   * acknowledgeExchange() 仅解除门控——不换牌、不发牌、不扣牌、不初始化、不出牌。
   * 抗贡（resist）与无贡（tribute=null）没有交换，不设门（是否强制人工继续属待确认建议，本轮不启用）。
   * 自动驾驶（?autopilot=1，dev 冒烟）自动确认，不阻塞。
   */
  exchangeAckPending = false;

  get exchangeError(): string | null {
    return this.recoveryError ?? this.exchangeValidationError ?? this.exchangeActionError;
  }

  /** Action failures can be retried against the still-valid displayed result. */
  get canAcknowledgeExchange(): boolean {
    this.armExchangeGate();
    return this.exchangeAckPending && !!this.exchangeSnapshot
      && !this.recoveryError && !this.exchangeValidationError;
  }

  get exchangeHistory(): readonly ExchangeHistoryEntry[] { return this.history; }

  private armExchangeGate(): void {
    const state = this.state;
    if (!state || state.moveNo > 0 || this.recoveryError) return;
    try {
      const result = readExchange(state, this.matchId);
      if (!result && this.verifiedExchangeVersion) throw new Error('已提交的交换结果缺失');
      const hands = JSON.stringify(state.hands.map((hand) => hand.map((card) => card.id).sort((a, b) => a - b)));
      if (result && result.version === this.verifiedExchangeVersion && hands !== this.exchangeHands) {
        throw new Error('同一交换版本的手牌发生变化');
      }
      this.exchangeValidationError = null;
      this.exchangeSnapshot = result;
      if (!result) { this.exchangeAckPending = false; return; }
      this.verifiedExchangeVersion = result.version;
      this.exchangeHands = hands;
      this.exchangeAckPending = !this.autopilotOn && this.acknowledgedVersion !== result.version;
      if (!this.history.some((entry) => entry.version === result.version)) {
        this.history = Object.freeze([...this.history, freezeExchange({ ...copyJson(result), confirmedAt: null })]);
      }
    } catch (error) {
      this.exchangeSnapshot = null;
      this.exchangeValidationError = `贡还结果校验失败：${error instanceof Error ? error.message : String(error)}`;
      this.exchangeAckPending = true;
    }
  }

  /**
   * 仅返回已验证的真实交换。版本绑定本地比赛、局号与结果内容，普通通知不影响版本。
   */
  exchangeResult(): ExchangeResult | null {
    this.armExchangeGate();
    return this.exchangeSnapshot;
  }

  /** 人工确认「已查看贡还结果」：只解除门控并恢复引擎既定调度（轮到谁由引擎决定），不执行任何牌局动作 */
  acknowledgeExchange(viewedVersion: string): boolean {
    if (!this.ownsLocalSnapshot()) { this.notify(); return false; }
    this.armExchangeGate();
    const result = this.exchangeSnapshot;
    if (!this.exchangeAckPending || this.recoveryError || this.exchangeValidationError || !result) return false;
    if (typeof viewedVersion !== 'string' || viewedVersion !== result.version) {
      this.exchangeActionError = '贡还结果已更新，请查看当前结果后继续';
      this.notify();
      return false;
    }
    const history = this.history;
    this.acknowledgedVersion = result.version;
    this.history = Object.freeze(this.history.map((entry) => entry.version === result.version
      ? freezeExchange({ ...copyJson(entry), confirmedAt: Date.now() }) : entry));
    this.exchangeActionError = null;
    if (!this.persistActiveGame()) {
      this.acknowledgedVersion = null;
      this.history = history;
      this.exchangeActionError = '确认未完成：本地存储不可用，请恢复存储后重试';
      this.notify();
      return false;
    }
    this.exchangeAckPending = false;
    this.notify();
    this.scheduleNext();
    return true;
  }

  get humanTurn(): boolean {
    this.armExchangeGate();
    return this.state !== null && !this.state.over
      && (this.replaying || this.ownsLocalSnapshot())
      && !this.exchangeAckPending && !this.exchangeError
      && this.state.pendingReturns.length === 0
      && this.state.turn === HUMAN_SEAT;
  }

  /** 还贡阶段轮到人类选牌（UI 据此切换选牌/按钮语义） */
  get humanReturning(): boolean {
    const p = this.state?.pendingReturns[0];
    return !this.exchangeError && p !== undefined && p.from === HUMAN_SEAT;
  }

  /** 还贡提示：与 AI 自动还同口径的建议牌 */
  returnHint(): Card | null {
    const state = this.state;
    if (!state || !this.humanReturning) return null;
    return pickReturnCard(state, HUMAN_SEAT);
  }

  /** 提交一张还贡牌（人类选牌或 AI/自动驾驶定时器共用）；还完无人再还则正式开牌 */
  submitReturn(card: Card): void {
    if (!this.ownsLocalSnapshot()) { this.notify(); return; }
    const state = this.state;
    if (!state || state.over || state.pendingReturns.length === 0) return;
    completeReturn(state, card);
    if (state.pendingReturns.length === 0 && !this.recorder) this.beginPlay();
    this.armExchangeGate();
    this.persistActiveGame();
    this.notify();
    this.scheduleNext();
  }

  /** 还贡全部完成：以还贡后的手牌开局记录（回放按 initialHands+leader 重建，口径不变） */
  private beginPlay(resume?: ActiveGameSave): void {
    const state = this.state!;
    this.recorder = new Recorder(resume ? copyJson(resume.recorderMeta) : {
      schemaVersion: RECORD_SCHEMA_VERSION,
      id: newRecordId(),
      matchId: this.matchId,
      createdAt: Date.now(),
      ruleOpts: { ...this.match.opts },
      levelsBefore: [...state.levelsBefore] as [number, number],
      stageTeam: state.stageTeam,
      leader: state.leader,
      humanSeat: HUMAN_SEAT,
      difficulties: [null, this.opts.difficulty, this.opts.difficulty, this.opts.difficulty],
      aiPolicies: [...this.currentPolicies],
      initialHands: state.hands.map((h) => [...h]),
    });
    this.recorder.recordTributes(state.tribute);
    this.activeGame = {
      schemaVersion: 1, initial: snapshotInitialGame(state), recorderMeta: copyJson(this.recorder.meta),
      moves: [], acknowledgedVersion: resume?.acknowledgedVersion ?? null,
    };
  }

  private persistActiveGame(): boolean {
    if (!this.activeGame || !this.state || this.state.over || this.replaying) return true;
    if (this.state.moveNo === 0 && !this.exchangeValidationError && this.recorder) {
      this.activeGame.initial = snapshotInitialGame(this.state);
      this.recorder.meta.leader = this.state.leader;
      this.recorder.meta.initialHands = copyJson(this.state.hands);
      this.activeGame.recorderMeta = copyJson(this.recorder.meta);
    }
    this.activeGame.acknowledgedVersion = this.acknowledgedVersion;
    // 测试/无 DOM 嵌入环境不具备本地存储；浏览器写失败则明确拒绝确认。
    return this.persistMatchSave(this.matchSavePoint());
  }

  /** 同步 localStorage 的乐观修订检查；不是服务器锁或跨设备确认协议。 */
  private ownsLocalSnapshot(): boolean {
    if (!this.savedRevision || typeof localStorage === 'undefined') return true;
    const latest = loadCurrentMatch();
    if (latest?.snapshotRevision === this.savedRevision && latest.matchId === this.matchId) return true;
    this.recoveryError = '牌局已在其他页面更新，请回到首页继续最新存档';
    this.exchangeAckPending = true;
    this.thinking = false;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.aiTimer = this.watchdog = null;
    return false;
  }

  private persistMatchSave(save: MatchSave): boolean {
    if (typeof localStorage === 'undefined') return true;
    if (!this.ownsLocalSnapshot()) return false;
    const revision = `${newRecordId()}-${Math.random().toString(36).slice(2)}`;
    if (!saveCurrentMatch({ ...save, snapshotRevision: revision })) return false;
    this.savedRevision = revision;
    return true;
  }

  private validateRestoredMove(move: Move): void {
    const state = this.state!;
    if (!move || state.over || (move.pass && !canPass(state))) throw new Error('续局动作不合法');
    if (move.pass) return;
    const cards = move.combo?.cards;
    if (!Array.isArray(cards) || new Set(cards.map((card) => card.id)).size !== cards.length
      || !cards.every((card) => state.hands[state.turn].some((owned) => owned.id === card.id
        && owned.suit === card.suit && owned.rank === card.rank))) throw new Error('续局动作的牌张不属于行牌方');
    const valid = classify(cards, state.ctx, this.match.opts).some((combo) => combo.kind === move.combo.kind
      && combo.keyRank === move.combo.keyRank && combo.size === move.combo.size
      && combo.length === move.combo.length && (!state.lastCombo || beats(combo, state.lastCombo)));
    if (!valid) throw new Error('续局动作牌型无效');
  }

  humanLegal(): Combo[] {
    if (!this.humanTurn) return [];
    return legalCombos(this.state!);
  }

  /** 校验人类选牌 → 可出的牌型解释（含万能牌代入），null = 不可出 */
  validateSelection(cards: Card[]): Combo | null {
    if (!this.humanTurn) return null;
    return bestResponse(cards, this.state!.lastCombo, this.state!.ctx, this.match.opts);
  }

  humanPlay(combo: Combo): void {
    if (!this.humanTurn || this.autopilotOn) return;
    this.step({ pass: false, combo });
    this.scheduleNext();
  }

  humanPass(): void {
    if (!this.humanTurn || this.autopilotOn || !canPass(this.state!)) return;
    this.step({ pass: true });
    this.scheduleNext();
  }

  /** 新 AI 首选（部署权重 ε=0；null=无权重或建议让牌）。提示行独立标注来源 */
  neuralHint(): { pass: boolean; combo: Combo | null } | null {
    if (!this.humanTurn || !this.hintNeural) return null;
    const d = this.hintNeural.decide(this.state!);
    return d.move as { pass: boolean; combo: Combo | null };
  }

  /** 提示：用中级策略给人类推荐一步（null = 建议让牌） */
  hint(): Combo | null {
    if (!this.humanTurn) return null;
    const move = decideMove({
      state: this.state!,
      seat: HUMAN_SEAT,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory: this.humanMemory,
      rand: Math.random,
    });
    return move.pass ? null : (move as { pass: false; combo: Combo }).combo;
  }

  /** 提示候选列表（供循环切换：多次点提示在候选间轮换） */
  hintCandidates(): { pass: boolean; combo: Combo | null }[] {
    if (!this.humanTurn) return [];
    const scored = scoreCandidates({
      state: this.state!,
      seat: HUMAN_SEAT,
      caps: { memory: true, inference: false, cooperation: true, planning: true, noise: 0, rolloutIters: 0 },
      memory: this.humanMemory,
      rand: () => 0,
    });
    const out: { pass: boolean; combo: Combo | null }[] = [];
    for (const s of scored) {
      if (s.move.pass) {
        if (!out.some((o) => o.pass)) out.push({ pass: true, combo: null });
      } else {
        out.push({ pass: false, combo: s.move.combo });
      }
      if (out.length >= 6) break;
    }
    return out;
  }

  /** 应用一步（人类或 AI 共用），更新桌面展示与记录 */
  private step(move: Move): void {
    if (!this.replaying && !this.ownsLocalSnapshot()) { this.notify(); return; }
    this.armExchangeGate();
    if (!this.state || this.state.over || this.exchangeAckPending || this.exchangeError || this.state.pendingReturns.length) return;
    const state = this.state!;
    const toBeat = state.lastCombo;
    const mover = state.turn; // 必须在 applyMove 之前取：applyMove 会把 turn 推进到下家
    const events = applyMove(state, move);
    this.activeGame?.moves.push(copyJson(move));
    this.recorder?.record(mover, { pass: move.pass, combo: move.pass ? null : move.combo }, state.hands, toBeat);
    this.humanMemory.observeEvents(events, toBeat);
    this.hintNeural?.observe(events);
    for (const ai of this.players.values()) ai.observe(events, toBeat);
    for (const ev of events) {
      if (ev.type === 'play') {
        if (this.completedTrickVisible) {
          this.tableCombos = [null, null, null, null];
          this.currentTrick = [];
          this.completedTrickVisible = false;
        }
        this.tableCombos[ev.player] = ev.combo;
        this.currentTrick.push({ player: ev.player, item: ev.combo });
      } else if (ev.type === 'pass') {
        this.tableCombos[ev.player] = 'pass';
        this.currentTrick.push({ player: ev.player, item: 'pass' });
      } else if (ev.type === 'trickEnd') {
        // 引擎已换首家，但最后一次 pass 必须能被本次 notify 的订阅者看见。
        this.completedTrickVisible = true;
      }
    }
    if (events.some((e) => e.type === 'gameEnd') && !this.replaying) {
      this.lastGameResult = state.result;
      const record = this.recorder?.finish(state.result!) ?? null;
      if (record) {
        // 落盘即校验：完整性问题当场暴露（复盘页也会拦，但这里能最早发现记录器回归）
        const issues = checkRecordIntegrity(record);
        if (issues.length > 0) {
          console.error('[record] 记录完整性校验失败：', issues);
        }
        this.record = record;
        saveRecord(record);
        updateStats(record);
        // 存档点=每局打完：没过 A 就记进度，过 A 清档（比赛结束）
        if (state.match.winner === null) this.persistMatchSave(this.matchSavePoint());
        else clearCurrentMatch();
      }
    }
    if (!this.replaying) {
      this.persistActiveGame();
      this.notify();
    }
  }

  /** 调度 AI 行动（带延迟营造节奏）。
   * 宿主休眠/标签挂起可能吞掉已排定的计时器（实测卡死在 AI 回合），
   * 用 5 秒看门狗自愈：thinking 仍为 true 就重排一次。
   * 还贡阶段也由此调度：AI 席位延迟自动还，人类席位挂起等 UI 提交。 */
  private scheduleNext(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.aiTimer = this.watchdog = null;
    if (!this.ownsLocalSnapshot()) return;
    this.armExchangeGate();
    if (!this.state || this.state.over) return;
    // 贡还结果确认门：确认前不启动 AI、不推进轮次（04 §一）；人类还贡选择不受影响
    if (this.exchangeAckPending || this.exchangeError) { this.thinking = false; return; }
    if (this.state.pendingReturns.length > 0) {
      const pending = this.state.pendingReturns[0];
      if (this.autopilotOn || pending.from !== HUMAN_SEAT) {
        this.thinking = true;
        this.notify();
        this.aiTimer = setTimeout(() => {
          this.thinking = false;
          this.aiTimer = null;
          const st = this.state;
          if (!st || st.over || st.pendingReturns.length === 0) return;
          this.submitReturn(pickReturnCard(st, st.pendingReturns[0].from));
        }, this.opts.aiDelayMs);
      } else {
        this.thinking = false;
        this.notify();
      }
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        if (this.thinking && this.state && !this.state.over) this.scheduleNext();
      }, 5000);
      return;
    }
    if (this.humanTurn && !this.autopilotOn) return;
    this.thinking = true;
    this.notify();
    this.aiTimer = setTimeout(() => {
      this.thinking = false;
      this.aiTimer = null;
      const state = this.state;
      if (!state || state.over) return;
      this.armExchangeGate();
      if (this.exchangeAckPending || this.exchangeError || !this.ownsLocalSnapshot()) return;
      const player = this.players.get(state.turn);
      if (!player) return;
      this.step(player.decide(state));
      this.scheduleNext();
    }, this.opts.aiDelayMs);
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.thinking && this.state && !this.state.over) this.scheduleNext();
    }, 5000);
  }

  sortedHand(seat: number): Card[] {
    if (!this.state) return [];
    return sortedHandCopy(this.state.hands[seat], this.state.ctx);
  }

  describe(combo: Combo | null): string {
    return combo ? describeCombo(combo) : '';
  }

  destroy(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    if (typeof window !== 'undefined') {
      for (const ev of ['visibilitychange', 'focus', 'pageshow'] as const) {
        window.removeEventListener(ev, this.reviveBound);
      }
    }
    this.listeners.clear();
  }
}
