import { describe, expect, it } from 'vitest';
import { createMatch, DEFAULT_RULES, startGame } from '@gd/engine';
import { createHash } from 'node:crypto';
import { describeRules, RULES_TEXT_VERSION } from '../../packages/ai/src/hybrid/observation';
import { candidatePolicyForBundle, CURRENT_CANDIDATE_SPEC, FIRST_TARGET_CANDIDATE_POLICY, resolveCandidatePolicy } from '../../packages/ai/src/candidate-spec';
import { resolveStudentCandidatePolicy } from '../../packages/ai/src/hybrid/student';
import { buildCommonTeacherView } from '../review6_2/first-round-common-view';
import { freezeProjectRulesRequest } from '../../packages/web/server/llm-selection-wire.mjs';
import * as current from '../../packages/web/server/llm-project-rules-v543.mjs';
import * as historical from '../../packages/web/server/llm-project-rules-v541.mjs';
import { createDecisionBundle } from '../../packages/ai/src/hybrid/candidates';
import { PendingDecision } from '../../packages/ai/src/hybrid/decide';
import { freezeCopy } from '../../packages/ai/src/hybrid/protocol';
import { NeuralDecider } from '../../packages/ai/src/nn/neuralSeat';
import type { MLP } from '../../packages/ai/src/nn/mlp';
import { sampleVisibleWorld, toVisibleRoot } from '../review6/visible-world';
import { evaluateTeacherBranch } from '../review6/teacher-engine';

describe('5.4.3 rule and request identities', () => {
  it('browser, designer and teacher share corrected prose; historical prompt stays separate', () => {
    const text = describeRules(DEFAULT_RULES);
    expect(RULES_TEXT_VERSION).toBe('ohuo-engine-rules-v543-v1');
    expect(current.PROJECT_RULES_TEXT).toContain(text);
    expect(current.PROJECT_RULES_TEACHER_SYSTEM).toContain(text);
    expect(current.PROJECT_RULES_DESIGN_SYSTEM).toContain(text);
    expect(text).toContain('级牌按原始点数参加序列');
    expect(text).toContain('人机共用同一合法集合');
    expect(describeRules({ ...DEFAULT_RULES, levelMode: 'both', straightLen: 6 })).toContain('历史both模式');
    expect(describeRules({ ...DEFAULT_RULES, levelMode: 'high', straightLen: 6 })).toContain('straightLen=6');
    expect(historical.PROJECT_RULES_ID).toBe('ohuo-project-rules-v541-v1');
    expect(historical.PROJECT_RULES_TEXT).toContain('序列剔除当前有效级牌');
    expect(current.PROJECT_RULES_TEACHER_SYSTEM_SHA256).not.toBe(historical.PROJECT_RULES_TEACHER_SYSTEM_SHA256);
    for (const role of ['teacher', 'designer']) {
      const body = JSON.parse(current.serializeProjectRulesChat({ protocol: 'openai-chat-completions', requestedModel: 'offline-fixture', requestOptions: {} }, { role, modelPayloadBytes: '{"fixture":true}' }));
      expect(body.messages[0].content).toContain(text);
      expect(body.messages[1].content).toBe('{"fixture":true}');
    }
  });
  it('new wire accepts only the new prompt, never rebinds an old request/SHA', () => {
    // Reuse the existing bounded common-view construction, without a provider.
    const row = Array(423).fill(0); row[1]=2; row[108]=1; row[162]=1; row[165]=1;
    row[175]=2/41; row[176]=1/10; row[312]=3/12; row[320]=1; row[330]=1;
    for(let i=0;i<3;i++) row[177+3*i]=(i+1)/27;
    for(let i=0;i<9;i++) row[186+14*i+13]=1;
    row[395]=1;
    const view = buildCommonTeacherView([{ actionId: 'pass', input423: row, equivalenceKey: 'pass' }], { inputDim: 423, passEncoding: 'action64' });
    const request = { schema: current.PROJECT_RULES_TEACHER_WIRE_SCHEMA, promptId: current.PROJECT_RULES_TEACHER_PROMPT_ID,
      systemPromptSHA256: current.PROJECT_RULES_TEACHER_SYSTEM_SHA256, ruleOptions: current.PROJECT_RULE_OPTIONS,
      decisionId: 'v543-fixture', modelPayloadBytes: view.modelPayloadBytes, addressMap: view.addressMap };
    expect(freezeProjectRulesRequest(request)).toEqual(request);
    expect(() => freezeProjectRulesRequest({ ...request, schema: historical.PROJECT_RULES_TEACHER_WIRE_SCHEMA,
      promptId: historical.PROJECT_RULES_TEACHER_PROMPT_ID, systemPromptSHA256: historical.PROJECT_RULES_TEACHER_SYSTEM_SHA256 })).toThrow();
    expect(() => freezeProjectRulesRequest({ ...request, systemPromptSHA256: historical.PROJECT_RULES_TEACHER_SYSTEM_SHA256 })).toThrow();
  });
  it('new candidate identities are explicit and old frozen bundles/student releases cannot select the new engine', () => {
    expect(resolveCandidatePolicy().candidateSpec).toBe(CURRENT_CANDIDATE_SPEC);
    expect(resolveCandidatePolicy(FIRST_TARGET_CANDIDATE_POLICY)).toBe(FIRST_TARGET_CANDIDATE_POLICY);
    expect(() => candidatePolicyForBundle({ candidateSpec: 'ohuo-frozen-c8-expand4-v1' } as never)).toThrow(/historical/);
    expect(() => resolveCandidatePolicy({ candidateSpec: 'first-target-offer12-v1', enumSpec: { id: 'full-house-attachment-ranks-v1', enumerationMode: 'all_supported_attachment_ranks' } } as never)).toThrow(/historical/);
    expect(() => resolveStudentCandidatePolicy({ schema: 'ohuo-student-release-v1', candidateSpecRef: 'ohuo-frozen-c8-expand4-v1' })).toThrow(/historical/);
  });
  it('old visible roots are rejected even with a valid old hash or a prefrozen teacher sample', () => {
    const state = startGame(createMatch(DEFAULT_RULES, 17));
    const old = { ...toVisibleRoot(state, []), schemaVersion: 'r6-visible-root-v1' };
    const { observationSHA256: _oldHash, ...content } = old;
    old.observationSHA256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    expect(() => sampleVisibleWorld(old as never, 17, 1)).toThrow(/historical/);
    expect(() => evaluateTeacherBranch({ observedBefore: old } as never, {} as never, 'primary', { seed: 17 }, null, null, undefined, 'original', {
      profile: {} as never, seatFactory: () => { throw Error('must not create a driver'); },
      frozenSample: { state, seed: 17, observationSHA256: old.observationSHA256 } as never,
      executionBoundary: { mode: 'input-workload-only', resourcePolicyRef: 'fixture@sha256:'+'0'.repeat(64) },
    })).toThrow(/historical/);
  });
  it('local and unique PendingDecision paths reject old frozen C before apply or any request', async () => {
    const state = startGame(createMatch(DEFAULT_RULES, 17)), actor = state.turn;
    const scorer = { forward: (_x: Float32Array, n: number) => new Float32Array(n) } as MLP;
    const key = { controllerOrRunnerGeneration: 'v543', matchId: 'v543', gameNo: 1, moveNo: 0, actorSeat: actor, requestSeq: 0 };
    const bundle = createDecisionBundle({ state, actorSeat: actor, decisionId: 'v543', matchId: 'v543', key,
      history: { matchId: 'v543', gameNo: 1, throughMoveNo: 0, steps: [] }, decider: new NeuralDecider(actor, scorer, 0, () => 0) });
    let applied = 0, requested = 0;
    for (const unique of [false, true]) {
      const old = freezeCopy({ ...bundle, candidateSpec: 'ohuo-frozen-c8-expand4-v1', isUniqueLegalAction: unique });
      const decision = new PendingDecision({ bundle: old as never,
        owner: { state: () => state, isCurrent: () => true, apply: () => { applied++; } },
        ...(unique ? { request: async () => { requested++; throw Error('must not send'); } } : {}),
      });
      expect((await decision.start()).status).toBe('halted');
      expect(await decision.remoteSettled).toBeNull();
    }
    expect(applied).toBe(0); expect(requested).toBe(0); expect(state.moveNo).toBe(0);
  });
});
