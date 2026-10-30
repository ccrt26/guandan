/** Read-only development choices for a frozen checkpoint; no match outcomes. */
import{join,resolve}from'node:path';import{HOME,json,atomicJson,fileHash}from'./protocol';import{policyForRun,scoreRoot}from'./evaluate';
const run=process.argv[2],expectedUpdate=Number(process.argv[3]),config=json(resolve(process.argv[4]??join(HOME,'config.json'))),candidate=policyForRun(config,run),manifest=json(join(HOME,'data/dev-roots-001/manifest.json'));
if(!Number.isSafeInteger(expectedUpdate)||candidate.policyId!==run+'-u'+expectedUpdate+'-greedy')throw Error('expected frozen checkpoint update not reached');
const policies=[policyForRun(config,'O'),policyForRun(config,'U0'),candidate];
const decisions=manifest.roots.map((r:any)=>{if(fileHash(r.rootRef)!==r.rootSHA256)throw Error('development source changed');const root=json(r.rootRef);return{rootId:r.rootId,sourceFamilyId:r.sourceFamilyId,category:r.category,split:'dev',choices:policies.map(p=>scoreRoot(p,root)),supported:null};});
const output=join(HOME,'development',candidate.policyId+'-choices-only/root-decisions.json');atomicJson(output,{scope:'choices only;0newmatches;unverified strategy, not accuracy',decisions});console.log(JSON.stringify({output,roots:decisions.length,newMatches:0,policySHA256:candidate.weightsSHA256}));
