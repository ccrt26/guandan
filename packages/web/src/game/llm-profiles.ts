/** Public named-profile cache only. Legacy credentials are read only by an explicit import action. */
export type ProfileProtocol = 'openai-chat-completions' | 'anthropic-messages';
export interface ProfileFields {
  profileId: string;
  nickname: string;
  protocol: ProfileProtocol;
  baseUrl: string;
  requestedModel: string;
  supportedReasoningOptions: { thinking?: string[]; reasoning_effort?: string[]; output_config_effort?: string[] };
  requestOptions: { temperature?: number; top_p?: number; max_tokens?: number; thinking?: { type: string; budget_tokens?: number }; reasoning_effort?: string; output_config?: { effort: string } };
}
export interface PublicProfile extends ProfileFields { revision: number; snapshotHash: string }
export type ProfileReference = Pick<PublicProfile, 'profileId' | 'revision' | 'snapshotHash'>;
export const CONNECTION_ERROR_CATEGORIES = ['authentication_rejected','billing_or_balance','authorization_rejected','rate_or_capacity',
  'quota_plan_or_rate_limit','content_rejected','request_or_model_rejected','endpoint_not_found','provider_failure','http_rejected',
  'response_too_large','invalid_json_response','invalid_protocol_response','timeout_unknown','network_error'] as const;
export type ConnectionErrorCategory = typeof CONNECTION_ERROR_CATEGORIES[number];
export interface ConnectionSummary {
  state: 'passed' | 'failed' | 'incomplete' | 'untested' | 'stale' | 'unknown';
  testedAt?: string; scope?: 'native-connection-probe'; httpStatus?: number; returnedModel?: string; errorCategory?: ConnectionErrorCategory;
  reason?: 'no_receipt' | 'receipt_unavailable' | 'credential_or_profile_changed' | 'historical_credential_unknown' | 'provider_not_ready';
}
export interface ProviderState {
  availability: 'ready' | 'missing' | 'incompatible' | 'ambiguous';
  reference: ProfileReference | null; connection: ConnectionSummary;
}
export interface ProviderStateView {
  schema: 'ohuo-provider-state-v1'; profiles: PublicProfile[];
  providers: { glm: ProviderState; deepseek: ProviderState };
}
export interface ProviderTestResult {
  provider: 'glm' | 'deepseek'; reference: ProfileReference; requestId: string; connection: ConnectionSummary;
  profileUnchanged: boolean; persisted: boolean; error?: 'receipt_persist_failed';
}
/** Unknown includes lost/invalid replies: never infer zero provider calls or retry automatically. */
export class ProviderTestError extends Error {
  constructor(readonly code: string, readonly execution: 'not-started' | 'unknown') { super(code); this.name = 'ProviderTestError'; }
}
export interface SaveProfile { profile: ProfileFields & { secret?: string }; expectedRevision: number | null; expectedSnapshotHash?: string }
type StorageLike = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response,'ok'|'status'|'json'>>;
const CACHE_KEY='gd_llm_profiles_public_v1';
const publicErrorCodes = new Set([
  'unknown_profile_field','invalid_profile_id','invalid_nickname','unsupported_protocol','invalid_requested_model','invalid_base_url',
  'unsupported_reasoning_capability','invalid_reasoning_capability','unsupported_request_option','max_tokens_required','invalid_temperature',
  'invalid_top_p','invalid_max_tokens','unsupported_thinking_option','unsupported_reasoning_effort','invalid_private_store',
  'private_store_unavailable','private_store_requires_0600_regular_file','invalid_profile_reference','profile_not_found','revision_conflict',
  'unknown_save_field','invalid_secret','profile_store_busy','secret_required','secret_in_public_fields','profile_limit',
  'local_same_origin_required','json_required','profile_request_too_large','invalid_json','method_not_allowed','profile_service_unavailable','fixture_only',
]);
const allowed=['profileId','revision','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions','snapshotHash'];
const plain=(v: unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function publicProfile(value: unknown): PublicProfile {
  if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in value))||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||typeof value.snapshotHash!=='string'||!/^[0-9a-f]{64}$/.test(value.snapshotHash)||!['openai-chat-completions','anthropic-messages'].includes(String(value.protocol))||!['profileId','nickname','baseUrl','requestedModel'].every(k=>typeof value[k]==='string'&&value[k])) throw Error('invalid_public_profile');
  const support=value.supportedReasoningOptions,options=value.requestOptions;
  if(!plain(support)||Object.keys(support).some(k=>!['thinking','reasoning_effort','output_config_effort'].includes(k))||Object.values(support).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string'))||!plain(options)||Object.keys(options).some(k=>!['temperature','top_p','max_tokens','thinking','reasoning_effort','output_config'].includes(k))) throw Error('invalid_public_profile');
  for(const k of ['temperature','top_p','max_tokens']) if(k in options&&typeof options[k]!=='number') throw Error('invalid_public_profile');
  if('reasoning_effort' in options&&typeof options.reasoning_effort!=='string') throw Error('invalid_public_profile');
  if('thinking' in options&&(!plain(options.thinking)||Object.keys(options.thinking).some(k=>!['type','budget_tokens'].includes(k))||typeof options.thinking.type!=='string'||('budget_tokens' in options.thinking&&typeof options.thinking.budget_tokens!=='number'))) throw Error('invalid_public_profile');
  if ('output_config_effort' in support && (value.protocol !== 'anthropic-messages' || !(support.output_config_effort as string[]).length || (support.output_config_effort as string[]).some(v=>!['low','high','max'].includes(v)))) throw Error('invalid_public_profile');
  if ('output_config' in options && (value.protocol !== 'anthropic-messages' || !plain(options.output_config) || Object.keys(options.output_config).sort().join(',') !== 'effort' || typeof options.output_config.effort !== 'string' || !(support.output_config_effort as string[] | undefined)?.includes(options.output_config.effort))) throw Error('invalid_public_profile');
  return structuredClone(value) as unknown as PublicProfile;
}
function publicList(value: unknown): PublicProfile[] {
  if(!Array.isArray(value)) throw Error('invalid_public_profile');
  const profiles=value.map(publicProfile);
  if(new Set(profiles.map(p=>p.profileId)).size!==profiles.length) throw Error('invalid_public_profile');
  return profiles;
}
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
function publicConnection(value: unknown, errorCode = 'invalid_provider_state'): ConnectionSummary {
  const invalid = (): never => { throw Error(errorCode); };
  const c = value;
  if (!plain(c) || Object.keys(c).some(k => !['state','testedAt','scope','httpStatus','returnedModel','reason','errorCategory'].includes(k)) ||
      typeof c.state !== 'string' || !['passed','failed','incomplete','untested','stale','unknown'].includes(c.state)) return invalid();
  if ('testedAt' in c && (typeof c.testedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(c.testedAt) || !Number.isFinite(Date.parse(c.testedAt)))) return invalid();
  if ('scope' in c && c.scope !== 'native-connection-probe') return invalid();
  if ('httpStatus' in c && (!Number.isInteger(c.httpStatus) || Number(c.httpStatus) < 100 || Number(c.httpStatus) > 599)) return invalid();
  if ('returnedModel' in c && (typeof c.returnedModel !== 'string' || !c.returnedModel || c.returnedModel.length > 200 || !/^[A-Za-z0-9_.:/\[\]-]+$/.test(c.returnedModel))) return invalid();
  if ('reason' in c && (typeof c.reason !== 'string' || !['no_receipt','receipt_unavailable','credential_or_profile_changed','historical_credential_unknown','provider_not_ready'].includes(c.reason))) return invalid();
  if (['passed','failed','incomplete','stale'].includes(String(c.state)) && (typeof c.testedAt !== 'string' || c.scope !== 'native-connection-probe')) return invalid();
  if (c.state === 'passed' && (typeof c.httpStatus !== 'number' || c.httpStatus < 200 || c.httpStatus > 299 || typeof c.returnedModel !== 'string' || 'reason' in c || 'errorCategory' in c)) return invalid();
  if ('errorCategory' in c && (typeof c.errorCategory !== 'string' || !(CONNECTION_ERROR_CATEGORIES as readonly string[]).includes(c.errorCategory) || !['failed','incomplete','stale'].includes(c.state))) return invalid();
  return structuredClone(c) as unknown as ConnectionSummary;
}
/** This view is authoritative and uncached: old browser metadata cannot imply availability or a test pass. */
function providerStateView(value: unknown): ProviderStateView {
  const invalid = () => { throw Error('invalid_provider_state'); };
  if (!plain(value) || !exactKeys(value, ['schema','profiles','providers']) || value.schema !== 'ohuo-provider-state-v1' ||
      !plain(value.providers) || !exactKeys(value.providers, ['glm','deepseek'])) return invalid();
  const profiles = publicList(value.profiles);
  for (const provider of ['glm','deepseek']) {
    const state = value.providers[provider];
    if (!plain(state) || !exactKeys(state, ['availability','reference','connection']) ||
        !['ready','missing','incompatible','ambiguous'].includes(String(state.availability))) return invalid();
    const ref = state.reference;
    if (state.availability === 'ready') {
      if (!plain(ref) || !exactKeys(ref, ['profileId','revision','snapshotHash']) ||
          profiles.filter(p => p.profileId === ref.profileId && p.revision === ref.revision && p.snapshotHash === ref.snapshotHash).length !== 1) return invalid();
    } else if (ref !== null) return invalid();
    const c = publicConnection(state.connection);
    if (state.availability !== 'ready') {
      const unavailable = c.state === 'unknown' && c.reason === 'provider_not_ready' && Object.keys(c).length === 2;
      const historical = state.availability === 'incompatible' && c.state === 'stale' &&
        ['credential_or_profile_changed','historical_credential_unknown'].includes(String(c.reason));
      if (!unavailable && !historical) return invalid();
    }
  }
  return { ...structuredClone(value), profiles } as unknown as ProviderStateView;
}
function validTestReference(value: unknown): value is ProfileReference {
  return plain(value) && exactKeys(value, ['profileId','revision','snapshotHash']) && typeof value.profileId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.profileId) && Number.isSafeInteger(value.revision) && Number(value.revision) > 0 &&
    typeof value.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(value.snapshotHash);
}
const testRejections: Record<string, number> = {invalid_test_request:400,invalid_json:400,revision_conflict:409,test_in_progress:409,
  request_id_conflict:409,profile_store_busy:409,profile_not_found:404,profile_contract_mismatch:422,profile_service_unavailable:503,
  local_same_origin_required:403,method_not_allowed:405,profile_request_too_large:413,json_required:415};
function testResult(value: unknown, provider: 'glm'|'deepseek', reference: ProfileReference, requestId: string): ProviderTestResult {
  const invalid = (): never => { throw new ProviderTestError('invalid_provider_test_response','unknown'); };
  if (!plain(value) || typeof value.persisted !== 'boolean' || !exactKeys(value, ['provider','reference','requestId','connection','profileUnchanged','persisted',...(!value.persisted?['error']:[])]) ||
      value.provider !== provider || value.requestId !== requestId || !validTestReference(value.reference) ||
      value.reference.profileId !== reference.profileId || value.reference.revision !== reference.revision || value.reference.snapshotHash !== reference.snapshotHash ||
      typeof value.profileUnchanged !== 'boolean' || (!value.persisted && value.error !== 'receipt_persist_failed')) return invalid();
  let connection: ConnectionSummary;
  try { connection = publicConnection(value.connection); } catch { return invalid(); }
  if (!connection.testedAt || connection.scope !== 'native-connection-probe' ||
      !(value.profileUnchanged ? ['passed','failed','incomplete'] : ['stale','unknown']).includes(connection.state)) return invalid();
  return {...structuredClone(value),connection} as unknown as ProviderTestResult;
}
export function createProfileClient({storage,fetchImpl}:{storage:StorageLike;fetchImpl:FetchLike}) {
  async function call(init?:RequestInit, url = '/api/llm-profiles'):Promise<unknown> {
    let response;try {response=await fetchImpl(url,init);} catch {throw Error('profile_service_unavailable');}
    let data;try {data=await response.json();} catch {throw Error('invalid_profile_response');}
    if(!response.ok) {
      // Never echo arbitrary upstream error content or submitted credentials.
      const code=plain(data)&&typeof data.error==='string'&&publicErrorCodes.has(data.error)?data.error:'profile_save_failed';
      throw Error(code);
    }
    return data;
  }
  function cache(profiles:PublicProfile[]) {try {storage.setItem(CACHE_KEY,JSON.stringify(profiles));} catch {/* persistence is the private service; cache is optional */}}
  return {
    cached():PublicProfile[] {try{return publicList(JSON.parse(storage.getItem(CACHE_KEY)??'[]'));}catch{return []; }},
    async refresh():Promise<PublicProfile[]> {const profiles=publicList(await call());cache(profiles);return profiles;},
    async refreshProviderState():Promise<ProviderStateView> {const state=providerStateView(await call(undefined, '/api/llm-profiles?view=providers'));cache(state.profiles);return state;},
    async testProvider(provider:'glm'|'deepseek', reference:ProfileReference, requestId:string):Promise<ProviderTestResult> {
      if (!['glm','deepseek'].includes(provider) || !validTestReference(reference) || typeof requestId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw new ProviderTestError('invalid_test_request','not-started');
      const captured = structuredClone(reference), id = requestId.toLowerCase();
      let response;
      try { response = await fetchImpl('/api/llm-profiles/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider,reference:captured,requestId:id})}); }
      catch { throw new ProviderTestError('provider_test_result_unknown','unknown'); }
      let data: unknown;
      try { data = await response.json(); } catch { throw new ProviderTestError('invalid_provider_test_response','unknown'); }
      if (typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) throw new ProviderTestError('invalid_provider_test_response','unknown');
      if (!response.ok) {
        if (plain(data) && exactKeys(data,['error']) && typeof data.error === 'string' && Object.prototype.hasOwnProperty.call(testRejections,data.error) && testRejections[data.error] === response.status)
          throw new ProviderTestError(data.error,'not-started');
        throw new ProviderTestError('provider_test_result_unknown','unknown');
      }
      if (response.status !== 200) throw new ProviderTestError('invalid_provider_test_response','unknown');
      return testResult(data,provider,captured,id);
    },
    async save(command:SaveProfile):Promise<PublicProfile> {
      const saved=publicProfile(await call({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)}));
      if (saved.profileId !== command.profile.profileId) throw Error('profile_response_mismatch');
      // Save response is authoritative even if subsequent refresh is unavailable; never touch legacy storage.
      let profiles:PublicProfile[];try {profiles=publicList(JSON.parse(storage.getItem(CACHE_KEY)??'[]'));}catch{profiles=[];}
      cache([...profiles.filter(p=>p.profileId!==saved.profileId),saved]);return saved;
    },
    readLegacyForExplicitImport():{baseUrl:string;requestedModel:string;secret:string;legacyEffort:string} {
      let value;try {value=JSON.parse(storage.getItem('gd_llm_config')??'null');}catch{throw Error('invalid_legacy_config');}
      if(!plain(value)||!['baseUrl','apiKey','model'].every(k=>typeof value[k]==='string'&&value[k])) throw Error('legacy_config_not_found');
      if(Object.keys(value).some(k=>!['baseUrl','apiKey','model','effort'].includes(k))||('effort' in value&&!['max','std','off'].includes(String(value.effort)))) throw Error('invalid_legacy_config');
      // Protocol and supported options are deliberately NOT inferred from brand, URL, or old effort label.
      return {baseUrl:value.baseUrl as string,requestedModel:value.model as string,secret:value.apiKey as string,legacyEffort:typeof value.effort==='string'?value.effort:'unspecified'};
    },
  };
}
