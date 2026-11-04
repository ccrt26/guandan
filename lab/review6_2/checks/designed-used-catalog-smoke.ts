/** Metadata fixture only: original fixed-host/commit readers, zero replay/model/provider calls. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {digest,referenceOf} from '../task-schema.mjs';
import * as api from '../offline-selection';
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
 function commit(id:string,rows:any[]){
  const spec={schema:'ohuo-offline-selection-spec-v1',planRef,clauseRef,branchRef:null,sourceIndexRef,queueRef,sourceRunRefs:[],targetDefinitionRef,selectionRuleRef,quotaBasisRef,purpose:'b_training_source',actingReleaseRef,outputId:id},specRef=ref('offline-selection-spec/'+id,spec),files:any[]=[];
  const write=(name:string,value:any,jsonl=false)=>{const path='lab/out/'+id+'/'+name,full=join(root,path),bytes=jsonl?value.map((v:any)=>JSON.stringify(v)+'\n').join(''):JSON.stringify(value)+'\n';mkdirSync(dirname(full),{recursive:true});writeFileSync(full,bytes,{mode:0o600});const f={path,sha256:sha(bytes)},entry={id:'offline-selection/'+id+'/'+name,file:f};files.push(entry);evidenceFiles.push(entry);return{id:entry.id,sha256:f.sha256};};
  write('spec.json',spec);const sourceInventoryRef=write('source-inventory.jsonl',[],true),populationRef=write('population.jsonl',rows,true),selectedMetadataRef=write('selected-metadata.jsonl',rows.map(r=>({...r,sampleKind:'demo'})),true),exclusionsRef=write('exclusions.jsonl',[],true);
  const production={schema:'ohuo-offline-selection-production-v1',specRef,sourceInventoryRef,populationRef,selectedMetadataRef,exclusionsRef,quotaBasisRef,selectionRuleRef,targetDefinitionRef,createdBeforeLabelEvidenceRef:freezeEvidenceRef,counts:{},verification:'incomplete'},productionRef=ref('offline-selection-production/'+id,production);write('production.json',production);
  const selection={schema:'ohuo-offline-label-selection-v2',sourceIndexRef,queueRef,purpose:'b_training_source',selectedCount:rows.length,quotas:[],rows,productionRef},selectionRef=ref('offline-label-selection/'+id,selection);write('selection.json',selection);
  evidence('offline-selection/'+id+'/manifest.json','lab/out/'+id+'/manifest.json',{schema:'ohuo-offline-selection-commit-v1',selectionRef,productionRef,specRef,files});return selectionRef;
 }
 const row=(i:number)=>({recordRef:{directory:join(root,'never-opened-record'),digest:sha('record')},recordRoot:join(root,'never-opened-record'),key:{controllerOrRunnerGeneration:1,matchId:'frozen-natural',gameNo:1,moveNo:i,actorSeat:0,requestSeq:i},inputSHA256:sha('input-'+i),familyId:'originalTrain',blockFamilyId:'originalTrain',split:'train',actorSeat:0});
 const save=()=>{const initialStateRef=ref('fixture-initial',{schemaVersion:1}),grantFile=file('unused-grant.json',{});file('deliverables/ohuo-runtime/host.json',{schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'fixture-root',initialStateRef,references,evidenceFiles,grantFile,planCloseoutFile:'unused-closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null});};
 return{root,index,commit,row,save,references,evidenceFiles};
}
const f=fixture();try{
 f.commit('frozen-unasked',Array.from({length:10},(_,i)=>f.row(i)));f.save();
 const used=await api.readUsedCommonSelectionRows(f.root);assert.equal(used.rows.length,10);assert.equal(used.admission,'not_admitted');assert(used.rows.every((x:any)=>x.sourceKind==='natural-recorded'));assert.equal(used.selectionRefs.length,1);
 const dropped=f.index('dropped',{originalTrain:{split:'train'}});f.save();await assert.rejects(api.verifyDesignedSourceIndexSuccessor(f.root,dropped),/designed_successor_drops_or_changes_original_family/);
 // Remove this deliberately bad candidate index so it is not a prior owner.
 f.references.splice(f.references.findIndex(x=>x.ref===dropped),1);
 const changed=f.index('changed',{originalTrain:{split:'train'},originalDev:{split:'train'}});f.save();await assert.rejects(api.verifyDesignedSourceIndexSuccessor(f.root,changed),/designed_successor_drops_or_changes_original_family/);
 f.references.splice(f.references.findIndex(x=>x.ref===changed),1);
 const next=f.index('successor',{originalTrain:{split:'train'},originalDev:{split:'dev'},newDesigned:{split:'train',rootFamilyId:'newDesigned',parentFamilyIds:[]}});f.save();const preserved=await api.verifyDesignedSourceIndexSuccessor(f.root,next);assert.equal(preserved.preservedFamilies,2);assert.equal(preserved.admission,'not_admitted');
 f.commit('same-key-mutated',[{...f.row(0),inputSHA256:sha('different-input')}]);f.save();await assert.rejects(api.readUsedCommonSelectionRows(f.root),/used_catalog_conflicting_key_input/);
}finally{rmSync(f.root,{recursive:true,force:true});}
const g=fixture();try{g.commit('omitted-manifest',[g.row(0)]);g.evidenceFiles.splice(g.evidenceFiles.findIndex(x=>x.id.endsWith('/manifest.json')),1);g.save();await assert.rejects(api.readUsedCommonSelectionRows(g.root),/used_catalog_selection_manifest_omitted/);}finally{rmSync(g.root,{recursive:true,force:true});}
console.log('PASS fixed-host catalog retains all ten unasked rows; rejects omitted manifest, conflicting input and prior dev loss; no model/provider/replay');
