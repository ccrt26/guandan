import {readFileSync,existsSync,realpathSync,openSync,closeSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha256File,readBudget,reserveBudget,settleBudget,writeNewJson} from './runtime.mjs';

function verifyPrerequisites(config){
 const h=config.data?.humanFit;if(!h)throw new Error('frozen H fit contract required');
 for(const [pathKey,hashKey] of [['contractPath','contractSHA256'],['preflightPath','preflightSHA256'],['reviewAuthorizationPath','reviewAuthorizationSHA256']])if(!h[pathKey]||sha256File(h[pathKey])!==h[hashKey])throw new Error('H pinned prerequisite mismatch: '+pathKey);
 const contract=JSON.parse(readFileSync(h.contractPath,'utf8')),preflight=JSON.parse(readFileSync(h.preflightPath,'utf8')),review=JSON.parse(readFileSync(h.reviewAuthorizationPath,'utf8'));
 if(preflight.stageStatus!=='preflight_passed'||preflight.trainingUpdates!==0||!preflight.parametersUnchanged||preflight.heldoutModelScoresOpened!==false||preflight.contractSHA256!==h.contractSHA256)throw new Error('H preflight not qualified');
 if(review.contractSHA256!==h.contractSHA256||review.allP1P2Closed!==true||review.reviews.length!==2)throw new Error('H pre-fit independent review incomplete');
 if(new Set(review.reviews.map(r=>realpathSync(r.path))).size!==2||new Set(review.reviews.map(r=>r.sha256)).size!==2)throw new Error('H independent reviews must be distinct; duplicate report rejected');
 if(!review.requestPath||sha256File(review.requestPath)!==review.requestSHA256)throw new Error('H review request identity changed');
 const request=JSON.parse(readFileSync(review.requestPath,'utf8'));if(!request.evidence.some(f=>resolve(f.path)===resolve(h.contractPath)&&f.sha256===h.contractSHA256))throw new Error('H review request does not bind this contract');
 const roles=new Set(),ids=new Set();for(const r of review.reviews){if(sha256File(r.path)!==r.sha256)throw new Error('H independent review changed');const raw=JSON.parse(readFileSync(r.path,'utf8'));if(raw.overallDecision!=='APPROVE_H_FIT')throw new Error('H review does not approve the fit');if(raw.role!==r.role||typeof raw.reviewId!=='string'||!raw.reviewId||ids.has(raw.reviewId)||raw.requestSHA256!==review.requestSHA256||raw.reviewedContractSHA256!==h.contractSHA256)throw new Error('H review identity/contract mismatch');ids.add(raw.reviewId);roles.add(raw.role);}
 if(!roles.has('engineering')||!roles.has('method'))throw new Error('H needs both independent review roles');
 if(sha256File(h.frozenTrainer)!==contract.trainerSHA256||sha256File(h.frozenNetwork)!==contract.networkSourceSHA256||sha256File(h.featureManifest)!==contract.manifestSHA256)throw new Error('actual H launch source/input changed');
 if(config.runtime.device!=='cpu'||config.runtime.torchThreads!==2||realpathSync(config.runtime.pythonAbsolutePath)!==realpathSync(contract.pythonAbsolutePath))throw new Error('actual H runtime differs from its contract');
 const out=resolve(h.outputDirectory);if(out!==resolve(contract.outputDirectory)||!out.startsWith(resolve(config.repo,'lab/review6_1/data')+'/'))throw new Error('invalid H output identity');
 if(config.cycleId!=='review6-humanlike-20261028'||resolve(config.handoff.budgetLedgerPath)!==resolve(config.repo,'lab/review6/budget-ledger.jsonl')||config.budget.cycleActiveSeconds!==259200||config.budget.windowMaxSeconds!==14400)throw new Error('H original cycle budget identity changed');
 if(!h.frozenGuard||sha256File(h.frozenGuard)!==contract.guardSHA256||resolve(h.frozenGuard)!==resolve(contract.guardPath))throw new Error('H frozen worker guard changed');
 return {h,contract,preflight,review,out};
}

export function verifyWorkerLaunch(receiptPath){
 const launch=JSON.parse(readFileSync(receiptPath,'utf8'));
 if(!launch.configPath||sha256File(launch.configPath)!==launch.configSHA256)throw new Error('H launch config snapshot changed');
 const config=JSON.parse(readFileSync(launch.configPath,'utf8')),{h,contract,preflight,out}=verifyPrerequisites(config);
 if(dirname(resolve(receiptPath))!==out||!/^launch-[1-9][0-9]*\.json$/.test(resolve(receiptPath).split('/').at(-1)))throw new Error('H launch receipt outside its fixed output');
 const anchor=JSON.parse(readFileSync(resolve(config.repo,'lab/review6/H-fit.anchor.json'),'utf8'));
 if(anchor.cycleId!==config.cycleId||anchor.fitId!==contract.fitId||anchor.contractSHA256!==h.contractSHA256||anchor.outputDirectory!==out||launch.contractSHA256!==h.contractSHA256||launch.fitId!==contract.fitId||launch.outputDirectory!==out)throw new Error('H canonical once-only anchor mismatch');
 const budget=readBudget(config.handoff.budgetLedgerPath,config.cycleId),age=(Date.now()-Date.parse(launch.startedAt))/1000;
 if(budget.reservations[launch.taskId]!==preflight.requiredReservationSeconds||Object.keys(budget.reservations).length!==1||!Number.isFinite(age)||age<0||age>preflight.requiredReservationSeconds||!Number.isSafeInteger(launch.parentPid)||launch.parentPid<1)throw new Error('H live original budget reservation/parent launch missing');
 return {stageStatus:'H_worker_launch_authorized',parentPid:launch.parentPid,contractSHA256:h.contractSHA256,outputDirectory:out,trainerPath:h.frozenTrainer,manifestPath:h.featureManifest,networkSourcePath:h.frozenNetwork};
}

export function executeHumanFit(config,configPath){
 const {h,contract,preflight,out}=verifyPrerequisites(config);
 if(!configPath)throw new Error('H source config path required');
 mkdirSync(out,{recursive:true});
 const anchorPath=resolve(config.repo,'lab/review6/H-fit.anchor.json'),identity={cycleId:config.cycleId,fitId:contract.fitId,contractSHA256:h.contractSHA256,outputDirectory:out};
 if(existsSync(anchorPath)){const prior=JSON.parse(readFileSync(anchorPath,'utf8'));if(Object.entries(identity).some(([k,v])=>prior[k]!==v))throw new Error('this cycle already owns a different once-only H fit');}else writeNewJson(anchorPath,{...identity,at:new Date().toISOString()});
 const budget=readBudget(config.handoff.budgetLedgerPath,config.cycleId);
 if(Object.keys(budget.reservations).length)throw new Error('settle foreground engineering/heavy work before the H scientific reservation');
 let launch=1;while(existsSync(resolve(out,`launch-${launch}.json`)))launch++;
 const taskId=contract.fitId+':launch-'+launch,seconds=preflight.requiredReservationSeconds;
 if(!Number.isSafeInteger(seconds)||seconds<150||seconds>config.budget.windowMaxSeconds)throw new Error('invalid measured H reservation');
 reserveBudget(config.handoff.budgetLedgerPath,config.cycleId,taskId,seconds);
 const launchPath=resolve(out,`launch-${launch}.json`),configSnapshot=resolve(out,`launch-${launch}-config.json`);writeNewJson(configSnapshot,config);
 const args=[h.frozenTrainer,'fit','--contract',h.contractPath,'--manifest',h.featureManifest,'--network-source',h.frozenNetwork,'--output',out,'--launch-receipt',launchPath],started=Date.now(),stdoutPath=resolve(out,`launch-${launch}.stdout`),stderrPath=resolve(out,`launch-${launch}.stderr`);
 writeNewJson(launchPath,{...identity,taskId,startedAt:new Date(started).toISOString(),parentPid:process.pid,reservationSeconds:seconds,configPath:configSnapshot,configSHA256:sha256File(configSnapshot),sourceConfigPath:resolve(configPath),sourceConfigSHA256:sha256File(configPath),executable:config.runtime.pythonAbsolutePath,args,stdoutPath,stderrPath,sourceMode:'actual frozen source bytes, not HEAD or a working-tree fallback'});
 const stdout=openSync(stdoutPath,'wx'),stderr=openSync(stderrPath,'wx');let child;
 try{child=spawnSync(config.runtime.pythonAbsolutePath,args,{cwd:config.repo,stdio:['ignore',stdout,stderr],timeout:Math.floor(seconds/1.25-120)*1000,killSignal:'SIGTERM'});}finally{closeSync(stdout);closeSync(stderr);}
 const elapsed=(Date.now()-started)/1000;
 const settled=settleBudget(config.handoff.budgetLedgerPath,config.cycleId,taskId,elapsed);
 const result={...identity,taskId,elapsedSeconds:elapsed,pid:child.pid,exitCode:child.status,signal:child.signal,error:child.error?.message??null,budgetHeadHash:settled.headHash,stdoutPath,stderrPath};
 writeNewJson(resolve(out,`launch-${launch}-settlement.json`),result);
 if(child.status!==0)throw new Error('H fit failed or interrupted; preserve this run and inspect its actual checkpoint, never start a replacement fit');
 const quality=JSON.parse(readFileSync(resolve(out,'proxy-quality.json'),'utf8'));
 return {...result,stageStatus:'H_quality_measured',ready:quality.ready,qualityPath:resolve(out,'proxy-quality.json'),qualitySHA256:sha256File(resolve(out,'proxy-quality.json')),trainingUpdates:quality.trainingUpdates};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='verify-worker-launch'){
 try{process.stdout.write(JSON.stringify(verifyWorkerLaunch(process.argv[3]))+'\n');}catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',message:error.message})+'\n');process.exitCode=2;}
}
