import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {GameTable} from '../src/ui/gt/GameTable';
import {gtFixtureVM} from '../src/ui/gt/fixture';

// Only an existing public visual VM. No controller, engine run, record or model.
function fourCounts(){
 const vm=structuredClone(gtFixtureVM('normal'));
 [0,9,27].forEach((n,i)=>{vm.players[i].remaining=n;});
 vm.hand=Array.from({length:10},(_,i)=>({...vm.hand[0],instanceId:`count-only-${i}`}));
 return vm;
}
const render=(vm:ReturnType<typeof gtFixtureVM>)=>renderToStaticMarkup(React.createElement(GameTable,{vm}));
it('count values and four-seat labels',()=>{
 const vm=fourCounts(),html=render(vm);
 expect([...html.matchAll(/class="gt-count-number">(\d+)</g)].map(m=>Number(m[1]))).toEqual([0,9,27,10]);
 expect([...html.matchAll(/class="gt-count-unit">张</g)]).toHaveLength(4);
 for(const [name,count]of vm.players.map(p=>[p.name,p.remaining] as const))expect(html).toContain(`aria-label="${name}，剩余 ${count} 张"`);
 expect(html).toContain('aria-label="1号手牌"');expect(html).not.toContain('aria-label="1号手牌，剩余');
});
it('return-pick 28 and tribute-result visibility',()=>{
 const vm=fourCounts();vm.phase='return-pick';vm.hand=Array.from({length:28},(_,i)=>({...vm.hand[0],instanceId:`return-only-${i}`}));
 expect(render(vm)).toContain('class="gt-count-number">28<');
 vm.phase='tribute-result';const hidden=render(vm);expect(hidden).not.toContain('class="gt-count-number"');expect(hidden).not.toContain('class="gt-count-unit"');
});
it('shared unit structure and unchanged actions',()=>{
 const vm=fourCounts(),before=JSON.stringify(vm),onBack=()=>{},onPlay=()=>{},onPass=()=>{},onHint=()=>{};
 const element=React.createElement(GameTable,{vm,onBack,onPlay,onPass,onHint});
 expect(element.props.onBack).toBe(onBack);expect(element.props.onPlay).toBe(onPlay);expect(element.props.onPass).toBe(onPass);expect(element.props.onHint).toBe(onHint);
 const html=renderToStaticMarkup(element);expect([...html.matchAll(/class="[^"]*gt-card-count[^"]*"/g)]).toHaveLength(4);
 expect(html).not.toMatch(/class="gt-count-(?:number|unit)"[^>]*(?:tabindex|aria-hidden)/i);
 expect(JSON.stringify(vm)).toBe(before);
});
