import {beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../review6_2/task-schema.mjs';

// Keep the real consumer/checkpoint/summary control flow. The host registration
// seam only exposes its consumer; model and match execution are forbidden here.
const seams=vi.hoisted(()=>({badRecord:false}));
vi.mock('../review6_2/task-control.mjs',()=>({createTaskController:(options:any)=>options}));
vi.mock('../review6_2/first-round-parent',async original=>({...await original<any>(),resolveFirstRoundParent:async()=>{throw Error('synthetic parent read failed before match');}}));
vi.mock('../review6_2/match-record',async original=>({...await original<any>(),loadMatchStore:()=>{if(seams.badRecord)throw Error('synthetic prior record invalid');return {};}}));
vi.mock('node:worker_threads',()=>({Worker:class {constructor(){throw Error('match execution forbidden');}}}));
vi.mock('../review6_2/match-play-async',()=>({runCompleteMatchAsync:async()=>{throw Error('match execution forbidden');}}));
import {createMatchTaskHost} from '../review6_2/match-consumer';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const zero=()=>({providerRequests:0,labelDecisions:0,optimizerSteps:0,matchAttempts:0});
beforeEach(()=>{seams.badRecord=false;});
function fixture(prior=false){
 const root=mkdtempSync(join(tmpdir(),'v543-match-boundary-')),sourceIndexPath=join(root,'index.json');writeFileSync(sourceIndexPath,'{}');
 const task:any={runId:'fixture',taskId:'fixture',outputRoot:root,seatLayoutPlan:'queue',limits:{},sourcePlan:{sourceIndexRef:'source'}};
 const rows=[0,1].map(i=>({matchId:'match-'+i,sourceFamilyId:'family-'+i,split:'train',actor:0,seats:[],runtimeSeats:[]}));
 const past={matchId:'match-0',recordRef:{directory:join(root,'record-0')},result:{complete:true}};
 const cp:any={schema:'ohuo-match-run-v1',taskSHA256:digest(task),queueRef:'queue',cursor:prior?1:0,active:null,matches:prior?[past]:[],executionUnknown:false};
 const consumption={confirmed:zero(),reserved:zero(),reservedUnknown:zero(),released:zero()};if(prior)consumption.confirmed.matchAttempts=1;
 let saved:any=null,reserves=0;const control=new AbortController();
 const host:any=createMatchTaskHost({root,adapter:{},policyRepositoryRoot:root}),consumer=host.consumers[0];
 const ctx:any={task,signal:control.signal,checkpoint:prior?cp:null,checkpointSequence:prior?3:0,executionId:'fixture',deadlineMonotonicMs:performance.now()+60000,
  executionInputs:{rows,rules:{},sourceIndexPath,sourceIndexSHA256:sha('{}'),sourceIndex:{}},
  reserve:async()=>{reserves++;consumption.reserved.matchAttempts++;throw Error('synthetic reservation acknowledgement lost');},
  settleReservation:async()=>{throw Error('settlement forbidden');},getConsumption:()=>structuredClone(consumption),saveCheckpoint:async(value:any)=>{saved=structuredClone(value);}
 };
 return {root,sourceIndexPath,task,cp,ctx,control,consumption,run:()=>consumer.run(ctx),saved:()=>saved,reserves:()=>reserves};
}
// Reverting the catch to unconditional executionUnknown=true breaks both known
// failure cases. No model forward, game, teacher request or update is executed.
it('keeps a model-load failure before the first match known and uncharged',async()=>{
 const f=fixture();f.ctx.executionInputs.firstRound={studentParentRef:'fixed',envelope:{},readEvidence:()=>Buffer.alloc(0)};
 await expect(f.run()).rejects.toThrow('synthetic parent read failed before match');
 expect(f.saved().executionUnknown).toBe(false);expect(f.saved().active).toBeNull();expect(f.saved().cursor).toBe(0);expect(f.reserves()).toBe(0);
 expect(f.consumption.confirmed.matchAttempts).toBe(0);expect(JSON.parse(readFileSync(join(f.root,'summary.json'),'utf8')).executionUnknown).toBe(false);
});
it('preserves a completed match when the next source check fails and can revisit its confirmed boundary',async()=>{
 const f=fixture(true);writeFileSync(f.sourceIndexPath,'changed');
 await expect(f.run()).rejects.toThrow('source index changed after freeze');
 expect(f.saved().executionUnknown).toBe(false);expect(f.saved().cursor).toBe(1);expect(f.saved().matches).toEqual(f.cp.matches);expect(f.reserves()).toBe(0);
 writeFileSync(f.sourceIndexPath,'{}');f.ctx.checkpoint=f.saved();f.ctx.checkpointSequence=4;f.control.abort('user_stop');
 const result=await f.run();expect(result.completed).toBe(false);expect(result.stopReason).toBe('user_stop');expect(f.reserves()).toBe(0);expect(f.consumption.confirmed.matchAttempts).toBe(1);
});
it('does not clear an unacknowledged reservation merely because no active match was saved',async()=>{
 const f=fixture();await expect(f.run()).rejects.toThrow('synthetic reservation acknowledgement lost');
 expect(f.saved().executionUnknown).toBe(true);expect(f.saved().cursor).toBe(0);expect(f.reserves()).toBe(1);expect(f.consumption.reserved.matchAttempts).toBe(1);
});
it('does not turn an invalid prior record into a verified recovery boundary',async()=>{
 const f=fixture(true);seams.badRecord=true;await expect(f.run()).rejects.toThrow('synthetic prior record invalid');
 expect(f.saved().executionUnknown).toBe(true);expect(f.saved().matches).toEqual(f.cp.matches);expect(f.reserves()).toBe(0);
});
it('retains a previously unknown checkpoint and never starts another match',async()=>{
 const f=fixture(true);f.ctx.checkpoint.executionUnknown=true;await expect(f.run()).rejects.toThrow('execution_uncertain');
 expect(f.saved().executionUnknown).toBe(true);expect(f.reserves()).toBe(0);
});
