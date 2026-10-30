import{it,expect}from'vitest';import{mkdtempSync,rmSync,symlinkSync,readFileSync,chmodSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{atomicJson,json,fileHash,claimFamily,bindFamilies,excludedFamilies}from'../review6_2/protocol';
it('preserves old JSON and foreign ordering across existing/new families and split failures',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-index-eq-')),path=join(dir,'index.json'),old=join(dir,'old.json');
 try{
  const initial={version:1,families:{f0:{split:'dev',firstSource:'original'}}};atomicJson(path,initial);atomicJson(old,initial);
  const legacy=(ids:string[],split:string,source:string)=>{const i=json(old);for(const id of ids)claimFamily(i,id,split,source);atomicJson(old,i);};
  for(const ids of[['t1'],['t1'],['t2','t3']]){legacy(ids,'train','new');bindFamilies(path,ids,'train','new');expect(fileHash(path)).toBe(fileHash(old));expect(excludedFamilies(path,'train')).toEqual(Object.entries(json(old).families).filter(([,v]:any)=>v.split!=='train').map(([id])=>id));}
  expect(()=>bindFamilies(path,['phantom','f0'],'train','bad')).toThrow(/collision/);expect(fileHash(path)).toBe(fileHash(old));expect(excludedFamilies(path,'dev')).not.toContain('phantom');
 }finally{rmSync(dir,{recursive:true});}
});
it.skipIf(process.getuid?.()===0)('discards uncommitted cached additions when atomic persistence fails',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-index-fail-')),path=join(dir,'index.json');
 try{atomicJson(path,{version:1,families:{}});bindFamilies(path,['t1'],'train','one');chmodSync(dir,0o555);expect(()=>bindFamilies(path,['phantom'],'train','fail')).toThrow();chmodSync(dir,0o755);expect(excludedFamilies(path,'dev')).toEqual(['t1']);bindFamilies(path,['t2'],'train','two');expect(Object.keys(json(path).families)).toEqual(['t1','t2']);}
 finally{chmodSync(dir,0o755);rmSync(dir,{recursive:true});}
});
it('invalidates after external atomic writes and returns independent foreign arrays',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-index-refresh-')),path=join(dir,'index.json');
 try{atomicJson(path,{version:1,families:{}});bindFamilies(path,['t1'],'train','one');const a=excludedFamilies(path,'dev');a.length=0;expect(excludedFamilies(path,'dev')).toEqual(['t1']);atomicJson(path,{version:1,families:{d1:{split:'dev',firstSource:'external'}}});expect(excludedFamilies(path,'train')).toEqual(['d1']);bindFamilies(path,['t2'],'train','two');expect(Object.keys(json(path).families)).toEqual(['d1','t2']);}
 finally{rmSync(dir,{recursive:true});}
});
it('writes the same real index that a symlink writer lock protects',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-index-alias-')),path=join(dir,'index.json'),alias=join(dir,'alias.json');
 try{atomicJson(path,{version:1,families:{}});symlinkSync(path,alias);bindFamilies(alias,['t1'],'train','alias');expect(json(path).families.t1.split).toBe('train');expect(readFileSync(path,'utf8')).toBe(readFileSync(alias,'utf8'));expect(excludedFamilies(path,'dev')).toEqual(['t1']);}
 finally{rmSync(dir,{recursive:true});}
});
