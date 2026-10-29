import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyProduct,verifyProductCard,type ExpectedCard} from './product';
import type {DecisionFactsV3} from '@gd/review';
import {verifyProductManifest,PRODUCT_CATEGORIES,productCaseIds} from './product-artifacts';
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
try{
 const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
 if(!config.product?.resultDirectory||!config.product?.browserReceipt)throw new Error('product evidence paths required');
 const directory=resolve(config.product.resultDirectory);
 if(!existsSync(directory)){
  const generated=verifyProduct(directory);
  process.stdout.write(JSON.stringify({stageStatus:'incomplete',resultCode:'product_generated_anchor_required',resultDirectory:directory,resultManifestHash:generated.resultManifestHash})+'\n');process.exit(3);
 }
 if(!config.product.resultManifestHash)throw new Error('product input manifest anchor required');
 verifyProductManifest(directory,config.product.resultManifestHash);
 const result=JSON.parse(readFileSync(resolve(directory,'product-acceptance.json'),'utf8'));
 for(const file of result.sourceFiles)if(hash(file.path)!==file.sha256)throw new Error('product source hash mismatch');
 const expected=JSON.parse(readFileSync(resolve(directory,'expected-assertions.lock.json'),'utf8')) as Array<Omit<ExpectedCard,'record'>&{caseId:string;recordPath:string}>;
 const rows=JSON.parse(readFileSync(resolve(directory,'case-results.json'),'utf8')) as Array<{caseId:string;viewerSeat:number;card:DecisionFactsV3}>;
 const plan=JSON.parse(readFileSync(resolve(directory,'plan.lock.json'),'utf8'));
 if(JSON.stringify(plan.categories)!==JSON.stringify(PRODUCT_CATEGORIES)||JSON.stringify(plan.cases.map((c:{caseId:string})=>c.caseId))!==JSON.stringify(productCaseIds()))throw new Error('fixed category/case denominator mismatch');
 for(const id of productCaseIds())for(let viewer=0;viewer<4;viewer++)if(!expected.some(r=>r.caseId===id&&r.viewerSeat===viewer&&r.recordPath===`records/${id}.json`))throw new Error('fixed case/viewer assertion missing');
 if(expected.length!==240||rows.length!==240||new Set(expected.map(r=>`${r.caseId}:${r.viewerSeat}`)).size!==240||new Set(rows.map(r=>`${r.caseId}:${r.viewerSeat}`)).size!==240)throw new Error('fixed 240-card denominator mismatch');
 let expectedAssertions=0,checkedAssertions=0;
 for(const item of expected){
  const row=rows.find(r=>r.caseId===item.caseId&&r.viewerSeat===item.viewerSeat);if(!row)throw new Error('missing card');
  const {record}=JSON.parse(readFileSync(resolve(directory,item.recordPath),'utf8'));
  const verified=verifyProductCard({...item,record},row.card);if(!verified.passed)throw new Error('product assertion failed');
  expectedAssertions+=verified.expectedAssertions;checkedAssertions+=verified.checkedAssertions;
 }
 if(expectedAssertions!==1440||checkedAssertions!==1440)throw new Error('fixed assertion denominator mismatch');
 if(!existsSync(config.product.browserReceipt)){
  process.stdout.write(JSON.stringify({stageStatus:'incomplete',resultCode:'browser_evidence_missing',expectedCards:240,passedCards:240,expectedAssertions,checkedAssertions})+'\n');process.exitCode=3;
 }else{
  const browser=JSON.parse(readFileSync(config.product.browserReceipt,'utf8'));
  if(browser.schemaVersion!=='review6-browser-acceptance-v1'||!browser.passed||browser.formalSkillMeasured!==false)throw new Error('browser receipt insufficient');
  for(const file of [...browser.sourceFiles,...browser.evidenceFiles])if(hash(file.path)!==file.sha256)throw new Error('browser evidence/source hash mismatch');
  const views=browser.evidenceFiles.filter((f:{path:string})=>/view-[0-3]\.txt$/.test(f.path));
  if(views.length!==4)throw new Error('four browser views required');
  for(let seat=0;seat<4;seat++){
   const file=views.find((f:{path:string})=>f.path.endsWith(`view-${seat}.txt`));
   if(!file||!new RegExp(`本手事实 · 行动席 \\d / 观察席 ${seat}`).test(readFileSync(file.path,'utf8')))throw new Error('browser viewer mismatch');
  }
  for(const [name,text] of [['cache-hit-fixed.txt','已重验缓存'],['cache-invalidated-viewer.txt','事实讲解']] as const){
   const file=browser.evidenceFiles.find((f:{path:string})=>f.path.endsWith('/'+name));
   if(!file||!readFileSync(file.path,'utf8').includes(text))throw new Error('browser cache path missing');
  }
  process.stdout.write(JSON.stringify({schemaVersion:'r6-product-verification-v1',stageStatus:'verified',resultCode:'finite_product_facts_and_browser_verified',resultDirectory:directory,resultManifestHash:config.product.resultManifestHash,expectedCards:240,passedCards:240,expectedAssertions,checkedAssertions,missingAssertions:0,errorAssertions:0,browserReceipt:resolve(config.product.browserReceipt),browserReceiptHash:hash(config.product.browserReceipt),candidateCapability:'not_measured',playingPolicyUpdated:false},null,2)+'\n');
 }
}catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',resultCode:'product_verification_failed',message:(error as Error).message})+'\n');process.exitCode=2;}
