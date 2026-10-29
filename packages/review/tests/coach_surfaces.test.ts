import { expect,it } from 'vitest';
import * as coach from '../src/coachJson';
import type { DecisionReview } from '../src/decisionReview';
const evidence={decisionId:'surface#m2',recordId:'surface',moveNo:2,seat:1,replayStatus:'exact',actual:{actionId:'a0',coverage:{status:'exact',index:0}},facts:{rule:'小王压得过♥A',count:'剩余5张'},actionTexts:{a0:'小王',a1:'♥A'},claims:[{claimId:'c1',kind:'rule_relation',decisionId:'surface#m2',factIds:['rule'],scope:'provable_fact',text:'小王压得过♥A'}],claimLevel:'provable_fact',conflicts:[],missing:[],recordHash:'fixture',verifiedPrefixEnd:2,ruleContext:{levelMode:'stage',stageTeam:0,levelsBefore:[2,2],version:'fixture'},observation:{hash:'fixture',basis:'legal visible'},candidates:null,policy:null,heuristic:{topActionId:null,note:null,perItemBreakdown:false},heuristicBreakdowns:[],rollouts:[],expressionScope:'只陈述规则事实',singleStep:{actual:{actionId:'a0',label:'实际打法',sourceId:'record',text:'小王',remainingCards:5,wildsSpent:0,factIds:['count']},alternatives:[]}} as unknown as DecisionReview;
const positive={summary:'以下仅说明规则事实。',lessons:[{decisionId:'surface#m2',actionIds:['a0'],factIds:['rule'],claimIds:['c1'],claimLevel:'provable_fact',title:'规则比较',text:'小王压得过♥A。'}]};
it('a title cannot bypass card, count or rule-direction validation',()=>{
 for(const title of ['剩余999张♠K','小王压不过♥A']){
  const output=structuredClone(positive);output.lessons[0].title=title;
  expect(coach.validateCoachJson(output,[evidence]).length).toBeGreaterThan(0);
 }
});
it('summary cannot invert an established rule relation',()=>{
 expect(coach.validateCoachJson({...positive,summary:'小王压不过♥A。'},[evidence]).length).toBeGreaterThan(0);
});
it('pass-to-inability and heuristic-to-rule substitutions are rejected',()=>{
 for(const text of ['东家不要，所以一定压不动。','引擎规定必须按启发式首选出牌。']){
  const output=structuredClone(positive);output.lessons[0].text=text;
  expect(coach.validateCoachJson(output,[evidence]).length).toBeGreaterThan(0);
 }
});
it('normal supported explanation remains usable',()=>expect(coach.validateCoachJson(positive,[evidence])).toEqual([]));
it('legacy cache and altered facts cannot bypass the live acceptance gate',()=>{
 const c=coach as unknown as {makeCoachCache?:Function;readCoachCache?:Function;acceptCoachResponse?:Function};
 expect(c.makeCoachCache).toBeTypeOf('function');expect(c.readCoachCache).toBeTypeOf('function');expect(c.acceptCoachResponse).toBeTypeOf('function');
 const context={viewerSeat:0,policyId:'old',factsSchema:'decision-facts-v3'};
 const raw=JSON.stringify(positive);const cache=c.makeCoachCache!(raw,[evidence],context);
 expect(c.readCoachCache!(cache,[evidence],context)).toEqual(positive);
 expect(c.readCoachCache!('小王压不过♥A。',[evidence],context)).toBeNull();
 expect(c.readCoachCache!(cache,[evidence],{...context,viewerSeat:2})).toBeNull();
 const changed={...evidence,facts:{...evidence.facts,count:'剩余7张'}};
 expect(c.readCoachCache!(cache,[changed],context)).toBeNull();
 expect(c.acceptCoachResponse!(JSON.stringify({...positive,summary:'小王压不过♥A。'}),[evidence])).toBeNull();
});
it('valid unrelated action references cannot authorize strong prose or invented identities',()=>{
 const ev={...evidence,claimLevel:'model_preference' as const};
 for(const text of ['用炸弹接管，随后连续出牌就能获胜。','对手因为没有大牌而不要。','规则必须选择启发式首选。','网络首选就是引擎核实的最佳策略。']){
  const bad={summary:positive.summary,lessons:[{...positive.lessons[0],claimLevel:'model_preference',factIds:[],claimIds:[],text}]};
  expect(coach.acceptCoachResponse(JSON.stringify(bad),[ev])).toBeNull();
  const cached=JSON.parse(coach.makeCoachCache(JSON.stringify({...positive,lessons:[{...positive.lessons[0],claimLevel:'model_preference'}]}),[ev],{viewer:1}));
  cached.payload=bad;expect(coach.readCoachCache(JSON.stringify(cached),[ev],{viewer:1})).toBeNull();
 }
 expect(coach.acceptCoachResponse(JSON.stringify({...positive,summary:'行动席9，观察席8，本手编号999。'}),[evidence])).toBeNull();
});
