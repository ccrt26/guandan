import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {verifyRound,DEFAULT_MAPPING} from '../src/review5_tuning/kscbReplay';
import {streamHumanMatches} from './data-source';
import {fileHash} from './product-artifacts';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--config'||args[2]!=='--out')throw new Error('expected --config path --out new-path');
const config=JSON.parse(readFileSync(args[1],'utf8')),out=resolve(args[3]),decisions=out+'.decisions.jsonl';
if(existsSync(out)||existsSync(decisions))throw new Error('refuse overwrite');
if(fileHash(config.data.sourcePath)!==config.data.sourceSHA256)throw new Error('source hash mismatch');
writeFileSync(decisions,'',{flag:'wx'});
const started=Date.now(),verdicts:unknown[]=[],consumedIds:string[]=[];let total=0,matched=0,rawActions=0,rounds=0;
for await(const item of streamHumanMatches(config.data.sourcePath)){
 if(item.lineNo>100)break;const match=item.record;consumedIds.push(match.sample_id);
 for(const round of match.rounds){
  rounds++;rawActions+=round.events.filter(e=>e.event_id===3||e.event_id===4).length;let actionIndex=0;const rows:unknown[]=[];
  const verdict=verifyRound(round,DEFAULT_MAPPING,null,info=>{total++;if(info.candidateMatched)matched++;rows.push({sourceMatchId:match.sample_id,sampleId:round.sample_id,actionIndex:actionIndex++,...info,scope:'legacy_diagnostic_not_consumable_truth'});});
  appendFileSync(decisions,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');verdicts.push({sourceMatchId:match.sample_id,...verdict,tracedActions:actionIndex,rawActions:round.events.filter(e=>e.event_id===3||e.event_id===4).length});
 }
}
const old=JSON.parse(readFileSync(config.data.historicalConsumptionManifest,'utf8'));if(JSON.stringify([...new Set([...old.train,...old.dev,...old.holdout])].sort())!==JSON.stringify(consumedIds.sort()))throw new Error('historical consumed ID set mismatch');
const report={schemaVersion:'r6-historical-human-diagnostic-v1',at:new Date().toISOString(),sourceSHA256:config.data.sourceSHA256,sourceMatches:consumedIds,rounds,rawActions,tracedActions:total,matched,unmatched:total-matched,untracedAfterFailures:rawActions-total,historicalNumbersReproduced:total===94450&&matched===91762&&total-matched===2688,activeWallSeconds:(Date.now()-started)/1000,scope:'actual rerun of unchanged old exported verifier; does not certify target legality, contexts or prefix consumption',limitations:['Old verifier continues with source-rule fallback and may not promote later invalid states; new strict audit must decide consumption.','Old callback runs before some legality checks; candidate presence is not an engine legality certificate.'],sourceFiles:['lab/src/review5_tuning/kscbReplay.ts','lab/review6/data-historical-diagnostic.ts'].map(path=>({path:resolve(path),sha256:fileHash(path)})),decisionRows:{path:decisions,sha256:fileHash(decisions)},verdicts};
writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({rawActions,tracedActions:total,matched,unmatched:total-matched,untraced:rawActions-total,seconds:report.activeWallSeconds,historicalNumbersReproduced:report.historicalNumbersReproduced}));
