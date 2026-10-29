export interface HumanRow {decisionId:string;sourceMatchId:string;split:string;usableForH:boolean;targetRuleLegal:boolean;sourceDeclarationCount:number;targetEquivalentIndices:number[];candidateCount:number;firstIncompatibleEvent:unknown;[key:string]:unknown;}
import {createHash} from 'node:crypto';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export function selectHumanRows(rows:HumanRow[],quota:Record<string,number>,namespace:string){
 const seen=new Set<string>(),splitBySource=new Map<string,string>(),eligible:HumanRow[]=[];
 for(const row of rows){
  if(seen.has(row.decisionId))throw new Error('duplicate decision ID');seen.add(row.decisionId);
  const prior=splitBySource.get(row.sourceMatchId);if(prior&&prior!==row.split)throw new Error('source match crosses splits');splitBySource.set(row.sourceMatchId,row.split);
  if(!row.usableForH)continue;
  if(!row.targetRuleLegal||row.sourceDeclarationCount!==1||row.firstIncompatibleEvent!==null||!row.targetEquivalentIndices.length||new Set(row.targetEquivalentIndices).size!==row.targetEquivalentIndices.length||row.targetEquivalentIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=row.candidateCount))throw new Error('malformed usable target');
  if(['train','dev','holdout'].includes(row.split))eligible.push(row);
  else if(!['historical_diagnostic','unusable'].includes(row.split))throw new Error('unknown source split');
 }
 const selected:Record<string,HumanRow[]>={train:[],dev:[],holdout:[]};
 for(const split of Object.keys(selected)){
  if(!Number.isSafeInteger(quota[split])||quota[split]<1)throw new Error('quota must be a positive integer');
  const groups=new Map<string,HumanRow[]>();for(const row of eligible.filter(r=>r.split===split)){if(!groups.has(row.sourceMatchId))groups.set(row.sourceMatchId,[]);groups.get(row.sourceMatchId)!.push(row);}
  const ids=[...groups.keys()].sort((a,b)=>digest(`${namespace}:match:${a}`).localeCompare(digest(`${namespace}:match:${b}`)));
  for(const group of groups.values())group.sort((a,b)=>digest(`${namespace}:decision:${a.decisionId}`).localeCompare(digest(`${namespace}:decision:${b.decisionId}`)));
  for(let depth=0;selected[split].length<quota[split];depth++){
   let found=false;for(const id of ids){const row=groups.get(id)![depth];if(row){found=true;selected[split].push(row);if(selected[split].length===quota[split])break;}}
   if(!found)break;
  }
 }
 return selected;
}
