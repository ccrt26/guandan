import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('node:fs',async original=>{const actual=await original<typeof import('node:fs')>();return {...actual,writeFileSync:vi.fn(actual.writeFileSync)};});
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {freezeDataset,loadFrozenDataset} from '../review6_2/distill-data';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const out=fileURLToPath(new URL('../out/',import.meta.url));mkdirSync(out,{recursive:true});const root=mkdtempSync(join(out,'v543-freeze-')),sourceIndexPath=join(root,'index.json'),index=JSON.stringify({version:1,families:{family:{split:'train'}}});writeFileSync(sourceIndexPath,index);
 const basePolicy={policyId:'fixture-B',inputDim:399,encoderVersion:'fixture-v1'},teacher={releaseRef:'fixture-H',promptRef:'fixture-prompt',profileSnapshot:{profileId:'fixture',revision:1,snapshotHash:'a'.repeat(64),credentialRevision:1,protocol:'openai-chat-completions',requestedModel:'fixture'}};
 const sourceQueue={schema:'ohuo-complete-match-queue-v1',sourceIndexRef:'index',rows:[]};
 const plan:any={schema:'ohuo-distill-plan-v1',datasetId:'fixture',purpose:'engineering_fixture',sourceIndexRef:'index',sourceIndexSHA256:sha(index),queueRef:'queue',queueSHA256:sha(JSON.stringify(sourceQueue)),samplingRef:'frozen-fixture',identities:{basePolicy,teacher,encoderVersion:'fixture-v1',encoderConfig:{schema:'v2',ctxFill:'rule-context',passEncoding:'action64'},candidateSpecRef:'ohuo-frozen-c8-expand4-v1',promptRef:teacher.promptRef},families:[{sourceFamily:'family',split:'train',sourceRefs:['source']}],games:[]};
 const args={plan,sourceIndexPath,sourceQueue,rows:[],outputDir:join(root,'dataset')};return {root,args,freeze:()=>freezeDataset(args)};
}
beforeEach(async()=>{const actual=await vi.importActual<typeof import('node:fs')>('node:fs');vi.mocked(writeFileSync).mockReset();vi.mocked(writeFileSync).mockImplementation(actual.writeFileSync);});
it('returns the original complete reference without rewriting files after a lost receipt',()=>{
 const f=fixture(),first=f.freeze(),manifest=readFileSync(join(first.directory,'manifest.json')),samples=readFileSync(join(first.directory,'samples.jsonl'));vi.mocked(writeFileSync).mockClear();
 expect(f.freeze()).toEqual(first);expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();expect(readFileSync(join(first.directory,'manifest.json'))).toEqual(manifest);expect(readFileSync(join(first.directory,'samples.jsonl'))).toEqual(samples);expect(loadFrozenDataset(first).samples).toHaveLength(0);
});
it('keeps the final destination absent on a samples-to-manifest failure and can publish the same identity on retry',async()=>{
 const f=fixture(),actual=await vi.importActual<typeof import('node:fs')>('node:fs');let partial:string|undefined;
 vi.mocked(writeFileSync).mockImplementation(((path:any,...rest:any[])=>{if(String(path).endsWith('/manifest.json')){partial=dirname(String(path));throw Error('synthetic local disk failure');}return (actual.writeFileSync as any)(path,...rest);}) as any);
 expect(f.freeze).toThrow('synthetic local disk failure');expect(existsSync(f.args.outputDir)).toBe(false);expect(partial).toBeDefined();expect(readFileSync(join(partial!,'samples.jsonl'),'utf8')).toBe('');
 vi.mocked(writeFileSync).mockImplementation(actual.writeFileSync);const result=f.freeze();expect(result.directory).toBe(f.args.outputDir);expect(loadFrozenDataset(result).manifest.datasetId).toBe('fixture');expect(existsSync(partial!)).toBe(true);
});
it.each(['different-plan','tampered-samples','legacy-partial'] as const)('rejects %s without replacing existing output',kind=>{
 const f=fixture();if(kind==='legacy-partial'){mkdirSync(f.args.outputDir);writeFileSync(join(f.args.outputDir,'samples.jsonl'),'partial');}else{f.freeze();if(kind==='different-plan')f.args.plan.samplingRef='different';else writeFileSync(join(f.args.outputDir,'samples.jsonl'),'tampered');}
 const before=readdirSync(f.args.outputDir).map(name=>[name,readFileSync(join(f.args.outputDir,name))]);expect(f.freeze).toThrow(/output_/);expect(readdirSync(f.args.outputDir).map(name=>[name,readFileSync(join(f.args.outputDir,name))])).toEqual(before);
});
