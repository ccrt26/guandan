import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{deriveSeed}from'@gd/ai';
import{resolveContinuationProfile}from'../review6/policy-registry';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const kernel=fileURLToPath(new URL('../review6/paired_stats.py',import.meta.url));
const registryPath=fileURLToPath(new URL('../review6_1/data/no-H-policy-registry-001.json',import.meta.url));

/** A boolean or a confidence claim is not a certificate. Bind the actual
 * original-target rows, frozen profiles, distinct worlds and bootstrap kernel. */
export function assertStrongEvidence(card:any,root:any,key:string){
 const pairs=card.pairs??[{preferredActionId:card.preferredActionId,otherActionId:card.otherActionId}];
 const refs=card.statisticsRefs??[{path:card.statisticsRef,sha256:card.statisticsSHA256}];
 if(refs.length!==pairs.length)throw Error('strong evidence must cover every pair');
 const registry=read(registryPath),obs=root.observedBefore;
 refs.forEach((ref:any,j:number)=>{
  if(!ref.path||sha(ref.path)!==ref.sha256)throw Error('strong evidence file identity required');
  const s=read(ref.path),pair=pairs[j];
  if(s.supported!==true||s.worldSeedRule!=='public-observation-only-v2'||s.scope!=='root_action_only'||s.negativeLabelProduced!==false||s.lineageValid!==true||s.rootKey!==key||s.observationSHA256!==obs.observationSHA256||s.preferredActionId!==pair.preferredActionId||s.otherActionId!==pair.otherActionId||s.sourceSHA256!==sha(kernel)||!s.inputRef||sha(s.inputRef)!==s.inputSHA256)throw Error('strong evidence contract/root binding mismatch');
  if(s.registrySHA256!==sha(registryPath))throw Error('strong evidence frozen registry mismatch');
  const data=read(s.inputRef),allIds=new Set<string>();
  if(data.expectedPrimaryWorlds!==256)throw Error('strong primary256 contract required');
  for(const[phase,n,threshold]of[['primary',256,.02],['secondary',128,0]]as const){
   const interval=s[phase],rows=data[phase],profile=resolveContinuationProfile(registry,phase,obs.actor);
   if(rows?.length!==n||interval?.independentUnits!==n||interval.replicates!==20000||interval.method!=='percentile'||interval.interpolation!=='R_type_7_linear'||JSON.stringify(interval.probabilities)!=='[0.0125,0.9875]'||!(interval.columns?.d.quantiles[0]>threshold))throw Error('strong256/128 confidence contract mismatch');
   const expectedBoot=deriveSeed('review6-2-strong-bootstrap-v2',2026102904,0,phase+':'+obs.observationSHA256);
   if(data[phase+'Seed']!==expectedBoot||interval.seed!==expectedBoot)throw Error('strong bootstrap identity mismatch');
   let sum=0;
   for(let i=0;i<n;i++){
    const row=rows[i],id=key+':'+phase+':'+String(i).padStart(4,'0');
    if(row.worldId!==id||allIds.has(id))throw Error('strong independent world identity mismatch');allIds.add(id);
    const seed=deriveSeed('review6-2-strong-independent-world-v2',2026102903,0,phase+':'+i+':'+obs.observationSHA256);
    for(const[arm,action]of[['A',pair.preferredActionId],['B',pair.otherActionId]]){
     const r=row[arm];
     if(r?.complete!==true||!Number.isInteger(r.g)||![-3,-2,-1,1,2,3].includes(r.g)||![-1,1].includes(r.W)||r.y!==r.g+r.W||r.seed!==seed||r.forcedActionId!==action||r.profileName!==phase||r.profileSHA256!==profile.profileSHA256||JSON.stringify(r.policyIds)!==JSON.stringify(profile.seats.map(s=>s.policyId)))throw Error('strong raw complete g+W/profile contract mismatch');
    }
    if(!row.A.initialWorldSHA256||row.A.initialWorldSHA256!==row.B.initialWorldSHA256)throw Error('strong branches do not share the same world');
    sum+=(row.A.y-row.B.y)/8;
   }
   if(Math.abs(sum/n-interval.columns.d.point)>1e-12)throw Error('strong raw mean differs from statistics');
  }
 });
}
