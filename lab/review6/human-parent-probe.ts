import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MLP} from '@gd/ai';
import {fileHash} from './product-artifacts';
const contractPath=resolve(process.argv[2]),contract=JSON.parse(readFileSync(contractPath,'utf8'));
if(contract.parentProbe.split!=='train'||contract.parentProbe.rows!==8)throw new Error('only the predeclared train numerical probe is allowed');
const manifest=JSON.parse(readFileSync(contract.manifestPath,'utf8'));
if(fileHash(contract.manifestPath)!==contract.manifestSHA256)throw new Error('H manifest changed before numeric probe');
for(const file of manifest.files)if(fileHash(file.path)!==file.sha256)throw new Error('H feature input changed');
const raw=readFileSync(resolve(contract.featureDirectory,'train.f32')),values=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const parentRaw=readFileSync(resolve(contract.featureDirectory,'clean-parent.f32')),parent=new Float32Array(parentRaw.buffer.slice(parentRaw.byteOffset,parentRaw.byteOffset+parentRaw.byteLength)),network=new MLP(20261028,399);network.setWeights(parent);
const metadata=JSON.parse(readFileSync(resolve(contract.featureDirectory,'train-metadata.json'),'utf8')),rows=[];let offset=0;
for(let index=0;index<8;index++){
 const state=values.subarray(offset,offset+331);offset+=331;const n=values[offset++],t=values[offset++];offset+=t;
 if(n!==metadata[index].nCandidates)throw new Error('numeric probe metadata mismatch');
 const input=new Float32Array(n*399);
 for(let k=0;k<n;k++){input.set(state,k*399);input.set(values.subarray(offset+k*68,offset+(k+1)*68),k*399+331);}offset+=n*68;
 rows.push({index,decisionId:metadata[index].decisionId,scores:Array.from(network.forward(input,n))});
}
const result={schemaVersion:'r6-H-parent-forward-probe-v1',at:new Date().toISOString(),contractSHA256:fileHash(contractPath),parentWeightsSHA256:manifest.parent.weightsSHA256,split:'train',purpose:'TS/Python frozen-parent numerical identity only; no model selection or heldout scoring',trainingUpdates:0,rows};
writeFileSync(contract.parentProbe.path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path:contract.parentProbe.path,sha256:fileHash(contract.parentProbe.path),trainDecisions:8,trainingUpdates:0,heldoutModelScoresOpened:false}));
