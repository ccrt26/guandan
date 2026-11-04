/** Read-only classification of the known pre-meter world-cache failure.
 * Never edits a checkpoint, releases a reservation, or authorizes a Task.
 * Callers retain their original parent/Task/scientific-contract admission. */
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {digest} from './task-schema.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function original(path,hash,value){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>32*1024*1024||realpathSync(path)!==path)return false;const b=readFileSync(path);return sha(b)===hash&&equal(JSON.parse(b.toString('utf8')),value);}
export function knownUnsentWorldPreparationFailure(run,state,controlRoot,resolveReference){
 try{
  const t=run?.task,cp=run?.checkpoint,ledger=state.budgets?.[t?.budgetRef];
  if(!t||!cp||!ledger||!ledger.reservations||Array.isArray(ledger.reservations)||typeof ledger.reservations!=='object'||run.status!=='failed'||run.failureReason!=='invalid_value'||run.cleanupConfirmed!==true||run.executionUnknown===true||run.observationStatus==='unknown'||run.stopReason==='execution_uncertain'||ledger.activeRunId===run.runId)return false;
  if(run.actualScope?.apiCalls!==false||run.actualScope?.parameterUpdates!==false||run.actualScope?.deployment!==false||run.actualScope?.localExecution!==true||run.ownedCleanup!==null)return false;
  if(run.runId!==t.runId||state.tasks?.[t.taskId]!==run.runId||run.taskSHA256!==digest(t)||run.taskRef?.split(':').at(-1)!==run.taskSHA256||t.outputRoot!==join(controlRoot,'runs',run.runId))return false;
  if(!Array.isArray(run.committed)||run.committed.length||!Array.isArray(run.consumerArtifactRefs)||run.consumerArtifactRefs.length||Object.values(ledger.reservations??{}).some(r=>r.runId===run.runId))return false;
  if(cp.schema!=='ohuo-offline-label-run-v1'||cp.taskSHA256!==run.taskSHA256||cp.cursor!==0||!Array.isArray(cp.rows)||cp.rows.length||cp.executionUnknown!==true||cp.active?.phase!=='world-preparation'||cp.active.index!==0||cp.active.worldPreparation!==null)return false;
  if(!equal(t.datasetRefs,[cp.selectionRef])||digest(cp)!==run.checkpointSHA256||run.checkpointRef!==join(t.outputRoot,`checkpoint-${run.checkpointSHA256}.json`))return false;
  const read=ref=>{const v=resolveReference(ref);if(!v||digest(v)!==ref?.split(':').at(-1))throw Error('prequery_reference_identity');return v;};
  const contract=read(t.scientificContract?.decisionRuleRef),protocol=read(t.scientificContract?.analysisMethodRef),selection=read(cp.selectionRef);
  if(contract.schema!=='ohuo-common-view-teacher-contract-r2'||contract.protocolRef!==t.scientificContract.analysisMethodRef||contract.selectionRef!==cp.selectionRef||protocol.schema!=='ohuo-first-round-protocol-revision-v2'||protocol.protocolId!=='first-round-common-view-r2'||selection.schema!=='ohuo-offline-label-selection-v2')return false;
  const routing=read(contract.routingRef);if(routing.schema!=='ohuo-common-view-teacher-routing-r2'||routing.role!=='primary')return false;
  const rows=selection.rows.filter(r=>r.split===t.sourcePlan.split&&t.sourcePlan.familyIds.includes(r.blockFamilyId??r.familyId));
  if(!rows.length||rows[0].inputSHA256!==cp.active.inputSHA256)return false;
  return original(join(t.outputRoot,'task.json'),run.taskSHA256,t)&&original(run.checkpointRef,run.checkpointSHA256,cp);
 }catch{return false;}
}
