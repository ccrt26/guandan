import { resolvePolicy, resolveSavedLocalPolicy, resolveRecordedPolicy, type ResolvedPolicy } from './resolve';
/** Browser adapter: only the selected descriptor's relative registered URL is
 * requested. No retry under another identity, no default/O fallback. */
export async function resolveBrowserPolicy(ref: string, registry: unknown,
  fetchAsset: typeof fetch = globalThis.fetch.bind(globalThis), subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<ResolvedPolicy> {
  return resolvePolicy(ref, { registry, site: 'browser',
    readWeights: async url => {
      const response = await fetchAsset(url);
      if (!response.ok) throw Error(`policy ${ref} unavailable: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    sha256: async bytes => Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource)), n => n.toString(16).padStart(2, '0')).join(''),
  });
}

/** Save restoration uses immutable reference+SHA, never the current default. */
export async function resolveSavedBrowserPolicy(aiPolicy: string | undefined, registry: unknown,
  fetchAsset?: typeof fetch, subtle?: SubtleCrypto): Promise<{ policy: ResolvedPolicy | undefined; tier: 'easy' | 'standard' | 'hard' }> {
  const saved = resolveSavedLocalPolicy(aiPolicy);
  if (!saved) return { policy: undefined, tier: 'hard' };
  const policy = await resolveBrowserPolicy(saved.policyRef, registry, fetchAsset, subtle);
  if (saved.weightsSHA256 && saved.weightsSHA256 !== policy.identity.weightsSHA256) throw Error('saved policy SHA256 differs from registration');
  return { policy, tier: saved.tier };
}

/** Model analysis resolves recorded identity explicitly. Pure replay never calls this. */
export async function resolveRecordedBrowserPolicy(aiPolicies: readonly string[] | undefined, registry: unknown,
  fetchAsset?: typeof fetch, subtle?: SubtleCrypto): Promise<{ policy: ResolvedPolicy; referenceOnly: boolean }> {
  const selected = resolveRecordedPolicy(aiPolicies);
  const policy = await resolveBrowserPolicy(selected.policyRef, registry, fetchAsset, subtle);
  if (selected.weightsSHA256 && selected.weightsSHA256 !== policy.identity.weightsSHA256) throw Error('recorded policy SHA256 differs from registration');
  return { policy, referenceOnly: selected.referenceOnly };
}
