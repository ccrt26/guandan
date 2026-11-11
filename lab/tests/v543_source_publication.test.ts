import {beforeEach,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DEFAULT_RULES} from '@gd/engine';
import {referenceOf} from '../review6_2/task-schema.mjs';

// A fixture-only zero-root workload reaches the real publisher without dealing
// cards, generating questions, loading weights, playing a game or calling APIs.
const seams=vi.hoisted(()=>({failName:null as string|null}));
vi.mock('node:fs',async original=>{const actual=await original<typeof import('node:fs')>();return {...actual,writeFileSync:(path:any,...args:any[])=>{if(seams.failName&&String(path).endsWith('/'+seams.failName))throw Error('synthetic publication write failure');return (actual.writeFileSync as any)(path,...args);}};});
vi.mock('../review6_2/first-round-source-batch.mjs',async original=>({...await original<any>(),sourceStageWorkload:()=>({reservedCount:0,devCount:0})}));
vi.mock('../review6/policy-registry',async original=>({...await original<any>(),validatePolicyRegistry:(value:any)=>value}));
vi.mock('../review6_2/first-round-registry-policy',async original=>({...await original<any>(),validateFirstRoundRegistryPolicy:()=>({})}));
vi.mock('../../packages/ai/src/policy/candidate-release',async original=>{const {FIRST_TARGET_CANDIDATE_SPEC}=await import('../../packages/ai/src/candidate-spec');return {...await original<any>(),resolveCandidateReleaseRef:()=>({candidatePolicy:{candidateSpec:FIRST_TARGET_CANDIDATE_SPEC},release:{mode:'local',tier:'hard'},policyIdentity:{policyId:'fixture-B'}})};});
vi.mock('../review6_2/first-round-parent',async original=>({...await original<any>(),validateFirstRoundParentEnvelope:()=>({basePolicyIdentity:{policyId:'fixture-B'}})}));
import {prepareFirstRoundSources} from '../review6_2/first-round-source';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
beforeEach(()=>{seams.failName=null;});
function fixture(){
 const repositoryRoot=realpathSync(mkdtempSync(join(tmpdir(),'v543-source-publication-')));mkdirSync(join(repositoryRoot,'lab/out'),{recursive:true});
 const references=new Map<string,any>(),evidenceFiles=new Map<string,any>();
 const ref=(id:string,value:any)=>{const key=referenceOf(id,value);references.set(key,value);return key;};
 const evidence=(id:string,value:any)=>{const bytes=JSON.stringify(value)+'\n',path=join(repositoryRoot,id+'.json');writeFileSync(path,bytes);const f={id,sha256:sha(bytes)};evidenceFiles.set(id,{path:relative(repositoryRoot,path),sha256:f.sha256});return f;};
 const registryRef=evidence('registry',{schemaVersion:'r6-no-H-policy-registry-v1',selectedExperiment:'direct_teacher_no_h',developmentPartners:['P0','P1','P2'],oldCompletePolicy:'O'});
 const excluded=evidence('excluded',{version:1,families:{'fixture-prior':{split:'dev'}}});
 const partnerRefs=['P0','P1','P2'].map(policyId=>ref(policyId,{registryRef,policyId})),opponentRef=ref('O',{registryRef,policyId:'O'});
 const spec:any={schema:'ohuo-first-round-source-spec-v1',purpose:'engineering_fixture',outputId:'published',reservationRef:null,planRef:ref('plan',{}),rulesRef:ref('rules',DEFAULT_RULES),seed:1,registryRef,partnerPolicyIds:['P0','P1','P2'],opponentPolicyId:'O',comparisonRef:ref('comparison',{schema:'ohuo-first-round-comparison-v1',proposalRef:ref('proposal',{}),studentParentRef:ref('parent',{})}),bindings:{partnerRefs,opponentRef,s0Ref:null,s1Ref:null,s1ReleaseFileRef:null},stages:Object.fromEntries(['pilot','formal','newTest','variancePilot','confirmation'].map(stage=>[stage,{namespace:'fixture-'+stage,dealNamespace:'fixture-deal-'+stage,activeCount:0}])),confirmationPlanningRef:null,exclusionIndexRefs:[excluded]};
 const run=(value=spec)=>prepareFirstRoundSources({specRef:ref('spec',value),repositoryRoot,references,evidenceFiles});
 return {spec,run,repositoryRoot,outputRoot:join(repositoryRoot,'lab/out/published'),parent:join(repositoryRoot,'lab/out')};
}
it('publishes a complete metadata directory and reuses its exact bytes without writes',()=>{
 const f=fixture(),first=f.run(),path=join(f.outputRoot,'manifest.json'),before=readFileSync(path),mtime=statSync(path).mtimeMs;
 expect(first.status).toBe('written');expect(first.manifest.actualMatches).toBe(0);expect(first.files).toHaveLength(5);
 expect(f.run().status).toBe('unchanged');expect(readFileSync(path)).toEqual(before);expect(statSync(path).mtimeMs).toBe(mtime);
});
// The old final-directory-first writer leaves outputRoot present and cannot
// repeat the same frozen spec after this exact mid-publication failure.
it('retains a failed staging directory and can publish the same output identity on retry',()=>{
 const f=fixture();seams.failName='formal-source-index.json';expect(()=>f.run()).toThrow('synthetic publication write failure');
 expect(existsSync(f.outputRoot)).toBe(false);const stages=readdirSync(f.parent);expect(stages).toHaveLength(1);expect(stages[0]).toMatch(/^published\.staging-/);
 const stage=join(f.parent,stages[0]),prior=readFileSync(join(stage,'pilot-source-index.json'));seams.failName=null;
 const result=f.run();expect(result.status).toBe('written');expect(result.outputRoot).toBe(f.outputRoot);expect(readFileSync(join(stage,'pilot-source-index.json'))).toEqual(prior);
 expect(result.files.every((entry:any)=>existsSync(join(f.repositoryRoot,entry.file.path)))).toBe(true);
});
it('rejects an old partial final directory without overwriting or deleting it',()=>{
 const f=fixture();mkdirSync(f.outputRoot);writeFileSync(join(f.outputRoot,'pilot-source-index.json'),'retained-partial');
 expect(()=>f.run()).toThrow('existing_output_conflict');expect(readFileSync(join(f.outputRoot,'pilot-source-index.json'),'utf8')).toBe('retained-partial');expect(readdirSync(f.outputRoot)).toEqual(['pilot-source-index.json']);
});
it('rejects a different frozen spec at an existing complete destination without changing it',()=>{
 const f=fixture();f.run();const path=join(f.outputRoot,'manifest.json'),before=readFileSync(path);
 expect(()=>f.run({...f.spec,seed:2})).toThrow('existing_output_conflict');expect(readFileSync(path)).toEqual(before);
});
