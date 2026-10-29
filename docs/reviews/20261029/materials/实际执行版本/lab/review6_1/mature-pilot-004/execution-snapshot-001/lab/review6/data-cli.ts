import {readFileSync} from 'node:fs';
import {auditHumanData} from './data-audit';
try{const result=await auditHumanData(JSON.parse(readFileSync(process.argv[2],'utf8')));process.stdout.write(JSON.stringify(result)+'\n');if(result.totals.unexplainedCandidateOmissions)process.exitCode=2;}
catch(error){process.stderr.write(JSON.stringify({stageStatus:'blocked',resultCode:'strict_data_audit_failed',message:(error as Error).message,partialEvidenceRetained:true})+'\n');process.exitCode=2;}
