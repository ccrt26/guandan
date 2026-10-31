import { expect, it } from 'vitest';
import { providerPresetFields, resolveProviderBinding, validateProviderPreset, type ProviderId } from '../src/game/provider-presets';
import { loadProviderBindings, saveProviderBindings } from '../src/game/storage';
const p = { profileId:'fake-profile',nickname:'any name',protocol:'openai-chat-completions' as const,baseUrl:'https://open.bigmodel.cn/api/paas/v4',requestedModel:'glm-5.3',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'},revision:1,snapshotHash:'a'.repeat(64) };
const ref = {profileId:p.profileId,revision:1,snapshotHash:'a'.repeat(64)};
const bindings = {schema:'ohuo-provider-bindings-v1' as const,glm:ref,deepseek:null};
it.each(['glm','deepseek'] as ProviderId[])('builds %s exact wire options with no temperatures or token fallback',provider=>{
 const result=providerPresetFields(provider,{profileId:'fixture',nickname:'fixture'});expect(result.requestedModel).toBe(provider==='glm'?'glm-5.3':'deepseek-flash');expect(result.requestOptions).toEqual({thinking:{type:'enabled'},reasoning_effort:'max'});expect(result.supportedReasoningOptions).toEqual({thinking:['enabled'],reasoning_effort:['low','high','max']});expect(()=>validateProviderPreset(provider,result)).not.toThrow();
});
it.each([
 {requestedModel:'glm-5.3-flash'}, {protocol:'anthropic-messages'}, {baseUrl:'https://open.bigmodel.cn/api/anthropic'},
 {baseUrl:'https://open.bigmodel.cn/api/paas/v4/'}, {requestOptions:{thinking:{type:'enabled'},reasoning_effort:'xhigh'}},
 {requestOptions:{thinking:{type:'enabled'},reasoning_effort:'high'}}, {requestOptions:{thinking:{type:'disabled'},reasoning_effort:'max'}},
 {requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max',temperature:0.2}}, {supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['high','max']}}
])('rejects nonmatching preset instead of substituting defaults (%j)',delta=>{expect(()=>validateProviderPreset('glm',{...p,...delta} as any)).toThrow();});
it('DeepSeek rejects chat/reasoner alias and xhigh rather than mislabelling them max',()=>{
 const good=providerPresetFields('deepseek',{profileId:'fixture',nickname:'GLM'});
 for(const model of ['deepseek-chat','deepseek-reasoner'])expect(()=>validateProviderPreset('deepseek',{...good,requestedModel:model})).toThrow();
 expect(()=>validateProviderPreset('deepseek',{...good,requestOptions:{thinking:{type:'enabled'},reasoning_effort:'xhigh'}})).toThrow();
});
it('resolves exact ref only; nickname, list order and changed revision cannot choose a replacement',()=>{
 const renamed={...p,nickname:'DeepSeek'};expect(resolveProviderBinding('glm',bindings,[renamed])).toBe(renamed);
 expect(resolveProviderBinding('deepseek',bindings,[p])).toBeNull();expect(()=>resolveProviderBinding('glm',bindings,[{...p,revision:2}])).toThrow();
 expect(()=>resolveProviderBinding('glm',bindings,[{...p,profileId:'other'}])).toThrow();expect(()=>resolveProviderBinding('glm',bindings,[p,p])).toThrow();
 expect(()=>resolveProviderBinding('glm',bindings,[{...p,requestOptions:{reasoning_effort:'high'}}])).toThrow();
});
it('public binding storage has exact shape, no secret or destructive fallback, and propagates read/write failure',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)};
 expect(loadProviderBindings(storage)).toEqual({schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null});saveProviderBindings(bindings,storage);expect(loadProviderBindings(storage)).toEqual(bindings);
 expect(data.get('gd_provider_bindings_v1')).toBe(JSON.stringify(bindings));expect(()=>saveProviderBindings({...bindings,secret:'SYNTHETIC_ONLY'} as any,storage)).toThrow();
 const original=data.get('gd_provider_bindings_v1');expect(()=>saveProviderBindings({...bindings,glm:{...ref,secret:'SYNTHETIC_ONLY'}} as any,storage)).toThrow();expect(data.get('gd_provider_bindings_v1')).toBe(original);
 data.set('gd_provider_bindings_v1','broken');expect(()=>loadProviderBindings(storage)).toThrow();expect(data.get('gd_provider_bindings_v1')).toBe('broken');
 expect(()=>loadProviderBindings({getItem(){throw Error('unavailable');}})).toThrow();expect(()=>saveProviderBindings(bindings,{setItem(){throw Error('quota');}})).toThrow();
});
