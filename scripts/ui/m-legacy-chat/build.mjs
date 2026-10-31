/** Static build only: esbuild does not load Vite/project env or start a listener. */
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const output=path.join(root,'lab/out/m-legacy-chat-ui');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildHelper(){
  await fs.mkdir(output,{recursive:true});
  const result=await build({absWorkingDir:root,entryPoints:['scripts/ui/m-legacy-chat/entry.tsx'],outdir:output,entryNames:'helper',bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:false,metafile:true,sourcemap:false,define:{'process.env.NODE_ENV':'"production"'},external:['/felt_green.jpg'],write:true,logLevel:'silent'});
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M 假控件检查</title><link rel="stylesheet" href="/helper.css"></head><body><div id="root"></div><script type="module" src="/helper.js"></script></body></html>\n';
  await fs.writeFile(path.join(output,'index.html'),html);
  const inputs=[];for(const input of Object.keys(result.metafile.inputs)){inputs.push({path:input,sha256:sha(await fs.readFile(path.resolve(root,input)))});}
  const outputs=[];for(const name of ['index.html','helper.js','helper.css']){const bytes=await fs.readFile(path.join(output,name));outputs.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
  const manifest={schema:'M-static-fake-ui-build-v1',origin:'http://127.0.0.1:15183',esbuildVersion:(await import('esbuild')).version,node:process.version,inputs,outputs,staticOnly:true,noEnvLoading:true,noServerStarted:true};
  await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')!=='--fake-ui-only')throw Error('explicit_fake_ui_flag_required');
  const result=await buildHelper();console.log(JSON.stringify({origin:result.origin,staticOnly:true,noServerStarted:true,outputs:result.outputs}));
}
