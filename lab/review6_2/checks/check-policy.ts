/** B01 finite offline checks. No API, games, training or private assets unless
 * explicitly selecting local c1400-parity after separate authorization. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function syntheticFixture(inputDim = 399, value = 0) {
  const weights = new Float32Array(inputDim * 256 + 256 + 256 * 256 + 256 + 256 + 1);
  weights[weights.length - 1] = value;
  const bytes = new Uint8Array(weights.buffer);
  return { bytes, descriptor: {
    policyId: `synthetic-${inputDim}-${value}`, modelVersion: 'synthetic-not-trained',
    architectureId: 'mlp-tanh-256x256-scalar-v1', weightsLayoutVersion: 'f32le-layer-w-row-major-then-b-v1',
    parameterCount: weights.length, weightsPathOrUrl: { nodePath: 'lab/out/B01/synthetic.f32', assetUrl: 'ai/synthetic.f32' },
    weightsSHA256: digest(bytes), inputDim,
    encoder: inputDim === 399
      ? { schema: 'v2', ctxFill: 'rule-context', passEncoding: 'action64', encoderVersion: 'gd-lab-schema-v4' }
      : { schema: 'v1', ctxFill: 'none', passEncoding: 'legacy-phys10', encoderVersion: 'gd-lab-schema-v1' },
    candidateSpecId: inputDim === 399 ? 'cand-suit-v3' : 'cand-dedup-v2', tierSpecId: inputDim === 399 ? 'none' : 'legacy-near-tie-v1', epsilon: 0, tieBreakId: 'first-candidate-v1',
  } };
}
export async function runPolicyCase(caseId: string) {
  const api = await import('../../../packages/ai/src/policy/resolve');
  const make = (f = syntheticFixture()) => ({ registry: { schemaVersion: 'gd-model-index-v1', defaultPolicyRef: f.descriptor.policyId, policies: [f.descriptor] }, f });
  const runtime = (registry: unknown, bytes: Uint8Array) => ({ registry, site: 'node' as const, readWeights: async () => bytes, sha256: digest });
  if (caseId === 'synthetic-load') {
    const { registry, f } = make();
    const resolved = await api.resolvePolicy(f.descriptor.policyId, runtime(registry, f.bytes));
    assert.equal(resolved.descriptor.inputDim, 399);
    assert.equal(resolved.descriptor.parameterCount, 168449);
    assert.equal(resolved.descriptor.weightsSHA256, digest(f.bytes));
    assert.deepEqual(resolved.encoder, { schema: 'v2', ctxFill: 'rule-context', passEncoding: 'action64' });
    for (const [name, descriptor, bytes, error] of [
      ['length', f.descriptor, f.bytes.slice(4), /length/],
      ['encoder', { ...f.descriptor, inputDim: 385 }, f.bytes, /encoder|dimension/],
      ['SHA', { ...f.descriptor, weightsSHA256: '0'.repeat(64) }, f.bytes, /SHA/],
      ['architecture', { ...f.descriptor, architectureId: 'unknown' }, f.bytes, /unsupported/],
      ['layout', { ...f.descriptor, weightsLayoutVersion: 'unknown' }, f.bytes, /unsupported/],
    ] as const) {
      let leaked: unknown;
      await assert.rejects(async () => { leaked = await api.resolvePolicy(descriptor.policyId, runtime({ ...registry, policies: [descriptor] }, bytes)); }, error, name);
      assert.equal(leaked, undefined, `${name}: no partial instance`);
    }
    const nan = f.bytes.slice(); new DataView(nan.buffer).setFloat32(0, NaN, true);
    await assert.rejects(api.resolvePolicy(f.descriptor.policyId, runtime({ ...registry, policies: [{ ...f.descriptor, weightsSHA256: digest(nan) }] }, nan)), /finite/);
    await assert.rejects(api.resolvePolicy('unknown', runtime(registry, f.bytes)), /unknown policy/);
    const { projectPublicIndex } = await import('../../../packages/ai/src/policy/public-index');
    const projected = projectPublicIndex(registry);
    assert.equal(JSON.stringify(projected).includes('nodePath'), false);
    const web = await api.resolvePolicy(f.descriptor.policyId, { ...runtime(projected, f.bytes), site: 'browser' });
    assert.deepEqual(web.identity, resolved.identity);
    const { resolveBrowserPolicy, resolveSavedBrowserPolicy, resolveRecordedBrowserPolicy } = await import('../../../packages/ai/src/policy/browser');
    const { webcrypto } = await import('node:crypto');
    const requested: string[] = [];
    const fetchAsset = async (url: unknown) => { requested.push(String(url)); return new Response(f.bytes, { status: 200 }); };
    const browserPolicy = await resolveBrowserPolicy(f.descriptor.policyId, projected, fetchAsset as typeof fetch, webcrypto.subtle as SubtleCrypto);
    assert.deepEqual(browserPolicy.identity, resolved.identity);
    const saved = api.serializeSavedLocalPolicy(browserPolicy, 'standard');
    const alternative = { ...f.descriptor, policyId: 'new-default-not-history' };
    const changedDefault = { ...projected, defaultPolicyRef: alternative.policyId, policies: [...projected.policies, alternative] };
    const historical = await resolveRecordedBrowserPolicy([saved], changedDefault, fetchAsset as typeof fetch, webcrypto.subtle as SubtleCrypto);
    assert.equal(historical.policy.identity.policyId, browserPolicy.identity.policyId, 'history never follows changed default');
    assert.equal(historical.referenceOnly, false);
    const restored = await resolveSavedBrowserPolicy(saved, projected, fetchAsset as typeof fetch, webcrypto.subtle as SubtleCrypto);
    assert.deepEqual(restored.policy!.identity, browserPolicy.identity);
    await assert.rejects(resolveSavedBrowserPolicy(saved.replace(browserPolicy.identity.weightsSHA256, '0'.repeat(64)), projected, fetchAsset as typeof fetch, webcrypto.subtle as SubtleCrypto), /saved policy SHA256/);
    let requests = 0;
    await assert.rejects(resolveBrowserPolicy(f.descriptor.policyId, projected, (async () => { requests++; return new Response(null, { status: 404 }); }) as typeof fetch, webcrypto.subtle as SubtleCrypto), /HTTP 404/);
    assert.equal(requests, 1, 'no silent default/O retry');
    await assert.rejects(resolveBrowserPolicy(f.descriptor.policyId, { ...projected, policies: [{ ...projected.policies[0], weightsPathOrUrl: {} }] }, fetchAsset as typeof fetch, webcrypto.subtle as SubtleCrypto), /no registered browser/);
    assert.ok(requested.every(url => url === 'ai/synthetic.f32'));
    // Exercise the real Node adapter with a bounded generated fixture tree.
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { resolve, join } = await import('node:path');
    const { readModelIndex, resolveNodePolicy } = await import('../policy-loader');
    const output = resolve('lab/out/B01'); await mkdir(output, { recursive: true });
    const root = await mkdtemp(join(output, 'policy-fixture-'));
    await mkdir(join(root, 'lab/out/B01'), { recursive: true });
    await writeFile(join(root, 'lab/model-index.json'), JSON.stringify(registry));
    await writeFile(join(root, 'lab/out/B01/synthetic.f32'), f.bytes);
    assert.deepEqual((await resolveNodePolicy(f.descriptor.policyId, root)).identity, browserPolicy.identity);
    const realIndex = await readModelIndex(); // registration metadata only, never real weights
    assert.equal(realIndex.defaultPolicyRef, 'frozenChampion-clean2-ck7051-encv1-candv2');
    assert.equal(realIndex.policies.find(d => d.policyId === 'r62-p8c-control-u1400-greedy')!.weightsPathOrUrl.assetUrl, undefined);
    // Load Vite's real config resolver only: no build, listener or browser.
    const { loadConfigFromFile } = await import('vite');
    const config = await loadConfigFromFile({ command: 'serve', mode: 'development' }, resolve('packages/web/vite.config.ts'));
    const plugin = config!.config.plugins!.flat().find(p => p && 'name' in p && p.name === 'registered-model-index') as import('vite').Plugin;
    const resolveId = plugin.resolveId as (id: string) => string;
    const load = plugin.load as (id: string) => string;
    const module = load(resolveId('virtual:gd-model-index'));
    const virtualIndex = JSON.parse(module.slice('export default '.length, -1));
    assert.deepEqual(virtualIndex, JSON.parse(JSON.stringify(projectPublicIndex(realIndex))));
    assert.equal(module.includes('nodePath'), false);
    return { cases: ['399 valid', 'length', 'encoder', 'SHA', 'architecture', 'layout', 'nonfinite', 'unknown-ref', 'public-projection', 'real-node-adapter-synthetic', 'browser-adapter-synthetic', 'browser-fail-closed', 'save-SHA-binding', 'Vite-projection-no-server'], input: 'synthetic-399-zero', sha256: digest(f.bytes), realWeights: false };
  }
  if (caseId === 'registry-isolation') {
    const { registry, f } = make();
    const first = await api.resolvePolicy(f.descriptor.policyId, runtime(registry, f.bytes));
    const secondFixture = syntheticFixture(399, 1);
    registry.policies.push(secondFixture.descriptor);
    registry.defaultPolicyRef = secondFixture.descriptor.policyId;
    const second = await api.resolvePolicy(secondFixture.descriptor.policyId, runtime(registry, secondFixture.bytes));
    f.bytes.fill(255); f.descriptor.weightsSHA256 = '0'.repeat(64); f.descriptor.encoder.ctxFill = 'zero';
    assert.equal(first.descriptor.weightsSHA256, '32b7c0466a0630db4ddf790c67a2c08242a4b72ae05c2deea74cc6080f05917a');
    assert.equal(first.encoder.ctxFill, 'rule-context');
    assert.equal(first.createNetwork().forward(new Float32Array(399), 1)[0], 0);
    assert.equal(second.createNetwork().forward(new Float32Array(399), 1)[0], 1);
    const disposable = second.createNetwork(); disposable.b[2][0] = 8;
    assert.equal(second.createNetwork().forward(new Float32Array(399), 1)[0], 1);
    assert.equal(Object.isFrozen(first.descriptor.encoder), true);
    assert.notEqual(first.identity.weightsSHA256, second.identity.weightsSHA256);
    return { cases: ['same-contract-second-registration', 'snapshot-isolation', 'weight-buffer-isolation', 'network-copy-isolation'], realWeights: false };
  }
  if (caseId === 'direct-consumers') {
    const { MLP, mulberry32 } = await import('../../../packages/ai/src/nn/mlp');
    const { NeuralDecider } = await import('../../../packages/ai/src/nn/neuralSeat');
    const { NeuralPlayer, FROZEN_CHAMPION_IDENTITY } = await import('../../../packages/ai/src/nn/nnplayer');
    const { MatchController } = await import('../../../packages/web/src/game/controller');
    const { DEFAULT_RULES } = await import('@gd/engine');
    const { resolveLegacySavedPolicy } = await import('../../../packages/ai/src/policy/resolve');
    const old = make(syntheticFixture(385));
    seedSyntheticSignal(old.f);
    const loaded = await api.resolvePolicy(old.f.descriptor.policyId, runtime(old.registry, old.f.bytes));
    assert.throws(() => new NeuralPlayer(0, loaded, 0.1), /tier/);
    const model = new MLP(1); model.setWeights(new Float32Array(old.f.bytes.buffer));
    const before = model.getWeights();
    assert.throws(() => model.setWeights(new Float32Array(1)), /length/);
    assert.deepEqual(model.getWeights(), before);
    const invalid = before.slice(); invalid[invalid.length - 1] = NaN;
    assert.throws(() => model.setWeights(invalid), /finite/);
    assert.deepEqual(model.getWeights(), before);
    const states = await policyPositions();
    for (const { state } of states) {
      const legacy = new NeuralDecider(0, model, 0, () => 0, { candidateCompat: 'v2', passEncoding: 'legacy-phys10' });
      const current = loaded.createDecider(0);
      assert.deepEqual(current.decide(state, { collectFeat: true, wantRanking: true }), legacy.decide(state, { collectFeat: true, wantRanking: true }));
      for (const tier of ['easy', 'standard', 'hard'] as const) {
        assert.deepEqual(new NeuralPlayer(0, loaded, tier, mulberry32(1234)).decide(state), new NeuralPlayer(0, new Float32Array(old.f.bytes.buffer), tier, mulberry32(1234)).decide(state));
      }
    }
    const c = new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, neuralPolicy: loaded, neuralTier: 'easy' });
    try {
      c.startGame();
      assert.equal(c.currentPolicies[1], 'neural-tier:easy:synthetic-not-trained');
      assert.equal(c.currentPolicies[2], 'neural:synthetic-not-trained');
      assert.deepEqual(api.resolveSavedLocalPolicy(c.matchSavePoint().aiPolicy), { policyRef: loaded.identity.policyId, weightsSHA256: loaded.identity.weightsSHA256, tier: 'easy' });
      const save = c.matchSavePoint();
      const recorder = (c as unknown as { recorder: { meta: { aiPolicies: string[] } } }).recorder;
      assert.equal(recorder.meta.aiPolicies[1], save.aiPolicy);
      assert.equal(api.resolveRecordedPolicy(recorder.meta.aiPolicies).weightsSHA256, loaded.identity.weightsSHA256);
      assert.throws(() => new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, resumeMatch: save }), /saved policy/);
      assert.throws(() => new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, resumeMatch: { ...save, aiPolicy: save.aiPolicy!.replace(loaded.identity.weightsSHA256, '0'.repeat(64)) }, neuralPolicy: loaded }), /saved policy/);
      for (const { state } of states) assert.deepEqual(c.hintNeural!.decide(state, { collectFeat: true, wantRanking: true }), loaded.createDecider(0).decide(state, { collectFeat: true, wantRanking: true }));
    } finally { c.destroy(); }
    const modern = make();
    seedSyntheticSignal(modern.f);
    const newPolicy = await api.resolvePolicy(modern.f.descriptor.policyId, runtime(modern.registry, modern.f.bytes));
    assert.throws(() => new NeuralPlayer(0, newPolicy, 'easy'), /tier/);
    assert.throws(() => new MatchController({ difficulty: 1, rules: { ...DEFAULT_RULES }, neuralPolicy: newPolicy, neuralTier: 'easy' }), /tier/);
    assert.deepEqual(api.resolveRecordedPolicy(['human', 'neural-tier:easy:clean2-ck7051-20261027', 'neural:clean2-ck7051-20261027']), { policyRef: FROZEN_CHAMPION_IDENTITY.policyId, tier: 'hard', referenceOnly: false });
    assert.deepEqual(api.resolveRecordedPolicy(['human', api.serializeSavedLocalPolicy(newPolicy, 'hard')]), { policyRef: newPolicy.identity.policyId, weightsSHA256: newPolicy.identity.weightsSHA256, tier: 'hard', referenceOnly: false });
    assert.equal(api.resolveRecordedPolicy(['human', 'heuristic:L1']).referenceOnly, true);
    assert.throws(() => api.resolveRecordedPolicy(['neural:unknown']), /unsupported/);
    assert.throws(() => api.resolveRecordedPolicy([api.serializeSavedLocalPolicy(newPolicy, 'hard'), api.serializeSavedLocalPolicy(loaded, 'hard')]), /multiple/);
    const old399 = new MLP(1, 399); old399.setWeights(new Float32Array(modern.f.bytes.buffer));
    for (const { name, state } of states) {
      const expected399 = new NeuralDecider(0, old399, 0, () => 0, { schema: 'v2', ctxFill: 'rule-context', passEncoding: 'action64' }).decide(state, { collectFeat: true, wantRanking: true });
      const result = newPolicy.createDecider(0).decide(state, { collectFeat: true, wantRanking: true });
      assert.deepEqual(result, expected399);
      assert.equal(result.feat!.length, 399);
      if (name === 'pass') {
        assert.ok(result.move.pass);
        assert.equal(result.feat![395], 1, '399 pass uses state331 + action64');
        assert.equal(result.feat![341], 0, 'legacy physical10 pass slot must remain zero');
      }
      if (name === 'wild') assert.ok(result.ranking!.some(row => row.combo?.wildAs.length));
      assert.deepEqual(new NeuralPlayer(0, newPolicy).decide(state), result.move);
      const ranker = new NeuralDecider(0, newPolicy.createNetwork(), 0, () => 0, newPolicy.encoder);
      assert.deepEqual(ranker.decide(state, { collectFeat: true, wantRanking: true }), result);
    }
    const saved = api.serializeSavedLocalPolicy(loaded, 'easy');
    assert.deepEqual(api.resolveSavedLocalPolicy(saved), { policyRef: loaded.identity.policyId, weightsSHA256: loaded.identity.weightsSHA256, tier: 'easy' });
    assert.deepEqual(api.resolveSavedLocalPolicy('neural-tier:standard'), { policyRef: FROZEN_CHAMPION_IDENTITY.policyId, tier: 'standard' });
    for (const value of ['neural-policy:v2:x:' + '0'.repeat(64) + ':easy', 'neural-policy:v1::' + '0'.repeat(64) + ':easy', 'neural-policy:v1:%zz:' + '0'.repeat(64) + ':easy', 'neural-policy:v1:x:bad:easy', '', 'neural-tier:', 'neural-policy:v1:x:y:' + '0'.repeat(64) + ':easy']) {
      assert.throws(() => api.resolveSavedLocalPolicy(value), /unsupported|invalid/);
    }
    const special = make(); special.f.descriptor.policyId = 'candidate:中文/%'; special.registry.defaultPolicyRef = special.f.descriptor.policyId;
    const specialPolicy = await api.resolvePolicy(special.f.descriptor.policyId, runtime(special.registry, special.f.bytes));
    assert.equal(api.resolveSavedLocalPolicy(api.serializeSavedLocalPolicy(specialPolicy, 'hard'))!.policyRef, 'candidate:中文/%');
    assert.equal(resolveLegacySavedPolicy(undefined), null);
    assert.equal(resolveLegacySavedPolicy('heuristic:L1'), null);
    assert.equal(resolveLegacySavedPolicy('neural-tier:easy'), FROZEN_CHAMPION_IDENTITY.policyId);
    assert.throws(() => resolveLegacySavedPolicy('neural-tier:unknown'), /unsupported/);
    assert.throws(() => resolveLegacySavedPolicy('new-unknown'), /unsupported/);
    return { cases: ['O385 ordinary/pass/wild legacy parity', 'atomic raw-weight rejection', 'controller player/hint same instance identity', '399 player/ranking parity', 'legacy-save explicit mapping', 'recorded policy SHA and default isolation', 'C greedy rejects product tier', 'O fixed D1 only'], realWeights: false, hintChange: 'intentional legacy O encoder/candidate alignment' };
  }
  if (caseId === 'c1400-parity') {
    // Real local asset only. Caller/B00 must first verify explicit authorization.
    const { resolveNodePolicy, POLICY_REPOSITORY_ROOT } = await import('../policy-loader');
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { MLP } = await import('../../../packages/ai/src/nn/mlp');
    const { NeuralDecider } = await import('../../../packages/ai/src/nn/neuralSeat');
    const { NeuralPlayer } = await import('../../../packages/ai/src/nn/nnplayer');
    const { installInferenceExecution } = await import('../../review6/exact-inference');
    const policy = await resolveNodePolicy('r62-p8c-control-u1400-greedy');
    assert.equal(policy.identity.weightsSHA256, 'd05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081');
    assert.equal(policy.descriptor.parameterCount, 168449);
    const bytes = await readFile(resolve(POLICY_REPOSITORY_ROOT, policy.descriptor.weightsPathOrUrl.nodePath!));
    assert.equal(digest(bytes), policy.identity.weightsSHA256);
    const original = new MLP(1, 399);
    original.setWeights(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    installInferenceExecution(original, 'exact-prefix-v1'); // scoreRoot's frozen research execution
    const encoder = { schema: 'v2' as const, ctxFill: 'rule-context' as const, passEncoding: 'action64' as const };
    const cases = [];
    for (const { name, state } of await policyPositions()) {
      const legacy = new NeuralDecider(0, original, 0, () => 0, encoder).decide(state, { collectFeat: true, wantRanking: true });
      const current = policy.createDecider(0).decide(state, { collectFeat: true, wantRanking: true });
      assert.deepEqual(current.feat, legacy.feat, `${name}: selected input features`);
      assert.deepEqual(current.move, legacy.move, `${name}: canonical first choice`);
      assert.deepEqual(current.ranking, legacy.ranking, `${name}: ranking/candidate identity`);
      assert.deepEqual(new NeuralPlayer(0, policy).decide(state), legacy.move, `${name}: player consumer`);
      const ranker = new NeuralDecider(0, policy.createNetwork(), 0, () => 0, policy.encoder);
      assert.deepEqual(ranker.decide(state, { collectFeat: true, wantRanking: true }), current, `${name}: review/hint consumer contract`);
      cases.push({ name, featureSHA256: digest(new Uint8Array(current.feat!.buffer)), move: current.move, candidates: current.nCands });
    }
    return { policy: policy.identity, realWeights: true, cases, scope: 'three synthetic positions with real fixed C1400; not a match/strength evaluation, not browser deployment' };
  }
  throw Error(`unknown case: ${caseId}`);
}
/** Sparse, deterministic nonzero signal exercises all serialized layers. */
function seedSyntheticSignal(f: ReturnType<typeof syntheticFixture>): void {
  const flat = new Float32Array(f.bytes.buffer);
  const d = f.descriptor.inputDim;
  flat[0] = 0.2; flat[d - 4] = 0.7; // state and action signal
  flat[d * 256] = 0.1; // b1
  flat[d * 256 + 256] = 0.3; // W2
  flat[d * 256 + 256 + 256 * 256] = 0.2; // b2
  flat[d * 256 + 256 + 256 * 256 + 256] = 0.4; // W3
  flat[flat.length - 1] = 0.5; // b3
  f.descriptor.weightsSHA256 = digest(f.bytes);
}
export async function policyPositions() {
  const { createMatch, startGame, DEFAULT_RULES, buildDeck, classify } = await import('@gd/engine');
  const deck = buildDeck();
  const card = (rank: number, suit: string) => { const c = deck.find(c => c.rank === rank && c.suit === suit); assert.ok(c); return c; };
  const base = () => { const s = startGame(createMatch({ ...DEFAULT_RULES }, 1234)); s.turn = 0; s.leader = 0; s.lastPlayer = 0; s.hands = [[card(3,'C'),card(3,'D'),card(3,'S'),card(4,'D'),card(5,'S')],[card(6,'C')],[card(7,'C')],[card(14,'C')]]; return s; };
  const ordinary = base();
  const pass = base(); pass.lastPlayer = 3; pass.lastCombo = classify([card(14,'C')], pass.ctx, pass.match.opts)[0];
  const wild = base(); wild.hands[0] = [card(2,'H'), card(9,'C')]; wild.lastPlayer = 3;
  wild.lastCombo = classify([card(8,'C'),card(8,'D')], wild.ctx, wild.match.opts).find(c => c.kind === 'pair')!;
  return [{ name: 'ordinary', state: ordinary }, { name: 'pass', state: pass }, { name: 'wild', state: wild }];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--case') throw Error('Expected --case <registered selector>');
  const caseId = process.argv[3];
  const start = new Date().toISOString();
  try { const actual = await runPolicyCase(caseId); console.log(JSON.stringify({ caseId, startedAt: start, completedAt: new Date().toISOString(), status: 'passed', actual })); }
  catch (error) {
    const pending = caseId === 'c1400-parity' && (error as { code?: string }).code === 'ENOENT';
    console.error(JSON.stringify({ caseId, startedAt: start, completedAt: new Date().toISOString(), status: pending ? 'pending' : 'failed', error: String(error) }));
    process.exitCode = pending ? 3 : 1;
  }
}
