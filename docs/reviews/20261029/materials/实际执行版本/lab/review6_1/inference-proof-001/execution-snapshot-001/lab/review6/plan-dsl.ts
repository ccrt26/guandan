import{canPass,legalCombos,teamOf,type GameState,type Combo}from'@gd/engine';
import{dedupCandidates}from'@gd/ai';
import{necessaryDeclarationKey}from'./action-effect';
import type{PublicStep}from'./match-play';

const kinds=['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb','pass'];
const factFields=new Set(['myTurn','myCount','partnerCount','opponentMinCount','partnerFinished','opponentFinishedCount','mateControls','hasTarget','targetKind','targetSize','targetKeyRank','myTeamLevel','opponentTeamLevel','myTeamOnStage','partnerLastPass']);
const numberFields=new Set(['myCount','partnerCount','opponentMinCount','opponentFinishedCount','targetSize','targetKeyRank','myTeamLevel','opponentTeamLevel']);
function object(value:any,allowed:string[],required:string[]=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw new Error('invalid plan schema/field');}
function predicate(value:any,depth=0,budget={nodes:0}){
 if(++budget.nodes>256)throw new Error('plan predicate node bound exceeded');
 if(depth>8)throw new Error('plan predicate depth exceeds bound');
 if(value?.op==='eq'||value?.op==='lt'||value?.op==='le'){object(value,['op','field','value'],['op','field','value']);if(!factFields.has(value.field))throw new Error('unrepresented or hidden predicate field');if(!['string','number','boolean'].includes(typeof value.value)&&value.value!==null||typeof value.value==='number'&&!Number.isFinite(value.value))throw new Error('invalid scalar predicate value');if(value.op!=='eq'&&(!numberFields.has(value.field)||typeof value.value!=='number'))throw new Error('numeric predicate field/value required');return;}
 if(value?.op==='and'||value?.op==='or'){object(value,['op','args'],['op','args']);if(!Array.isArray(value.args)||!value.args.length||value.args.length>8)throw new Error('bounded condition args required');value.args.forEach((v:any)=>predicate(v,depth+1,budget));return;}
 if(value?.op==='not'){object(value,['op','arg'],['op','arg']);predicate(value.arg,depth+1,budget);return;}
 if(value?.op==='legal'){object(value,['op','kind','maxSize'],['op','kind']);if(!kinds.includes(value.kind)||value.maxSize!==undefined&&(!Number.isInteger(value.maxSize)||value.maxSize<1||value.maxSize>27))throw new Error('invalid legal-set predicate');return;}
 throw new Error('unsupported plan predicate op');
}
function selection(value:any){
 if(value?.kind==='pass'||value?.kind==='finish_hand'){object(value,['kind'],['kind']);return;}
 if(value?.kind==='exact_action'){object(value,['kind','actionKey'],['kind','actionKey']);if(typeof value.actionKey!=='string'||!value.actionKey||value.actionKey.length>10000)throw new Error('explicit legal action key required');return;}
 if(value?.kind==='minimum_key'){object(value,['kind','comboKind','avoidBombs'],['kind']);if(value.comboKind!==undefined&&!kinds.filter(k=>k!=='pass').includes(value.comboKind)||value.avoidBombs!==undefined&&typeof value.avoidBombs!=='boolean')throw new Error('invalid action selector');return;}
 throw new Error('unsupported plan action selector');
}
export function validatePlan(plan:any){
 object(plan,['schemaVersion','planId','rootId','goal','condition','trigger','invalidateWhen','fallback','maxOwnActions','steps'],['schemaVersion','planId','rootId','goal','condition','trigger','invalidateWhen','fallback','maxOwnActions','steps']);
 if(plan.schemaVersion!=='r6-plan-dsl-v1'||typeof plan.planId!=='string'||!plan.planId||plan.planId.length>256||typeof plan.rootId!=='string'||!plan.rootId||plan.rootId.length>256||!['yield_resource','takeover_control','preserve_structure','finish_self','conditional_response'].includes(plan.goal)||plan.fallback!=='frozen_continuation')throw new Error('invalid plan schema/identity');
 if(!Number.isInteger(plan.maxOwnActions)||plan.maxOwnActions<1||plan.maxOwnActions>4||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>plan.maxOwnActions)throw new Error('plan limited to four own action steps');
 const budget={nodes:0};[plan.condition,plan.trigger,plan.invalidateWhen].forEach(p=>predicate(p,0,budget));for(const step of plan.steps){object(step,['trigger','invalidateWhen','select'],['trigger','invalidateWhen','select']);predicate(step.trigger,0,budget);predicate(step.invalidateWhen,0,budget);selection(step.select);}return plan;
}
function visibleFacts(state:GameState,actor:number,history:PublicStep[]){
 const mate=(actor+2)%4,opponents=[(actor+1)%4,(actor+3)%4],lastPartner=history.flatMap(h=>h.events).filter(e=>(e.type==='play'||e.type==='pass')&&e.player===mate).at(-1);
 return{myTurn:state.turn===actor,myCount:state.hands[actor].length,partnerCount:state.hands[mate].length,opponentMinCount:Math.min(...opponents.map(s=>state.hands[s].length)),partnerFinished:state.finished.includes(mate),opponentFinishedCount:opponents.filter(s=>state.finished.includes(s)).length,mateControls:state.lastCombo!==null&&state.lastPlayer===mate,hasTarget:state.lastCombo!==null,targetKind:state.lastCombo?.kind??null,targetSize:state.lastCombo?.size??0,targetKeyRank:state.lastCombo?.keyRank??0,myTeamLevel:state.match.levels[teamOf(actor)],opponentTeamLevel:state.match.levels[1-teamOf(actor)],myTeamOnStage:state.stageTeam===teamOf(actor),partnerLastPass:lastPartner?.type==='pass'};
}
function evaluate(p:any,facts:ReturnType<typeof visibleFacts>,candidates:Array<Combo|null>):boolean{
 if(p.op==='eq')return facts[p.field as keyof typeof facts]===p.value;
 if(p.op==='lt')return Number(facts[p.field as keyof typeof facts])<p.value;
 if(p.op==='le')return Number(facts[p.field as keyof typeof facts])<=p.value;
 if(p.op==='and')return p.args.every((q:any)=>evaluate(q,facts,candidates));
 if(p.op==='or')return p.args.some((q:any)=>evaluate(q,facts,candidates));
 if(p.op==='not')return!evaluate(p.arg,facts,candidates);
 return candidates.some(c=>(c?.kind??'pass')===p.kind&&(p.maxSize===undefined||(c?.size??0)<=p.maxSize));
}
export class PlanRuntime{
 private plan:any;private ownTurnsSeen=0;private stepIndex=0;private disabled=false;private initialized=false;private lastMoveNo:number|null=null;private lastResult:any=null;private rootGameNo:number|null=null;
 constructor(plan:any,readonly actor:number,rootId:string){validatePlan(plan);if(!Number.isInteger(actor)||actor<0||actor>3||plan.rootId!==rootId)throw new Error('plan actor/root identity mismatch');this.plan=structuredClone(plan);}
 snapshot(){return{planId:this.plan.planId,rootId:this.plan.rootId,actor:this.actor,ownTurnsSeen:this.ownTurnsSeen,stepIndex:this.stepIndex,disabled:this.disabled,initialized:this.initialized,lastMoveNo:this.lastMoveNo,rootGameNo:this.rootGameNo};}
 consider(state:GameState,history:PublicStep[]){
  if(state.turn!==this.actor)return{move:null,status:'not_controlled_seat'};
  if(this.rootGameNo!==null&&state.match.gameNo!==this.rootGameNo){this.disabled=true;return{move:null,status:'root_round_finished'};}
  this.rootGameNo??=state.match.gameNo;
  if(this.lastMoveNo===state.moveNo)return this.lastResult;
  if(this.disabled||this.ownTurnsSeen>=this.plan.maxOwnActions||this.stepIndex>=this.plan.steps.length)return{move:null,status:'frozen_fallback'};
  this.lastMoveNo=state.moveNo;this.ownTurnsSeen++;const facts=visibleFacts(state,this.actor,history),candidates=dedupCandidates(legalCombos(state),canPass(state)).map(c=>c.combo),step=this.plan.steps[this.stepIndex];
  const result=(status:string,move:{pass:boolean;combo?:Combo}|null=null)=>this.lastResult={move,status,ownTurnsSeen:this.ownTurnsSeen,stepIndex:this.stepIndex};
  if(!this.initialized){this.initialized=true;if(!evaluate(this.plan.condition,facts,candidates)){this.disabled=true;return result('condition_false');}}
  if(evaluate(this.plan.invalidateWhen,facts,candidates)||evaluate(step.invalidateWhen,facts,candidates)){this.disabled=true;return result('invalidated');}
  if(!evaluate(this.plan.trigger,facts,candidates)||!evaluate(step.trigger,facts,candidates))return result('not_triggered');
  const select=step.select;let found:Combo|null|undefined;
  if(select.kind==='pass')found=candidates.find(c=>c===null);
  else if(select.kind==='finish_hand')found=candidates.find(c=>c?.size===facts.myCount);
  else if(select.kind==='exact_action')found=candidates.find(c=>necessaryDeclarationKey(c,state.ctx)===select.actionKey);
  else found=candidates.filter((c):c is Combo=>!!c&&(select.comboKind===undefined||c.kind===select.comboKind)&&(!select.avoidBombs||!['bomb','flush','joker_bomb'].includes(c.kind))).sort((a,b)=>a.keyRank-b.keyRank||a.size-b.size||necessaryDeclarationKey(a,state.ctx).localeCompare(necessaryDeclarationKey(b,state.ctx)))[0];
  if(found===undefined)return result('missing_legal_action');this.stepIndex++;return result('controlled',found===null?{pass:true}:{pass:false,combo:found});
 }
}
