/** Fixed B05 synthetic selectors only. No arbitrary command, API, real weights,
 * full match or server. B00's sole registry owner maps these selectors. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const ai='packages/ai/tests/decide-b05.test.ts',controller='packages/web/tests/controller-b05.test.ts';
const cases={
 'pending-once':{files:[ai,controller],pattern:'pending_once|real controller pending',count:2},
 'failure-once':{files:[ai,controller],pattern:'failure_once|local override|profile conflict',count:4},
 'cancel-late':{files:[ai,controller],pattern:'cancel_late|missing schema2 execution marker|lost ownership cancels',count:4},
 'execution-uncertain':{files:[ai,controller],pattern:'execution_uncertain',count:2},
 'restore-refs':{files:[controller,'packages/web/tests/seats-b05.test.ts'],pattern:'four frozen seats|missing referenced policy|registered same-shape|default O tiers|recorder identity',count:5},
 'seat-config':{files:[controller,'packages/web/tests/seats-b05.test.ts','packages/web/tests/seat-ui-b05.test.ts','packages/web/tests/record-seats-b05.test.ts'],pattern:'four seats reject|private profile|configured all-AI returns|four-seat UI|replay labels|AI-only record',count:6},
 'proxy-boundary':{files:[ai,'packages/web/tests/play-route-b05.test.ts'],pattern:'same-origin route|route abort|browser propagates|browser lost|missing receipt',count:5},
};
// Applied to Vitest's node API as Vite InlineConfig, not a loaded config-file field.
export const controllerViteOverrides = Object.freeze({envFile:false,envPrefix:[]});
export const controllerChildEnv = () => ({PATH:process.env.PATH||'',LANG:'C.UTF-8',TZ:'UTC'});
export function runControllerCase(caseId){
 const config=cases[caseId];if(!config)throw Error('unsupported_case');
 const apiCode=`import {startVitest} from 'vitest/node';
const {files,pattern,overrides}=JSON.parse(process.argv[1]);
const ctx=await startVitest('test',files,{root:process.cwd(),config:'vitest.config.ts',run:true,watch:false,reporters:['json'],testNamePattern:pattern},overrides);
if(!ctx)process.exitCode=1;`;
 const argv=['--input-type=module','--eval',apiCode,JSON.stringify({files:config.files,pattern:config.pattern,overrides:controllerViteOverrides})];
 const run=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',shell:false,timeout:60000,maxBuffer:4*1024*1024,env:controllerChildEnv()});
 if(run.error)throw run.error;
 let evidence;try{evidence=JSON.parse(run.stdout);}catch{throw Error(`invalid_test_receipt: ${run.stderr.slice(-500)}`);}
 const actual=evidence.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='passed').map(test=>test.fullName));
 if(run.status!==0||!evidence.success||actual.length!==config.count)throw Error(JSON.stringify({expected:config.count,actual:actual.length,failed:evidence.numFailedTests,stderr:run.stderr.slice(-500),failures:evidence.testResults.flatMap(f=>f.assertionResults.filter(t=>t.status==='failed').map(t=>({name:t.fullName,messages:t.failureMessages})))}));
 return {input:'fixed synthetic seeds1234 and4242 / zero weights / fake transport only',argv,expectedPassed:config.count,actualPassed:actual.length,assertions:actual};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--case'||!Object.hasOwn(cases,args[1])){console.error('exactly one known --case required');process.exitCode=1;}
 else {const startedAt=new Date().toISOString();try{const actual=runControllerCase(args[1]);console.log(JSON.stringify({batchId:'B05',caseId:args[1],status:'passed',startedAt,endedAt:new Date().toISOString(),entrySHA256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),actual}));}catch(error){console.error(JSON.stringify({batchId:'B05',caseId:args[1],status:'failed',startedAt,error:String(error)}));process.exitCode=1;}}
}
