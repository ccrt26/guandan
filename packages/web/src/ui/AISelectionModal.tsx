import { useEffect, useRef, useState } from 'react';
import type { SeatAssignment } from '../../../ai/src/policy/seats';
import { describeSeatChoice, newGameSettingsFromLegacy, resolveNewGameAssignments, restoreDefaultSelection, setAllDraftSeats, setDraftSeat,
 type AISelection, type NewGameSettings, type SelectionContext } from '../game/ai-selection';
import { loadProviderBindings, type ProviderBindings } from '../game/storage';
import { describeProviderAvailability, PROVIDER_PRESETS } from '../game/provider-presets';
import { SettingsModal, type SettingsModalFixtureDependencies } from './SettingsModal';
import { createProfileClient, type PublicProfile } from '../game/llm-profiles';
import { SeatPicker, assignmentKey, type AIChoiceOption } from './SeatPicker';

export function BrainIcon({size=24}:{size?:number}) {return <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5c-2-3-6-1-6 2-3-1-6 3-4 6-3 2-2 7 1 8-1 4 4 7 7 5l2 2V5Zm2 0c2-3 6-1 6 2 3-1 6 3 4 6 3 2 2 7-1 8 1 4-4 7-7 5l-2 2V5Z"/><path d="M9 7v5l3 2m-7-1 4 3-1 4m5 6-1-6m11-13v5l-3 2m7-1-4 3 1 4m-5 6 1-6"/></svg>;}
export interface AISelectionServices {refreshProfiles:()=>Promise<PublicProfile[]>;loadBindings:()=>ProviderBindings;settingsFixture?:SettingsModalFixtureDependencies}
const defaultServices:AISelectionServices={refreshProfiles:()=>createProfileClient({storage:localStorage,fetchImpl:fetch}).refresh(),loadBindings:()=>loadProviderBindings()};
export function makeAIChoiceOptions(context:SelectionContext,bindings:ProviderBindings,{profilesReady=true,bindingIssue='',profileIssue=''}={}):{options:AIChoiceOption[];issues:string[]} {
 const options:AIChoiceOption[]=[],issues:string[]=[];
 for(const choice of context.choices??[]){
  const release=choice.release;
  if(release.mode==='local'){
   const assignment:SeatAssignment={controller:'ai',releaseRef:release.releaseRef,mode:'local'};
   try {options.push({key:assignmentKey(assignment),assignment,description:describeSeatChoice(assignment,context),available:choice.available,reason:'浏览器资源未准备'});}catch(error){issues.push(String(error));}
  }else for(const provider of ['glm','deepseek'] as const){
   // A recognized preset remains discoverable without inventing a playable profile/seat identity.
   const status=describeProviderAvailability(provider,bindings,profilesReady?[...(context.profiles??[])]:null);
   const p=!bindingIssue&&!profileIssue&&status.state==='ready'?status.profile:null;
   let reason=bindingIssue?`预设已配置；关联读取失败：${bindingIssue}`:profileIssue?`预设已配置；连接列表读取失败：${profileIssue}，请在AI设置重试。`:status.reason;
   try {
    if(p){
     const assignment:SeatAssignment={controller:'ai',releaseRef:release.releaseRef,mode:'hybrid',profileRevisionRef:{profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash}};
     options.push({key:assignmentKey(assignment),assignment,description:describeSeatChoice(assignment,context),available:choice.available,reason:'浏览器资源未准备'});
     continue;
    }
   }catch(error){reason=String(error);}
   let shortName=`${PROVIDER_PRESETS[provider].name}组合（本地底座未就绪）`;
   try {
    const parent=describeSeatChoice({controller:'ai',mode:'local',releaseRef:release.parentRelease!},context);
    shortName=`${parent.shortName} + ${PROVIDER_PRESETS[provider].name}`;
   }catch(error){reason=`本地底座未就绪：${String(error)}`;}
   options.push({key:`unavailable:${release.releaseRef}:${provider}`,assignment:null,
    description:{shortName,detail:reason},available:false,reason});
   issues.push(`${PROVIDER_PRESETS[provider].name}：${reason}`);
  }
 }
 return {options,issues:[...new Set(issues)]};
}
/** Opening owns a disposable draft; only one confirmed callback may commit it. */
export function AISelectionModal({value,context,onConfirm,onClose,services=defaultServices}:{
 value:NewGameSettings|null;context:SelectionContext;onConfirm:(selection:AISelection,profiles:readonly PublicProfile[])=>void|Promise<void>;onClose:()=>void;services?:AISelectionServices;
}) {
 const [draft,setDraft]=useState<NewGameSettings|null>(()=>value?structuredClone(value):null);
 const [profiles,setProfiles]=useState<PublicProfile[]>([]),[bindings,setBindings]=useState<ProviderBindings>({schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null});
 const [issue,setIssue]=useState(''),[busy,setBusy]=useState(false),[listReady,setListReady]=useState(false);
 const [bindingIssue,setBindingIssue]=useState(''),[profileIssue,setProfileIssue]=useState(''),[settingsOpen,setSettingsOpen]=useState(false);
 const generation=useRef(0),panel=useRef<HTMLDivElement>(null),confirming=useRef(false);
 const close=()=>{generation.current++;onClose();};
 useEffect(()=>{
  if(settingsOpen)return;
  setListReady(false);setBindingIssue('');setProfileIssue('');setIssue('');
  const operation=++generation.current,previous=document.activeElement as HTMLElement|null;
  panel.current?.querySelector<HTMLElement>('button')?.focus();
  try{setBindings(services.loadBindings());}catch(e){setBindingIssue(String(e));}
  services.refreshProfiles().then(rows=>{if(operation===generation.current){setProfiles(rows);setListReady(true);}},e=>{if(operation===generation.current)setProfileIssue(String(e));});
  return()=>{generation.current++;previous?.focus();};
 },[services,settingsOpen]);
 const liveContext={...context,profiles};
 const result=makeAIChoiceOptions(liveContext,bindings,{profilesReady:listReady,bindingIssue,profileIssue}),options=[...result.options];
 let seats:readonly SeatAssignment[]|null=null,draftIssue='';
 try {
  if(draft){
   // Current exact explicit references stay pinned even if they are no longer the provider's new-choice binding.
   seats=resolveNewGameAssignments(draft,{...context,...(listReady?{profiles}:{})});
   for(const seat of seats)if(seat.controller==='ai'&&!options.some(o=>o.key===assignmentKey(seat))){
    const description=describeSeatChoice(seat,liveContext);options.push({key:assignmentKey(seat),assignment:seat,description,available:true,retainOnly:true});
   }
  }
 }catch(e){draftIssue=String(e);}
 async function confirm(){
  if(!draft||confirming.current)return;
  confirming.current=true;setBusy(true);setIssue('');const operation=++generation.current;
  try {
   const hybrid=draft.aiSelection.kind==='explicit'&&draft.aiSelection.seats.some(s=>s.controller==='ai'&&s.mode==='hybrid');
   const currentProfiles=hybrid?await services.refreshProfiles():profiles;
   if(operation!==generation.current)return;
   resolveNewGameAssignments(draft,{...context,profiles:currentProfiles});
   await onConfirm(draft.aiSelection,currentProfiles);
   if(operation===generation.current)close();
  }catch(e){if(operation===generation.current)setIssue(`未保存：${String(e)}`);}
  finally{confirming.current=false;if(operation===generation.current)setBusy(false);}
 }
 function keyDown(e:React.KeyboardEvent){
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key==='Tab'){
   const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')??[]);
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }
 if(settingsOpen)return <SettingsModal fixture={services.settingsFixture} onClose={()=>{setListReady(false);setSettingsOpen(false);}}/>;
 return <div className="modal-mask settings-mask" onClick={e=>e.target===e.currentTarget&&close()} onKeyDown={keyDown}>
  <div className="tz-console tz-dialog ai-selection-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="ai-selection-title">
   <header className="tz-dialog-head"><h2 id="ai-selection-title"><BrainIcon size={30}/>AI选择</h2><button type="button" className="tz-resume-drop" aria-label="关闭AI选择" onClick={close}>✕</button></header>
   <div className="tz-settings tz-dialog-body">
    <p className="tz-hint">为新对局选择队友和对手。</p>
    <div className="tz-dialog-choice"><span>1号 · 玩家</span><div className="tz-row tz-dialog-input ai-human-fixed"><span>你（真人）</span><span className="tz-hint">固定</span></div></div>
    <hr className="tz-hr"/>
    <div className="tz-dialog-choice"><label htmlFor="ai-uniform">统一设置</label><select id="ai-uniform" className="tz-row tz-dialog-input" value="" disabled={busy||!draft} onChange={e=>{const option=options.find(o=>o.key===e.target.value);if(draft&&option?.available&&option.assignment&&!option.retainOnly)setDraft(setAllDraftSeats(draft,option.assignment));}}><option value="" disabled>选择模型，应用到三家</option>{options.filter(o=>!o.retainOnly).map(o=><option key={o.key} value={o.key} disabled={!o.available}>{o.description.shortName}{o.available?'':` · ${o.reason??'未就绪'}`}</option>)}</select></div>
    <hr className="tz-hr"/>
    {seats&&draft?<SeatPicker value={seats} options={options} disabled={busy} onChange={(seat,choice)=>setDraft(setDraftSeat(draft,seat,choice,context))}/>:<p role="status">{draftIssue||'原新局偏好不可用，请明确恢复默认后确认；原值尚未改变。'}</p>}
    <button type="button" className="tz-resume-drop ai-reset" disabled={busy} onClick={()=>setDraft(restoreDefaultSelection(draft??newGameSettingsFromLegacy()))}>恢复默认</button>
    <button type="button" className="tz-resume-drop ai-reset" disabled={busy} onClick={()=>{generation.current++;setSettingsOpen(true);}}>AI设置</button>
    {result.issues.length>0&&<p className="tz-dialog-message">{result.issues.join(' ')}</p>}
    {issue&&<p className="tz-dialog-message" role="alert">{issue}</p>}
   </div>
   <footer className="tz-dialog-actions"><span className="tz-hint">仅对新对局生效，正在进行的对局不变。</span><button type="button" className="tz-row tz-dialog-cancel" onClick={close}>取消</button><button type="button" className="tz-resume-btn tz-dialog-confirm" disabled={!draft||!!draftIssue||busy} onClick={()=>void confirm()}>{busy?'正在保存…':'确认选择'}</button></footer>
  </div>
 </div>;
}
