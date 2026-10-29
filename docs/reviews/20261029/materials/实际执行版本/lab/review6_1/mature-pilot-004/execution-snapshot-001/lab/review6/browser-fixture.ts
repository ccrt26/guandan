/** Bounded, loopback-only UI integration fixture. It never proxies an external
 * model or reads credentials. Source application code is served unchanged. */
import {createServer} from 'vite';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import base from '../../packages/web/vite.config';
import {productCaseIds} from './product-artifacts';
const args=process.argv.slice(2);
if(args.length!==0&&(![2,4].includes(args.length)||args[0]!=='--run-id'||!/^\d{3}$/.test(args[1])||Number(args[1])<1||args.length===4&&(args[2]!=='--case-id'||!productCaseIds().includes(args[3]))))throw new Error('expected --run-id NNN and optional --case-id product-case');
const runId=args[1]??'001';
const caseId=args[3]??'evidence_insufficient-1';
const logPath=`lab/review6_1/receipts/browser-sse-fixture-${runId}.jsonl`;
writeFileSync(logPath,'',{flag:'wx'});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const productDirectory=JSON.parse(readFileSync('lab/review6/cycle.draft.json','utf8')).product.resultDirectory;
const record=JSON.parse(readFileSync(resolve(productDirectory,'records',caseId+'.json'),'utf8')).record;
let mode='positive',requests=0;
const modes=['positive','bad_title','bad_summary','bad_source','bad_reference','truncated','bad_tactic','bad_cause','bad_rule_source','bad_model_source','bad_identity','positive_slow'];
const setup=`<!doctype html><meta charset="utf-8"><title>REVIEW6 本地流式出口验收</title>
<h1>隔离的开发验收环境</h1><p>仅本地 SSE 测试数据，不调用外部模型，不构成牌力成绩。端口 5181 与用户网页 5180 分离。</p>
<button id="install" disabled>安装开发回归记录</button><p id="installed">尚未安装</p>
${modes.map((value,i)=>`<button class="mode" data-value="${value}" disabled>${['合格流式讲解','错误标题','错误摘要','来源混用','错误引用','截断 JSON','无证获胜结论','虚构过牌因果','规则偏好混用','网络规则混用','伪造席位编号','延迟合格讲解'][i]}</button>`).join('\n')}
<p id="mode">当前流：positive</p><a href="/">打开实际应用</a>
<script type="module">
import {saveRecord} from '/src/game/storage.ts';
document.querySelector('#install').onclick=async()=>{const d=await(await fetch('/__r6/record')).json();saveRecord(d);document.querySelector('#installed').textContent='已安装：真实引擎生成的开发记录，不是真人记录';};
document.querySelector('#install').disabled=false;
for(const b of document.querySelectorAll('.mode')){b.disabled=false;b.onclick=async()=>{const d=await(await fetch('/__r6/mode?value='+b.dataset.value)).json();document.querySelector('#mode').textContent='当前流：'+d.mode;};}
</script>`;
const server=await createServer({...base,configFile:false,cacheDir:resolve(`lab/review6_1/mock-vite-cache-${runId}`),server:{...base.server,host:'127.0.0.1',port:5181,strictPort:true,proxy:{}},plugins:[...(base.plugins??[]),{
 name:'review6-local-sse-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  const url=new URL(req.url??'/','http://127.0.0.1:5181');
  if(url.pathname==='/__r6/setup'){res.setHeader('content-type','text/html; charset=utf-8');res.end(setup);return;}
  if(url.pathname==='/__r6/record'){res.setHeader('content-type','application/json');res.end(JSON.stringify(record));return;}
  if(url.pathname==='/__r6/mode'){
   const selected=url.searchParams.get('value');if(!selected||!modes.includes(selected)){res.statusCode=400;res.end('invalid mode');return;}
   mode=selected;res.setHeader('content-type','application/json');res.end(JSON.stringify({mode}));return;
  }
  if(url.pathname==='/api/health'){res.setHeader('content-type','application/json');res.end('{"configured":true,"fixture":true}');return;}
  if(url.pathname!=='/api/chat')return next();
  if(req.method!=='POST'){res.statusCode=405;res.end();return;}
  let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>1048576)req.destroy();});
  req.on('end',()=>{
   let input;try{input=JSON.parse(raw);}catch{res.statusCode=400;res.end();return;}
   const prompt=String(input.messages?.at(-1)?.content??'');
   const lessons=prompt.split('### 决策 ').slice(1).map(section=>({
    decisionId:section.split('（')[0],actionIds:[section.match(/实际动作\[([^\]]+)\]/)?.[1]??'missing'],
    factIds:[section.match(/当时可见\[([^\]]+)\]/)?.[1]??'missing'],claimIds:[],
    claimLevel:section.match(/claimLevel=([a-z_]+)/)?.[1]??'provable_fact',title:'核对事实与来源',
    text:'当前先核对行动者与公开牌权。证据不足时不判断策略最优。',
   }));
   const output={summary:'以下陈述原谱事实；策略优劣尚未验证。',lessons};
   if(!lessons.length){res.statusCode=400;res.end('no fact cards');return;}
   const chosenMode=mode;
   if(chosenMode==='bad_title')output.lessons[0].title='剩余999张♠A';
   if(chosenMode==='bad_summary')output.summary='你打错了，必输，剩余999张♠A。';
   if(chosenMode==='bad_source')output.lessons[0].text='引擎规定必须按启发式首选出牌。';
   if(chosenMode==='bad_reference')output.lessons[0].actionIds=['not-an-action'];
   if(chosenMode==='bad_tactic')output.lessons[0].text='用炸弹接管，随后连续出牌就能获胜。';
   if(chosenMode==='bad_cause')output.lessons[0].text='对手因为没有大牌而不要。';
   if(chosenMode==='bad_rule_source')output.lessons[0].text='规则必须选择启发式首选。';
   if(chosenMode==='bad_model_source')output.lessons[0].text='网络首选就是引擎核实的最佳策略。';
   if(chosenMode==='bad_identity')output.summary='行动席9，观察席8，本手编号999。';
   let body=JSON.stringify(output);if(chosenMode==='truncated')body=body.slice(0,Math.floor(body.length/2));
   requests++;appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),request:requests,mode:chosenMode,promptHash:hash(prompt),prompt,outputHash:hash(body),externalCalls:0,dataUse:'DEVELOPMENT_LOCAL_SSE_NOT_MODEL_EVIDENCE'})+'\n');
   res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache'});
   const chunks=body.match(/.{1,48}/gs)??[];let i=0;
   const timer=setInterval(()=>{if(i<chunks.length)res.write('data: '+JSON.stringify({choices:[{delta:{content:chunks[i++]}}]})+'\n\n');else{clearInterval(timer);res.end('data: [DONE]\n\n');}},chosenMode==='positive_slow'?150:20);
   res.on('close',()=>clearInterval(timer));
  });
 });},
}]});
await server.listen();
writeFileSync(`lab/review6_1/receipts/browser-sse-server-${runId}.json`,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),cwd:process.cwd(),listen:'127.0.0.1:5181',maximumLifetimeSeconds:900,externalProxyEnabled:false,fixtureCaseId:caseId,fixtureSource:'real application modules plus local HTTP SSE fixture; no paid model'},null,2)+'\n',{flag:'wx'});
console.log('REVIEW6 isolated SSE fixture ready at http://127.0.0.1:5181/__r6/setup');
let closing=false;
async function stop(){if(closing)return;closing=true;await server.close();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);setTimeout(stop,900000);
