/** Import only the two already-authorized historical receipts. Never calls a provider. */
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const RUNTIME='/Users/ccrt/game/guandan',HOME='/Users/ccrt';
const SOURCES=[
  {provider:'glm',name:'probe-glm.actual.json',sha256:'1f3a5e45b4427dfb0cbfa9ca034df74bc401e01e24deb35dd9cdf71f9a7bb3c1'},
  {provider:'deepseek',name:'probe-deepseek.actual.json',sha256:'10e14036bbf8518b979bbc1fed95ec5878c2b2ec69ecfc310e9628ac7cedf60f'},
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function args(argv){
  if(argv.length!==3||!argv.includes('--import-approved-receipts'))return null;
  const result={};for(const key of ['store-source-sha','state-source-sha']){
    const values=argv.filter(v=>v.startsWith(`--${key}=`));if(values.length!==1)return null;
    const value=values[0].slice(key.length+3);if(!/^[a-f0-9]{64}$/.test(value))return null;result[key]=value;
  }return result;
}
function exactFile(path,expected){const stat=lstatSync(path);return stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(path)===path&&sha(readFileSync(path))===expected;}
async function main(){
  const a=args(process.argv.slice(2));
  if(!a||homedir()!==HOME||process.cwd()!==RUNTIME||realpathSync(process.cwd())!==RUNTIME)return {status:'guard_refused_no_write',providerRequests:0};
  const script=join(RUNTIME,'deliverables/ohuo-batches/S31-PROVIDER-STATE/tools/import-connection-receipts.mjs');
  if(resolve(process.argv[1])!==script||realpathSync(script)!==script)return {status:'guard_refused_no_write',providerRequests:0};
  const storePath=join(RUNTIME,'packages/web/server/llm-profiles.mjs'),statePath=join(RUNTIME,'packages/web/server/llm-provider-state.mjs');
  if(!exactFile(storePath,a['store-source-sha'])||!exactFile(statePath,a['state-source-sha']))return {status:'source_mismatch_no_write',providerRequests:0};
  const sources=SOURCES.map(({name,...source})=>({...source,path:join(RUNTIME,'deliverables/ohuo-batches/S31-PROVIDER-STATE/inputs',name)}));
  if(sources.some(s=>!exactFile(s.path,s.sha256)))return {status:'receipt_source_mismatch_no_write',providerRequests:0};
  const {importLegacyReceipts}=await import(pathToFileURL(statePath).href);
  // This helper's approved defaults are the original project store and its receipt sidecar.
  return importLegacyReceipts({sources});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(`${JSON.stringify(await main())}\n`);}
  catch(error){const known=new Set(['receipt_source_invalid','receipt_source_mismatch','receipt_store_unavailable','receipt_conflict','profile_store_busy']);
    process.stdout.write(`${JSON.stringify({status:'import_not_completed',reason:known.has(error?.message)?error.message:'local_import_unavailable',providerRequests:0})}\n`);process.exitCode=1;}
}
