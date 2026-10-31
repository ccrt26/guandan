/** Local acceptance only. Importing does not read assets or start a server. */
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inlineConfig,repoRoot} from './config.mjs';
import {clearInheritedVite} from './safety.mjs';
export const O_ASSET={path:'packages/web/public/ai/clean2.f32',bytes:659460,sha256:'b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55'};
async function start(args){
 if(args.length!==1||args[0]!=='--local-restore-only')throw Error('exact --local-restore-only required');
 clearInheritedVite(process.env);
 const bytes=await readFile(resolve(repoRoot,O_ASSET.path));
 if(bytes.length!==O_ASSET.bytes||createHash('sha256').update(bytes).digest('hex')!==O_ASSET.sha256)throw Error('existing_O_asset_identity_mismatch');
 const server=await createServer(inlineConfig);
 const stop=()=>{void server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await server.listen();}catch(error){await server.close();throw error;}
 console.log(JSON.stringify({url:'http://127.0.0.1:15181/',purpose:'B05 artificial restore fixtures only; real UI pending observation',asset:O_ASSET,processId:process.pid,exit:'Ctrl-C stops only this owned helper; never kill a port owner'}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await start(process.argv.slice(2));}catch(error){console.error(`B05 helper not started: ${error.message}. Do not terminate another service or substitute an asset.`);process.exitCode=1;}
}
