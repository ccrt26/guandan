import React from 'react';
import type {GameRecord} from '@gd/engine';
import {displaySeatLabel,type ActualSeatController} from '@gd/review';
import {webPolicyDescriptors} from '../game/policy';
import {describeSeatChoice} from '../game/ai-selection';
import type {FrozenAISeat,SeatSnapshot} from '../../../ai/src/policy/seats';
export function recordSeatSnapshot(record:GameRecord):SeatSnapshot|undefined {
 const saved=(record as GameRecord & {seatConfig?:SeatSnapshot}).seatConfig;
 return saved?.schemaVersion===2&&Array.isArray(saved.seats)&&saved.seats.length===4?saved:undefined;
}
/** Only frozen controller evidence or the original recorded humanSeat is authoritative. */
export function recordSeatController(record:GameRecord,seat:number):ActualSeatController {
 const saved=recordSeatSnapshot(record)?.seats[seat];
 if(saved?.controller==='human'||saved?.controller==='ai')return saved.controller;
 const policy=record.aiPolicies?.[seat];
 if(policy==='human')return 'human';
 if(typeof policy==='string'&&/^(autopilot|heuristic|neural)(:|$)/.test(policy))return 'ai';
 if(record.humanSeat===null)return 'ai';
 if(Number.isInteger(record.humanSeat)&&record.humanSeat>=0&&record.humanSeat<=3)return record.humanSeat===seat?'human':'ai';
 return null;
}
/** A bad frozen identity is reported, never replaced with today's choice. */
function recordedModelDescription(seat:FrozenAISeat):{shortName:string;detail?:string} {
 try{return describeSeatChoice(seat,{policies:webPolicyDescriptors});}catch(error){return {shortName:`身份未核验：${(error as Error).message}`};}
}
export function recordedModelName(seat:FrozenAISeat):string {
 return recordedModelDescription(seat).shortName;
}
/** Display the saved identities as evidence; never resolve today's profiles. */
export function RecordedSeats({record}:{record:GameRecord}) {
 const saved=recordSeatSnapshot(record);
 return <details className="recorded-seats"><summary>四席冻结身份 · 纯回放不调用API</summary>
  {[0,1,2,3].map(seat=>{const s=saved?.seats[seat],label=displaySeatLabel(seat,null,recordSeatController(record,seat));
   const description=s?.controller==='ai'?recordedModelDescription(s):null;
   return <div key={seat}><p>{label.label}：{label.controller}
   {s?.controller==='ai'&&<> · {description!.shortName}{!description!.detail&&<> · 技术来源：{s.releaseRef} · {s.policyIdentity.policyId} · SHA {s.policyIdentity.weightsSHA256.slice(0,12)}
    {s.profileRevisionRef&&<> · {s.profileRevisionRef.profileId} r{s.profileRevisionRef.revision} · {String((s.profileSnapshot as {requestedModel?:string})?.requestedModel??'模型未记录')}</>}</>}
   </>}
  </p>{description?.detail&&<div className="ai-choice-identity"><pre>{description.detail}</pre></div>}</div>;})}
 </details>;
}
