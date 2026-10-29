import {readFileSync} from 'node:fs';
import {prepareHumanSource} from './data-source';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--config')throw new Error('expected --config path');
try{const result=await prepareHumanSource(JSON.parse(readFileSync(args[1],'utf8')));process.stdout.write(JSON.stringify({stageStatus:'source_split_locked',resultCode:'mechanical_provenance_only_not_data_gate',...result})+'\n');}
catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',message:(error as Error).message})+'\n');process.exitCode=2;}
