import { expect, it } from 'vitest';
import { describeProviderAvailability } from '../src/game/provider-presets';
import type { PublicProfile, ProviderBindings } from '../src/game/storage';
const empty:ProviderBindings={schema:'ohuo-provider-bindings-v1',glm:null,deepseek:null};
const glm:PublicProfile={profileId:'saved-glm',revision:3,snapshotHash:'a'.repeat(64),nickname:'stored name',protocol:'openai-chat-completions',baseUrl:'https://open.bigmodel.cn/api/paas/v4',requestedModel:'glm-5.3',supportedReasoningOptions:{thinking:['enabled'],reasoning_effort:['low','high','max']},requestOptions:{thinking:{type:'enabled'},reasoning_effort:'max'}};
const bound:ProviderBindings={...empty,glm:{profileId:glm.profileId,revision:3,snapshotHash:'a'.repeat(64)}};
it.each(['glm','deepseek'] as const)('provider availability: %s preset is identified without claiming a missing binding means no saved API',provider=>{
 const result=describeProviderAvailability(provider,empty,[]);expect(result.presetConfigured).toBe(true);expect(result.state).toBe('unlinked');expect(result.profile).toBeNull();expect(result.reason).toContain('预设已配置');expect(result.reason).not.toMatch(/尚未配置|未配置/);
});
it('provider availability: public list pending is not a missing configuration',()=>{
 const result=describeProviderAvailability('glm',bound,null);expect(result.state).toBe('checking');expect(result.profile).toBeNull();expect(result.reason).toContain('读取');
});
it('provider availability: ready requires the exact bound saved revision and preset',()=>{
 const result=describeProviderAvailability('glm',bound,[glm]);expect(result.state).toBe('ready');expect(result.profile).toEqual(glm);expect(result.reason).toContain('未测试');
});
it('provider availability: a saved unbound profile is not automatically selected',()=>{
 const result=describeProviderAvailability('glm',empty,[glm]);expect(result.state).toBe('unlinked');expect(result.profile).toBeNull();expect(result.reason).toContain('API已保存');expect(result.reason).toContain('关联');
});
it('provider availability: old saved model/options require explicit settings confirmation without another Key',()=>{
 const result=describeProviderAvailability('glm',empty,[{...glm,requestedModel:'glm-5'}]);expect(result.state).toBe('pending');expect(result.profile).toBeNull();expect(result.reason).toContain('旧API配置已保存');expect(result.reason).toContain('无需重新输入');
});
it('provider availability: ambiguous saved sources remain unresolved',()=>{
 const result=describeProviderAvailability('glm',empty,[glm,{...glm,profileId:'other'}]);expect(result.state).toBe('pending');expect(result.profile).toBeNull();expect(result.reason).toContain('多份');
});
it('provider availability: a stale bound revision is not rebound to latest',()=>{
 const result=describeProviderAvailability('glm',bound,[{...glm,revision:4}]);expect(result.state).toBe('invalid');expect(result.profile).toBeNull();expect(result.reason).toContain('版本');
});
it('provider availability: an unknown route is never rewritten or inferred from nickname',()=>{
 const proxy={...glm,baseUrl:'https://unknown.invalid/v1',nickname:'GLM'};const copy=JSON.stringify(proxy);const result=describeProviderAvailability('glm',bound,[proxy]);expect(result.state).toBe('pending');expect(result.profile).toBeNull();expect(result.reason).toContain('原路由');expect(JSON.stringify(proxy)).toBe(copy);
});
it('provider availability: inspection needs no storage/legacy/secret or provider request',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('legacy read forbidden here');}});
 try{expect(describeProviderAvailability('glm',empty,[]).state).toBe('unlinked');}finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete (globalThis as any).localStorage;}
});
