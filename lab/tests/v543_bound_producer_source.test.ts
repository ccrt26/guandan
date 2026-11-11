import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {digest,referenceOf} from '../review6_2/task-schema.mjs';

// Only the workspace resolver is synthetic. Source/ref byte reading, canonical
// identities, file metadata, source matching and the inventory loop stay real.
const workspace=vi.hoisted(()=>({root:''}));
vi.mock('node:module',async(importOriginal)=>{
 const original=await importOriginal<typeof import('node:module')>();
 return {...original,createRequire:(url:any)=>{
  const require=original.createRequire(url);
  return new Proxy(require,{get(target,key,receiver){
   if(key==='resolve')return (id:string,options:any)=>['@gd/ai','@gd/engine','@gd/review'].includes(id)?join(workspace.root,'packages',id.slice(4),'src/index.ts'):target.resolve(id,options);
   return Reflect.get(target,key,receiver);
  }});
 }};
});
import {FixedHostFiles,HOST_SOURCE_FILES,FIRST_ROUND_SOURCE_FILES} from '../review6_2/ohuo-host-files';

const roots:string[]=[],sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bound-producer-source-')));roots.push(root);workspace.root=root;
 const put=(path:string,bytes:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes,{mode:0o600});return {path,sha256:sha(bytes)};};
 const files=[...new Set([...HOST_SOURCE_FILES,...FIRST_ROUND_SOURCE_FILES])].map(path=>put(path,'fixed fixture source\n'));
 const references:any[]=[],add=(name:string,value:any)=>{const ref=referenceOf(name,value);references.push({ref,file:put('refs/'+digest(value)+'-'+references.length+'.json',JSON.stringify(value))});return ref;};
 const source={baseCommit:'a'.repeat(40),files},sourceRef=add('source/current',source),initialStateRef=add('initial-state',{fixture:true});
 mkdirSync(join(root,'lab/out/control'),{recursive:true});
 const grantFile=put('grant.json','{}');
 const host=()=>{
  put('deliverables/ohuo-runtime/host.json',JSON.stringify({schema:'ohuo-fixed-host-v1',controlRoot:'lab/out/control',rootInstanceId:'producer-fixture',initialStateRef,references,evidenceFiles:[],grantFile,planCloseoutFile:'closeout.json',inputBindings:[],profileStorePath:null,pythonPath:null}));
  return new FixedHostFiles(root) as any;
 };
 return {root,put,source,sourceRef,files,references,add,host};
}

describe('exact producer source lookup',()=>{
 it('ignores an unrelated unavailable ref only in the explicitly bound lookup',()=>{
  const f=fixture(),missing=referenceOf('unrelated',{fixture:'unavailable'});
  f.references.push({ref:missing,file:{path:'refs/missing.json',sha256:'b'.repeat(64)}});
  const host=f.host();
  expect(host.currentProducerSource(f.sourceRef)).toBe(f.sourceRef);
  expect(()=>host.currentProducerSource()).toThrow();
 });

 it('retains exact source identity while unbound discovery rejects multiple matches',()=>{
  const f=fixture(),other=f.add('source/other',{...f.source,baseCommit:'b'.repeat(40)}),host=f.host();
  expect(host.currentProducerSource(f.sourceRef)).toBe(f.sourceRef);
  expect(host.currentProducerSource(other)).toBe(other);
  expect(()=>host.currentProducerSource()).toThrow(/input_identity_unverified/);
 });

 it('rejects a changed explicit dependency on the next call without falling back',()=>{
  const f=fixture(),host=f.host();expect(host.currentProducerSource(f.sourceRef)).toBe(f.sourceRef);
  f.put(f.files[0].path,'changed fixture source\n');
  expect(()=>host.currentProducerSource(f.sourceRef)).toThrow(/input_identity_unverified/);
 });

 it('does not fall back to a valid catalog source when the selected source is absent',()=>{
  const f=fixture(),host=f.host();
  expect(()=>host.currentProducerSource(referenceOf('source/missing',{fixture:true}))).toThrow();
  expect(host.currentProducerSource()).toBe(f.sourceRef);
 });

 it.each(['missing-closure','duplicate-path','invalid-hash'] as const)('rejects %s in the exact source',kind=>{
  const f=fixture(),files=f.files.map(row=>({...row}));
  if(kind==='missing-closure')files.pop();
  if(kind==='duplicate-path')files.push({...files[0]});
  if(kind==='invalid-hash')files[0].sha256='not-a-hash';
  const bad=f.add('source/bad',{...f.source,files}),host=f.host();
  expect(()=>host.currentProducerSource(bad)).toThrow();
 });

 it('keeps the public historical label-start path on unbound discovery',async()=>{
  const f=fixture();f.add('source/other',{...f.source,baseCommit:'b'.repeat(40)});
  await expect(f.host().offlineSelectionHostInputs({},{phase:'label-start',task:{sourceRevision:f.sourceRef}})).rejects.toThrow(/input_identity_unverified/);
 });

 it('uses the exact current Task source in the execution consumer before later action gates',async()=>{
  const f=fixture();f.add('source/other',{...f.source,baseCommit:'b'.repeat(40)});
  const specRef=f.add('selection-spec',{outputId:'fixture-selection'}),productionRef=f.add('production',{specRef}),selectionRef='fixture-selection';
  const host=f.host(),refs=new Map([[selectionRef,{schema:'ohuo-offline-label-selection-v2',productionRef}]]);
  vi.spyOn(host,'checkExistingRoot').mockReturnValue({runs:{},tasks:{}});
  // Stop at the next independent authorization/action gate. A regression to
  // catalog-wide source discovery fails first because both sources match.
  vi.spyOn(host,'readNonrunnerAction').mockImplementation(()=>{throw Error('fixture_action_not_authorized');});
  await expect(host.offlineSelectionInputs({taskId:'fixture',datasetRefs:[selectionRef],sourceRevision:f.sourceRef},refs,{})).rejects.toThrow('fixture_action_not_authorized');
 });

 it('does not remove full catalog inventory checks after an exact source match',async()=>{
  const f=fixture();f.references.push({ref:referenceOf('inventory',{fixture:'unavailable'}),file:{path:'refs/missing-inventory.json',sha256:'b'.repeat(64)}});
  const host=f.host(),action={clauseRef:'fixture',branchRef:null};
  vi.spyOn(host,'readNonrunnerAction').mockReturnValue({action,closeout:{entity:{status:'incomplete',actions:[action]}}});
  vi.spyOn(host,'checkExistingRoot').mockReturnValue({});
  vi.spyOn(host,'assertDiagnosticWriteIntersection').mockImplementation(()=>{});
  await expect(host.offlineSelectionHostInputsScoped({outputId:'fixture-selection'},{phase:'label-start',task:{sourceRevision:f.sourceRef}},f.sourceRef)).rejects.toThrow(/missing-inventory/);
 });
});
