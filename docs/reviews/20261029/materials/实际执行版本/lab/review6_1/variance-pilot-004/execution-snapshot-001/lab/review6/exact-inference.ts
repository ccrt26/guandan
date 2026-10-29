import{MLP}from'@gd/ai';
const installedModels=new WeakSet<MLP>();
const localF32=(a:unknown):a is Float32Array=>a instanceof Float32Array&&a.buffer instanceof ArrayBuffer&&!a.buffer.resizable;
function standardLocalWeights(net:MLP){const[D,H1,H2,O]=net.sizes;if(net.sizes.length!==4||!Number.isSafeInteger(D)||D<1||H1!==256||H2!==256||O!==1||net.W.length!==3||net.b.length!==3)return false;const sizes=[D*H1,H1*H2,H2],bias=[H1,H2,1];return net.W.every((w,i)=>localF32(w)&&w.length===sizes[i])&&net.b.every((b,i)=>localF32(b)&&b.length===bias[i]);}
/** Frozen policy forward only. Reuse exactly the Number accumulator after the
 * shared state prefix; never round that accumulator to float32. The original
 * action order, tanh calls and float32 hidden/output boundaries stay intact.
 * V1 is317+68; V2 is331+68. No cross-call prediction or weight cache exists. */
export function makeExactSharedStateForward(net:MLP){
 const original=net.forward.bind(net);
 return function forward(X:Float32Array,n:number,out=new Float32Array(n)):Float32Array{
  const[D,H1,H2,O]=net.sizes,P=D===385?317:D===399?331:0;
  if(!P||O!==1||!standardLocalWeights(net)||!Number.isSafeInteger(n)||n<2||!localF32(X)||!localF32(out)||X.length<n*D||out.length<n||X.buffer===out.buffer||[...net.W,...net.b].some(a=>a.buffer===out.buffer))return original(X,n,out);
  for(let i=0;i<n*D;i++)if(!Number.isFinite(X[i]))return original(X,n,out);
  for(let s=1;s<n;s++)for(let i=0;i<P;i++)if(!Object.is(X[i],X[s*D+i]))return original(X,n,out);
  const W1=net.W[0],b1=net.b[0],W2=net.W[1],b2=net.b[1],W3=net.W[2],b3=net.b[2],prefix=new Float64Array(H1),h1=new Float32Array(H1),h2=new Float32Array(H2);
  for(let j=0;j<H1;j++){let acc=b1[j];const wo=j*D;for(let i=0;i<P;i++)acc+=X[i]*W1[wo+i];if(!Number.isFinite(acc))return original(X,n,out);prefix[j]=acc;}
  for(let s=0;s<n;s++){
   const xo=s*D;
   for(let j=0;j<H1;j++){let acc=prefix[j];const wo=j*D;for(let i=P;i<D;i++)acc+=X[xo+i]*W1[wo+i];h1[j]=Math.tanh(acc);}
   for(let j=0;j<H2;j++){let acc=b2[j];const wo=j*H1;for(let i=0;i<H1;i++)acc+=h1[i]*W2[wo+i];h2[j]=Math.tanh(acc);}
   let acc=b3[0];for(let i=0;i<H2;i++)acc+=h2[i]*W3[i];out[s]=acc;
  }
  return out;
 };
}
export const INFERENCE_EXECUTIONS=['original','exact-prefix-v1','exact-prefix-verify']as const;
export type InferenceExecution=typeof INFERENCE_EXECUTIONS[number];
export function createInferenceExecution(net:MLP,mode:InferenceExecution,checkedCandidate?:ReturnType<typeof makeExactSharedStateForward>){
 if(!INFERENCE_EXECUTIONS.includes(mode))throw Error('unknown inference execution');
 const original=net.forward.bind(net),fast=checkedCandidate??makeExactSharedStateForward(net),counters={batches:0,candidateVectors:0,bitwiseComparedBatches:0,referenceForwardCalls:0};
 const forward=(X:Float32Array,n:number,out=new Float32Array(n)):Float32Array=>{
  const standard=standardLocalWeights(net)&&localF32(X)&&localF32(out),effectful=standard&&(X.buffer===out.buffer||[...net.W,...net.b].some(a=>a.buffer===out.buffer)),checkable=mode==='exact-prefix-verify'&&standard&&!effectful&&Number.isSafeInteger(n)&&n>=0&&out.length>=n;
  let result:Float32Array;
  if(mode==='original'||mode==='exact-prefix-verify'&&!checkable)result=original(X,n,out);
  else if(checkable){const reference=original(X,n);counters.referenceForwardCalls++;result=fast(X,n,out);const a=new Uint32Array(reference.buffer,reference.byteOffset,n),b=new Uint32Array(result.buffer,result.byteOffset,n);for(let i=0;i<n;i++)if(a[i]!==b[i])throw Error('inference candidate score bitwise mismatch before action selection');counters.bitwiseComparedBatches++;}
  else result=fast(X,n,out);
  counters.batches++;if(Number.isSafeInteger(n)&&n>=0)counters.candidateVectors+=n;return result;
 };
 return{mode,forward,counters};
}
export function installInferenceExecution(net:MLP,mode:InferenceExecution){
 if(installedModels.has(net)||net.forward!==MLP.prototype.forward)throw Error('inference installation requires a fresh original model, never an already wrapped baseline');
 const executor=createInferenceExecution(net,mode);installedModels.add(net);net.forward=executor.forward;return executor;
}
