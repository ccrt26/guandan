/** Pure cumulative B09 invariants. No selection commit, model, or outcome lookup. */
import {createHash} from 'node:crypto';
const need=(x,r)=>{if(!x)throw Error('cumulative_'+r);};
const fixed=x=>typeof x==='string'&&/^[-a-zA-Z0-9._/:]+@sha256:[a-f0-9]{64}$/.test(x);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const cmp=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
export function validateCumulativeSampling(s,protocolRef){
 need(s&&Object.keys(s).sort().join(',')==='keepRule,poolRef,previousDatasetRef,productionRefs,protocolRef,schema,selectionRefs','sampling_shape');
 need(s.schema==='ohuo-first-round-cumulative-sampling-r2'&&s.protocolRef===protocolRef&&fixed(s.protocolRef)&&fixed(s.poolRef)&&s.keepRule==='same-split-frozen-layout-hash-prefix-equal-cumulative-valid-demo','sampling_identity');
 need(Array.isArray(s.selectionRefs)&&s.selectionRefs.length>=2&&Array.isArray(s.productionRefs)&&s.productionRefs.length===s.selectionRefs.length,'rounds');
 for(const values of [s.selectionRefs,s.productionRefs])need(values.every(fixed)&&new Set(values).size===values.length,'rounds_unique');
 need(s.previousDatasetRef===null||fixed(s.previousDatasetRef),'previous_dataset_ref');return s;
}
export function cumulativeKeepCandidates(population,demos,queue,layoutOrder){
 need(Array.isArray(population)&&Array.isArray(demos)&&Array.isArray(queue?.rows)&&stable(layoutOrder)===stable([[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]]),'frozen_keep_inputs');
 const seen=new Set(),contexts=new Set(),demoIds=new Set(demos.map(d=>d.decisionId)),demoContexts=new Set(demos.map(d=>d.contextSHA256));
 const eligible=population.filter(p=>p.eligibility==='eligible'&&p.sampleClass==='ordinary');
 for(const p of eligible){need(typeof p.decisionId==='string'&&typeof p.contextSHA256==='string'&&['train','dev'].includes(p.split),'ordinary_identity');need(!seen.has(p.decisionId)&&!contexts.has(p.contextSHA256),'ordinary_duplicate');seen.add(p.decisionId);contexts.add(p.contextSHA256);}
 const queueByMatch=new Map(queue.rows.map(q=>[q.matchId,q]));need(queueByMatch.size===queue.rows.length,'queue_duplicate');
 const result=[];
 for(const split of ['train','dev']){
  const count=demos.filter(d=>d.split===split).length,rows=eligible.filter(p=>p.split===split&&!demoIds.has(p.decisionId)&&!demoContexts.has(p.contextSHA256));
  for(const p of rows){const q=queueByMatch.get(p.key?.matchId);need(q&&layoutOrder.some(([g,s])=>q.group===g&&q.side===s),'ordinary_layout');}
  const buckets=layoutOrder.map(([g,s])=>rows.filter(r=>{const q=queueByMatch.get(r.key.matchId);return q.group===g&&q.side===s;}).sort((a,b)=>cmp(hash(a.decisionId),hash(b.decisionId))||cmp(a.decisionId,b.decisionId)||cmp(stable(a.key),stable(b.key))));
  const ordered=[];for(let n=0;buckets.some(b=>n<b.length);n++)for(const b of buckets)if(n<b.length)ordered.push(b[n]);
  result.push(...ordered.slice(0,count)); // A short pool stays short; qualification rejects imbalance.
 }
 return result;
}
export function assertCumulativeGrowth(previousSamples,samples){
 const previous=previousSamples.filter(s=>s.sampleKind==='demo'),now=samples.filter(s=>s.sampleKind==='demo');
 const byId=new Map(previous.map(s=>[s.decisionId,s])),oldContexts=new Set(previous.map(s=>s.contextSHA256)),newDemoIds=[];
 for(const s of now){const old=byId.get(s.decisionId);if(old){need(old.contextSHA256===s.contextSHA256&&old.provenance?.inputSHA256===s.provenance?.inputSHA256,'previous_demo_identity_changed');}else{need(!oldContexts.has(s.contextSHA256),'previous_demo_context_alias');newDemoIds.push(s.decisionId);}}
 return {previousValidDemoCount:previous.length,currentValidDemoCount:now.length,newDemoIds,hasNewValidDemo:newDemoIds.length>0};
}
