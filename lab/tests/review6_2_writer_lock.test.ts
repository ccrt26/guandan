import{it,expect}from'vitest';
import{mkdtempSync,writeFileSync,rmSync,readFileSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{acquireSourceWriter}from'../review6_2/writer-lock';
it('refuses a second index writer and releases only its own lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-writer-')),path=join(dir,'index.json');writeFileSync(path,'{}');
 try{const release=acquireSourceWriter(path);expect(()=>acquireSourceWriter(path)).toThrow(/already locked/);release();acquireSourceWriter(path)();}
 finally{rmSync(dir,{recursive:true});}
});
it('does not steal an abandoned or changed owner lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'r62-writer-')),path=join(dir,'index.json');writeFileSync(path,'{}');
 try{const release=acquireSourceWriter(path),ownerPath=path+'.writer-lock/owner.json',owner=JSON.parse(readFileSync(ownerPath,'utf8'));writeFileSync(ownerPath,JSON.stringify({...owner,pid:2147483647,token:'another-owner'}));expect(()=>acquireSourceWriter(path)).toThrow(/inspect.*owner/);expect(()=>release()).toThrow(/ownership changed/);}
 finally{rmSync(dir,{recursive:true});}
});
