#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeBudget, readBudget, sha256File, verifyFiles, writeNewJson, deriveRunState } from './runtime.mjs';

const repositoryRoot=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));

const contracts = {
  inspect:['config'], backup:['config'], 'verify-baseline':['config'], selftest:['synthetic-only'],
  'handoff-inspect':['config','protocol','out'], 'checkpoint-request':['run-manifest','reason','wait-seconds'],
  'verify-product':['config','scope'], 'verify-data':['config'], 'train-human-proxy':['config'],
  'verify-teacher':['config','pilot-roots'], pilot:['config'], 'collect-roots':['config','protocol','round','from-round','to-round'],
  freeze:['config','out'], 'prepare-capability':['protocol','config','phase','attempt','out-dir','plan'],
  'build-teacher-data':['protocol','round'], 'verify-learning':['protocol','updates'],
  'train-window':['protocol','round','window-seconds'], status:['config','protocol'],
  'evaluate-dev':['protocol','round'], 'decide-next':['protocol','round'],
  'extract-plan-tails':['protocol','from-round','to-round'], 'freeze-round':['protocol','round'],
  'lock-candidate':['protocol','round','attempt','capability-lock','out'], confirm:['protocol','candidate','attempt'],
  report:['config','protocol'], 'verify-delivery':['config','protocol'],
  'capability-export':['config','protocol','scope','checkpoint','out-dir'],
};
function fail(message, resultCode='invalid_input') {
  process.stderr.write(JSON.stringify({ stageStatus:resultCode==='not_implemented'?'not_implemented':'blocked', resultCode, message })+'\n');
  process.exitCode=2;
}
function parse(argv) {
  const command=argv.shift();
  if (!contracts[command]) throw new Error('unknown command');
  const options={};
  for (let i=0;i<argv.length;i++) {
    const key=argv[i].slice(2);
    if (!argv[i].startsWith('--') || !contracts[command].includes(key)) throw new Error('unknown option '+argv[i]);
    if (Object.hasOwn(options,key)) throw new Error('duplicate option '+key);
    if (key==='synthetic-only') {options[key]=true;continue;}
    if (!argv[i+1] || argv[i+1].startsWith('--')) throw new Error('empty option '+key);
    options[key]=argv[++i];
  }
  for (const key of ['round','from-round','to-round','attempt','updates','pilot-roots','window-seconds','wait-seconds']) {
    if (options[key]!==undefined && (!/^\d+$/.test(options[key]) || !Number.isSafeInteger(Number(options[key])) || Number(options[key])<1)) throw new Error(key+' must be a finite positive integer');
  }
  if (options['window-seconds'] && Number(options['window-seconds'])>14400) throw new Error('window exceeds original limit');
  if (options.config && options.protocol && command!=='prepare-capability') throw new Error('config/protocol are mutually exclusive');
  if (['train-window','build-teacher-data','verify-learning','evaluate-dev','decide-next','extract-plan-tails','freeze-round','lock-candidate','confirm'].includes(command) && !options.protocol) throw new Error('production command requires protocol');
  return {command,options};
}
function configAt(path) {
  if (!path) throw new Error('config is required');
  const config=JSON.parse(readFileSync(path,'utf8'));
  if (config.cycleId!=='review6-humanlike-20261028' || realpathSync(config.repo)!==repositoryRoot) throw new Error('invalid cycle/repo');
  if (resolve(config.handoff.budgetLedgerPath)!==resolve(repositoryRoot,'lab/review6/budget-ledger.jsonl') && realpathSync(resolve(config.handoff.budgetLedgerPath,'..'))!==realpathSync(resolve(repositoryRoot,'lab/review6'))) throw new Error('budget ledger must use canonical cycle path');
  // Compare the filename too: a second file in the same parent must not reset this cycle.
  if (resolve(config.handoff.budgetLedgerPath).split('/').at(-1)!=='budget-ledger.jsonl') throw new Error('budget ledger must use canonical cycle path');
  if (!Number.isFinite(config.budget.cycleActiveSeconds) || config.budget.cycleActiveSeconds!==259200 || config.budget.windowMaxSeconds!==14400) throw new Error('invalid original budget');
  return config;
}
function inspect(config, initialize=false) {
  const baseline=JSON.parse(readFileSync(config.handoff.baselinePath,'utf8'));
  const sourceChanges=baseline.files.flatMap(file=>{
    const currentHash=existsSync(file.path)?sha256File(file.path):null;
    return currentHash===file.sha256?[]:[{path:file.path,baselineHash:file.sha256,currentHash}];
  });
  const ledger=resolve(repositoryRoot,'lab/review6/budget-ledger.jsonl');
  const anchorPath=resolve(repositoryRoot,'lab/review6/cycle-anchor.json');
  const state=deriveRunState(resolve(repositoryRoot,'lab/review6/state-index.json'),config.cycleId);
  if (config.handoff.inheritedRunState) {
    for (const key of ['round','absoluteUpdate','confirmationAttemptsOpened','checkpointManifestPath']) {
      if (config.handoff.inheritedRunState[key]!==state[key]) throw new Error('draft/authoritative run state mismatch: '+key);
    }
  }
  const anchor=existsSync(anchorPath)?JSON.parse(readFileSync(anchorPath,'utf8')):null;
  if (anchor && (anchor.cycleId!==config.cycleId || anchor.ledgerPath!==ledger)) throw new Error('cycle anchor identity mismatch');
  if (anchor && !existsSync(ledger)) throw new Error('anchored budget ledger missing; refuse reinitialization');
  let budget=null;
  if (initialize) {
    if (!existsSync(ledger)) {
      const absence=JSON.parse(readFileSync(config.handoff.cycleAbsenceReceipt,'utf8'));
      if (absence.cycleId!==config.cycleId || absence.previousCycleFound!==false) throw new Error('cannot initialize without cycle absence audit');
    }
    budget=initializeBudget(ledger,config.cycleId,config.budget.cycleActiveSeconds,config.handoff.initialConservativeSeconds);
    if (!anchor) writeNewJson(anchorPath,{cycleId:config.cycleId,ledgerPath:ledger,initialEntryHash:JSON.parse(readFileSync(ledger,'utf8').split('\n')[0]).entryHash,absenceReceiptHash:sha256File(config.handoff.cycleAbsenceReceipt),createdAt:new Date().toISOString()});
  } else if (existsSync(ledger)) budget=readBudget(ledger,config.cycleId);
  else throw new Error('budget ledger missing; original inspect required');
  if (anchor && JSON.parse(readFileSync(ledger,'utf8').split('\n')[0]).entryHash!==anchor.initialEntryHash) throw new Error('budget anchor head changed');
  return {schemaVersion:'review6-handoff-v1',cycleId:config.cycleId,stageStatus:'completed',
    resultCode:'identity_inventory_only',at:new Date().toISOString(),requestedModel:'gpt-6.1-sol',reasoningEffort:'xhigh',
    observedExecutor:config.handoff.observedExecutor,repoRealPath:config.repo,
    baseline, sourceChanges, budget, baseProtocolHash:config.handoff.baseProtocolHash,
    inheritedRunState:state,singleWriterReceipt:config.handoff.singleWriterReceipt,
    nextStage:'C0_independent_reviews',capabilityMeasured:false};
}
try {
  const argv=process.argv.slice(2);
  if (argv.length===1 && argv[0]==='--help') {
    process.stdout.write('REVIEW6 strict thin entry. Implemented: inspect, handoff-inspect (draft), backup (existing C0 backup readback), verify-baseline, status (draft), selftest, verify-product (facts-review-ui), verify-data (structural audit), train-human-proxy (frozen once-only fit with prerequisites), capability-export (config + product scope, aggregation only). Other listed interfaces return not_implemented.\n');
    for (const [name,flags] of Object.entries(contracts)) process.stdout.write(name+' '+flags.map(x=>'--'+x).join(' ')+'\n');
  } else {
    const {command,options}=parse(argv);
    if (command==='selftest') {
      if (!options['synthetic-only']) throw new Error('selftest requires --synthetic-only');
      const r=spawnSync(process.execPath,['--test',new URL('./runtime.test.mjs',import.meta.url).pathname],{stdio:'inherit'});
      process.exitCode=r.status??2;
    } else if (['inspect','handoff-inspect','verify-baseline','backup','status'].includes(command) && options.config) {
      const config=configAt(options.config);
      const result=inspect(config,command==='inspect');
      if (command==='backup' || command==='verify-baseline') {
        const manifest=JSON.parse(readFileSync(config.handoff.backupManifestPath,'utf8'));
        verifyFiles(manifest.files.map(x=>({path:resolve(config.handoff.backupDirectory,x.path),sha256:x.sha256})));
        result.backupReadback={files:manifest.files.length,manifestHash:sha256File(config.handoff.backupManifestPath),allFilesHashVerified:true};
        result.resultCode=command==='backup'?'existing_backup_readback_reused':'baseline_backup_verified_working_drift_reported';
        if(command==='verify-baseline'&&result.sourceChanges.some(file=>file.path.includes('/packages/ai/src/')||file.path.includes('/packages/engine/src/')||file.path.includes('/packages/web/public/ai/')||file.path.endsWith('/game/controller.ts')||file.path.endsWith('/game/exchange.ts')))throw new Error('playing-policy source changed; requires explicit new complete identity');
      }
      if (command==='handoff-inspect') {
        if (!options.out) throw new Error('handoff-inspect requires out');
        writeNewJson(options.out,result);
      }
      process.stdout.write(JSON.stringify(result,null,2)+'\n');
    } else if(command==='verify-product'&&options.config) {
      configAt(options.config);
      if(options.scope!=='facts-review-ui')throw new Error('verify-product requires scope facts-review-ui');
      const child=spawnSync(process.execPath,['--import','tsx',new URL('./product-cli.ts',import.meta.url).pathname,resolve(options.config)],{stdio:'inherit',cwd:repositoryRoot});
      process.exitCode=child.status??2;
    } else if(command==='verify-data'&&options.config){
      configAt(options.config);
      const child=spawnSync(process.execPath,['--import','tsx',new URL('./data-cli.ts',import.meta.url).pathname,resolve(options.config)],{stdio:'inherit',cwd:repositoryRoot});
      process.exitCode=child.status??2;
    } else if(command==='train-human-proxy'&&options.config){
      const config=configAt(options.config);
      if(!config.data?.humanFit)throw new Error('frozen H fit contract required');
      const h=config.data.humanFit;
      if(!h.frozenGuard||sha256File(h.frozenGuard)!==h.guardSHA256)throw new Error('frozen H launch guard required');
      const {executeHumanFit}=await import(pathToFileURL(resolve(h.frozenGuard)).href);
      process.stdout.write(JSON.stringify(executeHumanFit(config,resolve(options.config)),null,2)+'\n');
    } else if(command==='capability-export'&&options.config){
      configAt(options.config);
      if(options.scope!=='product'||!options['out-dir']||options.protocol||options.checkpoint)throw new Error('product export requires config, scope product and out-dir only');
      const child=spawnSync(process.execPath,['--import','tsx',new URL('./product-export.ts',import.meta.url).pathname,resolve(options.config),resolve(options['out-dir'])],{stdio:'inherit',cwd:repositoryRoot});
      process.exitCode=child.status??2;
    } else fail('actual business path is not implemented: '+command,'not_implemented');
  }
} catch(error) { fail(error.message); }
