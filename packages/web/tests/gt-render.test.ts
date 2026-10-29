import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameTable } from '../src/ui/gt/GameTable';
import { gtFixtureVM } from '../src/ui/gt/fixture';

const render=(vm:ReturnType<typeof gtFixtureVM>)=>renderToStaticMarkup(React.createElement(GameTable,{vm}));
describe('实际 GameTable 呈现契约',()=>{
  it.each([['north','队友'],['west','西家'],['east','东家'],['self','我方']] as const)('%s 过牌提供明确可访问的“不出”提示',(seat,name)=>{
    const vm=gtFixtureVM('normal');vm.passes[seat]=true;
    expect(render(vm)).toContain(`aria-label="${name}不出"`);
  });
  it('确认结果只显示继续；手牌只读；残留pass状态不在确认页显示',()=>{
    const vm=gtFixtureVM('tribute-result');vm.passes.north=true;
    const html=render(vm);
    const footer=html.slice(html.indexOf('<footer'));
    expect(footer).toContain('aria-label="继续"');
    expect(footer).not.toMatch(/>不出<|>提示<|>出牌</);
    expect(html).not.toContain('class="gt-card selectable');
    expect(html).not.toContain('aria-label="队友不出"');
  });
  it('无效结果不宣称完成，也不能确认',()=>{
    const vm=gtFixtureVM('tribute-result');vm.exchange=null;vm.exchangeError='还贡记录缺失';
    const html=render(vm);
    expect(html).toContain('还贡记录缺失');
    expect(html).not.toContain('贡还牌已完成');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label="继续"/);
  });
  it('确认写盘失败后保留结果和同一个可重试的继续按钮',()=>{
    const vm=gtFixtureVM('tribute-result');vm.exchangeError='确认未完成：本地存储不可用，请恢复存储后重试';
    const html=render(vm);
    expect(html).toContain('请恢复存储后重试');
    const button=html.match(/<button[^>]+aria-label="继续"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled');
  });
});
