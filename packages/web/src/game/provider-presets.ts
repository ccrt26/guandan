import type { ConnectionSummary, ConnectionErrorCategory, ProviderStateView } from './llm-profiles';
import type { ProfileFields, PublicProfile, ProviderBindings } from './storage';

export type ProviderId = 'glm' | 'deepseek';
/** Product presets are routing contracts, not provider authentication or immutable model weights. */
export const PROVIDER_PRESETS = {
  glm: { name: 'GLM', label: 'GLM-5.3 · 最高', protocol: 'openai-chat-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', requestedModel: 'glm-5.3' },
  deepseek: { name: 'DeepSeek', label: 'DeepSeek-V4.1-Flash · 1017 · Max', protocol: 'openai-chat-completions',
    baseUrl: 'https://api.deepseek.com', requestedModel: 'deepseek-flash' },
} as const;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',');

export const GLM_ANTHROPIC_BASE = 'https://open.bigmodel.cn/api/anthropic';
/** Only exact reviewed routes: no brand guessing, URL rewriting or cross-route fallback. */
export function validateProviderRoute(provider: ProviderId, profile: Pick<ProfileFields, 'baseUrl' | 'protocol'>): void {
  const preset = PROVIDER_PRESETS[provider];
  if (provider === 'glm' && profile.baseUrl === GLM_ANTHROPIC_BASE && profile.protocol === 'anthropic-messages') return;
  if (!preset || profile.protocol !== preset.protocol) throw Error('provider_protocol_not_verified');
  if (profile.baseUrl !== preset.baseUrl) throw Error('provider_route_not_verified');
}
/** Legacy lacks protocol: only an explicitly reviewed endpoint can supply it. */
export function providerRouteForEndpoint(provider: ProviderId, baseUrl: string): Pick<ProfileFields, 'baseUrl' | 'protocol'> {
  const route = { baseUrl, protocol: provider === 'glm' && baseUrl === GLM_ANTHROPIC_BASE ? 'anthropic-messages' as const : PROVIDER_PRESETS[provider].protocol };
  validateProviderRoute(provider, route); return route;
}
export function isProviderEndpoint(provider: ProviderId, baseUrl: string): boolean {
  try { providerRouteForEndpoint(provider, baseUrl); return true; } catch { return false; }
}
export function providerPresetFields(provider: ProviderId, identity: Pick<ProfileFields, 'profileId' | 'nickname'>,
  route: Pick<ProfileFields, 'baseUrl' | 'protocol'> = PROVIDER_PRESETS[provider]): ProfileFields {
  validateProviderRoute(provider, route);
  if (route.protocol === 'anthropic-messages') return { ...identity, ...route, requestedModel: PROVIDER_PRESETS[provider].requestedModel,
    supportedReasoningOptions: { thinking: ['enabled'], output_config_effort: ['low', 'high', 'max'] },
    requestOptions: { thinking: { type: 'enabled' }, output_config: { effort: 'max' }, max_tokens: 32768 } };
  return { ...identity, protocol: route.protocol, baseUrl: route.baseUrl, requestedModel: PROVIDER_PRESETS[provider].requestedModel,
    supportedReasoningOptions: { thinking: ['enabled'], reasoning_effort: ['low', 'high', 'max'] },
    requestOptions: { thinking: { type: 'enabled' }, reasoning_effort: 'max' } };
}
export function validateProviderPreset(provider: ProviderId, profile: ProfileFields): void {
  validateProviderRoute(provider, profile);
  const support = profile.supportedReasoningOptions, options = profile.requestOptions;
  if (profile.protocol === 'anthropic-messages') {
    if (profile.requestedModel !== PROVIDER_PRESETS[provider].requestedModel || !plain(support) ||
      !exactKeys(support, ['thinking', 'output_config_effort']) || !Array.isArray(support.thinking) || support.thinking.length !== 1 || support.thinking[0] !== 'enabled' ||
      !Array.isArray(support.output_config_effort) || support.output_config_effort.length !== 3 || new Set(support.output_config_effort).size !== 3 || !['low','high','max'].every(v=>support.output_config_effort!.includes(v)) ||
      !plain(options) || !exactKeys(options, ['thinking','output_config','max_tokens']) || options.max_tokens !== 32768 ||
      !plain(options.thinking) || !exactKeys(options.thinking, ['type']) || options.thinking.type !== 'enabled' ||
      !plain(options.output_config) || !exactKeys(options.output_config, ['effort']) || options.output_config.effort !== 'max') throw Error('provider_preset_mismatch');
    return;
  }
  if (profile.requestedModel !== PROVIDER_PRESETS[provider].requestedModel || !plain(support) ||
    !exactKeys(support, ['thinking', 'reasoning_effort']) || !Array.isArray(support.thinking) ||
    support.thinking.length !== 1 || support.thinking[0] !== 'enabled' || !Array.isArray(support.reasoning_effort) ||
    support.reasoning_effort.length !== 3 || new Set(support.reasoning_effort).size !== 3 ||
    !['low', 'high', 'max'].every(value => support.reasoning_effort!.includes(value)) ||
    !plain(options) || !exactKeys(options, ['thinking', 'reasoning_effort']) || options.reasoning_effort !== 'max' ||
    !plain(options.thinking) || !exactKeys(options.thinking, ['type']) || options.thinking.type !== 'enabled')
    throw Error('provider_preset_mismatch');
}
/** Exact public reference only: never nickname, brand, array order, or latest revision fallback. */
export function resolveProviderBinding(provider: ProviderId, bindings: ProviderBindings, profiles: PublicProfile[]): PublicProfile | null {
  const reference = bindings[provider];
  if (!reference) return null;
  const matches = profiles.filter(p => p.profileId === reference.profileId && p.revision === reference.revision && p.snapshotHash === reference.snapshotHash);
  if (matches.length !== 1) throw Error('provider_binding_unavailable');
  validateProviderPreset(provider, matches[0]);
  return matches[0];
}

export interface ProviderAvailability {
  presetConfigured: true;
  state: 'checking' | 'ready' | 'missing' | 'incompatible' | 'ambiguous' | 'invalid';
  /** Backend exact reference for new choices; never rewrites an existing seat or match reference. */
  profile: PublicProfile | null;
  reason: string;
}
const connectionErrorText: Record<ConnectionErrorCategory,string> = {
  authentication_rejected:'认证被拒绝，请检查已保存凭据', billing_or_balance:'账户余额或计费状态受限', authorization_rejected:'访问权限被拒绝',
  rate_or_capacity:'请求限流或服务容量受限', quota_plan_or_rate_limit:'额度、套餐或请求频率受限', content_rejected:'测试内容被供应商拒绝',
  request_or_model_rejected:'请求或模型配置被拒绝', endpoint_not_found:'接口地址不可用', provider_failure:'供应商服务失败', http_rejected:'供应商拒绝了请求',
  response_too_large:'响应超过诊断大小上限', invalid_json_response:'响应JSON格式不完整或无效', invalid_protocol_response:'响应协议不完整或无效',
  timeout_unknown:'超时，供应商处理状态未知', network_error:'网络连接失败',
};
export function describeProviderConnection(connection: ConnectionSummary): string {
  // Fixed UTC rendering, not this browser's locale/timezone; preserve the historical test time.
  const time = connection.testedAt ? `（${connection.testedAt.slice(0,19).replace('T',' ')} UTC）` : '';
  const scope = '；原生接口诊断，非网页业务调用验收。';
  const failure = connection.errorCategory ? `；${connectionErrorText[connection.errorCategory]}` : ''; 
  switch (connection.state) {
    case 'passed': return `连接诊断通过${time}${scope}`;
    case 'failed': return `上次连接诊断失败${time}${failure}${scope}`;
    case 'incomplete': return `上次连接诊断未完成${time}${failure}${scope}`;
    case 'stale': return `配置或凭据已变更，当前配置未测试；保留上次记录${time}${failure}${scope}`;
    case 'untested': return '当前配置未测试。';
    case 'unknown': return '连接诊断记录不可用，状态未知。';
  }
}
/** All browsers use the same read-only backend selector; legacy binding storage is not consulted. */
export function describeProviderAvailability(provider: ProviderId, view: ProviderStateView | null): ProviderAvailability {
  const result = (state: ProviderAvailability['state'], reason: string, profile: PublicProfile | null = null): ProviderAvailability =>
    ({ presetConfigured: true, state, profile, reason });
  if (!view) return result('checking', '预设已配置；正在读取共享连接状态。');
  const state = view.providers[provider];
  if (state.availability === 'missing') return result('missing', '预设已配置；后台未找到已保存连接。');
  if (state.availability === 'ambiguous') return result('ambiguous', '存在多份有效连接，旧配置保留，待定位准确版本；未自动选择。');
  if (state.availability === 'incompatible') return result('incompatible', '旧配置保留：当前模型、路由、协议或参数不符合此预设；不会自动迁移或新建替代连接。' +
    (state.connection.state === 'stale' ? describeProviderConnection(state.connection) : ''));
  const ref = state.reference;
  const matches = view.profiles.filter(p => !!ref && p.profileId === ref.profileId && p.revision === ref.revision && p.snapshotHash === ref.snapshotHash);
  if (matches.length !== 1) return result('invalid', '共享连接引用不匹配，请重新读取；未自动选择。');
  try { validateProviderPreset(provider, matches[0]); }
  catch { return result('invalid', '共享连接不符合已核预设；旧配置保留，未自动选择。'); }
  return result('ready', `已配置 · ${describeProviderConnection(state.connection)}`, matches[0]);
}
