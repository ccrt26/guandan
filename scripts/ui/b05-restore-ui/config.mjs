/** Explicit inline config: never load product Vite config, dotenv or API proxy. */
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {projectPublicIndex} from '../../../packages/ai/src/policy/public-index.ts';
export const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const at=path=>fileURLToPath(new URL('../../../'+path,import.meta.url));
const virtualId='\0virtual:gd-model-index';
export const inlineConfig={
 configFile:false,envFile:false,envPrefix:[],
 root:at('packages/web'),publicDir:at('packages/web/public'),
 cacheDir:at('lab/out/B05-restore-ui/vite-cache'),
 plugins:[react(),{
  name:'b05-restore-only',
  resolveId(id){return id==='virtual:gd-model-index'?virtualId:null;},
  load(id){return id===virtualId?`export default ${JSON.stringify(projectPublicIndex(JSON.parse(readFileSync(at('lab/model-index.json'),'utf8'))))};`:null;},
  transformIndexHtml(html){
   if(!html.includes('src="/src/main.tsx"'))throw Error('expected_product_main_entry');
   return html.replace('src="/src/main.tsx"',`src="/@fs${at('scripts/ui/b05-restore-ui/bootstrap.ts')}"`)
    .replace('<div id="root">','<section id="b05-restore-tools" aria-label="B05 人工存档验收"></section><div id="root">');
  },
  configureServer(server){server.middlewares.use((req,res,next)=>{
   let path;try{path=decodeURIComponent(new URL(req.url??'/', 'http://127.0.0.1:15181').pathname);}catch{res.statusCode=400;res.end('invalid URL');return;}
   // No application API is connected. The browser itself supplies an empty public list.
   if(!['GET','HEAD'].includes(req.method??'')||path==='/api'||path.startsWith('/api/')||path.startsWith('/ai/')&&path!=='/ai/clean2.f32'||path.includes('/public/ai/')&&path!=='/@fs'+at('packages/web/public/ai/clean2.f32')){
    res.statusCode=403;res.end('B05 restore-only boundary');return;
   }
   next();
  });},
 }],
 resolve:{alias:{'@gd/engine':at('packages/engine/src/index.ts'),'@gd/ai':at('packages/ai/src/index.ts'),'@gd/review':at('packages/review/src/index.ts')}},
 server:{host:'127.0.0.1',port:15181,strictPort:true,open:false,hmr:false,proxy:{},
  headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"},
  fs:{strict:true,allow:[at('packages/web/src'),at('packages/web/public'),at('packages/web/index.html'),at('packages/ai/src'),at('packages/engine/src'),at('packages/review/src'),at('node_modules'),at('scripts/ui/b05-restore-ui'),at('lab/review6_2/checks/fixtures/B05-old-o-save.json'),at('lab/review6_2/checks/fixtures/B05-missing-release-save.json')]},
 },
};
