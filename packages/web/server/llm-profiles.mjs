/** Named configuration only. Importing this module never reads credentials, writes, listens, or fetches. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE_SCHEMA = 'gd-llm-profiles-v1';
export const DEFAULT_PROFILE_PATH = fileURLToPath(new URL('../../../.env.llm-profiles.json', import.meta.url));
export const PROFILE_PROTOCOLS = Object.freeze(['openai-chat-completions', 'anthropic-messages']);
export class ProfileError extends Error {
  constructor(code) { super(code); this.name = 'ProfileError'; this.code = code; }
}
const fail = code => { throw new ProfileError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, allowed, code) { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(code); }
function text(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const copy = value => JSON.parse(JSON.stringify(value));
function validProfile(input) {
  keys(input, ['profileId','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions','secret'], 'unknown_profile_field');
  if (!text(input.profileId,80) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.profileId)) fail('invalid_profile_id');
  if (!text(input.nickname,120)) fail('invalid_nickname');
  if (!PROFILE_PROTOCOLS.includes(input.protocol)) fail('unsupported_protocol');
  if (!text(input.requestedModel,200)) fail('invalid_requested_model');
  let url;
  try { url = new URL(input.baseUrl); } catch { fail('invalid_base_url'); }
  if (!text(input.baseUrl,2048) || !['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname) fail('invalid_base_url');
  // HTTP is useful only for a local compatible service; no cleartext remote credentials.
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) fail('invalid_base_url');
  const support=input.supportedReasoningOptions, options=input.requestOptions;
  keys(support, ['thinking','reasoning_effort','output_config_effort'], 'unsupported_reasoning_capability');
  for (const [key, values] of Object.entries(support)) {
    if (!Array.isArray(values) || !values.length || values.length > 32 || values.some(v=>!text(v,64)) || new Set(values).size!==values.length) fail('invalid_reasoning_capability');
    if (key === 'thinking' && values.some(v=>!['enabled','disabled'].includes(v))) fail('unsupported_reasoning_capability');
    if (key === 'reasoning_effort' && input.protocol !== 'openai-chat-completions') fail('unsupported_reasoning_capability');
    if (key === 'output_config_effort' && (input.protocol !== 'anthropic-messages' || values.some(v=>!['low','high','max'].includes(v)))) fail('unsupported_reasoning_capability');
  }
  keys(options, ['temperature','top_p','max_tokens','thinking','reasoning_effort','output_config'], 'unsupported_request_option');
  if (input.protocol === 'anthropic-messages' && !('max_tokens' in options)) fail('max_tokens_required');
  if ('temperature' in options && (typeof options.temperature!=='number' || !Number.isFinite(options.temperature) || options.temperature<0 || options.temperature>(input.protocol==='anthropic-messages'?1:2))) fail('invalid_temperature');
  if ('top_p' in options && (typeof options.top_p!=='number' || !Number.isFinite(options.top_p) || options.top_p<0 || options.top_p>1)) fail('invalid_top_p');
  if ('max_tokens' in options && (!Number.isSafeInteger(options.max_tokens) || options.max_tokens<=0)) fail('invalid_max_tokens');
  if ('thinking' in options) {
    keys(options.thinking,['type','budget_tokens'],'unsupported_thinking_option');
    if (!support.thinking?.includes(options.thinking.type)) fail('unsupported_thinking_option');
    if ('budget_tokens' in options.thinking && (input.protocol!=='anthropic-messages' || options.thinking.type!=='enabled' || !Number.isSafeInteger(options.thinking.budget_tokens) || options.thinking.budget_tokens<=0 || (options.max_tokens && options.thinking.budget_tokens>=options.max_tokens))) fail('unsupported_thinking_option');
  }
  if ('reasoning_effort' in options && (input.protocol!=='openai-chat-completions' || !support.reasoning_effort?.includes(options.reasoning_effort))) fail('unsupported_reasoning_effort');
  if ('output_config' in options) {
    keys(options.output_config,['effort'],'unsupported_request_option');
    if (input.protocol!=='anthropic-messages' || !support.output_config_effort?.includes(options.output_config.effort)) fail('unsupported_request_option');
  }
  // No provider/model aliases, protocol inference, option defaults or cross-profile fallbacks.
  return copy({profileId:input.profileId,nickname:input.nickname,protocol:input.protocol,baseUrl:input.baseUrl,requestedModel:input.requestedModel,supportedReasoningOptions:support,requestOptions:options});
}
function publicSnapshot(record) {
  const {secret,credentialRevision,...publicRecord}=record;
  return {...copy(publicRecord),snapshotHash:createHash('sha256').update(canonical(publicRecord)).digest('hex')};
}
function parseStore(raw) {
  let data; try { data=JSON.parse(raw); } catch { fail('invalid_private_store'); }
  keys(data,['schema','profiles'],'invalid_private_store');
  if (data.schema!==PROFILE_SCHEMA || !Array.isArray(data.profiles) || data.profiles.length>100) fail('invalid_private_store');
  const ids = new Set();
  for (const record of data.profiles) {
    keys(record,['profileId','revision','nickname','protocol','baseUrl','requestedModel','supportedReasoningOptions','requestOptions','secret','credentialRevision'],'invalid_private_store');
    const {revision,credentialRevision,...profile}=record;
    try { validProfile(profile); } catch { fail('invalid_private_store'); }
    if (!Number.isSafeInteger(revision)||revision<1||!Number.isSafeInteger(credentialRevision)||credentialRevision<1||!text(record.secret,16384)||ids.has(record.profileId)) fail('invalid_private_store');
    if(canonical(validProfile(profile)).includes(JSON.stringify(record.secret).slice(1,-1))) fail('invalid_private_store');
    ids.add(record.profileId);
  }
  return data;
}

export function createProfileStore({filePath=DEFAULT_PROFILE_PATH}={}) {
  const file=resolve(filePath);
  function read() {
    let st;
    try { st=lstatSync(file); } catch (error) { if(error.code==='ENOENT') return {schema:PROFILE_SCHEMA,profiles:[]}; fail('private_store_unavailable'); }
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600) fail('private_store_requires_0600_regular_file');
    try { return parseStore(readFileSync(file,'utf8')); } catch(error) { if(error instanceof ProfileError) throw error; fail('private_store_unavailable'); }
  }
  return {
    list() { return read().profiles.map(publicSnapshot); },
    resolve(reference) {
      keys(reference,['profileId','revision','snapshotHash'],'invalid_profile_reference');
      if(!text(reference.profileId,80)||!Number.isSafeInteger(reference.revision)||reference.revision<1||typeof reference.snapshotHash!=='string'||!/^[0-9a-f]{64}$/.test(reference.snapshotHash)) fail('invalid_profile_reference');
      const record=read().profiles.find(p=>p.profileId===reference.profileId);
      if(!record) fail('profile_not_found');
      if(record.revision!==reference.revision||publicSnapshot(record).snapshotHash!==reference.snapshotHash) fail('revision_conflict');
      return copy(record);
    },
    save(command) {
      keys(command,['profile','expectedRevision','expectedSnapshotHash'],'unknown_save_field');
      const profile=validProfile(command.profile);
      const suppliedSecret=command.profile.secret;
      if(suppliedSecret!==undefined&&!text(suppliedSecret,16384)) fail('invalid_secret');
      const lock=`${file}.lock`; let descriptor;
      try { descriptor=openSync(lock,'wx',0o600); } catch(error) { fail(error.code==='EEXIST'?'profile_store_busy':'private_store_unavailable'); }
      let temp;
      try {
        const data=read(), at=data.profiles.findIndex(p=>p.profileId===profile.profileId), old=data.profiles[at];
        if(old) {
          if(command.expectedRevision!==old.revision||command.expectedSnapshotHash!==publicSnapshot(old).snapshotHash) fail('revision_conflict');
        } else if(command.expectedRevision!==null||command.expectedSnapshotHash!==undefined) fail('revision_conflict');
        const secret=suppliedSecret??old?.secret;
        if(!secret) fail('secret_required');
        if(canonical(profile).includes(JSON.stringify(secret).slice(1,-1))) fail('secret_in_public_fields');
        if(at<0&&data.profiles.length>=100) fail('profile_limit');
        const oldBehavior=old?validProfile(Object.fromEntries(Object.entries(old).filter(([k])=>!['revision','credentialRevision'].includes(k)))):null;
        const revision=old?(canonical(profile)===canonical(oldBehavior)?old.revision:old.revision+1):1;
        const record={...profile,revision,secret,credentialRevision:old?old.credentialRevision+(secret===old.secret?0:1):1};
        if(old) data.profiles[at]=record; else data.profiles.push(record);
        temp=join(dirname(file),`.env.llm-profiles-${randomUUID()}.tmp`);
        const fd=openSync(temp,'wx',0o600);
        try { writeFileSync(fd,JSON.stringify(data,null,2)+'\n','utf8'); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temp,file); temp=undefined;
        return publicSnapshot(record);
      } catch(error) {
        if(error instanceof ProfileError) throw error;
        fail('private_store_unavailable');
      } finally {
        if(temp) try { unlinkSync(temp); } catch { /* no content logged */ }
        closeSync(descriptor); unlinkSync(lock);
      }
    },
  };
}
