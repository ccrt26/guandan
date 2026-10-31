/** Static build only. No dev client/HMR, dotenv or API proxy is ever started. */
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {projectPublicIndex} from '../../../packages/ai/src/policy/public-index.ts';
export const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const at=p=>fileURLToPath(new URL('../../../'+p,import.meta.url));
const virtualId='\0virtual:gd-model-index';
export const boundarySources=['scripts/ui/c1400-browser-evidence/safety.mjs','scripts/ui/c1400-browser-evidence/config.mjs','scripts/ui/c1400-browser-evidence/serve.mjs','scripts/ui/c1400-browser-evidence/bootstrap.ts','packages/web/src/App.tsx','packages/web/src/main.tsx','packages/web/src/game/policy.ts','packages/web/src/game/controller.ts','packages/web/src/game/storage.ts','packages/web/src/ui/SeatPicker.tsx','packages/ai/src/nn/mlp.ts','packages/ai/src/policy/browser.ts','packages/ai/src/policy/resolve.ts','lab/model-index.json'];
export const inlineConfig={
 configFile:false,envFile:false,envPrefix:[],root:at('packages/web'),publicDir:false,cacheDir:at('lab/out/C1400-browser-evidence/vite-cache'),
 build:{outDir:at('lab/out/C1400-browser-evidence/web-build'),emptyOutDir:false,copyPublicDir:false},
 plugins:[react(),{
  name:'c1400-static-browser-evidence',resolveId(id){return id==='virtual:gd-model-index'?virtualId:null;},
  load(id){return id===virtualId?`export default ${JSON.stringify(projectPublicIndex(JSON.parse(readFileSync(at('lab/model-index.json'),'utf8'))))};`:null;},
  transformIndexHtml:{order:'pre',handler(html){if(!html.includes('src="/src/main.tsx"'))throw Error('product_main_entry_missing');return html.replace('src="/src/main.tsx"',`src="/@fs${at('scripts/ui/c1400-browser-evidence/bootstrap.ts')}"`).replace('<div id="root">','<section id="c1400-evidence" aria-label="C1400 浏览器验收"></section><div id="root">');}},
  generateBundle(_,bundle){
   const modules=Object.values(bundle).filter(x=>x.type==='chunk').flatMap(x=>Object.keys(x.modules));
   for(const suffix of ['/packages/ai/src/nn/mlp.ts','/packages/web/src/game/controller.ts'])if(modules.filter(x=>x.endsWith(suffix)).length!==1)throw Error('single_real_runtime_module_required:'+suffix);
   if(modules.some(x=>x.includes('vite/dist/client/client')))throw Error('dev_network_client_forbidden');
  },
 }],
 resolve:{alias:{'@gd/engine':at('packages/engine/src/index.ts'),'@gd/ai':at('packages/ai/src/index.ts'),'@gd/review':at('packages/review/src/index.ts')}},
};
