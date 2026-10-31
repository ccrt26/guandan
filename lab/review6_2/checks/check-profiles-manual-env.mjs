/** One offline manual-Vite boundary case: generated fake dotenv only; never starts a server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveConfig, version } from 'vite';
import { manualInlineConfig as config } from './profiles-manual-vite.mjs';
import { taskOutput } from '../../../scripts/project-paths.mjs';

assert.deepEqual(process.argv.slice(2),['--case','dotenv-isolation'],'Only --case dotenv-isolation is supported');
fs.mkdirSync(new URL('../../out/',import.meta.url),{recursive:true});
const output=taskOutput('profiles-manual-env','B03-manual-env');
fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(join(output,'sentinel-'));
const files=['.env','.env.local','.env.development','.env.development.local'];
const fixture=Object.fromEntries(files.map((name,i)=>[name,`VITE_B03_DOTENV_${i}=FAKE_DOTENV_SENTINEL_${i}\n`]));
for(const [name,contents] of Object.entries(fixture)) fs.writeFileSync(join(root,name),contents,{mode:0o600});
process.env.VITE_B03_INHERITED='FAKE_INHERITED_SENTINEL_ONLY';
const read=fs.readFileSync;
const dotenvReads=[];
fs.readFileSync=function(path,...args) {
  const actual=path instanceof URL?fileURLToPath(path):typeof path==='string'?resolve(path):null;
  if(actual && /^\.env(?:\.|$)/.test(basename(actual))) {
    if(!files.some(name=>actual===join(root,name))) throw Error('refused_non_fixture_dotenv_read');
    dotenvReads.push(basename(actual));
  }
  return Reflect.apply(read,fs,[path,...args]);
};
try {
  const resolved=await resolveConfig({...config,root,envDir:root,configFile:false,logLevel:'silent'},'serve');
  const exposed=Object.keys(resolved.env).filter(key=>key.startsWith('VITE_'));
  const actual={dotenvReadCount:dotenvReads.length,clientViteKeys:exposed};
  assert.equal(actual.dotenvReadCount,0,`dotenv reads must be zero; actual ${actual.dotenvReadCount}`);
  assert.deepEqual(exposed,[],'Inherited/file VITE_* values must not enter client env');
  console.log(JSON.stringify({caseId:'dotenv-isolation',status:'passed',viteVersion:version,actual,fixtureSHA256:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),scope:'resolveConfig only; fake root/sentinels; no server, UI, real dotenv, API or model'}));
} catch(error) {
  console.error(JSON.stringify({caseId:'dotenv-isolation',status:'failed',dotenvReadCount:dotenvReads.length,error:error.message}));
  process.exitCode=1;
} finally {
  fs.readFileSync=read;delete process.env.VITE_B03_INHERITED;fs.rmSync(root,{recursive:true,force:true});
}
