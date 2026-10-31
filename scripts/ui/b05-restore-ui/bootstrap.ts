/** Only this helper entry is substituted; the real App/main/controller stay byte-identical. */
import {MLP} from '../../../packages/ai/src/nn/mlp';
import {MatchController} from '../../../packages/web/src/game/controller';
import oldSave from '../../../lab/review6_2/checks/fixtures/B05-old-o-save.json';
import missingSave from '../../../lab/review6_2/checks/fixtures/B05-missing-release-save.json';
import {assertOwnedStorage,installFixture,installNoPlayGuards,allowedFetch,MATCH_KEY} from './safety.mjs';
const panel=document.getElementById('b05-restore-tools')!;
panel.style.cssText='position:relative;z-index:100000;padding:12px;background:#fff7d6;color:#1d2433;font:14px/1.5 system-ui;border:2px solid #ab7000';
panel.innerHTML='<strong>B05 人工存档验收（不是用户牌局）</strong><p>仅旧 O 恢复／缺 release 暂停／四席配置。真实模型前向及出牌已禁止。不要点新局、提示或出牌；切换输入先离桌，再刷新此入口。</p><div id="b05-buttons"></div><pre id="b05-status" style="white-space:pre-wrap"></pre>';
const status=document.getElementById('b05-status')!;
const buttons=document.getElementById('b05-buttons')!;
let controller:MatchController|null=null,fixtureRaw:string|null=null,fixtureId:string|null=null;
let blockedForward=0,blockedStep=0,blockedFetch=0,playRequests=0,oGet=0,profileGet=0,lastError='';
function refresh(){
 try{
  assertOwnedStorage(localStorage);
  const raw=localStorage.getItem(MATCH_KEY),save=raw?JSON.parse(raw):null;
  status.textContent=JSON.stringify({fixture:fixtureId??'未安装；原 App 尚未挂载',artificial:true,
   currentMatchId:save?.matchId??null,unchangedSinceInstall:fixtureRaw===null?null:raw===fixtureRaw,
   savedActions:save?.activeGame?.moves?.length??0,savedPolicies:save?.activeGame?.recorderMeta?.aiPolicies??null,
   actualController:controller?{humanTurn:controller.humanTurn,turn:controller.state?.turn??null,moveNo:controller.state?.moveNo??0,waitingRemote:controller.waitingRemote,error:controller.exchangeError}:null,
   oGet,emptyPublicProfileGet:profileGet,playRequests,blockedForward,blockedStep,blockedFetch,lastError,
   verdict:'人工观察后再写回执；本面板不自行宣布通过'},null,2);
 }catch{status.textContent='拒绝：origin_not_fixture_owned。未挂载 App／未写入存档；请使用新的隔离浏览器 profile。';}
}
const button=(text:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.style.marginRight='8px';b.addEventListener('click',run);buttons.append(b);return b;};
try{
 if(location.origin!=='http://127.0.0.1:15181'||location.pathname!=='/'||location.search||location.hash)throw Error('use_exact_loopback_root_without_query');
 assertOwnedStorage(localStorage);
 installNoPlayGuards(MLP,MatchController,(kind:string)=>{if(kind==='forward')blockedForward++;else blockedStep++;lastError=`已阻止 ${kind}；本轮验收应无此前尝试`;refresh();});
 const realStart=MatchController.prototype.startGame;
 MatchController.prototype.startGame=function(){
  if(this.matchSavePoint().matchId!=='B05-manual-legacy-o'||controller)throw Error('B05_restore_ui_new_game_forbidden');
  controller=this;this.subscribe(refresh);realStart.call(this);refresh();
 };
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const rawUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(new URL(rawUrl,location.href).pathname==='/api/llm-play')playRequests++;
  const kind=allowedFetch(input,init,location.origin);
  if(kind==='profiles'){profileGet++;refresh();return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});}
  if(kind==='o'){oGet++;refresh();return nativeFetch(input,init);}
  blockedFetch++;lastError='已拒绝非 O 资产 / 非空 public profiles 请求';refresh();throw Error('B05_restore_ui_request_forbidden');
 };
 const install=async(fixture:typeof oldSave|typeof missingSave)=>{
  try{
   // Recheck immediately before writing: another tab may have changed this origin.
   assertOwnedStorage(localStorage);installFixture(localStorage,fixture);
   fixtureRaw=JSON.stringify(fixture);fixtureId=fixture.matchId;
   for(const node of buttons.querySelectorAll<HTMLButtonElement>('button[data-install]'))node.disabled=true;
   refresh();
   await import('../../../packages/web/src/main');
   refresh();
  }catch(error){lastError=String(error);refresh();}
 };
 button('安装人工旧 O 存档 → 进入真实首页',()=>{void install(oldSave);}).dataset.install='true';
 button('安装人工缺 release 存档 → 进入真实首页',()=>{void install(missingSave);}).dataset.install='true';
 button('刷新观测（不改存档）',refresh);
 button('返回验收入口（刷新，不改存档）',()=>location.reload());
 window.addEventListener('error',event=>{lastError=event.message;refresh();});
 window.addEventListener('unhandledrejection',event=>{lastError=String(event.reason);refresh();});
 refresh();
}catch(error){buttons.replaceChildren();status.textContent=`拒绝：${String(error)}。未挂载 App／未写入存档；请使用新的隔离浏览器 profile，访问 http://127.0.0.1:15181/ 。`;}
