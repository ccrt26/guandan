import {expect,it} from 'vitest';
import {createMatch,DEFAULT_RULES,startGame,legalCombos,applyMove,type GameRecord} from '@gd/engine';
import {buildDecisionFactsV3} from '@gd/review';
import * as audit from '../review6/product';
async function validator(){const m=audit;expect(m?.verifyProductCard).toBeTypeOf('function');return m!.verifyProductCard as Function;}
function card(){const match=createMatch({...DEFAULT_RULES},61201),s=startGame(match),actor=s.turn,combo=legalCombos(s)[0];const rec:GameRecord={schemaVersion:2,id:'denom',matchId:'denom',createdAt:0,ruleOpts:match.opts,levelsBefore:[...s.levelsBefore],stageTeam:s.stageTeam,leader:s.leader,humanSeat:0,difficulties:[0,0,0,0],initialHands:s.hands.map(h=>[...h]),moves:[],result:null};applyMove(s,{pass:false,combo});rec.moves.push({moveNo:1,player:actor,pass:false,cards:combo.cards,comboKind:combo.kind,mainRank:combo.mainRank,handsAfter:s.hands.map(h=>h.length)});return {rec,facts:buildDecisionFactsV3(rec,1,0)};}
it('missing assertions stay in the prelocked denominator and cannot yield a passed card',async()=>{const verify=await validator(),{rec,facts}=card();const expected={record:rec,moveNo:1,viewerSeat:0,expectedAssertionIds:[...facts.expectedAssertionIds]};const good=verify(expected,facts);expect(good.checkedAssertions).toBe(6);expect(good.passed).toBe(true);facts.assertions.pop();const bad=verify(expected,facts);expect(bad.expectedAssertions).toBe(6);expect(bad.missingAssertions).toBe(1);expect(bad.passed).toBe(false);});
it('false actor and after-count cannot be accepted because checked flags say true',async()=>{const verify=await validator(),{rec,facts}=card();const expected={record:rec,moveNo:1,viewerSeat:0,expectedAssertionIds:[...facts.expectedAssertionIds]};facts.actorSeat=(facts.actorSeat+1)%4;facts.afterCounts[0]=999;const bad=verify(expected,facts);expect(bad.errorAssertions).toBeGreaterThan(0);expect(bad.passed).toBe(false);});
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('actual ten-category generator produces 240 nonempty cards with all fixed assertions checked',()=>{
 const dir=join(mkdtempSync(join(tmpdir(),'r6-product-')),'new-output');
 const result=audit.verifyProduct(dir);
 expect(result.completedCards).toBe(240);expect(result.expectedAssertions).toBe(1440);
 expect(result.missingAssertions).toBe(0);expect(result.errorAssertions).toBe(0);expect(result.productFactsPassed).toBe(true);
},120000);
it('constructed four/five bomb incident reports both legal, distinct strength and exact remaining counts',()=>{
 const dir=join(mkdtempSync(join(tmpdir(),'r6-bombs-')),'new-output');audit.verifyProduct(dir);
 const rows=JSON.parse(requireRead(join(dir,'case-results.json')));
 const row=rows.find((r:{caseId:string;viewerSeat:number})=>r.caseId==='bomb_4_5-1'&&r.viewerSeat===0);
 expect(row.card.bombComparison).toEqual(expect.objectContaining({fourCanBeatCurrent:true,fiveCanBeatCurrent:true,fiveBeatsFour:true,fourRemaining:23,fiveRemaining:22,strategyPreference:null}));
},120000);
import {readFileSync as readBytes} from 'node:fs';
function requireRead(path:string){return readBytes(path,'utf8');}
it('wrong rendered facts and made-up inapplicability cannot pass the independent assertion checker',async()=>{
 const verify=await validator(),{rec,facts}=card();const expected={record:rec,moveNo:1,viewerSeat:0,expectedAssertionIds:[...facts.expectedAssertionIds]};
 const wrongText=structuredClone(facts);wrongText.actual.text='999张天王炸';expect(verify(expected,wrongText).passed).toBe(false);
 const omitted=structuredClone(facts);omitted.assertions[0].applicable=false;omitted.assertions[0].applicabilityReason='not relevant';expect(verify(expected,omitted).passed).toBe(false);
});
it('the fixed bomb cases include a reachable five-card finish and a four-card alternative leaving one card',()=>{
 const dir=join(mkdtempSync(join(tmpdir(),'r6-finish-')),'new-output');audit.verifyProduct(dir);
 const rows=JSON.parse(requireRead(join(dir,'case-results.json')));
 const row=rows.find((r:{caseId:string;viewerSeat:number})=>r.caseId==='bomb_4_5-4'&&r.viewerSeat===0);
 expect(row.card.actual.cardCount).toBe(5);expect(row.card.afterCounts[row.card.actorSeat]).toBe(0);
 expect(row.card.bombComparison.fourRemaining).toBe(1);expect(row.card.bombComparison.fiveRemaining).toBe(0);
},120000);
it('all six distinct locked roles, decision identity and rule explanation are mandatory',async()=>{
 const verify=await validator(),{rec,facts}=card();const expected={record:rec,moveNo:1,viewerSeat:0,expectedAssertionIds:[...facts.expectedAssertionIds]};
 const wrongIdentity=structuredClone(facts);wrongIdentity.decisionId='wrong-record#m999';expect(verify(expected,wrongIdentity).passed).toBe(false);
 const wrongRule=structuredClone(facts);wrongRule.ruleRelation.applicabilityReason='引擎要求必须五炸；对手不要所以压不动';expect(verify(expected,wrongRule).passed).toBe(false);
 const duplicated=structuredClone(facts);const ids=Array(6).fill(facts.expectedAssertionIds[0]);duplicated.expectedAssertionIds=ids;duplicated.actual.cardCount=999;duplicated.afterCounts=[999,999,999,999];expect(verify({...expected,expectedAssertionIds:ids},duplicated).passed).toBe(false);
});
