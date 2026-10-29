import { describe, expect, it } from 'vitest';
import { getTableLayout, getPlayedLayout } from '../src/ui/gt/layout';

describe('DOT 牌桌实际布局', () => {
  it('1800×874 保留基准手牌、标签和贡还面板', () => {
    const n = getTableLayout(1800, 874, false, 27);
    expect(n.hand.x).toBeCloseTo(115);
    expect(n.hand.y + n.headerHeight).toBeCloseTo(586);
    expect(n.hand.width).toBeCloseTo(1570);
    expect(n.hand.height).toBe(189);
    expect(n.selfLabel.y + n.headerHeight).toBe(515);
    const t = getTableLayout(1800, 874, true, 27);
    expect(t.panel.x).toBeCloseTo(527.5);
    expect(t.panel.y + t.headerHeight).toBe(167);
    expect(t.panel.height).toBe(372);
    expect(t.hand.y + t.headerHeight).toBe(598);
    expect(t.hand.height).toBe(175);
  });

  for (const [w, h] of [[1800,874],[2048,994],[1440,900],[1366,768],[2551,1242]]) {
    for (const tribute of [false,true]) {
      for (const count of [0,1,27,28]) {
        it(`${w}×${h} ${tribute?'贡还':'正常'} ${count}张居中完整、与标签和底栏分离`, () => {
          const l=getTableLayout(w,h,tribute,count);
          expect(l.hand.x+l.hand.width/2).toBeCloseTo(w/2);
          expect(l.hand.x).toBeGreaterThanOrEqual(24);
          expect(l.hand.x+l.hand.width).toBeLessThanOrEqual(w-24);
          expect(l.hand.y+l.hand.height).toBeLessThanOrEqual(l.tableHeight-12*l.scale);
          expect(l.selfLabel.y+l.selfLabel.height).toBeLessThanOrEqual(l.hand.y);
          if (tribute) {
            expect(l.panel.y+l.panel.height+12*l.scale).toBeLessThanOrEqual(l.hand.y);
            expect(l.panel.y+l.panel.height).toBeLessThanOrEqual(l.selfLabel.y);
          } else {
            const self=getPlayedLayout('self',7,l);
            expect(self.y+self.height).toBeLessThanOrEqual(l.selfLabel.y-8*l.scale);
          }
        });
      }
    }
    it(`${w}×${h} 上下牌组实际居中，左右牌组与中区分离`, () => {
      const l=getTableLayout(w,h,false,27);
      for (const n of [1,4,6,10]) {
        for (const seat of ['north','self'] as const) {
          const r=getPlayedLayout(seat,n,l);
          expect(r.x+r.width/2).toBeCloseTo(w/2);
        }
      }
      const west=getPlayedLayout('west',10,l),east=getPlayedLayout('east',10,l),self=getPlayedLayout('self',10,l);
      expect(l.players.west.x+l.players.west.width+19*l.scale).toBeLessThanOrEqual(west.x);
      expect(east.x+east.width+19*l.scale).toBeLessThanOrEqual(l.players.east.x+0.001);
      expect(west.x+west.width+10*l.scale).toBeLessThanOrEqual(self.x);
      expect(self.x+self.width+10*l.scale).toBeLessThanOrEqual(east.x);
    });
  }
  it('宽屏组件随设计比例增大，不能把1570px的小牌条留在大桌面中', () => {
    const l=getTableLayout(2551,1242,false,27);
    expect(l.scale).toBeCloseTo(2551/1800);
    expect(l.hand.width/2551).toBeCloseTo(1570/1800);
    expect(l.hand.cardWidth).toBeGreaterThan(190);
  });
  it('选牌抬升18px时标签不会盖住牌顶，已出牌也不会撞标签',()=>{
    for (const [w,h] of [[1800,874],[1366,768]]) {
      const l=getTableLayout(w,h,false,27,true);
      expect(l.selfLabel.y+l.selfLabel.height).toBeLessThanOrEqual(l.hand.y-18*l.scale);
      const self=getPlayedLayout('self',7,l);
      expect(self.y+self.height).toBeLessThanOrEqual(l.selfLabel.y-8*l.scale);
    }
  });
});
