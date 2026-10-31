import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileStore } from '../server/llm-profiles.mjs';
import { createProfileClient } from '../src/game/llm-profiles';
import { providerPresetFields, validateProviderPreset, describeProviderAvailability } from '../src/game/provider-presets';
const dirs:string[]=[];
const fields=()=>({profileId:'fake-glm-restored',nickname:'GLM',protocol:'anthropic-messages',baseUrl:'https://open.bigmodel.cn/api/anthropic',requestedModel:'glm-5.3',supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},output_config:{effort:'max'},max_tokens:32768}});
function store(){const d=mkdtempSync(join(tmpdir(),'glm-fake-'));dirs.push(d);return createProfileStore({filePath:join(d,'profiles.json')});}
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it('GLM recovery: exact Anthropic output_config roundtrips private store and strict public client without secret',async()=>{
 const s=store(),p=s.save({profile:{...fields(),secret:'SYNTHETIC_GLM_SECRET_ONLY'},expectedRevision:null});
 expect(p.requestOptions.output_config).toEqual({effort:'max'});expect(JSON.stringify(p)).not.toContain('SYNTHETIC');
 const client=createProfileClient({storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},fetchImpl:async()=>({ok:true,status:200,json:async()=>[p]})});
 expect(await client.refresh()).toEqual([p]);
});
it('GLM recovery: exact preserved route builds and validates its distinct max representation',()=>{
 const p=providerPresetFields('glm',{profileId:'fake-glm-restored',nickname:'GLM'},{protocol:'anthropic-messages',baseUrl:'https://open.bigmodel.cn/api/anthropic'});
 expect(p).toEqual(fields());expect(()=>validateProviderPreset('glm',p)).not.toThrow();
 const publicP={...p,revision:1,snapshotHash:'a'.repeat(64)};
 expect(describeProviderAvailability('glm',{schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null},[publicP]).reason).toContain('API已保存');
});
it('GLM recovery: schema rejects cross-protocol effort, undeclared effort and extra nested keys',()=>{
 const s=store();for(const change of [
 {protocol:'openai-chat-completions'},
 {supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['max']},requestOptions:{thinking:{type:'enabled'},output_config:{effort:'high'},max_tokens:32768}},
 {requestOptions:{thinking:{type:'enabled'},output_config:{effort:'max',extra:1},max_tokens:32768}},
 {requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max',max_tokens:32768}},
 {supportedReasoningOptions:{thinking:['enabled'],output_config_effort:['xhigh']}},
 ])expect(()=>s.save({profile:{...fields(),...change,secret:'SYNTHETIC_ONLY'},expectedRevision:null})).toThrow();
});
