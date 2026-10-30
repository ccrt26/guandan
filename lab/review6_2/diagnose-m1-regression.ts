/** Four fixed executions only: two original replays and two root interventions. */
import{existsSync,mkdirSync}from'node:fs';import{join}from'node:path';import{serialize,deserialize}from'node:v8';import{createHash}from'node:crypto';
import{createMatch,startGame,DEFAULT_RULES,teamOf}from'@gd/engine';
import{runCompleteMatch,indexedDealSeed,resolveLegalMove,type PublicStep}from'../review6/match-play';
import{necessaryDeclarationKey}from'../review6/action-effect';import{resourceEffectKey}from'../review6/data-replay';import{dealtFamilyBeforeExchange}from'../review6/training-ancestry';import{engineDealFamily}from'../review6/capability-lineage';
import{toVisibleRoot}from'../review6/visible-world';import{rootCandidates}from'../review6/teacher-roots';
import{HOME,ROOT,json,hash,fileHash,atomicJson,readRegistry,validatePolicy,bindFamilies,excludedFamilies}from'./protocol';import{evaluationLayouts}from'./evaluate';
const canonical=(v:any)=>JSON.stringify(v,(_k,value)=>value instanceof Set?[...value]:value instanceof Map?[...value]:value);
const traceOf=(rows:any[])=>{const h=createHash('sha256');for(const r of rows)h.update(JSON.stringify(r.entry));return h.digest('hex');};

export function diagnoseM1Regression(config:any,output:string){
 const begin=performance.now(),cpu=process.cpuUsage(),registry=readRegistry(config),ids=['r62-p9c-control','r62-p12-dose'];
 const blockRefs=ids.map(id=>join(HOME,'development',id+'-u1800-greedy-32blocks/block-00000.json'));
 const blockSHA=['cc50fd1594a8640aa4296829339cdec47bd18b575400ff193bbb852efa2633ee','1dd0245b23f47b5c3360f7cb207f34598693f624099b941b1afe5794a8683a9a'];
 if(blockRefs.some((p,i)=>fileHash(p)!==blockSHA[i]))throw Error('fixed first negative M1 block changed');
 const blocks=blockRefs.map(json),original=blocks.map(b=>b.matches.find((r:any)=>r.id==='M1-s0')),source=blocks[0].sources.M1;
 if(JSON.stringify(source)!==JSON.stringify(blocks[1].sources.M1)||source.seed!==1718165852||source.dealNamespace!=='review6-2-dev-M1-deals-v1'||original[0].winner!==0||original[1].winner!==1)throw Error('fixed first negative M1 source changed');
 const policies=ids.map(id=>json(join(HOME,'development',id+'-u1800-greedy-32blocks/report.json')).candidate);
 if(policies[0].weightsSHA256!=='e1c606a454b4496a327e547176c222dfc595194efaf3c8402c3033b15331545a'||policies[1].weightsSHA256!=='81ed4d1c979d1b926e9b641cf7cd16db79f4e9e61e24a8747739d097f65f3252')throw Error('fixed diagnostic policies changed');
 const layouts=policies.map(p=>{validatePolicy(p);const l=evaluationLayouts(registry,p).find(l=>l.id==='M1-s0')!;if(!l||l.policies.some(p=>p.kind!=='neural'||p.epsilon!==0))throw Error('fixed greedy neural M1 layout required');return l;});
 for(let i=0;i<2;i++)if(JSON.stringify(layouts[i].policies.map(p=>p.policyId))!==JSON.stringify(original[i].policyIds))throw Error('original replay seat identities differ');
 const potentials=Array.from({length:80},(_,g)=>engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(source.dealNamespace,source.seed,g))).hands)),foreign=new Set(excludedFamilies(config.sourceIndexRef,'dev'));
 if(potentials.some(f=>foreign.has(f)))throw Error('fixed diagnostic source future family foreign collision; no replacement');
 const planRef=join(ROOT,'docs/superpowers/plans/2026-10-30-guandan-review6-2-p12-m1-diagnosis.md'),spec={source,blockRefs,blockSHA,policies,layouts,planRef,planSHA256:fileHash(planRef),helperSHA256:fileHash(join(HOME,'diagnose-m1-regression.ts')),matchPlaySHA256:fileHash(join(HOME,'../review6/match-play.ts')),registrySHA256:fileHash(config.registryPath),nodeV8:process.versions.v8};
 const identity=hash(JSON.stringify(spec));mkdirSync(output,{recursive:true});const manifestRef=join(output,'manifest.json');if(existsSync(manifestRef)){if(json(manifestRef).identity!==identity)throw Error('preserve incompatible diagnostic output');}else atomicJson(manifestRef,{identity,...spec,scope:'dev fixed-case diagnosis only; never teacher, no model update or formal attempt'});
 const immutablePaths=[...blockRefs,...policies.map(p=>p.weightsPath),config.registryPath,planRef,join(HOME,'diagnose-m1-regression.ts'),join(HOME,'../review6/match-play.ts')],immutableSHA256=Object.fromEntries(immutablePaths.map(p=>[p,fileHash(p)]));
 let executedNow=0;
 function execute(name:string,seats:any[],options:{root?:any;forced?:any;compare?:any[];capture?:boolean}={}){
  const path=join(output,name+'.json');if(existsSync(path)){const cached=json(path);if(cached.identity!==identity||!cached.result.complete)throw Error('cached diagnostic execution changed/incomplete');return cached;}
  const rows:any[]=[],families:string[]=[],seen=new Set<number>();let prior:any,lastState:any,lastHistory:any,captured:any=null;
  const result=runCompleteMatch({seed:source.seed,policies:seats,rngMode:'counter-per-decision',dealMode:'indexed-deal-v1',dealNamespace:source.dealNamespace,inferenceExecution:'exact-prefix-v1',maxGames:options.root?81-options.root.state.match.gameNo:80,maxMovesPerGame:2500,deadlineMonotonicMs:performance.now()+config.windowSeconds*1000,
   ...(options.root?{rootState:options.root.state,rootHistory:options.root.history,actingSeat:options.root.state.turn,forcedRootMove:options.forced}:{actingSeat:0}),
   onBeforeDecision({state,seat,history}){
    if(!seen.has(state.match.gameNo)){seen.add(state.match.gameNo);const f=state.moveNo===0?dealtFamilyBeforeExchange(state):potentials[state.match.gameNo-1];if(f!==potentials[state.match.gameNo-1]||foreign.has(f))throw Error('diagnostic actual ancestry changed');families.push(f);}
    prior={gameNo:state.match.gameNo,moveNo:state.moveNo,actor:seat,stateSHA256:hash(canonical(state)),historySHA256:hash(canonical(history))};
    if(options.capture&&!captured){lastState=structuredClone(state);lastHistory=structuredClone(history);}
   },onAfterDecision({state,seat,move,events}){
    const key=necessaryDeclarationKey(move.pass?null:move.combo!,state.ctx),entry={gameNo:state.match.gameNo,seat,move:resourceEffectKey(move.pass?null:move.combo!),counts:state.hands.map(h=>h.length),events};
    const row={before:prior,key,move:structuredClone(move),entry};
    if(options.compare&&!captured){const old=options.compare[rows.length];if(!old||JSON.stringify(old.before)!==JSON.stringify(prior))throw Error('original trajectories do not share the prefix before first divergence');
     if(old.key!==key){if(teamOf(seat)!==0)throw Error('first policy divergence must belong to candidate team');captured={index:rows.length,state:lastState,history:lastHistory,oldMove:old.move,newMove:structuredClone(move),oldKey:old.key,newKey:key};}
    }rows.push(row);
   }});
  executedNow++;bindFamilies(config.sourceIndexRef,families,'dev','p12-m1-fixed:'+name);
  const saved={identity,name,result,families,rows,...(captured?{privateSimulationRootBase64:serialize(captured).toString('base64')}:{}),scope:'dev diagnostic cache; private root state is not teacher input'};atomicJson(path,saved);
  if(!result.complete||traceOf(rows)!==result.traceSHA256)throw Error('diagnostic incomplete or trace reconstruction failed');return saved;
 }
 const control=execute('original-control',layouts[0].policies),current=execute('original-P12',layouts[1].policies,{capture:true,compare:control.rows});
 for(const[replayed,expected]of[[control,original[0]],[current,original[1]]]as any)if(replayed.result.traceSHA256!==expected.traceSHA256||replayed.result.winner!==expected.winner||replayed.result.games!==expected.games||JSON.stringify(replayed.families)!==JSON.stringify(expected.roundBaseFamilies))throw Error('original full trajectory replay differs; do not add samples');
 if(!current.privateSimulationRootBase64)throw Error('fixed negative match has no policy action divergence');
 const fork=deserialize(Buffer.from(current.privateSimulationRootBase64,'base64'));
 if(hash(canonical(fork.state))!==control.rows[fork.index].before.stateSHA256||hash(canonical(fork.history))!==control.rows[fork.index].before.historySHA256||fork.state.turn!==control.rows[fork.index].before.actor)throw Error('saved private fork differs from verified shared prefix');
 for(const move of[fork.oldMove,fork.newMove])resolveLegalMove(fork.state,move);
 const rootRef=join(output,'public-dev-root.json');atomicJson(rootRef,{split:'dev',scope:'diagnostic only; never teacher',sourceFamilyId:source.familyId,sourceRootRoundFamilyId:potentials[fork.state.match.gameNo-1],observedBefore:toVisibleRoot(fork.state,fork.history),allCandidates:rootCandidates(fork.state),oldActionKey:fork.oldKey,newActionKey:fork.newKey,prefixDecisions:fork.index});
 const oldAction=execute('P12-after-control-action',layouts[1].policies,{root:fork,forced:fork.oldMove}),newAction=execute('P12-after-P12-action',layouts[1].policies,{root:fork,forced:fork.newMove});
 const prefix=current.rows.slice(0,fork.index),composedTrace=traceOf([...prefix,...newAction.rows]),suffix=current.rows.slice(fork.index).map((r:any)=>r.entry);
 const reproduced=composedTrace===original[1].traceSHA256&&canonical(newAction.rows.map((r:any)=>r.entry))===canonical(suffix)&&JSON.stringify(newAction.families)===JSON.stringify(current.families.slice(fork.state.match.gameNo-1))&&newAction.result.winner===current.result.winner;
 if(!reproduced)throw Error('forced P12 branch did not reproduce original full action suffix/families; preserve evidence');
 const branches=[oldAction,newAction].map(r=>({name:r.name,complete:r.result.complete,g:r.result.rootG,W:r.result.finalW,y:r.result.rootTeamTarget,winner:r.result.winner,remainingGames:r.result.games,traceSHA256:r.result.traceSHA256,families:r.families}));
 if(JSON.stringify(immutableSHA256)!==JSON.stringify(Object.fromEntries(immutablePaths.map(p=>[p,fileHash(p)]))))throw Error('diagnostic original inputs changed');
 const used=process.cpuUsage(cpu),summary={status:'completed',identity,rootRef,firstDivergence:{decisionIndex:fork.index,gameNo:fork.state.match.gameNo,moveNo:fork.state.moveNo,actor:fork.state.turn,oldActionKey:fork.oldKey,newActionKey:fork.newKey},branches,forcedP12FullTraceReproduced:true,composedTraceSHA256:composedTrace,rootGDefinition:'signed upgrade of the divergence round for the divergence actor team, not accumulated rounds',uniqueFixedExecutions:4,currentInvocationCompleteExecutions:executedNow,newMainUpdates:0,newMainDevelopmentMatches:0,formalAttempt:0,immutableSHA256,immutableInputsUnchanged:true,wallSeconds:(performance.now()-begin)/1000,measuredProcessCPUSeconds:(used.user+used.system)/1e6,scope:'one fixed dev world/local intervention only; not average policy causality, not teaching evidence'};atomicJson(join(output,'summary.json'),summary);return summary;
}
