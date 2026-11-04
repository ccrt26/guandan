/** Finite original source-family bytes/link test. Synthetic documents are not
 * original H authority. No provider, model, Task execution or host mutation. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical,referenceOf,validateTask} from '../task-schema.mjs';
import {reserveDesignedFamilies,verifyDesignedFamilyReservationLink} from '../designed-family-reservation';
import {verifyDesignedSourceInputs} from '../designed-source-consumer';
import {createDesignedConsumerFixture} from './designed-source-consumer-fixture';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-family-reservation']);
const f=createDesignedConsumerFixture(),sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex'),evidence=new Map<string,any>();
const ref=(id:string,v:any)=>{const r=referenceOf('synthetic-family/'+id,v);f.refs.set(r,v);return r;};
const save=(path:string,value:any)=>{const raw=canonical(value)+'\n';mkdirSync(dirname(join(f.dir,path)),{recursive:true});writeFileSync(join(f.dir,path),raw,{mode:0o600});return{path,sha256:sha(raw)};};
try{
 const naturalRoot='first-deal-family:'+'c'.repeat(64);
 const old={version:1,families:{[naturalRoot]:{split:'train'},'old-dev':{split:'dev'},'old-sealed':{split:'sealed'}}},oldFile=save('prior-index.json',old),oldRef=ref('old-index',{schema:'ohuo-source-index-ref-v1',namespace:'synthetic-design',fileSHA256:oldFile.sha256});
 const approvalRef=ref('coverage',{...f.refs.get(f.coverageApprovalRef),sourceIndexRef:oldRef}),comparisonRef=ref('comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef:f.task.parentPolicyRef,studentParentRef:f.fixed});
 const spec={schema:'ohuo-designed-family-reservation-spec-v1',planRef:f.task.planRef,clauseRef:f.fixed,branchRef:null,sourceIndexRef:oldRef,requestInventoryRef:f.inventoryRef,coverageApprovalRef:approvalRef,budgetRef:f.task.budgetRef,comparisonRef,protocolRef:f.fixed,families:[{designFamilyId:'design-family',rootFamilyId:naturalRoot,parentFamilyIds:[naturalRoot]}],outputId:'finite-first-family'},specRef=ref('spec',spec),inventory=f.refs.get(f.inventoryRef);
 const successor=reserveDesignedFamilies(old,spec,inventory);assert.deepEqual(successor.families[naturalRoot],{split:'train'});assert.deepEqual(successor.families['old-dev'],old.families['old-dev']);assert.deepEqual(successor.families['old-sealed'],old.families['old-sealed']);assert(!('design-family'in old.families));
 assert.throws(()=>reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'design-family',rootFamilyId:'missing-root',parentFamilyIds:['missing-root']}]},inventory),/family_split/);
 assert.throws(()=>reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'design-family',rootFamilyId:'old-dev',parentFamilyIds:['old-dev']}]},inventory),/nontrain_or_foreign_root/);
 assert.throws(()=>reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'design-family',rootFamilyId:naturalRoot,parentFamilyIds:[]}]},inventory),/family_edge/);
 assert.throws(()=>reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'design-family',rootFamilyId:naturalRoot,parentFamilyIds:['design-family']}]},inventory),/family_cycle/);
 assert.throws(()=>reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'other-family',rootFamilyId:'other-family',parentFamilyIds:[]}]},inventory),/inventory_family_scope/);
 const explicitRoot=reserveDesignedFamilies(old,{...spec,families:[{designFamilyId:'design-family',rootFamilyId:'design-family',parentFamilyIds:[]}]},inventory);assert.deepEqual(explicitRoot.families['design-family'],{split:'train',rootFamilyId:'design-family',parentFamilyIds:[]});
 const indexFile=save('source-successor/source-index.json',successor),indexValue={schema:'ohuo-source-index-ref-v1',namespace:'synthetic-design',fileSHA256:indexFile.sha256},indexRef=ref('new-index',indexValue),indexRefFile=save('source-successor/source-index-ref.json',indexValue);
 const files=[{id:'designed-family/'+spec.outputId+'/source-index.json',file:indexFile},{id:'designed-family/'+spec.outputId+'/source-index-ref.json',file:indexRefFile}];for(const row of files)evidence.set(row.id,row.file);
 const manifest={schema:'ohuo-designed-family-reservation-v1',specRef,planRef:spec.planRef,previousSourceIndexRef:oldRef,sourceIndexRef:indexRef,requestInventoryRef:spec.requestInventoryRef,coverageApprovalRef:approvalRef,budgetRef:spec.budgetRef,comparisonRef,families:spec.families,priorIndices:[{ref:oldRef,file:oldFile}],sourceIndexFile:indexFile,references:[{ref:indexRef,file:indexRefFile}],files},manifestFile=save('source-successor/manifest.json',manifest),reservationRef=ref('reservation',manifest);evidence.set('designed-family/'+spec.outputId+'/manifest.json',manifestFile);
 const contract={...f.refs.get(f.contractRef),coverageApprovalRef:approvalRef,sourceIndexRef:indexRef},contractRef=ref('new-contract',contract),task=validateTask({...f.task,sourcePlan:{...f.task.sourcePlan,sourceIndexRef:indexRef},scientificContract:{...f.task.scientificContract,decisionRuleRef:contractRef,comparisonRef}}),args={task,contract,repositoryRoot:f.dir,references:f.refs,evidenceFiles:evidence,sourceIndexPath:join(f.dir,indexFile.path)};
 assert.equal(verifyDesignedFamilyReservationLink(args).reservationRef,reservationRef);
 const prepared=verifyDesignedSourceInputs({task,refs:f.refs,inputs:{...f.inputs,sourceIdentity:indexRef,sourceIndexPath:args.sourceIndexPath,designerRepositoryRoot:f.dir,designerEvidenceFiles:evidence}});assert.equal(prepared.requests.length,1);assert.equal((prepared as any).familyReservation.reservationRef,reservationRef);
 const without=new Map(f.refs);without.delete(reservationRef);assert.throws(()=>verifyDesignedFamilyReservationLink({...args,references:without}),/unique_original_producer/);
 const duplicate=new Map(f.refs);duplicate.set(referenceOf('synthetic-alias',manifest),manifest);assert.throws(()=>verifyDesignedFamilyReservationLink({...args,references:duplicate}),/unique_original_producer/);
 assert.throws(()=>verifyDesignedFamilyReservationLink({...args,task:{...task,scientificContract:{...task.scientificContract,comparisonRef:f.fixed}}}),/producer_binding/);
 const bytes=readFileSync(join(f.dir,oldFile.path));writeFileSync(join(f.dir,oldFile.path),canonical({...old,families:{...old.families,'old-dev':{split:'train'}}})+'\n');assert.throws(()=>verifyDesignedFamilyReservationLink(args),/file_hash/);writeFileSync(join(f.dir,oldFile.path),bytes);
 const changed=structuredClone(successor);delete changed.families['old-dev'];writeFileSync(args.sourceIndexPath,canonical(changed)+'\n');assert.throws(()=>verifyDesignedFamilyReservationLink(args),/file_hash/);
 console.log(JSON.stringify({caseId:'source.designed-family-reservation',status:'passed',implicitNaturalRootPreserved:true,explicitNewRootRequired:true,devCycleMissingParentRejected:true,actualCommittedFilesRead:true,exactOldApprovalToNewTaskLink:true,originalConsumerVerifier:true,tamperedMissingDuplicateProducerRejected:true,providerRequests:0,modelLoads:0,scientificRuns:0,originalHAuthority:false,hostCatalogMutations:0}));
}finally{rmSync(f.dir,{recursive:true,force:true});}
