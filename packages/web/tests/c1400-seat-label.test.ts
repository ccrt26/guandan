import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SeatPicker} from '../src/ui/SeatPicker';
import {defaultSeatAssignments,RELEASES} from '../../ai/src/policy/seats';
it('candidate fixed refs are visible without changing labels, option values/order or availability',()=>{
 const frozen=JSON.stringify(RELEASES);
 for(const candidateAssetsReady of [false,true]){
  const choices=RELEASES.map(release=>({release,available:release.status==='adopted'||candidateAssetsReady}));
  const html=renderToStaticMarkup(SeatPicker({value:defaultSeatAssignments('standard'),onChange:()=>{},choices,profiles:[],profileError:null}));
  const options=[...html.matchAll(/<option([^>]*)>(.*?)<\/option>/g)].slice(0,RELEASES.length+1);
  expect(options.map(o=>o[1].match(/value="([^"]*)"/)![1])).toEqual(['human',...RELEASES.map(r=>r.releaseRef)]);
  expect(options[0][2]).toBe('真人（0号）');
  for(const [i,{release,available}] of choices.entries()){
   const option=options[i+1];
   expect(option[2]).toBe((release.status==='candidate'?`${release.releaseRef} · `:'')+release.label+(available?'':' · 浏览器资源未准备'));
   expect(option[1].includes('disabled')).toBe(!available);
  }
 }
 expect(JSON.stringify(RELEASES)).toBe(frozen);
});
