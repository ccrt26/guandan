import { describe, expect, it } from 'vitest';
import { handPose, playedPose } from '../src/ui/gp/Stage';
import { toCode } from '../src/ui/gp/viewmodel';

/**
 * 布局公式钉死（批准图 21 张基准 + 推广边界）。
 * 21 张精确值与 ui_full_gameplay_handoff/state.js 的 handPose 一致
 * （CSS 角度口径；Pillow 原始角度符号相反，概念相同）。
 */
describe('gp handPose', () => {
  it('21 张：精确复刻批准图公式 x=560+72i, y=944+18t², angle=+2t(CSS)', () => {
    expect(handPose(0, 21)).toEqual({ x: 560, y: 962, angle: -2 });
    expect(handPose(10, 21)).toEqual({ x: 1280, y: 944, angle: 0 });
    expect(handPose(20, 21)).toEqual({ x: 2000, y: 962, angle: 2 });
    expect(handPose(5, 21).y).toBeCloseTo(944 + 18 * 0.25, 10);
  });

  it('角度与 y 关于中心对称', () => {
    const l = handPose(4, 21);
    const r = handPose(16, 21);
    expect(l.angle).toBeCloseTo(-r.angle, 12);
    expect(l.y).toBeCloseTo(r.y, 12);
  });

  it('1 张：行中心 1372 与 21 张口径一致（左缘=1280），无旋转无弧线', () => {
    expect(handPose(0, 1)).toEqual({ x: 1280, y: 944, angle: 0 });
  });

  it('0 张：不出错', () => {
    expect(handPose(0, 0)).toEqual({ x: 0, y: 0, angle: 0 });
  });

  it('27 张：步距收缩不越界（首 x=560、末右缘≤2184），弧线角度不超 ±2°', () => {
    const first = handPose(0, 27);
    const last = handPose(26, 27);
    expect(first.x).toBeCloseTo(560, 6);
    expect(last.x).toBeCloseTo(2000, 6);
    expect(Math.abs(first.angle)).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.abs(last.angle)).toBeLessThanOrEqual(2 + 1e-9);
    expect(first.y).toBeCloseTo(last.y, 12);
  });

  it('已出牌区：批准图精确坐标', () => {
    expect(playedPose(0, 'east', 5)).toEqual({ x: 1600, y: 590, w: 174 });
    expect(playedPose(2, 'east', 5)).toEqual({ x: 1768, y: 590, w: 174 });
    expect(playedPose(3, 'east', 5)).toEqual({ x: 1852, y: 590, w: 174 });
    expect(playedPose(0, 'self', 4)).toEqual({ x: 1030, y: 702, w: 166 });
    expect(playedPose(3, 'self', 4)).toEqual({ x: 1294, y: 702, w: 166 });
  });
});

describe('gp toCode', () => {
  it('54 牌面 code：大小王与花色牌', () => {
    expect(toCode({ id: 0, suit: 'J', rank: 16 })).toBe('BJ');
    expect(toCode({ id: 1, suit: 'J', rank: 17 })).toBe('RJ');
    expect(toCode({ id: 2, suit: 'H', rank: 10 })).toBe('10H');
    expect(toCode({ id: 3, suit: 'S', rank: 14 })).toBe('AS');
    expect(toCode({ id: 4, suit: 'C', rank: 11 })).toBe('JC');
  });

  it('instanceId 与 code 分离：同 code 两张 8S 实体独立（用引擎 id 组装）', () => {
    const a = { id: 40, suit: 'S' as const, rank: 8 };
    const b = { id: 92, suit: 'S' as const, rank: 8 };
    expect(toCode(a)).toBe(toCode(b));
    expect(`c${a.id}`).not.toBe(`c${b.id}`);
  });
});
