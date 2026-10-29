import{readFileSync,realpathSync,existsSync}from'node:fs';import{resolve}from'node:path';import{fileURLToPath}from'node:url';import{readBudget,sha256File}from'./runtime.mjs';import{verifyExecutableSnapshot}from'./executable-snapshot.mjs';
// Task authority is fixed to this original workspace/cycle. A self-supplied
// contract, shadow ledger or copied receipt cannot establish a new authority.
export const R6_REPO='/Users/ccrt/game/guandan';
export const R6_CYCLE='review6-humanlike-20261028';
export const R6_LEDGER=R6_REPO+'/lab/review6/budget-ledger.jsonl';
export const R6_LEASE=R6_REPO+'/lab/review6/active-compute-lease.json';
const BASE=R6_REPO+'/lab/review6_1/teacher-pilot-001';
export const R6_INITIAL_ENTRY='66d45addaf0531a072e76b807e19a7e8bb7a681aa7dd3e809cf25fef8b72b337';
export function assertOriginalGenesis(anchor,first){if(anchor.cycleId!==R6_CYCLE||anchor.ledgerPath!==R6_LEDGER||anchor.initialEntryHash!==R6_INITIAL_ENTRY||first.entryHash!==R6_INITIAL_ENTRY)throw Error('original budget genesis changed');}
export function verifyOriginalBudget(){const anchor=JSON.parse(readFileSync(R6_REPO+'/lab/review6/cycle-anchor.json')),first=JSON.parse(readFileSync(R6_LEDGER,'utf8').split('\n')[0]);assertOriginalGenesis(anchor,first);return readBudget(R6_LEDGER,R6_CYCLE);}

export function canonicalPilotShape(contract,launch,launchPath){
 let task,reservation,output;
 if(contract.schemaVersion==='r6-pilot-source-contract-v1'){task='C3-pilot-source-generation-001';reservation=600;output=BASE+'/source-results-001';if(resolve(launchPath)!==R6_REPO+'/lab/review6_1/receipts/c3-pilot-source-execution-001.json')throw Error('noncanonical source launch receipt');}
 else if(contract.mode==='speed'){task='C3-pilot-speed-execution-001';reservation=300;output=BASE+'/speed-results-001';}
 else if(contract.mode==='inference-proof'&&contract.executionOrdinal===1&&contract.workers===2){task='C3-exact-inference-proof-execution-001';reservation=600;output=BASE+'/inference-proof-results-001';}
 else if(contract.mode==='mature'&&contract.executionOrdinal===1&&contract.workers===4){task='C3-mature-pilot-execution-001';reservation=7200;output=BASE+'/mature-results-001';}
 else if(contract.mode==='variance'&&[1,2].includes(contract.executionOrdinal)&&contract.workers===4){task='C3-variance-pilot-execution-'+String(contract.executionOrdinal).padStart(3,'0');reservation=3000;output=BASE+'/variance-results-001';}
 else if(contract.mode==='teacher-root'&&Number.isInteger(contract.slot)&&contract.slot>=1&&contract.slot<=48&&Number.isInteger(contract.executionOrdinal)&&contract.executionOrdinal>=1&&contract.executionOrdinal<=999){task='C3-teacher-pilot-root-'+String(contract.slot).padStart(2,'0')+'-execution-'+String(contract.executionOrdinal).padStart(3,'0');reservation=3600;output=BASE+'/root-results/root-'+String(contract.slot).padStart(2,'0');if(contract.pilotOpenedLedger!==BASE+'/teacher-opened.jsonl')throw Error('noncanonical pilot root ledger');}
 else throw Error('unregistered pilot task shape');
 if(contract.mode==='mature'&&launch.ownedProcessGroup!==true)throw Error('mature ownedprocessgroup required');
 if(contract.schemaVersion!=='r6-pilot-source-contract-v1'&&resolve(launchPath)!==R6_REPO+'/lab/review6_1/receipts/'+task.toLowerCase()+'.json')throw Error('noncanonical official launch receipt');
 if(contract.originalRepo!==R6_REPO||launch.cycleId!==R6_CYCLE||launch.canonicalBudgetLedger!==R6_LEDGER||launch.taskId!==task||launch.reservationSeconds!==reservation||contract.outputDirectory!==output)throw Error('canonical original cycle/task/reservation/output mismatch');return{taskId:task,reservationSeconds:reservation};
}
export function verifyFrozenLaunch({entryURL,contractPath,contractSHA,launchPath,launchSHA}){
 if(!contractPath||!launchPath||sha256File(contractPath)!==contractSHA||sha256File(launchPath)!==launchSHA)throw Error('verified canonical frozen launch required');const contract=JSON.parse(readFileSync(contractPath)),launch=JSON.parse(readFileSync(launchPath));const shape=canonicalPilotShape(contract,launch,launchPath);
 if(launch.parentPID!==process.ppid||launch.contractSHA256!==contractSHA||launch.contractPath!==contractPath||launch.snapshotManifestSHA256!==contract.snapshotManifestSHA256)throw Error('official parent/contract/snapshot mismatch');
 if(!existsSync(R6_LEASE))throw Error('canonical active compute lease missing');const lease=JSON.parse(readFileSync(R6_LEASE));if(lease.taskId!==shape.taskId||lease.parentPID!==process.ppid||lease.launchPath!==launchPath||lease.launchSHA256!==launchSHA||lease.contractSHA256!==contractSHA||lease.snapshotManifestSHA256!==contract.snapshotManifestSHA256)throw Error('canonical active lease identity mismatch');
 const anchor=JSON.parse(readFileSync(R6_REPO+'/lab/review6/cycle-anchor.json')),budget=verifyOriginalBudget();if(anchor.cycleId!==R6_CYCLE||anchor.ledgerPath!==R6_LEDGER||budget.limitSeconds!==259200||budget.reservations[shape.taskId]!==shape.reservationSeconds||sha256File(R6_REPO+'/lab/review6/cycle-anchor.json')!==lease.cycleAnchorSHA256)throw Error('original cycle anchor/reservation changed');
 const snapshot=verifyExecutableSnapshot(contract.snapshotManifestPath,contract.snapshotManifestSHA256);if(snapshot.sourceRoot!==R6_REPO||snapshot.entryPath!==fileURLToPath(entryURL)||realpathSync(fileURLToPath(entryURL))!==fileURLToPath(entryURL))throw Error('official frozen entry/source authority mismatch');
 return{contract,launch,snapshot,shape,launchIdentity:{entryURL,contractPath,contractSHA,launchPath,launchSHA}};
}
