import{fileURLToPath}from'node:url';
import{spawnSync}from'node:child_process';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function confirmOwnedGroupFromPs(pgid){
 const q=spawnSync('/bin/ps',['-x','-o','pid=,pgid=','-p',String(process.pid),'-g',String(pgid)],{env:{...process.env,COMMAND_MODE:'unix2003'},encoding:'utf8',timeout:1500,maxBuffer:65536});
 if(q.error||q.status!==0||q.signal||q.stderr?.trim())throw Error('owned group ps confirmation unavailable after EPERM');
 const rows=q.stdout.trim().split('\n').map(line=>{const m=/^\s*(\d+)\s+(\d+)\s*$/.exec(line);if(!m)throw Error('invalid owned group ps confirmation');return{pid:Number(m[1]),pgid:Number(m[2])};});
 if(rows.filter(r=>r.pid===process.pid).length!==1||new Set(rows.map(r=>r.pid)).size!==rows.length||rows.some(r=>r.pid!==process.pid&&r.pgid!==pgid))throw Error('owned group ps visibility/selection unconfirmed');
 return rows.some(r=>r.pgid===pgid);
}
/** Target only the PID returned by our own detached spawn, which is its PGID.
 * Await group disappearance after TERM/KILL before accounting can settle. */
export async function terminateOwnedGroup(pgid,{graceMs=250,killWaitMs=5000}={}){if(!Number.isSafeInteger(pgid)||pgid<=1||pgid===process.pid||pgid===process.ppid)throw Error('valid distinct ownedchild PGID required');let psFallbacks=0;const alive=()=>{try{process.kill(-pgid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM'){psFallbacks++;return confirmOwnedGroupFromPs(pgid);}throw e;}},signal=name=>{try{process.kill(-pgid,name);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}},start=performance.now();let termSent=false,killSent=false;if(alive()){termSent=signal('SIGTERM');const until=performance.now()+graceMs;while(alive()&&performance.now()<until)await wait(10);if(alive())killSent=signal('SIGKILL');const killUntil=performance.now()+killWaitMs;while(alive()&&performance.now()<killUntil)await wait(10);}const remaining=alive();if(remaining)throw Error('ownedprocessgroup didnot disappear afterhardkill');return{pgid,termSent,killSent,remaining,psFallbacks,seconds:(performance.now()-start)/1000};}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await terminateOwnedGroup(Number(process.argv[2]));console.log(JSON.stringify(result));}
