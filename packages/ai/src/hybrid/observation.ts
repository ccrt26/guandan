/** Public-only projection. Complete current-game history is a mandatory input;
 * GameState/trickPlays alone cannot reconstruct it. No full-state serialization. */
import { buildDeck, makeLevelCtx, stageTeamOf, teammateOf, type Card, type Combo, type GameResult, type GameState, type RuleOptions, type EngineEvent } from '@gd/engine';
import { necessaryDeclarationKey } from './legality';
import { OBSERVATION_SCHEMA, DecisionHaltedError, faceCounts, freezeCopy, halt, publicCombo, type FaceCount, type Observation, type PublicEvent, type PublicHistoryPrefix, type PublicTransfer } from './protocol';

export function assertActiveActor(state: GameState, actorSeat: number): void {
  if (!Number.isInteger(actorSeat) || actorSeat < 0 || actorSeat > 3 || actorSeat !== state.turn) halt('actor must equal active turn');
  if (state.over || state.result !== null || state.match.winner !== null || state.pendingReturns.length) halt('observation requires active play after returns');
  if (state.finished.includes(actorSeat) || state.hands.length !== 4 || state.hands[actorSeat].length === 0) halt('active actor has no hand');
  if (!Number.isSafeInteger(state.moveNo) || state.moveNo < 0 || !Number.isSafeInteger(state.match.gameNo) || state.match.gameNo < 1) halt('invalid game/move identity');
}
function seat(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 3) halt('invalid public seat');
  return value;
}
function rulesCopy(r: RuleOptions): RuleOptions {
  if (!['stage', 'both', 'high'].includes(r.levelMode) || !['head', 'head3', 'double'].includes(r.passA)) halt('invalid rule options');
  const out = { levelMode: r.levelMode, passA: r.passA, pairSeqMin: r.pairSeqMin, pairSeqMax: r.pairSeqMax,
    trioSeqMin: r.trioSeqMin, trioSeqMax: r.trioSeqMax, flushLen: r.flushLen, straightLen: r.straightLen };
  for (const n of [out.pairSeqMin, out.pairSeqMax, out.trioSeqMin, out.trioSeqMax, out.flushLen, out.straightLen]) {
    if (!Number.isSafeInteger(n) || n < 1) halt('invalid rule length');
  }
  if (out.pairSeqMin > out.pairSeqMax || out.trioSeqMin > out.trioSeqMax) halt('invalid rule range');
  return out;
}
/** Frozen prose for this engine revision, not generic/official-rule folklore.
 * Values come from all eight RuleOptions; dynamic levels remain in Observation.
 * Source: combo.ts classify/powerClass/beats, rank.ts, game.ts tribute/apply/settle.
 * Changing those semantics requires reviewing/bumping this text contract. */
export const RULES_TEXT_VERSION = 'ohuo-engine-rules-v1' as const;
export function describeRules(r: RuleOptions): string {
  const level = { stage: '全场级牌为台上一方本副级数', both: '历史both模式：双方级数均为级牌', high: '历史high模式：双方较高级数为级牌' }[r.levelMode];
  const passA = { head: '拿头游', head3: '头游且同伴不是末游', double: '双上游' }[r.passA];
  return [
    `规则合同 ${RULES_TEXT_VERSION}。两副牌108张，每席初始27张；0/2一队、1/3一队，按席号循环行动并跳过已出完者。`,
    `级牌模式levelMode=${r.levelMode}：${level}。当前生效级牌以effectiveLevelRanks数组为准，不沿用上一副。普通点数2<3<…<K<A，级牌高于普通A、小王高于级牌、大王最高；多级牌按其rank大小比较。`,
    `合法牌型：单张single；同点对子pair（含两小王或两大王）；非王同点三张trio；三带二trio_pair（非王三张加另一点数非王对子）；顺子straight（straightLen=${r.straightLen}张连续单牌）；连对pair_seq（pairSeqMin=${r.pairSeqMin},pairSeqMax=${r.pairSeqMax}组连续对子）；钢板trio_seq（trioSeqMin=${r.trioSeqMin},trioSeqMax=${r.trioSeqMax}组连续三张，钢板不带对子）；同点非王炸弹bomb（4—8张，万能补足也不超过8）；同花顺flush（flushLen=${r.flushLen}张同花连续单牌）；天王炸joker_bomb（两小王加两大王）。王只用于单张、同种王对或天王炸。`,
    '序列剔除所有当前有效级牌，不能靠万能牌填入被剔除的级牌位置；2若不是级牌可以参与。A可处于最低位置1或最高位置14，不绕圈；序列按最大位置比较（如可用时A2345的keyRank=5，10JQKA=14）。本版本B枚举只在straightLen=5时提案顺子；严格分类按实际straightLen检查。',
    '比较优先级：天王炸 > 6—8张炸弹 > 同花顺 > 5张炸弹 > 4张炸弹 > 普通牌型。6—8张炸弹先比张数再比keyRank；同档4/5张炸弹及同花顺比keyRank；普通牌型须kind、size、length都相同且keyRank严格更大，三带二比较主体而非所带对子。天王炸不能被另一手压过；等值不能压，花色不是普通牌力高低。',
    '万能牌是红心有效级牌，可在组合中补非王点数（同花顺还须声明目标花色），也可按级牌自然身份使用；万能牌不能代王。单张万能牌按当前有效级牌的最大rank计牌力。选择必须保留候选的实际花色/点数资源与必要声明：kind、mainRank/keyRank、length、size、pairRanks、万能代入rank，以及同花顺suit/代入花色。自然点数自代入与非同花顺代入花色只是注记，不凭牌型或弱键替换另一组资源。',
    '领出目标为空时必须出牌；跟牌可过牌，即使能压也可过，过牌不证明没有能压牌。有人压牌则重新累计pass；其余在场者全过后重开一轮。最后出牌者未出完由其领出；最后出牌者已出完则由其未出完的搭档领出，搭档也出完才由顺序下一位未出完者领出。',
    '首副无贡还。后续应贡者为上副末游；若三游与末游同队则两人都贡。应贡者合计有两大王则抗贡、上副头游先出；否则各贡牌力最大的非万能牌。单贡末游→头游，末游先出。双贡较大贡牌→头游、较小→二游，贡较大者先出；同牌力时按本引擎实际分支，末游贡给头游并由末游先出，三游贡给二游。',
    '收贡者各还一张给对应贡者。手动还贡仅允许点数2—10且非万能牌；本版本本地自动还贡优先选这些牌中牌力最小者，若无可还的≤10非万能牌则沿既有自动策略退为最小非万能牌。进还贡完成后才能正常出牌；公开转移只形成牌面数量下界，打出同牌面任一副本都扣减下界，不追踪隐含物理副本归属。',
    `第三名出完时结算本副，剩下一人为末游；头游所在队获胜。头游搭档为二/三/末游时分别升3/2/1级，最多到A，另一队级数不变。只有获胜队本副开始已在A且满足passA=${r.passA}（${passA}）才过A并结束整场；已在A但未满足者继续打A。下一副台上方为上副头游所在队。`,
    '信息边界：只用己牌与完整因果公开前缀；未见牌不按席断言，不接收其他席私牌、RNG或未来结果。仅选择本decision已展示actionId；一次扩展只能增加原池选项。候选是本地有限提案，不宣称覆盖全部数学合法动作；裁判始终是本地冻结引擎。',
  ].join('\n');
}

function resultCopy(r: GameResult | null): GameResult | null {
  if (r === null) return null;
  if (r.passedA) halt('previous game already ended match');
  return { finishOrder: r.finishOrder.map(seat), winnerTeam: r.winnerTeam, doubleUp: r.doubleUp,
    levelsAfter: [r.levelsAfter[0], r.levelsAfter[1]], upgrade: r.upgrade, passedA: r.passedA };
}
const faceKey = (c: Pick<Card, 'suit' | 'rank'>) => `${c.suit}:${c.rank}`;
function transferCopy(t: { from: number; to: number; card: Card }): PublicTransfer {
  if (t.from === t.to) halt('public transfer to same seat');
  return { from: seat(t.from), to: seat(t.to), card: { suit: t.card.suit, rank: t.card.rank } };
}
export interface ObservationInput {
  state: GameState;
  actorSeat: number;
  decisionId: string;
  matchId: string;
  history: PublicHistoryPrefix;
}
export function buildObservation(input: ObservationInput): Observation {
  try { return projectObservation(input); }
  catch (error) {
    if (error instanceof DecisionHaltedError) throw error;
    halt(`public observation/state conflict: ${String(error)}`);
  }
}
function projectObservation({ state, actorSeat, decisionId, matchId, history }: ObservationInput): Observation {
  assertActiveActor(state, actorSeat);
  if (typeof decisionId !== 'string' || !decisionId.trim() || typeof matchId !== 'string' || !matchId.trim()) halt('decision/match identity required');
  if (!history || history.matchId !== matchId || history.gameNo !== state.match.gameNo || history.throughMoveNo !== state.moveNo || !Array.isArray(history.steps)) halt('complete current-game history identity/prefix required');
  const ruleOptions = rulesCopy(state.match.opts);
  if (state.stageTeam !== stageTeamOf(state.match) || JSON.stringify(state.match.levels) !== JSON.stringify(state.levelsBefore)) halt('public stage/level context inconsistent');
  const expected = makeLevelCtx(state.levelsBefore, ruleOptions.levelMode as 'stage', state.stageTeam);
  if (!(state.ctx.ranks instanceof Set) || JSON.stringify([...state.ctx.ranks].sort((a, b) => a - b)) !== JSON.stringify([...expected.ranks].sort((a, b) => a - b)) || JSON.stringify(state.ctx.levels) !== JSON.stringify(state.levelsBefore)) halt('effective level context inconsistent');
  const faces = faceCounts(buildDeck());
  const capacity = new Map(faces.map(c => [faceKey(c), c.count]));
  const own = faceCounts(state.hands[actorSeat]);
  const played: Card[] = [], playedIds = new Set<number>();
  const playedBySeat = [0, 0, 0, 0];
  const finished: number[] = [];
  let target: Combo | null = null, moves = 0, passes = 0;
  let expectedActor: number | null = state.tribute?.leader ?? null;
  let leader = state.tribute?.leader ?? state.leader;
  let lastPlayer = leader;
  const currentTrick: Observation['currentTrick'] = [];
  const publicPrefix: Observation['publicPrefix'] = [];
  for (const row of history.steps) {
    if (!row || !Array.isArray(row.events)) halt('invalid public history row');
    const actions = row.events.filter((e: EngineEvent) => e.type === 'play' || e.type === 'pass');
    if (actions.length !== 1) halt('history row requires one engine action');
    const action = actions[0];
    if (expectedActor !== null && action.player !== expectedActor) halt('history actor turn mismatch');
    if (moves === 0 && state.tribute === null) { leader = action.player; lastPlayer = leader; }
    if (necessaryDeclarationKey(row.priorTarget, state.ctx) !== necessaryDeclarationKey(target, state.ctx)) halt('history prior target mismatch');
    const events: PublicEvent[] = [];
    let actionSeen = false;
    for (const e of row.events) {
      switch (e.type) {
        case 'deal': break; // Explicitly discard ALL four hands, not a spread.
        case 'play': {
          if (actionSeen || finished.includes(seat(e.player))) halt('invalid history action');
          actionSeen = true;
          for (const c of e.combo.cards) {
            if (playedIds.has(c.id)) halt('history repeats a played physical resource');
            playedIds.add(c.id); played.push({ id: c.id, suit: c.suit, rank: c.rank });
          }
          if (!e.combo.cards.length || e.combo.size !== e.combo.cards.length) halt('history play size mismatch');
          playedBySeat[e.player] += e.combo.cards.length;
          target = e.combo; lastPlayer = e.player; passes = 0;
          const combo = publicCombo(e.combo)!;
          events.push({ type: 'play', player: e.player, combo });
          currentTrick.push({ player: e.player, combo });
          break;
        }
        case 'pass':
          if (actionSeen || target === null || finished.includes(seat(e.player))) halt('invalid history pass');
          actionSeen = true; passes++;
          events.push({ type: 'pass', player: e.player }); currentTrick.push({ player: e.player, combo: null });
          break;
        case 'finish':
          if (!actionSeen || action.type !== 'play' || e.player !== action.player || finished.includes(seat(e.player)) || e.order !== finished.length + 1) halt('history finish mismatch');
          finished.push(e.player); events.push({ type: 'finish', player: e.player, order: e.order }); break;
        case 'trickEnd':
          if (!actionSeen || action.type !== 'pass') halt('history trick-end mismatch');
          leader = seat(e.nextLeader); lastPlayer = leader; target = null; passes = 0; currentTrick.length = 0;
          events.push({ type: 'trickEnd', nextLeader: leader }); break;
        case 'gameEnd': halt('terminal/future result in active-game history');
        default: halt('unknown public history event');
      }
    }
    const ended = events.find(e => e.type === 'trickEnd');
    expectedActor = ended?.type === 'trickEnd' ? ended.nextLeader : (action.player + 1) % 4;
    if (!ended) for (let i = 0; i < 4 && finished.includes(expectedActor); i++) expectedActor = (expectedActor + 1) % 4;
    moves++;
    publicPrefix.push({ moveNo: moves, priorTarget: publicCombo(row.priorTarget), events });
  }
  if (moves !== state.moveNo || moves !== history.throughMoveNo) halt('complete causal history prefix missing or includes future moves');
  if (JSON.stringify(finished) !== JSON.stringify(state.finished) || state.hands.some((h, s) => h.length !== 27 - playedBySeat[s])) halt('history/public remaining counts mismatch');
  if (necessaryDeclarationKey(target, state.ctx) !== necessaryDeclarationKey(state.lastCombo, state.ctx) || leader !== state.leader || lastPlayer !== state.lastPlayer || passes !== state.passCount || JSON.stringify(currentTrick) !== JSON.stringify(state.trickPlays.map(t => ({ player: t.player, combo: publicCombo(t.combo) })))) halt('history/current public state mismatch');
  if (expectedActor !== null && expectedActor !== actorSeat) halt('history does not end before current actor turn');
  if ([0, 1, 2, 3].some(s => (playedBySeat[s] === 27) !== finished.includes(s))) halt('history finish/remaining count mismatch');
  const tribute = state.tribute === null ? null : {
    resist: state.tribute.resist, tributes: state.tribute.tributes.map(transferCopy),
    returns: state.tribute.returns.map(transferCopy), leader: seat(state.tribute.leader),
  };
  const known = Array.from({ length: 4 }, () => new Map<string, FaceCount>());
  const decrease = (s: number, c: Pick<Card, 'suit' | 'rank'>) => {
    const value = known[s].get(faceKey(c));
    if (value) { if (value.count === 1) known[s].delete(faceKey(c)); else value.count--; }
  };
  // A transfer moves a known lower bound, it does not create a new deck card.
  for (const t of [...(tribute?.tributes ?? []), ...(tribute?.returns ?? [])]) {
    if (!capacity.has(faceKey(t.card))) halt('unknown public transfer face');
    decrease(t.from, t.card);
    const value = known[t.to].get(faceKey(t.card));
    if (value) value.count++; else known[t.to].set(faceKey(t.card), { ...t.card, count: 1 });
  }
  for (const row of publicPrefix) for (const e of row.events) if (e.type === 'play') {
    for (const c of e.combo.resources) for (let n = 0; n < c.count; n++) decrease(e.player, c);
  }
  const ownCounts = new Map(own.map(c => [faceKey(c), c.count]));
  for (const c of known[actorSeat].values()) if (c.count > (ownCounts.get(faceKey(c)) ?? 0)) halt('own hand conflicts with public transfer lower bound');
  const knownOtherHands = [0, 1, 2, 3].filter(s => s !== actorSeat).map(s => ({ seat: s,
    cards: [...known[s].values()].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit)) }));
  for (const s of knownOtherHands) if (s.cards.reduce((n, c) => n + c.count, 0) > state.hands[s.seat].length) halt('public lower bound exceeds remaining count');
  const playedCards = faceCounts(played);
  for (const c of [...own, ...playedCards, ...knownOtherHands.flatMap(s => s.cards)]) {
    const available = capacity.get(faceKey(c));
    if (available === undefined || available < c.count) halt('public face accounting exceeds deck');
    capacity.set(faceKey(c), available - c.count);
  }
  const unseenPool = faces.map(c => ({ ...c, count: capacity.get(faceKey(c))! })).filter(c => c.count > 0);
  return freezeCopy({ schema: OBSERVATION_SCHEMA, decisionId, matchId, actorSeat, partnerSeat: teammateOf(actorSeat), phase: 'play',
    ruleOptions, rulesText: describeRules(ruleOptions), levelsBefore: [state.levelsBefore[0], state.levelsBefore[1]], stageTeam: state.stageTeam,
    effectiveLevelRanks: [...state.ctx.ranks].sort((a, b) => a - b), gameNo: state.match.gameNo, moveNo: state.moveNo,
    previousGameResult: resultCopy(state.match.lastResult), ownHand: own,
    seats: [0, 1, 2, 3].map(s => ({ seat: s, remaining: state.hands[s].length, finishOrder: state.finished.includes(s) ? state.finished.indexOf(s) + 1 : null })),
    target: publicCombo(state.lastCombo), leader: state.leader, lastPlayer: state.lastPlayer, passCount: state.passCount,
    currentTrick, publicPrefix, tribute, knownOtherHands, playedCards, unseenPool,
    informationBoundary: 'own-hand-and-public-prefix; pass-does-not-prove-inability' });
}
