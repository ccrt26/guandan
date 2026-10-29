import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const PRODUCT_CATEGORIES=['yield','takeover','bomb_4_5','remaining_structure','block_finish','known_tribute','role_rotation','rule_context','evidence_insufficient','plan_invalidated'] as const;
export const fileHash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
export const productCaseIds=()=>PRODUCT_CATEGORIES.flatMap(category=>Array.from({length:6},(_,i)=>`${category}-${i+1}`));
const files=()=>['plan.lock.json','expected-assertions.lock.json','case-results.json','product-acceptance.json','product-acceptance.jsonl','development-examples.json','development-example-evidence.json','product-display.json',...productCaseIds().map(id=>`records/${id}.json`)].sort();
export function writeProductManifest(directory:string){
 const manifest={schemaVersion:'r6-product-inputs-v1',files:files().map(path=>({path,sha256:fileHash(resolve(directory,path))}))};
 writeFileSync(resolve(directory,'input-manifest.lock.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return fileHash(resolve(directory,'input-manifest.lock.json'));
}
export function verifyProductManifest(directory:string,expectedHash:string){
 const path=resolve(directory,'input-manifest.lock.json');
 if(!/^[a-f0-9]{64}$/.test(expectedHash)||fileHash(path)!==expectedHash)throw new Error('product input manifest anchor mismatch');
 const manifest=JSON.parse(readFileSync(path,'utf8'));
 if(manifest.schemaVersion!=='r6-product-inputs-v1'||JSON.stringify(manifest.files.map((f:{path:string})=>f.path))!==JSON.stringify(files()))throw new Error('product input manifest fixed files mismatch');
 if(JSON.stringify(readdirSync(resolve(directory,'records')).sort())!==JSON.stringify(productCaseIds().map(id=>`${id}.json`).sort()))throw new Error('product record denominator mismatch');
 for(const f of manifest.files)if(fileHash(resolve(directory,f.path))!==f.sha256)throw new Error(`product input changed: ${f.path}`);
 return manifest;
}
