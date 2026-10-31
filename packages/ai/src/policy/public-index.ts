import { validatePolicyIndex, type PolicyIndex } from './descriptor';
/** Derived in Vite's Node context; never ship registered filesystem locations. */
export function projectPublicIndex(value: unknown): PolicyIndex {
  const index = validatePolicyIndex(value);
  return validatePolicyIndex({ ...index, policies: index.policies.map(d => ({ ...d,
    weightsPathOrUrl: d.weightsPathOrUrl.assetUrl ? { assetUrl: d.weightsPathOrUrl.assetUrl } : {},
  })) });
}
