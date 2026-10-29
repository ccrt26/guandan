import type { CardItem, StageVM } from '../gp/viewmodel';
import type { ExchangePairVM, GameTableVM, GTPhase } from './viewmodel';

/**
 * DEV 视觉 fixture（?gtfixture=1，&gtstate=tribute 切贡还确认态）。
 * 与 05_state_examples.json 同口径：仅布局验收，不是合法牌局、不接真实引擎、不解锁真实门控。
 * 正常态手牌/计数为本 fixture 自洽的一组值（27 张，我方未出牌），不照抄生成图中的错误组合。
 */

// 与参考图 01 的手牌逐张一致（视觉 fixture；参考图自身“我方 27 张 + 已出 7 张”计数矛盾，
// 生产数据一律来自引擎快照，见交件报告）
const HAND_CODES = [
  '3C', '3S', '3H', '4C', '4H', '4S', '5S', '5H', '6C', '7C', '7D', '7H', '8C', '8D',
  '9C', '9D', '10C', '10S', 'JC', 'JD', 'JS', 'KC', 'KD', 'KS', 'AC', 'AD', '2D', '2H', 'RJ',
] as const;
const HAND27 = [...HAND_CODES.slice(0, 15), ...HAND_CODES.slice(17, 29)]; // 去 9C/9D 中一张：27 张，结尾 2♦2♥RJ 与参考图一致
void HAND_CODES;

function hand(wildIdx: number): CardItem[] {
  return HAND27.map((code, i) => ({ instanceId: `gtx-${i}`, code, wild: i === wildIdx }));
}

function played(codes: readonly string[], prefix: string): { status: 'cards'; cards: CardItem[] } {
  return { status: 'cards', cards: codes.map((code, i) => ({ instanceId: `${prefix}-${i}`, code, wild: false })) };
}

/** 05 样例配对：东家→我方 AS／我方→东家 3C；西家→队友 KH／队友→西家 4D */
const TRIBUTE_PAIRS: ExchangePairVM[] = [
  {
    id: 'pair-0',
    tribute: { fromName: '东家', toName: '我方', card: { instanceId: 'demo-AS-1', code: 'AS', wild: false } },
    ret: { fromName: '我方', toName: '东家', card: { instanceId: 'demo-3C-1', code: '3C', wild: false } },
  },
  {
    id: 'pair-1',
    tribute: { fromName: '西家', toName: '队友', card: { instanceId: 'demo-KH-1', code: 'KH', wild: false } },
    ret: { fromName: '队友', toName: '西家', card: { instanceId: 'demo-4D-1', code: '4D', wild: false } },
  },
];

export function gtFixtureVM(phase: GTPhase, forcePass = false): GameTableVM {
  const tribute = phase === 'tribute-result';
  const base: StageVM = {
    levels: { own: '2', other: '2' },
    wildRule: '配牌 · 红心级牌可当任意牌',
    status: tribute ? '贡还牌' : '第1局·第1手',
    notice: null,
    players: [
      { seat: 'north', name: '队友', role: 'teammate', remaining: 23, rankIdx: null },
      { seat: 'west', name: '西家', role: 'opponent', remaining: 23, rankIdx: null },
      { seat: 'east', name: '东家', role: 'opponent', remaining: 21, rankIdx: null },
    ],
    passes: !tribute && forcePass ? { north: true, west: true, east: false, self: false } : { north: false, west: false, east: false, self: false },
    playedEast: tribute || forcePass ? { status: 'none', cards: [] } : played(['4C', '4S', '5C', '5D', '6H', '6S'], 'gtx-e'),
    playedSelf: tribute || forcePass ? { status: 'none', cards: [] } : played(['3C', '3S', '3H', '4C', '4H', '4S', '5H'], 'gtx-s'),
    playedNorth: tribute || forcePass ? { status: 'none', cards: [] } : played(['4D', '4H', '4S', '2H'], 'gtx-n'),
    playedWest: tribute || forcePass ? { status: 'none', cards: [] } : played(['6C', '6D', '6H', '6S'], 'gtx-w'),
    hand: hand(-1).slice(0, 27).map((c, i) => ({ ...c, instanceId: `gtx-${i}`, wild: c.code === '2H' })),
    selectable: !tribute,
    selectedIds: [],
    turnActive: !tribute,
    actions: {
      message: tribute ? '贡还牌已完成' : '请选择要出的牌',
      canPass: false,
      canHint: !tribute,
      canPlay: false,
      playLabel: '出牌',
    },
  };
  return {
    ...base,
    phase,
    phaseLabel: tribute ? '贡还牌' : '第1局·第1手',
    ackPending: tribute,
    exchangeError: null,
    canAcknowledgeExchange: true,
    exchange: tribute ? { pairs: TRIBUTE_PAIRS, leader: 0, version: 'fixture-only' } : null,
  };
}
