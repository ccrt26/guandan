import { expect, it } from 'vitest';
import { describeProviderAvailability } from '../src/game/provider-presets';
import type { PublicProfile, ProviderStateView, ProviderState } from '../src/game/llm-profiles';
const missing:ProviderState={availability:'missing',reference:null,connection:{state:'unknown',reason:'provider_not_ready'}};
const glm:PublicProfile={profileId:'saved-glm',revision:3,snapshotHash:'a'.repeat(64),nickname:'stored name',protocol:'openai-chat-completions',baseUrl:'https://open.bigmodel.cn/api/paas/v4',requestedModel:'glm-5.3',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'}};
const ready:ProviderState={availability:'ready',reference:{profileId:glm.profileId,revision:3,snapshotHash:glm.snapshotHash},connection:{state:'untested',reason:'no_receipt'}};
const view=(profiles:PublicProfile[]=[],state:ProviderState=missing):ProviderStateView=>({schema:'ohuo-provider-state-v1',profiles,providers:{glm:state,deepseek:missing}});
it.each(['glm','deepseek'] as const)('provider availability: %s preset remains identified when shared backend has no saved source',provider=>{
 const result=describeProviderAvailability(provider,view());expect(result.presetConfigured).toBe(true);expect(result.state).toBe('missing');expect(result.profile).toBeNull();expect(result.reason).toContain('预设已配置');expect(result.reason).not.toMatch(/尚未配置|未配置/);
});
it('provider availability: shared view pending is not a missing configuration',()=>{
 const result=describeProviderAvailability('glm',null);expect(result.state).toBe('checking');expect(result.profile).toBeNull();expect(result.reason).toContain('读取');
});
it('provider availability: ready requires the exact backend reference and reviewed preset',()=>{
 const result=describeProviderAvailability('glm',view([glm],ready));expect(result.state).toBe('ready');expect(result.profile).toEqual(glm);expect(result.reason).toContain('未测试');
});
it('provider availability: unique shared saved source is available without a per-browser association and does not mutate input',()=>{
 const state=view([glm],ready),before=JSON.stringify(state);const result=describeProviderAvailability('glm',state);expect(result.state).toBe('ready');expect(result.profile).toEqual(glm);expect(result.reason).not.toContain('关联');expect(JSON.stringify(state)).toBe(before);
});
it('provider availability: incompatible old model/options remain saved and cannot become a replacement connection',()=>{
 const result=describeProviderAvailability('glm',view([{...glm,requestedModel:'glm-5'}],{...missing,availability:'incompatible'}));expect(result.state).toBe('incompatible');expect(result.profile).toBeNull();expect(result.reason).toContain('旧配置保留');expect(result.reason).toContain('不会自动迁移或新建替代');
});
it('provider availability: ambiguous shared saved sources remain unresolved, never pick the first',()=>{
 const result=describeProviderAvailability('glm',view([glm,{...glm,profileId:'other'}],{...missing,availability:'ambiguous'}));expect(result.state).toBe('ambiguous');expect(result.profile).toBeNull();expect(result.reason).toContain('多份');
});
it('provider availability: stale backend exact reference is not rebound to latest',()=>{
 const result=describeProviderAvailability('glm',view([{...glm,revision:4}],ready));expect(result.state).toBe('invalid');expect(result.profile).toBeNull();expect(result.reason).toContain('引用不匹配');
});
it('provider availability: unknown route cannot be rewritten or inferred from nickname even if a view claims ready',()=>{
 const proxy={...glm,baseUrl:'https://unknown.invalid/v1',nickname:'GLM'},copy=JSON.stringify(proxy);const result=describeProviderAvailability('glm',view([proxy],ready));expect(result.state).toBe('invalid');expect(result.profile).toBeNull();expect(result.reason).toContain('不符合已核预设');expect(JSON.stringify(proxy)).toBe(copy);
});
it('provider availability: inspection reads no storage/legacy/secret and issues no provider request',()=>{
 const keys=['localStorage','fetch'] as const,originals=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('storage/network forbidden here');}});
 try{expect(describeProviderAvailability('glm',view([glm],ready)).state).toBe('ready');}finally{keys.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]!);else delete (globalThis as any)[key];});}
});
