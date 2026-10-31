import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createProfileClient, loadProviderBindings, saveProviderBindings, profileReference, profileReferenceKey,
  type PublicProfile, type ProviderBindings, type SaveProfile } from '../game/storage';
import { PROVIDER_PRESETS, GLM_ANTHROPIC_BASE, providerRouteForEndpoint, isProviderEndpoint, providerPresetFields, validateProviderPreset, validateProviderRoute, type ProviderId } from '../game/provider-presets';
import { awaitChatOperation, createChatOperationOwner, operationProfileClient, requestImportDraft, type ChatOperation } from './chat-operation';

export interface SettingsModalFixtureDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}
type Legacy = ReturnType<ReturnType<typeof createProfileClient>['readLegacyForExplicitImport']>;
type Row = { profile: PublicProfile | null; profileId: string; legacy: boolean; editing: boolean; secret: string;
  issue: string; blocked: boolean; outcome: 'idle' | 'saved' | 'binding-pending' | 'unknown'; receipt?: PublicProfile };
const providers: ProviderId[] = ['glm', 'deepseek'];
const emptyBindings = (): ProviderBindings => ({ schema: 'ohuo-provider-bindings-v1', glm: null, deepseek: null });
const emptyRow = (provider: ProviderId): Row => ({ profile: null, profileId: `ohuo-${provider}-${crypto.randomUUID()}`,
  legacy: false, editing: false, secret: '', issue: '', blocked: false, outcome: 'idle' });
const matchesPreset = (provider: ProviderId, profile: PublicProfile) => {
  try { validateProviderPreset(provider, profile); return true; } catch { return false; }
};
// Public-only unresolved attempt/receipt, scoped to this storage instance. Never stores a key/draft.
// Keeps cancellation/close from turning an uncertain POST into an automatic retry on reopening.
const pendingByStorage = new WeakMap<object, Partial<Record<ProviderId, { profileId: string; receipt?: PublicProfile }>>>();
const definiteRejection = new Set(['revision_conflict', 'profile_store_busy', 'unknown_profile_field', 'invalid_profile_id', 'invalid_nickname',
  'unsupported_protocol', 'invalid_requested_model', 'invalid_base_url', 'unsupported_reasoning_capability', 'invalid_reasoning_capability',
  'unsupported_request_option', 'unsupported_thinking_option', 'unsupported_reasoning_effort', 'unknown_save_field', 'invalid_secret',
  'secret_required', 'secret_in_public_fields', 'profile_limit', 'local_same_origin_required', 'json_required', 'profile_request_too_large', 'invalid_json', 'method_not_allowed']);

/** Two reviewed presets. Credentials exist only in the local open editor and the original private save path. */
export function SettingsModal({ onClose, fixture }: { onClose: () => void; fixture?: SettingsModalFixtureDependencies }) {
  if (fixture && !import.meta.env.DEV) throw Error('fixture_only');
  const owner = useMemo(createChatOperationOwner, []), listOwner = useMemo(createChatOperationOwner, []);
  const storage = fixture?.storage ?? localStorage;
  const client = (operation?: ChatOperation) => fixture ? createProfileClient({ storage: {
    getItem: key => storage.getItem(key),
    setItem: (key, value) => { if (operation?.current()) storage.setItem(key, value); },
    removeItem: () => { /* Legacy is never mutated. */ },
  }, fetchImpl: async (url, init) => {
    if (!operation?.current()) throw new DOMException('Operation cancelled', 'AbortError');
    const response = await awaitChatOperation(fixture.fetchImpl(url, { ...init, signal: operation.signal }), operation);
    return { ok: response.ok, status: response.status, json: () => awaitChatOperation(response.json(), operation) };
  } }) : operationProfileClient(operation);
  const [rows, setRows] = useState<Record<ProviderId, Row>>(() => ({ glm: emptyRow('glm'), deepseek: emptyRow('deepseek') }));
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const bindings = useRef(emptyBindings()), legacy = useRef<Legacy | null>(null), glmRestoreSession = useRef(false), deepSeekExplicitSave = useRef(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const busyRef = useRef(false), panel = useRef<HTMLDivElement | null>(null);
  function patch(provider: ProviderId, changes: Partial<Row>) {
    const next = { ...rowsRef.current, [provider]: { ...rowsRef.current[provider], ...changes } };
    rowsRef.current = next; setRows(next);
  }
  function discard() {
    owner.invalidate(); listOwner.invalidate(); legacy.current = null;
    for (const provider of providers) rowsRef.current[provider] = { ...rowsRef.current[provider], secret: '' };
  }
  function close() { discard(); onClose(); }
  useLayoutEffect(() => () => discard(), [owner, listOwner]);
  useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);
  useEffect(() => {
    // This effect runs only because the user opened SettingsModal, never in App/background diagnostics.
    const operation = listOwner.begin();
    let bound: ProviderBindings;
    try { bound = loadProviderBindings(storage); bindings.current = bound; }
    catch { setMessage('连接关联无法读取；原值保留，请先修复关联存储。'); return () => listOwner.invalidate(); }
    let legacyIssue = '';
    try { legacy.current = client().readLegacyForExplicitImport(); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      legacyIssue = code === 'legacy_config_not_found'
        ? '当前浏览器未找到完整旧配置；GLM来源待识别，已有密钥无需重填。'
        : code === 'invalid_legacy_config'
          ? '旧配置格式未识别；原配置保留，已有密钥无需重填。'
          : '当前浏览器旧配置读取未完成；原配置保留，已有密钥无需重填。';
    }
    client(operation).refresh().then(profiles => {
      if (!operation.current()) return;
      const next = { ...rowsRef.current };
      for (const provider of providers) {
        const reference = bound[provider];
        let profile: PublicProfile | null = null, issue = '';
        if (reference) {
          profile = profiles.find(p => profileReferenceKey(p) === profileReferenceKey(reference)) ?? null;
          if (!profile) issue = '已绑定版本不再匹配；保留原关联，请定位原连接，不自动跟随新版本。';
        } else {
          // Upgrade discovery uses only the exact reviewed endpoint, never nickname/model branding.
          // Old model/options are still a saved source, not evidence that the user needs another Key.
          // Protocol support is checked below before any migration; multiple sources stay unresolved.
          const sources = profiles.filter(p => isProviderEndpoint(provider, p.baseUrl));
          if (sources.length === 1) profile = sources[0];
          else if (sources.length > 1) issue = '存在多份已保存连接，旧配置保留、待定位准确版本；未自动选择。';
        }
        const hasLegacy = provider === 'glm' && !profile && !reference && !!legacy.current;
        if (profile || hasLegacy) {
          try { validateProviderRoute(provider, profile ?? providerRouteForEndpoint(provider, legacy.current!.baseUrl)); }
          catch { issue = '旧配置保留：当前 endpoint／协议尚未核实支持此预设；不会改路由或迁移 Key。'; }
        }
        const pending = pendingByStorage.get(storage)?.[provider];
        next[provider] = { ...next[provider], profile, profileId: profile?.profileId ?? pending?.profileId ?? next[provider].profileId,
          legacy: hasLegacy, blocked: !!issue, issue: issue || (provider === 'glm' && !profile && !hasLegacy ? legacyIssue : ''),
          outcome: pending ? (pending.receipt ? 'binding-pending' : 'unknown') : 'idle', receipt: pending?.receipt };
      }
      rowsRef.current = next; setRows(next); setReady(true);
    }).catch(() => { if (operation.current()) setMessage('本机配置服务暂不可用；缓存不代表已保存，未读取环境凭据。'); });
    return () => listOwner.invalidate();
  }, [listOwner, storage]);

  function remember(provider: ProviderId, entry?: { profileId: string; receipt?: PublicProfile }) {
    const pending = pendingByStorage.get(storage) ?? {};
    if (entry) pending[provider] = entry; else delete pending[provider];
    pendingByStorage.set(storage, pending);
  }
  function bindSaved(provider: ProviderId, saved: PublicProfile) {
    // Merge the other public binding as it exists now; never roll back another tab/provider.
    const next = { ...loadProviderBindings(storage), [provider]: profileReference(saved) };
    saveProviderBindings(next, storage); bindings.current = next;
    remember(provider); patch(provider, { profile: saved, profileId: saved.profileId, secret: '', editing: false,
      legacy: false, outcome: 'saved', receipt: undefined, issue: '', blocked: false });
  }
  async function save() {
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    const operation = owner.begin();
    // Freeze this transaction's intent before GLM Save changes its binding.
    // Restoring/associating GLM is not consent to migrate an untouched DS preset.
    const glm = rowsRef.current.glm;
    const restoringGLM = !glm.blocked && glm.outcome !== 'unknown' && (glm.legacy || !!glm.secret || !!glm.receipt ||
      !!(glm.profile && (!matchesPreset('glm', glm.profile) || !bindings.current.glm ||
        profileReferenceKey(glm.profile) !== profileReferenceKey(bindings.current.glm))));
    if (restoringGLM) glmRestoreSession.current = true;
    // A successful explicit DS save may leave only a public-binding receipt.
    // Retain that consent for binding-only retry; never infer it from an old receipt.
    if (rowsRef.current.deepseek.editing || rowsRef.current.deepseek.secret) deepSeekExplicitSave.current = true;
    try {
      for (const provider of providers) {
        if (!operation.current()) return;
        const row = rowsRef.current[provider];
        if (provider === 'deepseek' && glmRestoreSession.current && !deepSeekExplicitSave.current) continue;
        if (row.outcome === 'unknown') continue;
        if (row.receipt) {
          try { bindSaved(provider, row.receipt); }
          catch { patch(provider, { outcome: 'binding-pending' }); }
          continue;
        }
        const profile = row.profile;
        // Broken/ambiguous bindings and unverified routes cannot be replaced by typing a new key.
        if ((bindings.current[provider] && !profile) || row.blocked) continue;
        const unchanged = profile && matchesPreset(provider, profile) && !row.secret;
        if (unchanged) {
          if (bindings.current[provider] && profileReferenceKey(bindings.current[provider]!) === profileReferenceKey(profile)) continue;
          // The public service read established this exact saved profile; Save commits only its public association.
          remember(provider, { profileId: profile.profileId, receipt: profile });
          try { bindSaved(provider, profile); }
          catch { patch(provider, { receipt: profile, outcome: 'binding-pending', secret: '' }); }
          continue;
        }
        const secret = row.secret || (row.legacy ? legacy.current?.secret : undefined);
        if (!profile && !secret) continue;
        let command: SaveProfile;
        try {
          const route = profile ?? (row.legacy ? providerRouteForEndpoint(provider, legacy.current!.baseUrl) : PROVIDER_PRESETS[provider]);
          const fields = providerPresetFields(provider, { profileId: row.profileId, nickname: profile?.nickname ?? PROVIDER_PRESETS[provider].name }, route);
          command = { profile: { ...fields, ...(secret ? { secret } : {}) }, expectedRevision: profile?.revision ?? null,
            ...(profile ? { expectedSnapshotHash: profile.snapshotHash } : {}) };
        } catch { patch(provider, { blocked: true, issue: '旧配置保留：当前 endpoint／协议尚未核实支持此预设；不会改路由或迁移 Key。' }); continue; }
        remember(provider, { profileId: row.profileId });
        try {
          const saved = await client(operation).save(command);
          if (!operation.current()) return;
          // A success reply must acknowledge the exact intended public fields, not only the id.
          validateProviderPreset(provider, saved);
          if (saved.baseUrl !== command.profile.baseUrl || saved.nickname !== command.profile.nickname) throw Error('profile_response_mismatch');
          remember(provider, { profileId: saved.profileId, receipt: saved });
          patch(provider, { profile: saved, secret: '', editing: false, legacy: false, receipt: saved, outcome: 'binding-pending', issue: '' });
          try { bindSaved(provider, saved); }
          catch { /* Private success is retained. Next Save retries only the public association. */ }
        } catch (error) {
          if (!operation.current()) return;
          const code = error instanceof Error ? error.message : '';
          if (definiteRejection.has(code)) {
            remember(provider);
            if (code === 'revision_conflict') {
              patch(provider, { blocked: true, issue: '版本冲突，本次未覆盖；正在回读此连接，草稿保留。' });
              try {
                const fresh = await client(operation).refresh();
                if (!operation.current()) return;
                const current = fresh.find(p => p.profileId === row.profileId);
                patch(provider, current ? { profile: current, blocked: false, issue: '版本冲突，本次未覆盖；已回读新版本。请核对后再次明确保存。' }
                  : { issue: '版本冲突，原连接已不存在；草稿保留，请定位来源。' });
              } catch { if (operation.current()) patch(provider, { issue: '版本冲突；回读未完成，草稿保留，请关闭后重新读取。' }); }
            } else patch(provider, { blocked: true, issue: '此连接未保存；请检查已核来源后重新打开设置，草稿未提交。' });
          } else {
            // Network/response/storage errors can follow a completed private write. Never retry the secret.
            patch(provider, { outcome: 'unknown', secret: '', editing: false, issue: '' });
          }
        }
      }
    } finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }
  async function restoreGLM() {
    const row = rowsRef.current.glm;
    if (!ready || busyRef.current || row.profile || row.legacy || bindings.current.glm || row.blocked || row.secret || row.outcome !== 'idle') return;
    busyRef.current = true; setBusy(true); setMessage('');
    const operation = owner.begin();
    try {
      const draft = fixture ? await (async () => {
        const response = await awaitChatOperation(fixture.fetchImpl('/api/import-zcode', { method: 'POST', signal: operation.signal }), operation);
        const data = await awaitChatOperation(response.json(), operation);
        if (!response.ok) throw Error('invalid_import_draft');
        return data;
      })() : await requestImportDraft(operation);
      if (!operation.current()) return;
      if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.keys(draft).some(k => !['baseUrl','apiKey','model','note'].includes(k)) ||
        draft.baseUrl !== GLM_ANTHROPIC_BASE || typeof draft.apiKey !== 'string' || !draft.apiKey.trim() || typeof draft.model !== 'string' || !draft.model.trim()) throw Error('invalid_import_draft');
      legacy.current = { baseUrl: draft.baseUrl, secret: draft.apiKey, requestedModel: draft.model, legacyEffort: 'unspecified' };
      patch('glm', { legacy: true, editing: false, secret: '', blocked: false, issue: '已读取本机已有 GLM，原地址与密钥保留；确认保存后使用 GLM-5.3 最高预设。尚未测试连接。' });
    } catch {
      if (operation.current()) setMessage('本机 GLM 来源未能按已核地址读取；原配置保留，未保存、未调用供应商。');
    } finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }
  async function inspectUnknown(provider: ProviderId) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const operation = owner.begin();
    try {
      const profiles = await client(operation).refresh();
      if (!operation.current()) return;
      const found = profiles.some(p => p.profileId === rowsRef.current[provider].profileId);
      patch(provider, { issue: found ? '已读到同名公开版本，但不能证明本次 Key 写入；保存结果仍未知，不自动重发。'
        : '尚未读到此连接；保存结果仍未知，不自动重发。' });
    } catch { if (operation.current()) patch(provider, { issue: '核对未完成；保存结果仍未知，不自动重发。' }); }
    finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="modal-mask settings-mask" onClick={event => event.target === event.currentTarget && close()}>
    <div ref={panel} tabIndex={-1} className="tz-console tz-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title" onKeyDown={keyDown}>
      <header className="tz-dialog-head"><h2 id="provider-settings-title">AI 设置</h2><button type="button" className="tz-resume-drop" aria-label="关闭设置" onClick={close}>×</button></header>
      <div className="tz-settings tz-dialog-body">
        {providers.map(provider => {
          const row = rows[provider], preset = PROVIDER_PRESETS[provider], stored = !!row.profile || row.legacy;
          const configured = row.profile && matchesPreset(provider, row.profile) && row.outcome !== 'unknown' && row.outcome !== 'binding-pending';
          const linked = !!row.profile && !!bindings.current[provider] && profileReferenceKey(row.profile) === profileReferenceKey(bindings.current[provider]!);
          const status = row.outcome === 'unknown' ? '保存结果未知' : row.outcome === 'binding-pending' ? '配置已保存、关联未保存'
            : configured ? (linked ? '已配置（未测试）' : 'API已保存，待确认关联（未测试）')
            : stored ? '旧配置保留，预设待保存 · API已保存，待确认关联' : row.blocked ? '旧配置保留，待定位'
            : provider === 'glm' ? 'API来源待确认' : 'API待填写或确认关联';
          const blocked = !ready || busy || row.outcome === 'unknown' || row.outcome === 'binding-pending' ||
            row.blocked;
          return <section className="tz-dialog-section" key={provider} aria-label={`${preset.name} API 设置`}>
            <h3>{preset.name}</h3><p className="tz-hint">{preset.label} · 预设已配置</p><p className="tz-hint" role="status">{status}</p>
            <div className="tz-dialog-provider-key">
              <input className="tz-row tz-dialog-input" aria-label={`${preset.name} API Key`} type="password" autoComplete="new-password" spellCheck={false}
                value={row.secret} placeholder={stored && !row.editing ? '••••••••••••' : stored ? '留空保留原 Key' : row.blocked ? '已有连接待定位，原 Key 保留' : provider === 'glm' ? '来源待确认，已有密钥无需重填' : `填写 ${preset.name} API Key`}
                disabled={blocked || (stored && !row.editing)} onChange={event => patch(provider, { secret: event.target.value })} />
              {stored && !row.editing && <button type="button" className="tz-resume-drop" disabled={blocked} onClick={() => patch(provider, { editing: true })}>修改</button>}
            </div>
            {provider === 'glm' && !stored && !bindings.current.glm && !row.blocked && row.outcome === 'idle' && <button type="button" className="tz-resume-drop" disabled={blocked || !!row.secret} onClick={restoreGLM}>读取本机已有 GLM</button>}
            {row.issue && <p className="tz-dialog-message" role="status">{row.issue}</p>}
            {row.outcome === 'unknown' && <button type="button" className="tz-resume-drop" disabled={busy} onClick={() => inspectUnknown(provider)}>核对保存状态</button>}
          </section>;
        })}
        {message && <p className="tz-dialog-message" role="status">{message}</p>}
        {busy && <p className="tz-dialog-message" role="status">正在读取、保存或核对；此时关闭不代表服务端回滚，结果可能未知。</p>}
      </div>
      <footer className="tz-dialog-actions"><button type="button" className="tz-row tz-dialog-cancel" onClick={close}>取消</button>
        <button type="button" className="tz-resume-btn tz-dialog-confirm" disabled={!ready || busy} onClick={save}>{busy ? '处理中…' : '保存设置'}</button></footer>
    </div>
  </div>;
}
