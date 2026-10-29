import type { MatchController } from '../../game/controller';
import type { StageVM } from './viewmodel';

/**
 * 批准图 fixture（reference/original-card-layout.json 的冻结视觉数据）。
 * 这些牌序是视觉 fixture，不是真实对局记录；仅用于
 * DEV + ?gpfixture=1 时的确定性截图对比与布局边界测试，不进生产构建。
 * 配标位置完全来自批准图的 wildcards 数组，不代表任何规则判断。
 */

const HAND_CODES = [
  '3C', '3D', '3H', '3S', '6H', '6S', '7D', '7S', '8S', '8S', '9H', '9H',
  'JC', 'JD', 'JH', 'QC', 'QS', 'KD', 'AD', 'AH', '5H',
] as const;
const HAND_WILD_IDX = 20;

const EAST_CODES = ['3C', '3D', '2H', '5H', '3S'] as const;
const EAST_WILD_IDX = 2;
const SELF_CODES = ['2C', '2C', '2D', '2H'] as const;
const SELF_WILD_IDX = 3;

/**
 * DEV 专用：fixture 路由的空控制器桩。TablePage 的 fixture 分支不会触碰
 * 真实对局，只需要 satisfy useSyncExternalStore 的订阅接口。
 */
export const fixtureControllerStub = {
  subscribe: () => () => {},
  getSnapshot: () => 0,
  state: null,
  destroy: () => {},
} as unknown as MatchController;

function items(codes: readonly string[], wildIdx: number, prefix: string) {
  return codes.map((code, i) => ({ instanceId: `${prefix}-${i}`, code, wild: i === wildIdx }));
}

/** 基准 21 张 fixture：与 approved-v4-2560.png 同一视觉数据 */
export function fixtureVM(opts: { handCount?: number; locked?: boolean } = {}): StageVM {
  const locked = opts.locked ?? false;
  const n = opts.handCount ?? HAND_CODES.length;
  // n<21 时配标牌（5H）被截掉，配标自然不出现；边界测试只关心排布不越界
  const hand =
    n <= HAND_CODES.length
      ? items(HAND_CODES, HAND_WILD_IDX, 'fx').slice(0, n)
      : [
          ...items(HAND_CODES, HAND_WILD_IDX, 'fx'),
          ...Array.from({ length: n - HAND_CODES.length }, (_, i) => ({
            instanceId: `fx-extra-${i}`,
            code: HAND_CODES[i % HAND_CODES.length],
            wild: false,
          })),
        ];

  return {
    levels: { own: '5', other: '2' },
    wildRule: '配牌 · 红心级牌可当任意牌',
    status: '本局进行中',
    notice: { visible: true, text: '抗贡 · 下游方抓有两大王，免进贡' },
    players: [
      { seat: 'north', name: '队友', role: 'teammate', remaining: 25, rankIdx: null },
      { seat: 'west', name: '西家', role: 'opponent', remaining: 25, rankIdx: null },
      { seat: 'east', name: '东家', role: 'opponent', remaining: 20, rankIdx: null },
    ],
    passes: { north: true, west: true, east: false, self: false },
    playedEast: { status: 'cards', cards: items(EAST_CODES, EAST_WILD_IDX, 'fx-e') },
    playedSelf: { status: 'cards', cards: items(SELF_CODES, SELF_WILD_IDX, 'fx-s') },
    playedNorth: { status: 'none', cards: [] },
    playedWest: { status: 'none', cards: [] },
    hand,
    selectable: !locked,
    selectedIds: [],
    turnActive: !locked,
    actions: {
      message: locked ? '等待其他玩家…' : '请选择要出的牌',
      canPass: !locked,
      canHint: !locked,
      // 演示态按钮外观与批准图一致（可点）；点击仅出 toast，不判牌型不出牌
      canPlay: !locked,
      playLabel: '出牌',
    },
  };
}
