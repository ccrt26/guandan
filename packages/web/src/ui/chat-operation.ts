import { createProfileClient, profileReference, type PublicProfile } from '../game/storage';

export interface ChatOperation { signal: AbortSignal; current(): boolean }
/** Each UI owns its generation; invalidation is synchronous, independent of transport cooperation. */
export function createChatOperationOwner() {
  let generation = 0, controller: AbortController | null = null;
  function invalidate() { ++generation; controller?.abort(); controller = null; }
  return {
    invalidate,
    begin(): ChatOperation {
      invalidate(); const mine = generation, owned = new AbortController(); controller = owned;
      return { signal: owned.signal, current: () => mine === generation && !owned.signal.aborted };
    },
  };
}
function cancelled() { return new DOMException('Operation cancelled', 'AbortError'); }
/** Stop awaiting even if a fake/peer ignores abort; late rejection remains observed. */
export function awaitChatOperation<T>(pending: Promise<T>, operation: ChatOperation): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(cancelled()); };
    const cleanup = () => operation.signal.removeEventListener('abort', abort);
    pending.then(value => { cleanup(); operation.current() ? resolve(value) : reject(cancelled()); }, error => { cleanup(); reject(error); });
    if (!operation.current()) { abort(); return; }
    operation.signal.addEventListener('abort', abort, { once: true });
  });
}
export function operationProfileClient(operation?: ChatOperation) {
  return createProfileClient({
    storage: {
      getItem: key => { try { return localStorage.getItem(key); } catch { return null; } },
      setItem: (key, value) => { if (operation?.current()) { try { localStorage.setItem(key, value); } catch { /* optional public cache */ } } },
      removeItem: () => { /* No legacy mutation. */ },
    },
    fetchImpl: async (url, init) => {
      if (!operation?.current()) throw cancelled();
      const response = await awaitChatOperation(fetch(url, { ...init, signal: operation.signal }), operation);
      return { ok: response.ok, status: response.status, json: () => awaitChatOperation(response.json(), operation) };
    },
  });
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export async function requestCompletedChat(profile: PublicProfile, messages: { role: string; content: string }[], operation: ChatOperation): Promise<string> {
  if (!operation.current()) throw cancelled();
  const reference = profileReference(profile), protocol = profile.protocol, requestedModel = profile.requestedModel;
  let response;
  try { response = await awaitChatOperation(fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference, messages }), signal: operation.signal }), operation); }
  catch { throw Error('讲解连接未完成；连接状态未知，可取消或重新显式请求。'); }
  if (!operation.current()) throw cancelled();
  let data: unknown;
  try { data = await awaitChatOperation(response.json(), operation); }
  catch { throw Error('未收到完整有效的完成响应。'); }
  if (!operation.current()) throw cancelled();
  if (!response.ok || response.status !== 200 || !plain(data) || data.status !== 'completed' ||
      Object.keys(data).sort().join(',') !== 'status,summary,text' || typeof data.text !== 'string' || !data.text.trim() || !plain(data.summary))
    throw Error('请求未完成；未接受任何部分输出。');
  const summary = data.summary;
  if (Object.keys(summary).sort().join(',') !== 'profileId,protocol,requestCount,requestedModel,returnedModel,revision,snapshotHash' ||
      summary.profileId !== reference.profileId || summary.revision !== reference.revision || summary.snapshotHash !== reference.snapshotHash ||
      summary.protocol !== protocol || summary.requestedModel !== requestedModel || summary.requestCount !== 1 ||
      !(summary.returnedModel === null || (typeof summary.returnedModel === 'string' && summary.returnedModel.length <= 200))) throw Error('完成响应的连接身份不匹配。');
  return data.text;
}
export async function requestImportDraft(operation: ChatOperation): Promise<Record<string, unknown>> {
  if (!operation.current()) throw cancelled();
  const response = await awaitChatOperation(fetch('/api/import-zcode', { method: 'POST', signal: operation.signal }), operation);
  if (!operation.current()) throw cancelled();
  const draft: unknown = await awaitChatOperation(response.json(), operation);
  if (!response.ok || !plain(draft)) throw Error('invalid_import_draft');
  // Keep every source field in memory; never combine absent fields with defaults/environment.
  return draft;
}
