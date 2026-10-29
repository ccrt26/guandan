import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileHash,verifyProductManifest} from './product-artifacts';

// Aggregation only: no engine, policy, model or measurement module is imported.
try{
 const config=JSON.parse(readFileSync(process.argv[2],'utf8')),product=config.product;
 if(!product?.verificationReceipt||!product.verificationReceiptHash)throw new Error('product verification receipt and hash required');
 const directory=resolve(product.resultDirectory),out=resolve(process.argv[3]);
 if(existsSync(out))throw new Error('output exists; refuse overwrite');
 verifyProductManifest(directory,product.resultManifestHash);
 if(fileHash(product.verificationReceipt)!==product.verificationReceiptHash)throw new Error('product verification receipt changed');
 const receipt=JSON.parse(readFileSync(product.verificationReceipt,'utf8'));
 if(receipt.schemaVersion!=='r6-product-verification-v1'||receipt.stageStatus!=='verified'||receipt.resultDirectory!==directory||receipt.resultManifestHash!==product.resultManifestHash||receipt.expectedCards!==240||receipt.checkedAssertions!==1440||receipt.missingAssertions!==0||receipt.errorAssertions!==0)throw new Error('product verification receipt insufficient');
 if(fileHash(receipt.browserReceipt)!==receipt.browserReceiptHash)throw new Error('browser receipt changed');
 const browser=JSON.parse(readFileSync(receipt.browserReceipt,'utf8'));
 for(const file of [...browser.sourceFiles,...browser.evidenceFiles])if(fileHash(file.path)!==file.sha256)throw new Error('browser source/evidence changed');
 const result=JSON.parse(readFileSync(resolve(directory,'product-acceptance.json'),'utf8'));
 for(const file of result.sourceFiles)if(fileHash(file.path)!==file.sha256)throw new Error('measured source changed');
 const examples=JSON.parse(readFileSync(resolve(directory,'development-example-evidence.json'),'utf8'));
 if(examples.schemaVersion!=='r6-product-examples-v1'||examples.sourceDirectory!==directory||examples.examples.length!==13)throw new Error('stored development measurements missing');
 for(const example of examples.examples)if(fileHash(resolve(directory,'records',example.id+'.json'))!==example.recordSha256)throw new Error('example dataset lineage mismatch');
 mkdirSync(out,{recursive:false});
 const files=[['product-display.json','capability-display.json'],['development-example-evidence.json','development-example-evidence.json']] as const;
 for(const [source,target] of files)writeFileSync(resolve(out,target),readFileSync(resolve(directory,source)),{flag:'wx'});
 const manifest={schemaVersion:'r6-product-export-v1',at:new Date().toISOString(),scope:'product',sourceDirectory:directory,resultManifestHash:product.resultManifestHash,verificationReceipt:resolve(product.verificationReceipt),verificationReceiptHash:product.verificationReceiptHash,newEvaluations:0,externalCalls:0,formalConfirmationsOpened:0,files:files.map(([,path])=>({path,sha256:fileHash(resolve(out,path))}))};
 writeFileSync(resolve(out,'export-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 process.stdout.write(JSON.stringify({stageStatus:'exported',scope:'product',outDirectory:out,newEvaluations:0,externalCalls:0,examples:13,resultManifestHash:product.resultManifestHash})+'\n');
}catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',resultCode:'capability_export_failed',message:(error as Error).message})+'\n');process.exitCode=2;}
