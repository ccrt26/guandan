import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzeGame,buildDecisionReviews,runCounterfactual} from '@gd/review';
import {verifyProductManifest,productCaseIds,fileHash} from './product-artifacts';

const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--config'||args[2]!=='--out')throw new Error('expected --config path --out new-path');
const config=JSON.parse(readFileSync(args[1],'utf8')),directory=resolve(config.product.resultDirectory),out=resolve(args[3]);
if(existsSync(out))throw new Error('refuse overwrite');
verifyProductManifest(directory,config.product.resultManifestHash);
const started=Date.now(),rows:unknown[]=[],errors:unknown[]=[];let expectedRoots=0;
for(const caseId of productCaseIds()){
 const recordPath=resolve(directory,'records',caseId+'.json'),{record}=JSON.parse(readFileSync(recordPath,'utf8'));
 for(let viewerSeat=0;viewerSeat<4;viewerSeat++){
  const scoped={...record,humanSeat:viewerSeat},analysis=analyzeGame(scoped);
  const roots=analysis.moves.filter(m=>m.grade==='divergent').sort((a,b)=>b.scoreGap-a.scoreGap).slice(0,4);expectedRoots+=roots.length;
  if(!roots.length)continue;
  try{
   const evidence=buildDecisionReviews(scoped,{analysis,moves:roots.map(m=>m.moveNo),maxPoints:4});
   const results=await runCounterfactual(scoped,roots,{maxDecisions:4});
   if(results.length!==roots.length)throw new Error('missing normal UI root results');
   for(const result of results){
    const fact=evidence.find(e=>e.moveNo===result.moveNo);
    if(!fact||result.actualActionId!==fact.actual.actionId||result.alternativeActionId!==fact.heuristic.topActionId||result.sourceId!==fact.heuristic.sourceId)throw new Error('counterfactual/fact declaration or source mismatch');
    rows.push({caseId,recordSHA256:fileHash(recordPath),viewerSeat,...result});
   }
  }catch(error){errors.push({caseId,viewerSeat,rootMoves:roots.map(r=>r.moveNo),message:(error as Error).message});}
 }
}
const receipt={schemaVersion:'r6-development-counterfactual-audit-v1',at:new Date().toISOString(),sourceDirectory:directory,resultManifestHash:config.product.resultManifestHash,scope:'existing development records; normal UI top-four divergent roots; deterministic posthoc branch identity audit, not skill or teacher evidence',sourceFiles:['packages/review/src/counterfactual.ts','lab/review6/counterfactual-audit.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),expectedRoots,completedRoots:rows.length,errorGroups:errors.length,errors,rows,activeWallSeconds:(Date.now()-started)/1000,formalSkillMeasured:false,externalCalls:0,passed:errors.length===0&&rows.length===expectedRoots&&expectedRoots>0};
writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({expectedRoots,completedRoots:rows.length,errorGroups:errors.length,seconds:receipt.activeWallSeconds,passed:receipt.passed}));if(!receipt.passed)process.exitCode=2;
