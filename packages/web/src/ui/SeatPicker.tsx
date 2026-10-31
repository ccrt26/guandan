import type { SeatAssignment } from '../../../ai/src/policy/seats';
import { displaySeatNumber } from '@gd/review';
import type { SeatChoiceDescription } from '../game/ai-selection';
export interface AIChoiceOption {key:string;assignment:SeatAssignment|null;description:Pick<SeatChoiceDescription,'shortName'|'detail'>;available:boolean;reason?:string;retainOnly?:boolean}
export const DISPLAY_AI_SEATS=[2,3,1] as const;
export function assignmentKey(seat:SeatAssignment):string {
 return seat.controller==='human'?'human':JSON.stringify([seat.releaseRef,seat.mode,seat.profileRevisionRef?.profileId??null,seat.profileRevisionRef?.revision??null,seat.profileRevisionRef?.snapshotHash??null]);
}
/** Pure controlled selectors. Engine order is preserved; only presentation order changes. */
export function SeatPicker({value,onChange,options,disabled=false}:{value:readonly SeatAssignment[];onChange:(seat:number,next:SeatAssignment)=>void;options:readonly AIChoiceOption[];disabled?:boolean}) {
 return <div className="ai-seat-selectors">{DISPLAY_AI_SEATS.map(seat=>{
  const current=assignmentKey(value[seat]),option=options.find(o=>o.key===current);
  return <div key={seat} className="tz-dialog-choice"><label htmlFor={`ai-seat-${seat}`}>{displaySeatNumber(seat)}号 · {seat===2?'队友':seat===3?'左侧对手':'右侧对手'}</label>
   <div><select id={`ai-seat-${seat}`} className="tz-row tz-dialog-input" aria-label={`${displaySeatNumber(seat)}号牌手`} disabled={disabled} value={current} onChange={e=>{const next=options.find(o=>o.key===e.target.value);if(next?.available&&next.assignment&&!next.retainOnly)onChange(seat,next.assignment);}}>
    {!option&&<option value={current} disabled>当前引用未就绪（不会替换）</option>}
    {options.filter(o=>!o.retainOnly||o.key===current).map(o=><option key={o.key} value={o.key} disabled={!o.available||o.retainOnly}>{o.description.shortName}{o.available?'':` · ${o.reason??'未就绪'}`}</option>)}
   </select>{option&&<details className="ai-choice-identity"><summary>身份详情</summary><pre>{option.description.detail}</pre></details>}</div>
  </div>;
 })}</div>;
}
