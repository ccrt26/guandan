import{mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync}from'node:fs';
import{randomUUID}from'node:crypto';
/** One controller owns each source index. Workers never acquire this lock.
 * A stale lock requires checking its recorded owner; never guess that EPERM
 * means a process has gone away, and never steal another controller's lock. */
export function acquireSourceWriter(indexPath:string){
 const directory=realpathSync(indexPath)+'.writer-lock',token=randomUUID();
 try{mkdirSync(directory);}catch(e){
  if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
  let owner='unreadable owner';try{owner=readFileSync(directory+'/owner.json','utf8').trim();}catch{}
  throw Error('source index already locked; inspect this owner before clearing a stale lock: '+owner);
 }
 try{writeFileSync(directory+'/owner.json',JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString(),indexPath:realpathSync(indexPath)})+'\n',{flag:'wx'});}
 catch(e){rmSync(directory,{recursive:true});throw e;}
 return()=>{
  const owner=JSON.parse(readFileSync(directory+'/owner.json','utf8'));
  if(owner.token!==token||owner.pid!==process.pid)throw Error('source writer lock ownership changed');
  rmSync(directory,{recursive:true});
 };
}
