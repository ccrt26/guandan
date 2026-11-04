/** Finite offline diagnostic fixture. Import actual designer/meter/consumer;
 * injected fetch rejects locally. No provider, host authority or old run mutation. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,lstatSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createProfileDesigner,prepareDesignedSourceRequest} from '../designed-source-request.ts';
import {createDesignedSourceConsumer} from '../designed-source-consumer.ts';
import {createDesignedConsumerFixture} from './designed-source-consumer-fixture.ts';
import {buildCommonTeacherView} from '../first-round-common-view.ts';
import {PROJECT_RULES_TEACHER_WIRE_SCHEMA,PROJECT_RULES_TEACHER_PROMPT_ID,PROJECT_RULES_TEACHER_SYSTEM_SHA256} from '../../../packages/web/server/llm-project-rules-v541.mjs';
import {createProfileTextTransport,createProfileSelector} from '../../../packages/web/server/llm-select.mjs';
assert.deepEqual(process.argv.slice(2),['--case','source.designer-transport-diagnostic']);
const f=createDesignedConsumerFixture(),input=prepareDesignedSourceRequest(f.requestSpec),secret='MUST_NOT_RETAIN_SECRET_URL_BODY',signal=()=>new AbortController().signal;
let invocations=0;
const options=fetchImpl=>({store:f.profileStore,reference:f.reference,fetchImpl});
const reject=error=>async()=>{invocations++;throw error;};
const fail=error=>createProfileDesigner(options(reject(error))).request(input,signal());
const error=(code)=>Object.assign(new TypeError(secret),{code,cause:Object.assign(new Error(secret),{code})});
try {
 for(const code of ['ENOTFOUND','EPERM','ECONNRESET','UND_ERR_CONNECT_TIMEOUT']){
  const r=await fail(error(code));
  assert.equal(r.reason,'transport_failed');assert.equal(r.status,'remote_failure');assert.equal(r.summary.requestCount,1);
  assert.deepEqual(r.privateTransportDiagnostic,{phase:'fetch_await',errorClass:'TypeError',errorCode:code,causeCodes:[code]});
  assert(!JSON.stringify(r).includes(secret));assert(!('httpStatus' in r.summary));assert(!('privateTransportDiagnostic' in r.summary));
 }
 const hostile=error(secret);hostile.name=secret;hostile.stack=secret;hostile.cause.name=secret;hostile.toJSON=()=>{throw Error('must not serialize thrown errors');};
 const unknown=await fail(hostile);assert.deepEqual(unknown.privateTransportDiagnostic,{phase:'fetch_await',errorClass:'unknown',errorCode:'unknown',causeCodes:['unknown']});assert(!JSON.stringify(unknown).includes(secret));
 let getterReads=0;const getters=Object.create(null);for(const k of ['name','code','cause','message','stack'])Object.defineProperty(getters,k,{get(){getterReads++;throw Error(secret);}});
 const accessorResult=await fail(getters);assert.equal(getterReads,0);assert.deepEqual(accessorResult.privateTransportDiagnostic,{phase:'fetch_await',errorClass:'unknown',errorCode:'unknown',causeCodes:[]});
 const proxy=await fail(new Proxy({},{get(){throw Error(secret);},getOwnPropertyDescriptor(){throw Error(secret);},getPrototypeOf(){throw Error(secret);}}));assert.equal(proxy.reason,'transport_failed');assert.equal(proxy.privateTransportDiagnostic.errorCode,'unknown');
 // A Proxy trap must not run: even descriptor reads can abort and change status.
 for(const retain of [false,true]){
  let trapCalls=0;const controller=new AbortController(),trap=()=>{trapCalls++;controller.abort('proxy_side_effect');throw Error(secret);};
  const proxy=new Proxy({},{get:trap,getOwnPropertyDescriptor:trap,getPrototypeOf:trap});
  const r=await createProfileTextTransport(options(reject(proxy)),{prepare:()=>({view:{},body:'{}'}),parse:()=>({}),retainPrivateTransportDiagnostic:retain}).request({},controller.signal);
  assert.equal(r.status,'remote_failure','proxy must not change failure boundary');assert.equal(r.reason,'transport_failed');assert.equal(r.summary.requestCount,1);assert.equal(trapCalls,0);assert.equal(controller.signal.aborted,false);
  if(retain)assert.equal(r.privateTransportDiagnostic.errorCode,'unknown');else assert(!('privateTransportDiagnostic' in r));
 }
 const nativeShape=await fail(new TypeError('fetch failed',{cause:Object.assign(new Error(secret),{code:'ENOTFOUND'})}));
 assert.deepEqual(nativeShape.privateTransportDiagnostic,{phase:'fetch_await',errorClass:'TypeError',errorCode:'unknown',causeCodes:['ENOTFOUND']});
 const cycle=error('ECONNRESET');cycle.cause=cycle;assert.deepEqual((await fail(cycle)).privateTransportDiagnostic.causeCodes,Array(4).fill('ECONNRESET'));
 let deep=Object.assign(new Error(secret),{code:'EPERM'});for(let i=0;i<20;i++)deep=Object.assign(new Error(secret),{code:'ENOTFOUND',cause:deep});assert.deepEqual((await fail(deep)).privateTransportDiagnostic.causeCodes,Array(4).fill('ENOTFOUND'));
 const sync=await createProfileDesigner(options(()=>{invocations++;throw error('EPERM');})).request(input,signal());assert.equal(sync.reason,'request_internal_error');assert.equal(sync.summary.requestCount,1);assert.equal(sync.privateTransportDiagnostic.phase,'fetch_invoke');assert.equal(sync.privateTransportDiagnostic.errorCode,'EPERM');
 const cancelled=new AbortController();cancelled.abort('user_stop');const n=invocations,c=await createProfileDesigner(options(reject(error('EPERM')))).request(input,cancelled.signal);assert.equal(c.status,'cancelled');assert.equal(c.summary.requestCount,0);assert.equal(invocations,n);assert(!('privateTransportDiagnostic' in c));
 const during=new AbortController(),pending=createProfileDesigner(options(async()=>{invocations++;during.abort('user_stop');throw error('ECONNRESET');}));const stopped=await pending.request(input,during.signal);assert.equal(stopped.status,'cancelled');assert.equal(stopped.summary.requestCount,1);assert(!('privateTransportDiagnostic' in stopped));
 const basic={prepare:()=>({view:{},body:'{}'}),parse:()=>({})};
 const shared=await createProfileTextTransport(options(reject(error('ENOTFOUND'))),basic).request({},signal());assert.equal(shared.reason,'transport_failed');assert(!('privateTransportDiagnostic' in shared));
 // Profile/task payload cannot opt the shared transport into private diagnostics.
 const untrustedStore={resolve:ref=>({...f.profileStore.resolve(ref),retainPrivateTransportDiagnostic:true})};
 const untrusted=await createProfileTextTransport({...options(reject(error('EPERM'))),store:untrustedStore},basic).request({retainPrivateTransportDiagnostic:true},signal());assert(!('privateTransportDiagnostic' in untrusted));
 const pass=Array(423).fill(0);pass[1]=2;pass[108]=1;pass[162]=1;pass[165]=1;pass[175]=2/41;pass[176]=1/10;pass[312]=3/12;pass[320]=1;pass[330]=1;for(let i=0;i<3;i++)pass[177+3*i]=(i+1)/27;for(let i=0;i<9;i++)pass[186+14*i+13]=1;pass[395]=1;
 const view=buildCommonTeacherView([{actionId:'a-pass',input423:pass,equivalenceKey:'pass'}],{inputDim:423,passEncoding:'action64'}),teacherInput={schema:PROJECT_RULES_TEACHER_WIRE_SCHEMA,promptId:PROJECT_RULES_TEACHER_PROMPT_ID,systemPromptSHA256:PROJECT_RULES_TEACHER_SYSTEM_SHA256,ruleOptions:f.requestSpec.ruleOptions,decisionId:'diagnostic-teacher',modelPayloadBytes:view.modelPayloadBytes,addressMap:view.addressMap};
 const selector=await createProfileSelector(options(reject(error('EPERM')))).request(teacherInput,signal());assert.equal(selector.reason,'transport_failed');assert.equal(selector.summary.requestCount,1);assert(!('privateTransportDiagnostic' in selector));
 // Real consumer -> meter -> designer -> immutable private file, with public exclusion.
 const consumer=createDesignedSourceConsumer({profileStore:f.profileStore,fetchImpl:reject(error('ENOTFOUND'))}),prepared=await consumer.prepare({task:f.task,refs:f.refs,inputs:f.inputs});
 mkdirSync(f.task.outputRoot,{recursive:true});let checkpoint=null,sequence=0;const reservations=[],settled=[];
 const ctx={task:f.task,checkpoint:null,checkpointSequence:0,executionId:'diagnostic-fixture',executionInputs:prepared,signal:signal(),executionBoundary:{mode:'input-workload-only',resourcePolicyRef:f.fixed},reserve:async(key,cost)=>{reservations.push({key,cost});return key;},settleReservation:async(key,value)=>{settled.push({key,value});},saveCheckpoint:async(cp,next)=>{assert.equal(next,++sequence);assert(consumer.validateCheckpoint(cp));checkpoint=structuredClone(cp);},getConsumption:()=>({syntheticOnly:true})};
 const terminal=await consumer.run(ctx);assert.equal(terminal.completed,true);assert.equal(checkpoint.rows[0].status,'remote_failure');assert.equal(checkpoint.rows[0].reason,'transport_failed');assert.equal(checkpoint.rows[0].requestCount,1);assert.equal(settled[0].value.disposition,'consumed');assert.deepEqual(reservations[0].cost,{providerRequests:1,optimizerSteps:0,matchAttempts:0,labelDecisions:0});
 const path=join(f.task.outputRoot,checkpoint.rows[0].privateRef.relativePath),bytes=readFileSync(path),privateQuery=JSON.parse(bytes);
 assert.equal(privateQuery.result.privateTransportDiagnostic.errorCode,'ENOTFOUND');assert.equal(lstatSync(path).mode&0o777,0o600);assert.equal(lstatSync(join(f.task.outputRoot,'designer-private')).mode&0o777,0o700);
 for(const value of [JSON.stringify(checkpoint),readFileSync(terminal.artifactRefs[0].path,'utf8')]){assert(!value.includes('privateTransportDiagnostic'));assert(!value.includes('ENOTFOUND'));assert(!value.includes(secret));}
 assert(!bytes.includes(secret));const before=invocations;await consumer.run({...ctx,checkpoint,checkpointSequence:sequence});assert.equal(invocations,before);assert.equal(reservations.length,1);assert.deepEqual(readFileSync(path),bytes);
 console.log(JSON.stringify({caseId:'source.designer-transport-diagnostic',status:'passed',distinctTransportCodes:4,privateOnly:true,gettersNotEvaluated:true,proxyTrapsNotEvaluated:true,boundedCauseDepth:4,terminalNoResend:true,meteringUnchanged:true,externalProviderCalls:0}));
} finally {rmSync(f.dir,{recursive:true,force:true});}
