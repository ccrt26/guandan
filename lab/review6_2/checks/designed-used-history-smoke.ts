/** Metadata fixture only: original fixed-host/commit readers, zero replay/model/provider calls. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {digest,referenceOf} from '../task-schema.mjs';
import * as api from '../offline-selection';
import {FIRST_ROUND_TARGET_DEFINITION} from '../first-round-target';
assert.equal(typeof api.readUsedCommonSelectionRows,'function','missing status-independent original catalog row seam');
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'designed-used-catalog-'))),references:any[]=[],evidenceFiles:any[]=[],objects=new Map<string,any>();
 mkdirSync(join(root,'lab/out/control'),{recursive:true});
 const file=(path:string,value:any)=>{const full=join(root,path),bytes=JSON.stringify(value)+'\n';mkdirSync(dirname(full),{recursive:true});writeFileSync(full,bytes,{mode:0o600});return {path,sha256:sha(bytes)};};
 const ref=(id:string,value:any)=>{const r=referenceOf(id,value);if(!objects.has(r)){objects.set(r,value);references.push({ref:r,file:file('refs/'+sha(r)+'.json',value)});}return r;};
 const evidence=(id:string,path:string,value:any)=>{const f=file(path,value);evidenceFiles.push({id,file:f});return{id,sha256:f.sha256};};
 file('lab/out/control/state.json',{schemaVersion:1,tasks:{},runs:{}});
 const planRef=ref('fixture-plan',{id:'fixture-plan'}),clauseRef=ref('fixture-clause',{id:'fixture-clause'}),actingReleaseRef=ref('fixture-acting',{id:'fixture-acting'}),targetDefinitionRef=ref('fixture-target',{id:'fixture-target'}),selectionRuleRef=ref('fixture-rule',{schema:'ohuo-offline-selection-common-view-r2'});
 const index=(id:string,families:any)=>{const f=evidence('index/'+id,'indexes/'+id+'.json',{version:1,families});return ref('index/'+id,{schema:'ohuo-source-index-ref-v1',namespace:id,fileSHA256:f.sha256});};
 const sourceIndexRef=index('original',{originalTrain:{split:'train'},originalDev:{split:'dev'}}),queueRef=ref('fixture-queue',{id:'fixture-queue'}),quotaBasisRef=evidence('fixture-quota','quota.json',{}),freezeEvidenceRef=evidence('fixture-freeze','freeze.json',{});
 function commit(id:string,rows:any[],override:any={},usedSnapshot?:()=>any){
  const spec={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs:[],targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:id,...override},specRef=ref('offline-selection-spec/'+id,spec),files:any[]=[],usedCatalog=usedSnapshot?.();
  const write=(name:string,value:any,jsonl=false)=>{const path='lab/out/'+id+'/'+name,full=join(root,path),bytes=jsonl?value.map((v:any)=>JSON.stringify(v)+'\n').join(''):JSON.stringify(value)+'\n';mkdirSync(dirname(full),{recursive:true});writeFileSync(full,bytes,{mode:0o600});const f={path,sha256:sha(bytes)},entry={id:'offline-selection/'+id+'/'+name,file:f};files.push(entry);evidenceFiles.push(entry);return{id:entry.id,sha256:f.sha256};};
  write('spec.json',spec);const sourceInventoryRef=write('source-inventory.jsonl',[],true),populationRef=write('population.jsonl',rows,true),selectedMetadataRef=write('selected-metadata.jsonl',rows.map(r=>({...r,sampleKind:'demo'})),true),exclusionsRef=write('exclusions.jsonl',[],true);
  const usedCatalogRef=usedCatalog?write('used-catalog.json',usedCatalog):null;
  const production={schema:'ohuo-offline-selection-production-v1',...(usedCatalogRef?{usedCatalogRef}:{}),specRef,sourceInventoryRef,populationRef,selectedMetadataRef,exclusionsRef,quotaBasisRef,selectionRuleRef:spec.selectionRuleRef,targetDefinitionRef:spec.targetDefinitionRef,createdBeforeLabelEvidenceRef:freezeEvidenceRef,counts:{},verification:'incomplete'},productionRef=ref('offline-selection-production/'+id,production);write('production.json',production);
  const selection={schema:'ohuo-offline-label-selection-v2',sourceIndexRef:spec.sourceIndexRef,queueRef:spec.queueRef,purpose:'b_training_source',selectedCount:rows.length,quotas:[],rows,productionRef},selectionRef=ref('offline-label-selection/'+id,selection);write('selection.json',selection);
  evidence('offline-selection/'+id+'/manifest.json','lab/out/'+id+'/manifest.json',{schema:'ohuo-offline-selection-commit-v1',selectionRef,productionRef,specRef,files});return selectionRef;
 }
 const row=(i:number)=>({recordRef:{directory:join(root,'never-opened-record'),digest:sha('record')},recordRoot:join(root,'never-opened-record'),key:{controllerOrRunnerGeneration:1,matchId:'frozen-natural',gameNo:1,moveNo:i,actorSeat:0,requestSeq:i},inputSHA256:sha('input-'+i),familyId:'originalTrain',blockFamilyId:'originalTrain',split:'train',actorSeat:0});
 const save=()=>{const initialStateRef=ref('fixture-initial',{schemaVersion:1}),grantFile=file('unused-grant.json',{});file('deliverables/ohuo-runtime/host.json',{schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'fixture-root',initialStateRef,references,evidenceFiles,grantFile,planCloseoutFile:'unused-closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null});};
 return{root,index,commit,row,save,references,evidenceFiles,ref,file,evidence,planRef,clauseRef,actingReleaseRef,sourceIndexRef};
}

const f=fixture();try{
 const old=f.commit('old-frozen-natural',Array.from({length:10},(_,i)=>f.row(i)));
 const controlStateRef=f.evidence('frozen-state','frozen-state.json',{schemaVersion:1,tasks:{},runs:{}});
 const protocolRef=f.ref('protocol',{schema:'ohuo-first-round-protocol-revision-v2',protocolId:'first-round-common-view-r2'}),comparisonRef=f.ref('comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef:f.actingReleaseRef,studentParentRef:f.ref('student',{fixtureOnly:true})}),targetDefinitionRef=f.ref('real-target-definition',FIRST_ROUND_TARGET_DEFINITION),budgetRef=f.ref('budget',{fixtureOnly:true});
 const sourceRef=f.ref('designed-registration',{schema:'ohuo-designed-source-registration-v1',sourceIndexRef:f.sourceIndexRef,comparisonRef});
 const queueRef=f.ref('designed-queue',{schema:'ohuo-designed-source-queue-v1',namespace:'original',sourceIndexRef:f.sourceIndexRef,rows:[{sourceKind:'designed-synthetic',sourceRef}]});
 const selectionRuleRef=f.ref('designed-rule',{schema:api.DESIGNED_SELECTION_RULE_SCHEMA,protocolRef,comparisonRef,targetDefinitionRef,sourceKind:'designed-synthetic',split:'train',representativeRule:'one-hash-representative-per-root-public-cell',usedRule:'all-original-host-committed-selections',ordinaryKeepRule:'existing-natural-train-pool-disjoint-causal-context'});
 const designedContractRef=f.ref('designed-contract',{schema:'ohuo-designed-source-consumer-contract-v1',planRef:f.planRef,clauseRef:f.clauseRef,branchRef:null,budgetRef,protocolRef,comparisonRef,sourceIndexRef:f.sourceIndexRef,queueRef,selectionRuleRef,targetDefinitionRef,plannedTasks:[{role:'teacher',taskId:'future-teacher',runId:'future-teacher',experimentId:'future-teacher'}]});
 const natural=f.row(100),{recordRoot,recordRef,...core}=natural,row={...core,sourceKind:'designed-synthetic',sourceRef,questionId:'new-designed'};
 const designed=f.commit('new-designed',[row],{schema:api.DESIGNED_SELECTION_SPEC_SCHEMA,designedContractRef,selectionRuleRef,targetDefinitionRef,queueRef},()=>{f.save();const hostManifest=JSON.parse(readFileSync(join(f.root,'deliverables/ohuo-runtime/host.json'),'utf8'));return{schema:'ohuo-designed-used-catalog-v1',hostManifest,hostSHA256:digest(hostManifest),controlStateRef};});f.save();
 assert.deepEqual((await api.readUsedCommonSelectionRowsAtCommit(f.root,designed)).selectionRefs,[old]);
 f.commit('later-natural',[f.row(200)]);f.index('later-index',{originalTrain:{split:'train'},originalDev:{split:'dev'},futureFamily:{split:'dev'}});f.save();
 const historical=await api.readUsedCommonSelectionRowsAtCommit(f.root,designed);assert.equal(historical.rows.length,10);assert.deepEqual(historical.selectionRefs,[old]);assert.equal((await api.readUsedCommonSelectionRows(f.root)).rows.length,12);
 // A later addition is harmless; changing a historical mapping is not.
 const mapping=f.evidenceFiles.find(x=>x.id==='frozen-state');mapping.file={...mapping.file,path:'alternate-frozen-state.json'};f.file(mapping.file.path,{schemaVersion:1,tasks:{},runs:{}});f.save();
 await assert.rejects(api.readUsedCommonSelectionRowsAtCommit(f.root,designed),/designed_used_catalog_original_mapping_changed/);
}finally{rmSync(f.root,{recursive:true,force:true});}
console.log('PASS original designed commit fixes ten-row used denominator; later selection/index additions do not rewrite it; changed old mapping rejected; no model/replay/provider');
