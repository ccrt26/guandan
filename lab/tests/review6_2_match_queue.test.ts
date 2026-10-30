import{it,expect}from'vitest';import{mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{atomicJson,json}from'../review6_2/protocol';import{prepareMatchQueue,queueSource,validateMatchQueue}from'../review6_2/match-queue';
it('rejects a colliding prospective source before fixing a small fixture queue',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-queue-')),index=join(dir,'index.json'),out=join(dir,'queue');
 try{
  const source=queueSource(1,'cooperation',0);atomicJson(index,{version:1,families:{[source.familyId]:{split:'dev',firstSource:'fixture'}}});
  const config={sourceIndexRef:index,windowSeconds:30},spec={attempt:1,fixture:true,counts:{cooperation:2,M1:2,M2:2},examFiles:[]};
  const r=prepareMatchQueue(config,out,spec);expect(r.status).toBe('prepared');const q=json(join(out,'queue.json'));
  expect(q.rejectedTrials).toBeGreaterThanOrEqual(1);expect(q.sources[0].trial).not.toBe(0);
  expect(q.sources).toHaveLength(6);expect(new Set(q.sources.flatMap((s:any)=>s.roundFamilies)).size).toBe(480);
  expect(()=>validateMatchQueue(config,join(out,'queue.json'),[],true)).not.toThrow();
  expect(()=>validateMatchQueue(config,join(out,'queue.json'),[])).toThrow(/fixture/);
  const again=prepareMatchQueue(config,out,spec);expect(again.queueSHA256).toBe(r.queueSHA256);
 }finally{rmSync(dir,{recursive:true});}
});
it.each(['partial-json','complete-json-no-newline'])('recovers only the committed journal prefix: %s',tail=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-queue-tail-')),index=join(dir,'index.json'),spec={attempt:1,fixture:true,counts:{cooperation:2,M1:2,M2:2},examFiles:[]};
 try{
  atomicJson(index,{version:1,families:{}});prepareMatchQueue({sourceIndexRef:index,windowSeconds:30},join(dir,'original'),spec);
  const original=json(join(dir,'original/queue.json')),lines=readFileSync(join(dir,'original/proposals.jsonl'),'utf8').trim().split('\n');
  atomicJson(index,{version:1,families:{}});prepareMatchQueue({sourceIndexRef:index,windowSeconds:0},join(dir,'resumed'),spec);
  writeFileSync(join(dir,'resumed/proposals.jsonl'),lines.slice(0,2).join('\n')+'\n'+(tail==='partial-json'?'{"metric":':lines[2]));
  const r=prepareMatchQueue({sourceIndexRef:index,windowSeconds:30},join(dir,'resumed'),spec);expect(r.status).toBe('prepared');
  expect(json(join(dir,'resumed/queue.json')).sources).toEqual(original.sources);
  expect(readdirSync(join(dir,'resumed')).some(s=>s.startsWith('proposals.jsonl.uncommitted-'))).toBe(true);
  expect(()=>validateMatchQueue({sourceIndexRef:index},join(dir,'resumed/queue.json'),[],true)).not.toThrow();
 }finally{rmSync(dir,{recursive:true});}
});
it('resumes an expired queue preparation without changing its fixed proposal order',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-queue-window-')),index=join(dir,'index.json');
 try{
  atomicJson(index,{version:1,families:{}});const spec={attempt:2,fixture:true,counts:{cooperation:2,M1:2,M2:2},examFiles:[]};
  expect(prepareMatchQueue({sourceIndexRef:index,windowSeconds:0},join(dir,'queue'),spec).status).toBe('window_expired');
  const r=prepareMatchQueue({sourceIndexRef:index,windowSeconds:30},join(dir,'queue'),spec);expect(r.status).toBe('prepared');
  const q=json(join(dir,'queue/queue.json'));expect(q.sources[0].trial).toBe(0);expect(q.sources[0].source).toEqual(queueSource(2,'cooperation',0));
  const changed={...spec,attempt:3};expect(()=>prepareMatchQueue({sourceIndexRef:index,windowSeconds:30},join(dir,'queue'),changed)).toThrow(/identity/);
 }finally{rmSync(dir,{recursive:true});}
});
