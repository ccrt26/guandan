/** Node-only adapter. Do not re-export from @gd/ai's browser entry. */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolvePolicy, validatePolicyIndex, type PolicyIndex, type ResolvedPolicy } from '../../packages/ai/src/policy/resolve';
export const POLICY_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function readModelIndex(root = POLICY_REPOSITORY_ROOT): Promise<PolicyIndex> {
  return validatePolicyIndex(JSON.parse(await readFile(resolve(root, 'lab/model-index.json'), 'utf8')));
}
export async function resolveNodePolicy(ref: string, root = POLICY_REPOSITORY_ROOT): Promise<ResolvedPolicy> {
  const registry = await readModelIndex(root);
  const realRoot = realpathSync(root);
  return resolvePolicy(ref, { registry, site: 'node',
    readWeights: async location => {
      const path = realpathSync(resolve(root, location));
      const rel = relative(realRoot, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error('registered weights escape repository');
      return new Uint8Array(await readFile(path));
    },
    sha256: bytes => createHash('sha256').update(bytes).digest('hex'),
  });
}
