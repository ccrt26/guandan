import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createMatch,startGame,DEFAULT_RULES,legalCombos,canPass,applyMove,type GameState} from '@gd/engine';
import {PublicTracker,encodeStudentInput399Plus24} from '../../packages/ai/src/nn/schema';
import {buildPublicHighCardMemory} from '../../packages/ai/src/nn/publicMemory';
import {STUDENT_SCORER_ENCODER} from '../../packages/ai/src/policy/descriptor';
import {dedupCandidates} from '../../packages/ai/src/nn/neuralSeat';
import {createDecisionBundle} from '../../packages/ai/src/hybrid/candidates';
import {FIRST_TARGET_CANDIDATE_POLICY as policy} from '../../packages/ai/src/candidate-spec';
import {captureStudent423InitialCandidates} from '../../packages/ai/src/hybrid/student';
import {captureInitialCandidateInputs,captureStudentCandidateInputs} from '../review6_2/match-record';

// Count the real full encoder, preserving its validations and numerical work.
vi.mock('../../packages/ai/src/nn/schema',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../packages/ai/src/nn/schema')>();
 return {...actual,encodeStudentInput399Plus24:vi.fn(actual.encodeStudentInput399Plus24)};
});
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
const identity={policyId:'synthetic-B',inputDim:399,encoderVersion:'gd-lab-schema-v4'} as any;
const scorer={schema:'ohuo-student-scorer-v1',policyId:'synthetic-S0',modelVersion:'fixture',architectureId:'mlp-tanh-256x256-scalar-v1',weightsLayoutVersion:'f32le-layer-w-row-major-then-b-v1',parameterCount:174593,inputDim:423,weightsPathOrUrl:{nodePath:'lab/out/synthetic-not-read.f32'},weightsSHA256:'1'.repeat(64),encoder:STUDENT_SCORER_ENCODER,tieBreakId:'first-candidate-v1'} as const;
function fixture(follow=false){
 const state=startGame(createMatch({...DEFAULT_RULES},43));state.turn=state.leader=state.lastPlayer=0;
 const tracker=new PublicTracker(),steps:any[]=[];
 if(follow){const high=legalCombos(state).find(c=>c.kind==='single'&&[11,12,13].includes(c.cards[0].rank));if(!high)throw Error('synthetic high-card fixture required');const events=applyMove(state,{pass:false,combo:high});steps.push({priorTarget:null,events});tracker.observe(events);}
 const key={controllerOrRunnerGeneration:'fixture',matchId:'fixture',gameNo:1,moveNo:state.moveNo,actorSeat:state.turn,requestSeq:state.moveNo};
 const decider={seat:state.turn,tracker,decide:(s:GameState)=>{const rows=dedupCandidates(legalCombos(s,policy.enumSpec.enumerationMode),canPass(s));return {move:rows[0].combo?{pass:false as const,combo:rows[0].combo}:{pass:true as const},nCands:rows.length,explored:false,candidatePolicy:policy,ranking:rows.map((r,idx)=>({combo:r.combo,idx,score:rows.length-idx}))};}};
 const bundle=createDecisionBundle({state,actorSeat:state.turn,key,decisionId:'fixture-'+state.moveNo,matchId:'fixture',history:{matchId:'fixture',gameNo:1,throughMoveNo:state.moveNo,steps},decider,candidatePolicy:policy});
 const candidateInputs=captureInitialCandidateInputs({bundle,state,tracker,encoder,policyIdentity:identity});
 // Deterministic synthetic scores; no learning, source generation or real weights.
 const network={inputDim:423,forward:vi.fn((x:Float32Array,n:number)=>Float32Array.from({length:n},(_,i)=>x[i*423+395]))} as any;
 const student={studentParentRef:'fixture@sha256:'+'2'.repeat(64),scorer,network};
 return {state,tracker,bundle,candidateInputs,student};
}
beforeEach(()=>vi.clearAllMocks());

it.each([false,true])('preserves all float32 rows, order, scores and serialized identity with one full encoding (follow=%s)',follow=>{
 const f=fixture(follow),obs=f.bundle.observation;
 const memory=buildPublicHighCardMemory({matchId:obs.matchId,gameNo:obs.gameNo,throughMoveNo:obs.moveNo,steps:obs.publicPrefix},{matchId:f.bundle.key.matchId,gameNo:f.bundle.key.gameNo},obs.effectiveLevelRanks);
 // Unmodified public encoder is the differential oracle for the removed loop.
 const rows=f.bundle.initialCandidateIds.map(id=>[...encodeStudentInput399Plus24(f.state,f.tracker,f.bundle.pool.find(c=>c.actionId===id)!.canonical,f.bundle.key,memory)]);
 const expected=captureStudent423InitialCandidates(f.bundle,{schema:'ohuo-student-candidate-input-v1',studentParentRef:f.student.studentParentRef,scorer,inputDim:423,inputContract:STUDENT_SCORER_ENCODER,candidatePolicy:policy,candidateIds:[...f.bundle.initialCandidateIds],candidateFeatures:rows,publicHighCardMemory:memory},f.student.network);
 vi.mocked(encodeStudentInput399Plus24).mockClear();f.student.network.forward.mockClear();
 const actual=captureStudentCandidateInputs(f);
 expect(actual.candidateIds.length).toBeGreaterThan(1);expect(actual).toEqual(expected);
 expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
 const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');expect(sha(actual)).toBe(sha(expected));
 expect(encodeStudentInput399Plus24).toHaveBeenCalledTimes(1);expect(f.student.network.forward).toHaveBeenCalledTimes(1);
 if(follow){const pass=f.bundle.pool.find(c=>c.canonical===null)!.actionId;expect(actual.baseActionId).toBe(pass);expect(actual.candidateFeatures[actual.candidateIds.indexOf(pass)][395]).toBe(1);expect(actual.candidateFeatures[0].slice(399).some(value=>value>0)).toBe(true);}
});

it('rejects changed state, stale decision identity, missing candidate and either later legacy segment corruption',()=>{
 for(const fault of ['state','key','mapping','stateFeature','actionFeature'] as const){
  const f=fixture();
  if(fault==='state')f.state.hands[f.state.turn].pop();
  if(fault==='key'){f.bundle=structuredClone(f.bundle);f.bundle.key={...f.bundle.key,moveNo:f.bundle.key.moveNo+1};}
  if(fault==='mapping'){f.bundle=structuredClone(f.bundle);f.bundle.pool=f.bundle.pool.filter(c=>c.actionId!==f.bundle.initialCandidateIds[1]);}
  if(fault==='stateFeature')f.candidateInputs.candidateFeatures[1][0]+=.25;
  if(fault==='actionFeature')f.candidateInputs.candidateFeatures[1][395]=1;
  expect(()=>captureStudentCandidateInputs(f),fault).toThrow();
  expect(f.student.network.forward).not.toHaveBeenCalled();
 }
});

it('does not reuse a previous call after state or candidate capture changes',()=>{
 const f=fixture();captureStudentCandidateInputs(f);f.state.hands[f.state.turn].pop();
 expect(()=>captureStudentCandidateInputs(f)).toThrow(/legacy segment/);
 expect(encodeStudentInput399Plus24).toHaveBeenCalledTimes(2);
});
