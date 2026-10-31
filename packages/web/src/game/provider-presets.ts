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
  state: 'checking' | 'ready' | 'unlinked' | 'pending' | 'invalid';
  /** Present only for an exact saved binding; ready is structural eligibility, not authentication. */
  profile: PublicProfile | null;
  reason: string;
}
/** Public-only presentation. Missing bindings do not imply missing credentials or absent browser legacy. */
export function describeProviderAvailability(provider: ProviderId, bindings: ProviderBindings,
  profiles: readonly PublicProfile[] | null): ProviderAvailability {
  const result = (state: ProviderAvailability['state'], reason: string, profile: PublicProfile | null = null): ProviderAvailability =>
    ({ presetConfigured: true, state, profile, reason });
  if (profiles === null) return result('checking', '预设已配置；正在读取已保存连接，API状态尚未确认。');
  const reference = bindings[provider];
  let source: PublicProfile | undefined;
  if (reference) {
    const matches = profiles.filter(p => p.profileId === reference.profileId && p.revision === reference.revision && p.snapshotHash === reference.snapshotHash);
    if (matches.length !== 1) return result('invalid', '预设已配置；原关联版本不再匹配，请在AI设置确认，不自动改绑。');
    source = matches[0];
  } else {
    const sources = profiles.filter(p => isProviderEndpoint(provider, p.baseUrl));
    if (sources.length > 1) return result('pending', '预设已配置；已有多份API连接，待确认准确关联，原配置保留。');
    source = sources[0];
  }
  if (!source) return result('unlinked', provider === 'glm'
    ? '预设已配置；API配置待确认关联，请在AI设置识别已有配置，已保存密钥无需重填。'
    : '预设已配置；API待填写或确认关联，尚未测试连接。');
  try { validateProviderRoute(provider, source); }
  catch { return result('pending', '预设已配置；旧API配置保留，原路由或协议支持待确认，不自动迁移。'); }
  try { validateProviderPreset(provider, source); }
  catch { return result('pending', '预设已配置；旧API配置已保存，请在AI设置确认预设与关联，无需重新输入已保存密钥。'); }
  if (!reference) return result('unlinked', '预设已配置；API已保存，请在AI设置确认关联，无需重新输入密钥。');
  return result('ready', '预设已配置；API已保存并关联（未测试）。', source);
}
