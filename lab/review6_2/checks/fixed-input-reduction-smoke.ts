// Actual FixedHostFiles input methods with a synthetic, in-memory catalog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import {join,relative,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {FixedHostFiles,HOST_SOURCE_FILES,FIRST_ROUND_SOURCE_FILES} from '../ohuo-host-files';
import {digest} from '../task-schema.mjs';
const root=resolve('.'),out=fs.realpathSync(fs.mkdtempSync(join(root,'lab/out/v542-fixed-input-'))),repo=join(out,'repository');
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),file=(path:string,bytes:string)=>{fs.mkdirSync(dirname(path),{recursive:true});fs.writeFileSync(path,bytes,{mode:0o600});return {path:relative(root,path),sha256:hash(bytes)};};
fs.mkdirSync(join(repo,'lab/out/control'),{recursive:true});
file(join(repo,'deliverables/ohuo-runtime/host.json'),JSON.stringify({schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'synthetic-input-smoke',initialStateRef:'initial@sha256:'+'a'.repeat(64),references:[],evidenceFiles:[],grantFile:{path:'grant.json',sha256:'b'.repeat(64)},planCloseoutFile:'closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null}));
const host:any=new FixedHostFiles(repo);
// No actual host/state/private configuration is used. Only workspace package
// resolution must point at the real repository for the production verifier.
Object.defineProperty(host,'repositoryRoot',{value:root});
const watchedFile=file(join(out,'fixed-source.ts'),'export const fixture=1;'),watched=join(root,watchedFile.path);
const source={baseCommit:'1'.repeat(40),files:[...new Set([...HOST_SOURCE_FILES,...FIRST_ROUND_SOURCE_FILES])].map(path=>({path,sha256:hash(fs.readFileSync(join(root,path)))})).concat(watchedFile)};
const task:any={taskId:'fixture',taskKind:'evaluate',sourceRevision:'source',capabilityRef:'cap',runtimeRef:'runtime',releaseRefs:[],sourcePlan:{namespace:'fixture',sourceIndexRef:'index',familyIds:['f'],split:'fixture'},scientificContract:{decisionRuleRef:'rule'}};
const index=file(join(out,'index.json'),JSON.stringify({version:1,families:{f:{split:'fixture'}}}));
const refs=new Map<string,any>([['source',source],['cap',{id:'B07.complete-match.v1'}],['rule',{}],['runtime',{node:process.version,platform:process.platform,arch:process.arch,tsx:createRequire(import.meta.url)('tsx/package.json').version,python:null}],['index',{schema:'ohuo-source-index-ref-v1',namespace:'fixture',fileSHA256:index.sha256}]]);
let authorized=true,grants=0;const bind=(t:any)=>{const taskRef='fixture@sha256:'+digest(t);host.bindings=new Map([[taskRef,{sourceIndexFile:index,confirmedRecordRoots:[],studentReleaseFiles:[],datasetDirectory:null,seed:null,trainingPhase:null,numericalRestartReceiptRef:null}]]);host.readGrant=()=>{grants++;if(!authorized)throw Error('fixture dynamic authority closed');return {tasks:[{taskRef}]};};};
host.resolveRef=(ref:string)=>refs.get(ref);host.checkExistingRoot=()=>({});host.firstRoundPilotContext=()=>null;host.commonViewTaskProtocol=()=>null;bind(task);
const read=fs.readFileSync;let reads=0;
fs.readFileSync=function(path:any,...args:any[]){if(String(path)===watched)reads++;return (read as any).call(this,path,...args);} as any;syncBuiltinESMExports();
try{
 if(process.argv.at(-1)==='producer'){
  const old={...source,files:source.files.map(f=>f.path===watchedFile.path?{...f,sha256:'0'.repeat(64)}:f)},catalog=new Map([['old',old],['current',source]]);host.references=catalog;host.resolveRef=(ref:string)=>catalog.get(ref);
  assert.equal(host.currentProducerSource(),'current');assert.equal(reads,1,'one lookup must read/hash a shared source path once');
  assert.equal(host.currentProducerSource(),'current');assert.equal(reads,2,'a new lookup must cold-read');
  catalog.set('duplicate',{...source,baseCommit:'2'.repeat(40)});assert.throws(()=>host.currentProducerSource(),/one fixed actual full producer/);catalog.delete('duplicate');
  catalog.set('illegal',{...source,files:[...source.files,source.files[0]]});assert.throws(()=>host.currentProducerSource(),/duplicate source/);catalog.delete('illegal');
  catalog.delete('current');assert.throws(()=>host.currentProducerSource(),/one fixed actual full producer/);
  console.log(JSON.stringify({status:'passed',sameLookupSourceReads:1,newLookupCold:true,multipleNoneAndIllegalRejected:true}));
 }else{
  const first=await host.verifyInputs(task,refs),second=await host.verifyInputs(task,refs);assert.equal(first.sourceIdentity,second.sourceIdentity);assert.equal(first.sourceIndexPath,second.sourceIndexPath);
  assert.equal(reads,1,'the two actual verifyInputs boundaries must reuse unchanged fixed source bytes');assert.equal(grants,2,'dynamic authority must be rechecked');
  const runtime=refs.get('runtime');refs.set('runtime',{...runtime,node:'changed'});await assert.rejects(host.verifyInputs(task,refs),/actual Node\/platform\/tsx differ/);refs.set('runtime',runtime);
  authorized=false;await assert.rejects(host.verifyInputs(task,refs),/dynamic authority closed/);authorized=true;
  const other={...task,taskId:'other'};bind(other);await host.verifyInputs(other,refs);assert.equal(reads,2,'another task must cold-read');
  fs.writeFileSync(watched,'export const fixture=2;');await assert.rejects(host.verifyInputs(other,refs),/frozen file bytes changed/);assert.equal(reads,3);
  fs.writeFileSync(watched,'export const fixture=1;');await host.verifyInputs(other,refs);assert.equal(reads,4);
  const replacement=join(out,'replacement.ts');fs.writeFileSync(replacement,'export const fixture=1;');fs.renameSync(replacement,watched);await host.verifyInputs(other,refs);assert.equal(reads,5,'inode replacement must invalidate');
  const target=join(out,'real-source.ts');fs.renameSync(watched,target);fs.symlinkSync(target,watched);await assert.rejects(host.verifyInputs(other,refs),/nonsymlink/);
  fs.unlinkSync(watched);fs.renameSync(target,watched);
  const cold:any=new FixedHostFiles(repo);Object.defineProperty(cold,'repositoryRoot',{value:root});for(const name of ['bindings','readGrant','resolveRef','checkExistingRoot','firstRoundPilotContext','commonViewTaskProtocol'])cold[name]=host[name];const beforeCold=reads;await cold.verifyInputs(other,refs);assert.equal(reads,beforeCold+1,'another H instance must cold-read');
  console.log(JSON.stringify({status:'passed',sameTaskSourceReads:1,authorityCheckedEveryBoundary:true,taskEditReplacementAndSymlinkInvalidation:true,privateProfileReads:0}));
 }
}finally{fs.readFileSync=read;syncBuiltinESMExports();fs.rmSync(out,{recursive:true,force:true});}
