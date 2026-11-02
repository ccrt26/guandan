import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createProfileClient, type PublicProfile, type SaveProfile } from '../game/storage';
import { ProviderTestError, type ProviderStateView, type ConnectionSummary, type ProfileReference } from '../game/llm-profiles';
import { PROVIDER_PRESETS, GLM_ANTHROPIC_BASE, providerRouteForEndpoint, providerPresetFields, validateProviderPreset, validateProviderRoute, describeProviderAvailability, describeProviderConnection, type ProviderId } from '../game/provider-presets';
import { awaitChatOperation, createChatOperationOwner, operationProfileClient, requestImportDraft, type ChatOperation } from './chat-operation';

export interface SettingsModalFixtureDependencies {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}
type Legacy = ReturnType<ReturnType<typeof createProfileClient>['readLegacyForExplicitImport']>;
type Row = { profile: PublicProfile | null; profileId: string; legacy: boolean; editing: boolean; secret: string;
  issue: string; blocked: boolean; outcome: 'idle' | 'saved' | 'unknown'; connection: string; diagnostic: ConnectionSummary | null; testing: boolean; testNotice: string; testRecord: 'shared' | 'unpersisted' | 'unverified' };
const providers: ProviderId[] = ['glm', 'deepseek'];
const sameReference = (a: ProfileReference | null | undefined, b: ProfileReference | null | undefined) =>
  !!a && !!b && a.profileId === b.profileId && a.revision === b.revision && a.snapshotHash === b.snapshotHash;
const emptyRow = (): Row => ({ profile: null, profileId: '',
  legacy: false, editing: false, secret: '', issue: '', blocked: false, outcome: 'idle', connection: '正在读取共享连接状态。', diagnostic: null, testing: false, testNotice: '', testRecord: 'shared' });
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
  const testOwners = useMemo(() => ({ glm: createChatOperationOwner(), deepseek: createChatOperationOwner() }), []);
  const testing = useRef<Record<ProviderId, boolean>>({ glm: false, deepseek: false });
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
  const [rows, setRows] = useState<Record<ProviderId, Row>>(() => ({ glm: emptyRow(), deepseek: emptyRow() }));
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const legacy = useRef<Legacy | null>(null), sharedState = useRef<ProviderStateView | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const busyRef = useRef(false), panel = useRef<HTMLDivElement | null>(null);
  function patch(provider: ProviderId, changes: Partial<Row>) {
    const next = { ...rowsRef.current, [provider]: { ...rowsRef.current[provider], ...changes } };
    rowsRef.current = next; setRows(next);
  }
  function discard() {
    owner.invalidate(); listOwner.invalidate(); legacy.current = null;
    for (const provider of providers) testOwners[provider].invalidate();
    for (const provider of providers) rowsRef.current[provider] = { ...rowsRef.current[provider], secret: '' };
  }
  function close() { discard(); onClose(); }
  useLayoutEffect(() => () => discard(), [owner, listOwner, testOwners]);
  useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);
  function remember(provider: ProviderId, entry?: { profileId: string; receipt?: PublicProfile }) {
    const pending = pendingByStorage.get(storage) ?? {};
    if (entry) pending[provider] = entry; else delete pending[provider];
    pendingByStorage.set(storage, pending);
  }
  function applySharedState(view: ProviderStateView, initial = false, legacyIssue = '') {
    sharedState.current = view;
    for (const provider of providers) {
      const status = describeProviderAvailability(provider, view), row = rowsRef.current[provider];
      const pending = pendingByStorage.get(storage)?.[provider];
      if (!initial && row.secret) continue; // Preserve a rejected/conflicted draft and its exact CAS target.
      // Another provider's Save readback cannot replace an unpersisted result or clear its uncertainty gate.
      if (!initial && row.testRecord !== 'shared') {
        if (!sameReference(row.profile, status.profile) && row.testRecord !== 'unverified')
          patch(provider, { blocked: true, testRecord: 'unverified',
            testNotice: `${row.testRecord === 'unpersisted' && !row.testNotice.includes('未保存') ? '所示诊断结果未保存。' : ''}${row.testNotice}共享配置已变化；所示诊断仅属原连接，请重新打开设置核对。` });
        continue;
      }
      const hasLegacy = provider === 'glm' && status.state === 'missing' && !!legacy.current;
      let issue = status.state === 'ready' ? '' : status.reason;
      let blocked = status.state !== 'ready' && status.state !== 'missing';
      if (hasLegacy) {
        try { validateProviderRoute(provider, providerRouteForEndpoint(provider, legacy.current!.baseUrl)); }
        catch { blocked = true; issue = '旧配置保留：当前 endpoint／协议尚未核实支持此预设；不会改路由或迁移 Key。'; }
      } else if (provider === 'glm' && status.state === 'missing' && legacyIssue) issue = legacyIssue;
      // An uncertain key write cannot be proven by the unchanged public snapshot.
      const unknown = row.outcome === 'unknown' || !!(pending && !pending.receipt);
      patch(provider, { profile: status.profile, profileId: unknown ? pending?.profileId ?? row.profileId : status.profile?.profileId ?? '',
        legacy: hasLegacy, blocked, issue, connection: status.reason, diagnostic: view.providers[provider].connection,
        ...(initial ? { outcome: unknown ? 'unknown' : pending?.receipt ? 'saved' : 'idle' } : {}) });
      if (pending?.receipt) remember(provider);
    }
  }
  useEffect(() => {
    // Only opening this editor reads legacy data; shared availability never depends on it or browser bindings.
    const operation = listOwner.begin();
    let legacyIssue = '';
    try { legacy.current = client().readLegacyForExplicitImport(); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      legacyIssue = code === 'legacy_config_not_found'
        ? '当前浏览器未找到完整旧配置；可显式读取本机已有 GLM，已有密钥无需重填。'
        : '旧配置格式未识别或读取未完成；原配置保留，已有密钥无需重填。';
    }
    client(operation).refreshProviderState().then(view => {
      if (!operation.current()) return;
      applySharedState(view, true, legacyIssue); setReady(true);
    }).catch(() => { if (operation.current()) setMessage('本机配置服务暂不可用；共享状态未知，缓存不代表当前可用或已测试。'); });
    return () => listOwner.invalidate();
  }, [listOwner, storage]);

  async function save() {
    if (!ready || busyRef.current || providers.some(provider => testing.current[provider])) return;
    busyRef.current = true; setBusy(true); setMessage('');
    const operation = owner.begin();
    const savedProviders = new Set<ProviderId>();
    try {
      for (const provider of providers) {
        if (!operation.current()) return;
        const row = rowsRef.current[provider];
        if (row.outcome === 'unknown' || row.blocked) continue;
        const profile = row.profile;
        // No browser association write. Blank key/unchanged ready profile is a complete no-op.
        if (profile && !row.secret) continue;
        if (!profile && !row.secret && !(row.legacy && row.editing)) continue;
        const secret = row.secret || (row.legacy ? legacy.current?.secret : undefined);
        if (!profile && !secret) continue;
        if (!profile) {
          // A new profile is allowed only while the shared backend still has no provider source.
          let fresh: ProviderStateView;
          try { fresh = await client(operation).refreshProviderState(); }
          catch {
            if (!operation.current()) return;
            patch(provider, { blocked: true, issue: '共享来源核对未完成；未新建连接，草稿保留，请重新打开设置。' });
            continue;
          }
          if (!operation.current()) return;
          if (fresh.providers[provider].availability !== 'missing') {
            applySharedState(fresh);
            patch(provider, { blocked: true, issue: '共享连接已变化；未新建或覆盖。请重新打开设置核对准确来源。' });
            continue;
          }
        }
        const profileId = profile?.profileId ?? (row.profileId || `ohuo-${provider}-${crypto.randomUUID()}`);
        let command: SaveProfile;
        try {
          const route = profile ?? (row.legacy ? providerRouteForEndpoint(provider, legacy.current!.baseUrl) : PROVIDER_PRESETS[provider]);
          const fields = providerPresetFields(provider, { profileId, nickname: profile?.nickname ?? PROVIDER_PRESETS[provider].name }, route);
          command = { profile: { ...fields, ...(secret ? { secret } : {}) }, expectedRevision: profile?.revision ?? null,
            ...(profile ? { expectedSnapshotHash: profile.snapshotHash } : {}) };
        } catch { patch(provider, { blocked: true, issue: '旧配置保留：当前 endpoint／协议尚未核实支持此预设；不会改路由或迁移 Key。' }); continue; }
        patch(provider, { profileId, outcome: 'idle' }); remember(provider, { profileId });
        try {
          const saved = await client(operation).save(command);
          if (!operation.current()) return;
          validateProviderPreset(provider, saved);
          if (saved.baseUrl !== command.profile.baseUrl || saved.protocol !== command.profile.protocol || saved.nickname !== command.profile.nickname) throw Error('profile_response_mismatch');
          // The private save receipt is final even if the subsequent read fails. Never resend its key.
          remember(provider, { profileId: saved.profileId, receipt: saved }); savedProviders.add(provider);
          patch(provider, { profile: saved, profileId: saved.profileId, secret: '', editing: false, legacy: false,
            outcome: 'saved', issue: '', testNotice: '', testRecord: 'shared', diagnostic: null, connection: '配置已保存；正在读取连接诊断状态。' });
          if (provider === 'glm') legacy.current = null;
          // Notify mounted consumers only after an acknowledged save; opening/GET/fixtures never emit this.
          if (!fixture && typeof window !== 'undefined') window.dispatchEvent(new Event('ohuo-provider-state-changed'));
        } catch (error) {
          if (!operation.current()) return;
          const code = error instanceof Error ? error.message : '';
          if (definiteRejection.has(code)) {
            remember(provider);
            if (code === 'revision_conflict') {
              patch(provider, { blocked: true, issue: '版本冲突，本次未覆盖；正在回读此连接，草稿保留。' });
              try {
                const fresh = await client(operation).refreshProviderState();
                if (!operation.current()) return;
                const status = describeProviderAvailability(provider, fresh);
                if (status.profile?.profileId === profileId) {
                  sharedState.current = fresh;
                  patch(provider, { profile: status.profile, connection: status.reason, diagnostic: fresh.providers[provider].connection, blocked: false, testRecord: 'shared', testNotice: '',
                    issue: '版本冲突，本次未覆盖；已回读同一连接的新版本。请核对后再次明确保存。' });
                } else patch(provider, { issue: '版本冲突，准确来源已变化；草稿保留，请关闭后重新定位。' });
              } catch { if (operation.current()) patch(provider, { issue: '版本冲突；回读未完成，草稿保留，请关闭后重新读取。' }); }
            } else patch(provider, { blocked: true, issue: '此连接未保存；请检查已核来源后重新打开设置，草稿未提交。' });
          } else {
            patch(provider, { outcome: 'unknown', secret: '', editing: false, issue: '', diagnostic: null, testNotice: '', testRecord: 'shared', connection: '保存结果未知。' });
          }
        }
      }
      if (savedProviders.size && operation.current()) {
        try {
          const fresh = await client(operation).refreshProviderState();
          if (operation.current()) applySharedState(fresh);
        } catch {
          if (operation.current()) {
            for (const provider of savedProviders)
              patch(provider, { connection: '配置已保存；连接诊断读取失败，状态未知。' });
            setMessage('配置保存已确认；共享状态回读未完成，不会重发保存。请重开设置读取最新状态。');
          }
        }
      }
    } finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }

  async function restoreGLM() {
    const row = rowsRef.current.glm;
    if (!ready || busyRef.current || providers.some(provider => testing.current[provider]) || row.profile || row.legacy || sharedState.current?.providers.glm.availability !== 'missing' || row.blocked || row.secret || row.outcome !== 'idle') return;
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
      patch('glm', { legacy: true, editing: true, secret: '', blocked: false, issue: '已读取本机已有 GLM，原地址与密钥保留；确认保存后使用 GLM-5.3 最高预设。当前草稿未测试。' });
    } catch {
      if (operation.current()) setMessage('本机 GLM 来源未能按已核地址读取；原配置保留，未保存、未调用供应商。');
    } finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }
  async function inspectUnknown(provider: ProviderId) {
    if (busyRef.current || providers.some(provider => testing.current[provider])) return;
    busyRef.current = true; setBusy(true);
    const operation = owner.begin();
    try {
      const { profiles } = await client(operation).refreshProviderState();
      if (!operation.current()) return;
      const found = profiles.some(p => p.profileId === rowsRef.current[provider].profileId);
      patch(provider, { issue: found ? '已读到同名公开版本，但不能证明本次 Key 写入；保存结果仍未知，不自动重发。'
        : '尚未读到此连接；保存结果仍未知，不自动重发。' });
    } catch { if (operation.current()) patch(provider, { issue: '核对未完成；保存结果仍未知，不自动重发。' }); }
    finally { if (operation.current()) { busyRef.current = false; setBusy(false); } }
  }
  function testBlockedReason(provider: ProviderId): string {
    const row = rowsRef.current[provider];
    if (testing.current[provider]) return '测试中…关闭仅停止等待，不代表后台回滚。';
    if (!ready) return '正在读取共享配置，暂不能测试。';
    if (busyRef.current) return '请等待读取、保存或核对完成后再测试。';
    if (row.secret || row.legacy) return '先保存再测试。';
    if (row.outcome === 'unknown') return '保存结果未知，暂不能测试。';
    const state = sharedState.current?.providers[provider];
    if (row.blocked || !row.profile || state?.availability !== 'ready' || !sameReference(row.profile, state.reference))
      return '准确已保存连接尚未就绪，请核对配置后再测试。';
    return '';
  }
  async function testProvider(provider: ProviderId) {
    if (testBlockedReason(provider)) return;
    const profile = rowsRef.current[provider].profile!;
    const reference: ProfileReference = { profileId: profile.profileId, revision: profile.revision, snapshotHash: profile.snapshotHash };
    let requestId: string;
    try { requestId = crypto.randomUUID(); }
    catch { patch(provider, { testNotice: '浏览器未能创建测试请求，本次未执行。' }); return; }
    const operation = testOwners[provider].begin();
    testing.current[provider] = true;
    patch(provider, { testing: true, testNotice: '测试中…关闭仅停止等待，不代表后台回滚。以下为已有记录：' });
    const ownsRow = () => {
      const row = rowsRef.current[provider];
      return operation.current() && sameReference(row.profile, reference) && !row.secret && !row.legacy && row.outcome !== 'unknown';
    };
    try {
      const result = await client(operation).testProvider(provider, reference, requestId);
      if (!ownsRow()) return;
      patch(provider, { connection: describeProviderConnection(result.connection), diagnostic: result.connection,
        blocked: !result.profileUnchanged, testRecord: !result.profileUnchanged ? 'unverified' : result.persisted ? 'shared' : 'unpersisted',
        testNotice: `${!result.persisted ? '本次测试结果未保存；以下仅为本次返回结果。' : ''}${!result.profileUnchanged ? '配置已变化或无法核实，本次结果不证明当前配置可用；请重新打开设置核对。' : ''}` });
      if (result.persisted && !fixture && typeof window !== 'undefined') window.dispatchEvent(new Event('ohuo-provider-state-changed'));
    } catch (error) {
      if (!ownsRow()) return;
      const rejected = error instanceof ProviderTestError && error.execution === 'not-started';
      const changed = rejected && ['revision_conflict','profile_not_found','profile_contract_mismatch'].includes(error.code);
      const notice = !rejected ? '本次测试结果未知，不会自动重发；重新打开设置可只读已有结果。'
        : error.code === 'test_in_progress' ? '服务端已有此供应商测试在进行，本次未另发测试；稍后重新打开设置读取结果。'
        : changed ? '已保存连接已变化或不匹配，本次测试未执行；请重新打开设置核对。'
        : error.code === 'profile_service_unavailable' ? '配置服务暂不可用，本次测试未执行。'
        : '测试请求未执行；请核对已保存配置后再明确测试。';
      const retained = rowsRef.current[provider].testRecord === 'unpersisted' ? '此前显示的诊断结果未保存。' : '';
      patch(provider, { testNotice: `${notice}${retained}以下为已有记录：`, ...(changed ? { blocked: true, testRecord: 'unverified' as const } : {}) });
    } finally {
      if (operation.current()) { testing.current[provider] = false; patch(provider, { testing: false }); }
    }
  }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex]'))
      .filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0 && getComputedStyle(item).visibility === 'visible');
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="modal-mask settings-mask" onClick={event => event.target === event.currentTarget && close()}>
    <div ref={panel} tabIndex={-1} className="tz-console tz-dialog provider-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title" onKeyDown={keyDown}>
      <header className="tz-dialog-head"><h2 id="provider-settings-title">AI 设置</h2><button type="button" className="tz-resume-drop" aria-label="关闭设置" onClick={close}>×</button></header>
      <div className="tz-settings tz-dialog-body">
        {providers.map(provider => {
          const row = rows[provider], preset = PROVIDER_PRESETS[provider], stored = !!row.profile || row.legacy;
          const status = row.outcome === 'unknown' ? '保存结果未知' : stored && row.legacy
            ? '旧配置保留；需显式修改或导入后保存，当前草稿未测试。' : row.connection;
          const blocked = !ready || busy || row.testing || row.outcome === 'unknown' || row.blocked;
          const testReason = testBlockedReason(provider), testStatusId = `provider-${provider}-test-status`;
          const retainedNotice = row.testRecord === 'unpersisted' && !row.testNotice.includes('未保存') ? '此前显示的诊断结果未保存。' : '';
          const testStatus = [retainedNotice, row.testing ? row.testNotice : [testReason, row.testNotice].filter(Boolean).join(' ')].filter(Boolean).join(' ');
          return <section className="tz-dialog-section" key={provider} aria-label={`${preset.name} API 设置`}>
            <h3>{preset.name}</h3><p className="tz-hint">{preset.label} · 预设已配置</p><p className="tz-hint" id={testStatusId} role="status">{testStatus && <>{testStatus} </>}{status}</p>
            <div className="tz-dialog-provider-key">
              <input className="tz-row tz-dialog-input" aria-label={`${preset.name} API Key`} type="password" autoComplete="new-password" spellCheck={false}
                value={row.secret} placeholder={stored && !row.editing ? '••••••••••••' : stored ? '留空保留原 Key' : row.blocked ? '已有连接待定位，原 Key 保留' : provider === 'glm' ? '来源待确认，已有密钥无需重填' : `填写 ${preset.name} API Key`}
                disabled={blocked || (stored && !row.editing)} onChange={event => patch(provider, { secret: event.target.value, outcome: 'idle', testNotice: '' })} />
              <div className="provider-settings-key-actions">
              {stored && !row.editing && <button type="button" className="tz-resume-drop" disabled={blocked} onClick={() => patch(provider, { editing: true, outcome: 'idle', testNotice: '' })}>修改</button>}
              <button type="button" className="tz-resume-drop" disabled={!!testReason} aria-describedby={testStatusId} onClick={() => testProvider(provider)}>{row.testing ? '测试中…' : '测试连接'}</button>
              </div>
            </div>
            {provider === 'glm' && !stored && sharedState.current?.providers.glm.availability === 'missing' && !row.blocked && row.outcome === 'idle' && <button type="button" className="tz-resume-drop" disabled={blocked || !!row.secret || providers.some(p => rows[p].testing)} onClick={restoreGLM}>读取本机已有 GLM</button>}
            {row.profile && <details className="provider-settings-diagnostic"><summary>连接诊断详情</summary><pre>{JSON.stringify({
              profileId: row.profile.profileId, revision: row.profile.revision, snapshotHash: row.profile.snapshotHash,
              protocol: row.profile.protocol, requestedModel: row.profile.requestedModel, connection: row.diagnostic,
            }, null, 2)}</pre></details>}
            {row.issue && <p className="tz-dialog-message" role="status">{row.issue}</p>}
            {row.outcome === 'unknown' && <button type="button" className="tz-resume-drop" disabled={busy || providers.some(p => rows[p].testing)} onClick={() => inspectUnknown(provider)}>核对保存状态</button>}
          </section>;
        })}
        {message && <p className="tz-dialog-message" role="status">{message}</p>}
        {providers.some(provider => rows[provider].testing) && <p className="tz-dialog-message" role="status">测试期间暂不能保存设置；关闭仅停止等待，不代表后台回滚。</p>}
        {busy && <p className="tz-dialog-message" role="status">正在读取、保存或核对；此时关闭不代表服务端回滚，结果可能未知。</p>}
      </div>
      <footer className="tz-dialog-actions"><button type="button" className="tz-row tz-dialog-cancel" onClick={close}>取消</button>
        <button type="button" className="tz-resume-btn tz-dialog-confirm" disabled={!ready || busy || providers.some(p => rows[p].testing)} onClick={save}>{busy ? '处理中…' : '保存设置'}</button></footer>
    </div>
  </div>;
}
