/** DEV-only, memory-isolated NAV-S31 IAB fixture. Never starts a game, loads weights, or sends a request. */
import { useMemo, useState } from 'react';
import { DEFAULT_RULES } from '@gd/engine';
import { AppFrame } from './AppFrame';
import { HomePage } from './HomePage';
import { AISelectionModal } from './AISelectionModal';
import { SettingsModal, type SettingsModalFixtureDependencies } from './SettingsModal';
import { PageHeading } from './sp/components';
import { ReviewHeading, ReviewFilters, type ReviewFiltersProps } from './ReviewPicker';
import { webPolicyDescriptors, webReleaseChoices } from '../game/policy';
import { newGameSettingsFromLegacy, resolveNewGameAssignments, validateNewGameSettings, type AISelection } from '../game/ai-selection';
import { loadNewGameSettings, saveNewGameSettings, loadProviderBindings, saveProviderBindings, type MatchSave } from '../game/storage';
import { providerPresetFields, validateProviderPreset } from '../game/provider-presets';
import type { PublicProfile, ProviderStateView, ConnectionSummary } from '../game/llm-profiles';

export default function DevAISelectionAudit(){
 if(!import.meta.env.DEV)throw Error('fixture_only');
 const scenario=new URLSearchParams(window.location.search).get('case')??'same';
 const fixture=useMemo(()=>{
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{
   if(scenario==='savefail'&&key==='gd_new_game_settings_v1')throw Error('fixture_storage_denied');data.set(key,value);
  },removeItem:(key:string)=>{data.delete(key);}};
  const connectionScenario=scenario==='connection-pending'||scenario==='connection-long';
  const longConnection=():ConnectionSummary=>({state:'passed',testedAt:'2026-11-01T00:00:00.000Z',scope:'native-connection-probe',httpStatus:200,returnedModel:`synthetic-${'model-'.repeat(25)}layout`});
  let profiles:PublicProfile[]=['glm',...(scenario==='mixed'||connectionScenario?['deepseek']:[])].map((id,i)=>({
   ...providerPresetFields(id as 'glm'|'deepseek',{profileId:`fixture-${id}`,nickname:id==='glm'?'GLM':'DeepSeek'}),revision:1,snapshotHash:(i?'b':'a').repeat(64),
  }));
  if(scenario==='legacy'){
   profiles=[];data.set('gd_llm_config',JSON.stringify({baseUrl:'https://open.bigmodel.cn/api/paas/v4',apiKey:'S31_SYNTHETIC_LEGACY_SENTINEL',model:'glm-4.5',effort:'max'}));
  }
  const ref=(p:PublicProfile|undefined)=>p?{profileId:p.profileId,revision:p.revision,snapshotHash:p.snapshotHash}:null;
  saveProviderBindings({schema:'ohuo-provider-bindings-v1',glm:ref(profiles.find(p=>p.profileId==='fixture-glm')),deepseek:ref(profiles.find(p=>p.profileId==='fixture-deepseek'))},storage);
  const initial=newGameSettingsFromLegacy();
  if(scenario==='mixed'){
   const local={controller:'ai' as const,mode:'local' as const,releaseRef:'ohuo-1030-b-v1'},hybrid=(provider:string)=>({controller:'ai' as const,mode:'hybrid' as const,releaseRef:'ohuo-1030-h-v1',profileRevisionRef:ref(profiles.find(p=>p.profileId===`fixture-${provider}`))!});
   data.set('gd_new_game_settings_v1',JSON.stringify({...initial,aiSelection:{kind:'explicit',seats:[{controller:'human'},hybrid('glm'),local,hybrid('deepseek')]}}));
  }
  const providerState=():ProviderStateView=>{
   const state=(provider:'glm'|'deepseek'):ProviderStateView['providers']['glm']=>{
    const matches=profiles.filter(profile=>{try{validateProviderPreset(provider,profile);return true;}catch{return false;}});
    return matches.length===1?{availability:'ready',reference:ref(matches[0]),connection:scenario==='connection-long'?longConnection():{state:'untested',reason:'no_receipt'}}
     :{availability:matches.length?'ambiguous':'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}};
   };
   const view:ProviderStateView={schema:'ohuo-provider-state-v1',profiles,providers:{glm:state('glm'),deepseek:state('deepseek')}};
   return structuredClone(view);
  };
  const fetchImpl:SettingsModalFixtureDependencies['fetchImpl']=async(url,init)=>{
   if(url==='/api/llm-profiles?view=providers'&&(!init?.method||init.method==='GET'))return {ok:true,status:200,json:async()=>providerState()};
   if(url==='/api/llm-profiles/test'&&connectionScenario){
    if(init?.method!=='POST')throw Error('fixture_test_method');
    const command=JSON.parse(String(init.body));
    if(!command||Object.keys(command).sort().join(',')!=='provider,reference,requestId'||!['glm','deepseek'].includes(command.provider)
     ||typeof command.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(command.requestId))throw Error('fixture_test_command');
    const profile=profiles.find(p=>p.profileId===command.reference?.profileId);
    if(!profile||!command.reference||Object.keys(command.reference).sort().join(',')!=='profileId,revision,snapshotHash'
     ||profile.revision!==command.reference.revision||profile.snapshotHash!==command.reference.snapshotHash)throw Error('fixture_test_reference');
    validateProviderPreset(command.provider,profile);
    if(scenario==='connection-pending')return new Promise<never>((_,reject)=>{
     const signal=init.signal;if(!signal){reject(Error('fixture_test_signal_required'));return;}
     const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('fixture_test_aborted'));};
     if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
    });
    return {ok:true,status:200,json:async()=>({provider:command.provider,reference:ref(profile),requestId:command.requestId,connection:longConnection(),profileUnchanged:true,persisted:true})};
   }
   if(url!=='/api/llm-profiles')throw Error('fixture_network_forbidden');
   if(!init?.method||init.method==='GET')return {ok:true,status:200,json:async()=>structuredClone(profiles)};
   const command=JSON.parse(String(init.body));const previous=profiles.find(p=>p.profileId===command.profile.profileId);
   if((previous?.revision??null)!==command.expectedRevision||previous&&previous.snapshotHash!==command.expectedSnapshotHash)return {ok:false,status:409,json:async()=>({error:'revision_conflict'})};
   const {secret:discardedSecret,...publicFields}=command.profile;void discardedSecret;
   const bytes=new TextEncoder().encode(JSON.stringify(publicFields));const digest=await crypto.subtle.digest('SHA-256',bytes);
   const snapshotHash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
   const saved={...publicFields,revision:previous?(JSON.stringify(publicFields)===JSON.stringify(Object.fromEntries(Object.entries(previous).filter(([k])=>!['revision','snapshotHash'].includes(k))))?previous.revision:previous.revision+1):1,snapshotHash};
   profiles=[...profiles.filter(p=>p.profileId!==saved.profileId),saved];return {ok:true,status:200,json:async()=>structuredClone(saved)};
  };
  return {storage,fetchImpl,profiles:()=>profiles,services:{settingsFixture:{storage,fetchImpl},refreshProfiles:async()=>structuredClone(profiles),refreshProviderState:async()=>providerState(),loadBindings:()=>loadProviderBindings(storage)}};
 },[scenario]);
 const [settings,setSettings]=useState(()=>loadNewGameSettings(undefined,fixture.storage));
 const [open,setOpen]=useState<'ai'|'settings'|null>(null),[section,setSection]=useState<'train'|'stats'|'review'>('train'),[message,setMessage]=useState('');
 const [reviewResult,setReviewResult]=useState<ReviewFiltersProps['result']>('all'),[reviewFavorite,setReviewFavorite]=useState(false),[reviewDifficulty,setReviewDifficulty]=useState<ReviewFiltersProps['difficulty']>('all');
 const [resume,setResume]=useState<MatchSave|null>({levels:[5,2],gameNo:2,lastResult:null,lastHead:null,rngState:1,ruleOpts:DEFAULT_RULES,difficulty:1,savedAt:0});
 const context={policies:webPolicyDescriptors,choices:scenario==='unavailable'?webReleaseChoices.map(c=>({...c,available:false})):webReleaseChoices};
 const commit=(aiSelection:AISelection,profiles:readonly PublicProfile[])=>{
  const next=validateNewGameSettings({...settings,aiSelection});resolveNewGameAssignments(next,{...context,profiles});saveNewGameSettings(next,fixture.storage);setSettings(next);setMessage('仅夹具偏好已保存；真实存档及运行中对局未改变');
 };
 return <>
  {open==='ai'&&<AISelectionModal value={settings} context={context} services={fixture.services} onClose={()=>setOpen(null)} onConfirm={commit}/>}
  {open==='settings'&&<SettingsModal fixture={fixture} onClose={()=>setOpen(null)}/>}
  <AppFrame active={section} onNav={setSection} onSettings={()=>setOpen('settings')}>
   {section==='train'?<HomePage settings={settings} profiles={fixture.profiles()} context={context} error={message||null} onAISelection={()=>setOpen('ai')}
    onPassA={passA=>{try{const next={...settings,passA};saveNewGameSettings(next,fixture.storage);setSettings(next);}catch(e){setMessage(String(e));}}}
    onStart={()=>setMessage(`夹具仅核新局引用：${resolveNewGameAssignments(settings,{...context,profiles:fixture.profiles()})[1].controller}；未开局、未读权重、未发API`)}
    onResume={()=>setMessage('夹具续局入口已点击；未接真实局')} onAbandon={()=>setResume(null)} fixture={{stats:{games:10,wins:10,headFinish:9,byDifficulty:{}},resume}}/>
    :section==='stats'?<div className="sp-content"><PageHeading/></div>:<div className="tz rv"><ReviewHeading/><main className="tz-console rv-console"><ReviewFilters result={reviewResult} favOnly={reviewFavorite} difficulty={reviewDifficulty} visibleValidCount={0} onResult={setReviewResult} onToggleFavorite={()=>setReviewFavorite(v=>!v)} onDifficulty={setReviewDifficulty}/></main></div>}
  </AppFrame>
  <output data-testid="ai-audit-state" hidden>{JSON.stringify({fixture:true,scenario,settings,resumePresent:!!resume,providerBindings:loadProviderBindings(fixture.storage),networkRequests:0,gameStarts:0,weightsReads:0})}</output>
 </>;
}
