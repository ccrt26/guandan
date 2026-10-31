import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createChatRoutes } from '../server/chat-routes.mjs';
import { createProfileSelector } from '../server/llm-select.mjs';
const ref={profileId:'fake-glm',revision:1,snapshotHash:'a'.repeat(64)};
const profile={profileId:ref.profileId,revision:1,nickname:'GLM',credentialRevision:1,secret:'SYNTHETIC_ONLY',protocol:'anthropic-messages',baseUrl:'https://open.bigmodel.cn/api/anthropic',requestedModel:'glm-5.3',supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}};
function fakeFetch(calls:any[]){return async(url:string,init:any)=>{calls.push({url,...init,body:JSON.parse(init.body)});return new Response('',{status:401});};}
function check(calls:any[]){expect(calls).toHaveLength(1);expect(calls[0].url).toBe('https://open.bigmodel.cn/api/anthropic/v1/messages');expect(calls[0].body).toMatchObject({model:'glm-5.3',stream:true,thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768});expect(calls[0].body.reasoning_effort).toBeUndefined();expect(calls[0].headers['x-api-key']).toBe('SYNTHETIC_ONLY');expect(calls[0].redirect).toBe('error');}
it('GLM recovery serialization: original chat sends reviewed Anthropic max unchanged with no fallback',async()=>{
 const calls:any[]=[],req:any=new EventEmitter(),res:any=new EventEmitter();Object.assign(req,{url:'/api/chat',method:'POST',headers:{host:'localhost:8787',origin:'http://localhost:5180','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'},[Symbol.asyncIterator]:async function*(){yield Buffer.from(JSON.stringify({reference:ref,messages:[{role:'user',content:'SYNTHETIC'}]}));}});
 Object.assign(res,{writeHead(){},end(){this.writableEnded=true;}});
 await createChatRoutes({store:{resolve:()=>profile},fetchImpl:fakeFetch(calls)})(req,res);check(calls);
});
it('GLM recovery serialization: original hybrid sends same exact max without transport changes',async()=>{
 const calls:any[]=[],observation={schema:'ohuo-public-observation-v1',decisionId:'fake-decision',matchId:'fake-match',actorSeat:0,partnerSeat:2,phase:'play',ruleOptions:{levelMode:'stage',passA:'head',pairSeqMin:3,pairSeqMax:6,trioSeqMin:2,trioSeqMax:4,flushLen:5,straightLen:5},rulesText:'SYNTHETIC RULES',levelsBefore:[2,2],stageTeam:0,effectiveLevelRanks:[2],gameNo:1,moveNo:0,previousGameResult:null,ownHand:[],seats:[0,1,2,3].map(seat=>({seat,remaining:1,finishOrder:null})),target:null,leader:0,lastPlayer:-1,passCount:0,currentTrick:[],publicPrefix:[],tribute:null,knownOtherHands:[],playedCards:[],unseenPool:[],informationBoundary:'own-hand-and-public-prefix; pass-does-not-prove-inability'};
 const selector=createProfileSelector({store:{resolve:()=>profile},reference:ref,fetchImpl:fakeFetch(calls)});
 await selector.request({observation,candidateSpec:'ohuo-frozen-c8-expand4-v1',expansionCount:0,candidates:[{actionId:'fake-pass',action:null,remainingHand:[]}],expandableGroups:[]},new AbortController().signal);check(calls);
});
