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
export function createProfileClient({storage,fetchImpl}:{storage:StorageLike;fetchImpl:FetchLike}) {
  async function call(init?:RequestInit):Promise<unknown> {
    let response;try {response=await fetchImpl('/api/llm-profiles',init);} catch {throw Error('profile_service_unavailable');}
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
