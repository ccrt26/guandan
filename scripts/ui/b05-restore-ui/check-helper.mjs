/** Offline helper-only check: synthetic storage tests run separately; this never starts Vite. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveConfig} from 'vite';
import ts from 'typescript';
import {inlineConfig,repoRoot} from './config.mjs';
import {clearInheritedVite} from './safety.mjs';
assert.deepEqual(process.argv.slice(2),['--offline-only']);
const out=join(repoRoot,'lab/out/B05-restore-ui');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(join(out,'fake-env-'));
const names=['.env','.env.local','.env.development','.env.development.local'];
for(const name of names)fs.writeFileSync(join(root,name),'VITE_B05_SENTINEL=FAKE_ONLY\n');
const sentinel={VITE_B05_INHERITED:'FAKE_ONLY',OTHER:'keep'};clearInheritedVite(sentinel);assert.deepEqual(sentinel,{OTHER:'keep'});
const originalRead=fs.readFileSync;let dotenvReads=0;
fs.readFileSync=function(path,...args){
 const p=path instanceof URL?fileURLToPath(path):typeof path==='string'?resolve(path):null;
 if(p&&/^\.env(?:\.|$)/.test(basename(p))){dotenvReads++;throw Error('dotenv_read_forbidden');}
 return Reflect.apply(originalRead,fs,[path,...args]);
};
const old=process.env.VITE_B05_INHERITED;process.env.VITE_B05_INHERITED='FAKE_ONLY';
try{
 const resolved=await resolveConfig({...inlineConfig,root,envDir:root,logLevel:'silent'},'serve');
 assert.equal(dotenvReads,0);assert.deepEqual(Object.keys(resolved.env).filter(k=>k.startsWith('VITE_')),[]);
 assert.equal(resolved.server.host,'127.0.0.1');assert.equal(resolved.server.port,15181);assert.equal(resolved.server.strictPort,true);assert.deepEqual(resolved.server.proxy,{});
 const plugin=inlineConfig.plugins.find(p=>p.name==='b05-restore-only');
 const html=plugin.transformIndexHtml('<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
 assert(html.includes('bootstrap.ts'));assert(!html.includes('src="/src/main.tsx"'));
 const index=JSON.parse(plugin.load(plugin.resolveId('virtual:gd-model-index')).replace(/^export default /,'').replace(/;$/,''));
 assert.equal(index.defaultPolicyRef,'frozenChampion-clean2-ck7051-encv1-candv2');assert.equal(index.policies[1].weightsPathOrUrl.assetUrl,undefined);
 assert(!JSON.stringify(index).includes('nodePath'));
 let gate;plugin.configureServer({middlewares:{use(fn){gate=fn;}}});
 for(const request of [{url:'/api/llm-play',method:'POST'},{url:'/api/llm-profiles',method:'GET'},{url:'/ai/other.f32',method:'GET'},{url:'/@fs'+join(repoRoot,'packages/web/public/ai/other.f32').replaceAll('/','%2F'),method:'GET'}]){
  let next=false,ended=false;const res={statusCode:200,end(){ended=true;}};gate(request,res,()=>{next=true;});assert.equal(next,false);assert.equal(ended,true);assert.equal(res.statusCode,403);
 }
 let next=false;gate({url:'/ai/clean2.f32',method:'GET'},{},()=>{next=true;});assert.equal(next,true);
 const source=originalRead(join(repoRoot,'scripts/ui/b05-restore-ui/bootstrap.ts'),'utf8');
 const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});
 assert.equal(result.diagnostics?.length??0,0);
 console.log(JSON.stringify({status:'passed',scope:'offline configuration/projection/transpile only; no server, real asset, model forward or browser',dotenvReads,exposedViteKeys:[],port:15181,proxy:{},defaultOUnchanged:true,cUnavailable:true}));
}finally{fs.readFileSync=originalRead;if(old===undefined)delete process.env.VITE_B05_INHERITED;else process.env.VITE_B05_INHERITED=old;fs.rmSync(root,{recursive:true});}
