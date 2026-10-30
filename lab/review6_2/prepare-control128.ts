/** Audited dev-only prefix reuse. Original 32-block files are never modified. */
import{existsSync}from'node:fs';import{join}from'node:path';import{deriveSeed}from'@gd/ai';import{createMatch,startGame,DEFAULT_RULES}from'@gd/engine';import{indexedDealSeed}from'../review6/match-play';import{engineDealFamily}from'../review6/capability-lineage';
import{HOME,ROOT,json,hash,fileHash,atomicJson,readRegistry}from'./protocol';import{policyForRun,evaluationLayouts,outcomeBlock}from'./evaluate';
const config=json(join(HOME,'p7-control-config.json')),candidate=policyForRun(config,'r62-p7-control');
if(candidate.policyId!=='r62-p7-control-u800-greedy')throw Error('fixed control800 required');
const registry=readRegistry(config),layouts=evaluationLayouts(registry,candidate,'dev'),phase='dev',seed=config.seed,code=['lab/review6_2/evaluate.ts','lab/review6/match-play.ts','lab/review6/variance-layout.ts'].map(p=>fileHash(join(ROOT,p)));
const identity=(n:number)=>hash(JSON.stringify({candidate,registry:fileHash(config.registryPath),layouts,counts:{cooperation:n,M1:n,M2:n},phase,seed,code}));
const old=join(HOME,'development',candidate.policyId+'-32blocks'),out=join(HOME,'development',candidate.policyId+'-128blocks'),oldManifest=join(old,'manifest.json'),manifest=json(oldManifest),oldIdentity=identity(32),newIdentity=identity(128),index=json(config.sourceIndexRef);
if(manifest.identity!==oldIdentity||json(join(old,'report.json')).status!=='completed')throw Error('old32 simulation/policy/config identity no longer matches');
if(existsSync(join(out,'manifest.json'))&&json(join(out,'manifest.json')).identity!==newIdentity)throw Error('existing128 manifest mismatch');
const originalHashes=[{path:oldManifest,sha256:fileHash(oldManifest)}],reuse:any[]=[];
const source=(metric:string,ordinal:number)=>{const worldSeed=deriveSeed('review6-2-evaluation-source-v1',seed,ordinal,phase+':'+metric),dealNamespace=`review6-2-${phase}-${metric}-deals-v1`;return{seed:worldSeed,dealNamespace,familyId:engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(dealNamespace,worldSeed,0))).hands)};};
for(let i=0;i<32;i++){
 const name=`block-${String(i).padStart(5,'0')}.json`,path=join(old,name),sha256=fileHash(path),b=json(path),v:any=outcomeBlock(b.matches,layouts);
 if(b.identity!==oldIdentity||b.ordinal!==i||Object.keys(v).some(k=>JSON.stringify(v[k])!==JSON.stringify(b[k]))||['cooperation','M1','M2'].some(metric=>JSON.stringify(b.sources[metric])!==JSON.stringify(source(metric,i))))throw Error('old32 raw/aggregate/source differs');
 if(b.matches.some((r:any)=>!Number.isSafeInteger(r.games)||r.games<1||r.games>80||!/^[a-f0-9]{64}$/.test(r.traceSHA256)||r.roundBaseFamilies?.length!==r.games||r.roundBaseFamilies[0]!==b.sources[r.metric].familyId||r.roundBaseFamilies.some((f:string)=>index.families[f]?.split!=='dev')))throw Error('old32 full raw ancestry/trace incomplete');
 const prefixes=new Map<string,string[]>();
 for(const r of b.matches){
  const s=b.sources[r.metric],expected=prefixes.get(r.metric)??[];
  while(expected.length<r.games)expected.push(engineDealFamily(startGame(createMatch({...DEFAULT_RULES},indexedDealSeed(s.dealNamespace,s.seed,expected.length))).hands));
  prefixes.set(r.metric,expected);
  if(r.roundBaseFamilies.some((f:string,g:number)=>f!==expected[g]))throw Error('old32 future gameNo source family differs from indexed deal');
 }
 const reusedFrom={path,sha256,identity:oldIdentity,manifestRef:oldManifest,manifestSHA256:fileHash(oldManifest)},member={...b,identity:newIdentity,reusedFrom},target=join(out,name);
 if(existsSync(target)){if(JSON.stringify(json(target))!==JSON.stringify(member))throw Error('existing128 prefix changed');}else atomicJson(target,member);
 originalHashes.push({path,sha256});reuse.push({ordinal:i,...reusedFrom,newMemberRef:target,newMemberSHA256:fileHash(target)});
}
if(originalHashes.some(r=>fileHash(r.path)!==r.sha256))throw Error('old32 bytes changed');
const binding={scope:'dev only; old32 selected prefix reused; new96 are supplemental development, not formal confirmation',candidate,registrySHA256:fileHash(config.registryPath),seed,phase,oldIdentity,newIdentity,code,oldBlocks:32,newBlocks:96,totalBlocks:128,reusedPhysicalMatches:512,plannedNewPhysicalMatches:1536,originalFilesUnchanged:true,reuse};
const bindingRef=join(out,'reuse-prefix.json');if(existsSync(bindingRef)&&JSON.stringify(json(bindingRef))!==JSON.stringify(binding))throw Error('prefix binding changed');atomicJson(bindingRef,binding);
console.log(JSON.stringify({bindingRef,reusedPhysicalMatches:512,plannedNewPhysicalMatches:1536,originalFilesUnchanged:true,identity:newIdentity}));
