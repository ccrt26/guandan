/** One fixed read-only B08 acceptance of already stored engineering events.
 * No engine/model/private record/Task/worker/API or statistics call. */
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readB07PublicRecord,sha256} from '../paired-summary';
import {digest} from '../task-schema.mjs';
const INPUT='deliverables/ohuo-batches/B08/stored-parity-input.json';
const paths={accepted:'deliverables/ohuo-batches/B07/accepted-code.json',result:'deliverables/ohuo-batches/B08/evidence/original-B07-parity-result.json',summary:'deliverables/ohuo-batches/B08/evidence/original-B07-parity-summary.json',parityInput:'deliverables/ohuo-batches/B07/parity-input.json'};
function exactKeys(x:any,keys:string[]){assert(x&&typeof x==='object'&&!Array.isArray(x));assert.deepEqual(Object.keys(x).sort(),keys.slice().sort());}
export function checkStoredParity(root:string){
 root=realpathSync(root);const observed=new Map<string,string>();
 const read=(name:string,expected?:string)=>{
  assert(!isAbsolute(name)&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'bounded relative public path required');
  const full=resolve(root,name);assert(!relative(root,full).startsWith('..'));
  let at=root;for(const component of name.split('/')){at=join(at,component);assert(!lstatSync(at).isSymbolicLink(),'public input symlink');}
  assert(lstatSync(full).isFile(),'public regular file required');const b=readFileSync(full),h=sha256(b);if(expected!==undefined)assert.equal(h,expected,'public input SHA mismatch');observed.set(name,h);return b;
 };
 const input=JSON.parse(read(INPUT).toString());exactKeys(input,Object.keys(paths));
 const sources:any={};for(const [key,name]of Object.entries(paths)){const ref=input[key];exactKeys(ref,['path','sha256']);assert.equal(ref.path,name);assert.match(ref.sha256,/^[a-f0-9]{64}$/);sources[key]=JSON.parse(read(name,ref.sha256).toString());}
 const {accepted,result,summary,parityInput}=sources;
 assert.equal(accepted.kind,'functional-acceptance');assert.equal(accepted.batchId,'B07');assert.equal(accepted.functionalStatus,'accepted');assert.equal(accepted.revision,3);
 assert.equal(result.caseId,'sync-async-parity');assert.equal(result.status,'passed');assert.equal(summary.kind,'finite-engineering-sync-async-parity-summary');assert.equal(summary.status,'passed');assert.equal(result.actual.canonicalSequenceAndTerminalEqual,true);assert.deepEqual(result.actual.invokedPaths,['sync','async']);assert.equal(summary.canonicalSequenceAndTerminalEqual,true);
 assert.equal(result.inputRef.sha256,input.parityInput.sha256);assert.equal(result.inputRef.path,paths.parityInput);
 const p=parityInput.payload;assert(p);assert.equal(p.runId,summary.runId);assert.equal(summary.payloadSHA256,digest(p));assert.equal(p.runId,'B07-parity-20261031-M-d1625909');assert.equal(p.row.matchId,'B07-fixed-parity-match');
 assert.equal(result.recordRefs.length,2);assert.equal(summary.journalMetadataOnly.length,2);
 const sourceRef=`${p.sourceNamespace}@sha256:${p.sourceRef.sha256}`,layoutRef=`${p.row.layoutId}@sha256:${digest(p.row)}`;
 const results=[];
 for(const [i,role]of ['sync','async'].entries()){
  const rootRel=`lab/out/B07-parity/${p.runId}/${role}`,dirRel=`${rootRel}/matches/${p.row.matchId}`,ref=result.recordRefs[i];exactKeys(ref,['directory','identitySHA256','journalBytes','journalSHA256']);
  // Original Mac record location must be the actual current repository, not a relocated copy.
  assert.equal(resolve(ref.directory),resolve(root,dirRel),'original record directory differs from this repository');
  const idName=dirRel+'/identity.json',journalName=dirRel+'/events.jsonl';const id=JSON.parse(read(idName,ref.identitySHA256).toString()),journal=read(journalName,ref.journalSHA256);assert.equal(journal.length,ref.journalBytes);
  assert.equal(id.runId,p.runId);assert.equal(id.matchId,p.row.matchId);assert.equal(id.sourceRef,sourceRef);assert.equal(id.layoutRef,layoutRef);assert.deepEqual(id.policyIds,p.policies.map((q:any)=>q.identity.policyId));assert.deepEqual(id.seatSnapshots,p.policies.map((q:any)=>({policyIdentity:q.identity})));assert.deepEqual(id.rules,p.rules);
  const original=result.actual[role];assert.deepEqual(summary[role],original);assert.equal(original.complete,true);assert.equal(original.incompleteReason,null);assert.equal(original.games,10);assert.equal(original.decisions,977);assert.equal(original.winner,0);
  const a=readB07PublicRecord(resolve(root,rootRel),{runId:p.runId,queueRef:layoutRef},{matchId:p.row.matchId,recordRef:ref,result:original});
  assert.equal(a.recordVerified,true,a.issues.join(','));assert.deepEqual(a.issues,[]);assert.equal(a.complete,true);assert.equal(a.winner,original.winner);assert.equal(a.incompleteReason,null);assert.equal(a.wallMs,null);
  assert.deepEqual(a.actualRoundFamilies,p.row.roundFamilyIds.slice(0,original.games));assert.equal(a.actualRoundFamilies.length,original.games);assert(a.decisions);
  assert.equal(a.decisions.length,original.decisions);assert(a.decisions.every(d=>d.executionKind==='confirmed'&&d.status!=='pending'));
  const requests=a.decisions.flatMap(d=>d.requests);assert(requests.every(r=>r.requestCount!==null));const count=requests.reduce((n,r)=>n+r.requestCount!,0);assert.equal(count,0);
  const meta=summary.journalMetadataOnly[i];assert.equal(meta.path,journalName);assert.equal(meta.sha256,ref.journalSHA256);assert.equal(meta.bytes,ref.journalBytes);assert.equal(meta.games,original.games);assert.equal(meta.confirmedActions,original.decisions);assert.equal(meta.recordedProviderRequests,0);assert.deepEqual(meta.terminal,{complete:a.complete,winner:a.winner,incompleteReason:a.incompleteReason});
  results.push({role,identitySHA256:ref.identitySHA256,journalSHA256:ref.journalSHA256,games:a.actualRoundFamilies.length,confirmedActions:a.decisions.length,complete:a.complete,winner:a.winner,recordedProviderRequests:count,wholeTaskWallMs:a.wallMs});
 }
 const before=[...observed].map(([path,sha256])=>({path,sha256}));for(const f of before)read(f.path,f.sha256);
 return {caseId:'stored-parity-readback',status:'passed',scope:'already-stored-engineering-events-not-research',results,inputFiles:before,sourceInputsUnchanged:true,scientificQualification:null,newMatches:0,modelForwards:0,apiCalls:0,privateInputsRead:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.deepEqual(process.argv.slice(2),['--case','stored-parity-readback'],'only fixed case allowed');
 console.log(JSON.stringify(checkStoredParity(fileURLToPath(new URL('../../../',import.meta.url)))));
}
