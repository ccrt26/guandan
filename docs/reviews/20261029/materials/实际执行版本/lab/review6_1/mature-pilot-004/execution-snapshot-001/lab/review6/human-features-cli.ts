import {readFileSync} from 'node:fs';
import {prepareHumanFeatures} from './human-features';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--config')throw new Error('expected --config path');
try{const result=await prepareHumanFeatures(JSON.parse(readFileSync(args[1],'utf8')));process.stdout.write(JSON.stringify({stageStatus:'features_verified',trainingStarted:false,neuralForwardCalls:0,...result})+'\n');}
catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',resultCode:'H_feature_preparation_failed',message:(error as Error).message,partialEvidenceRetained:true})+'\n');process.exitCode=2;}
