import { expect, it } from 'vitest';
import { createProfileSelector } from '../server/llm-select.mjs';
import { COMMON_VIEW_RESPONSE_CONTRACT, COMMON_VIEW_WIRE_SCHEMA } from '../server/llm-selection-wire.mjs';
import { PROJECT_RULE_OPTIONS, PROJECT_RULES_TEACHER_PROMPT_ID, PROJECT_RULES_TEACHER_SYSTEM, PROJECT_RULES_TEACHER_SYSTEM_SHA256, PROJECT_RULES_TEACHER_WIRE_SCHEMA } from '../server/llm-project-rules-v541.mjs';
import { buildCommonTeacherView } from '../../../lab/review6_2/first-round-common-view';

const reference = { profileId: 'synthetic', revision: 1, snapshotHash: 'a'.repeat(64) };
const rulesText = 'SYNTHETIC COMPLETE RULES\nRules apply independently to every request.';
function ordinary(expansionCount = 0) {
  return {
    observation: { schema: 'ohuo-public-observation-v1', decisionId: 'synthetic-decision', matchId: 'synthetic-match', actorSeat: 0, partnerSeat: 2, phase: 'play',
      ruleOptions: { levelMode: 'stage', passA: 'head', pairSeqMin: 3, pairSeqMax: 3, trioSeqMin: 2, trioSeqMax: 2, flushLen: 5, straightLen: 5 },
      rulesText, levelsBefore: [2, 2], stageTeam: 0, effectiveLevelRanks: [2], gameNo: 1, moveNo: 0, previousGameResult: null, ownHand: [],
      seats: [0, 1, 2, 3].map(seat => ({ seat, remaining: 27, finishOrder: null })), target: null, leader: 0, lastPlayer: -1, passCount: 0,
      currentTrick: [], publicPrefix: [], tribute: null, knownOtherHands: [], playedCards: [], unseenPool: [], informationBoundary: 'own-hand-and-public-prefix; pass-does-not-prove-inability' },
    candidateSpec: 'ohuo-frozen-c8-expand4-v1', expansionCount,
    candidates: Array.from({ length: expansionCount ? 12 : 8 }, (_, i) => ({ actionId: `action-${i}`, action: null, remainingHand: [] })),
    expandableGroups: expansionCount ? [] : [{ groupId: 'group-4', kind: 'single', size: 1, wildConsumption: 0, remainingCount: 4 }],
  };
}
function sse(protocol: string, value: unknown) {
  const content = JSON.stringify(value);
  const events = protocol === 'openai-chat-completions'
    ? [{ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }, '[DONE]']
    : [{ type: 'message_start', message: { content: [], model: 'synthetic' } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: content } },
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
  return new Response(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function fixture(protocol: string, replies: unknown[]) {
  const calls: any[] = [];
  const profile = { ...reference, nickname: 'synthetic', credentialRevision: 1, secret: 'SYNTHETIC_ONLY', protocol, baseUrl: 'https://synthetic.invalid/v1', requestedModel: 'synthetic', requestOptions: { max_tokens: 100, temperature: 0.2 }, supportedReasoningOptions: {} };
  const selector = createProfileSelector({ store: { resolve: () => profile }, reference, fetchImpl: async (url: string, init: any) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) });
    return sse(protocol, replies.shift());
  } });
  return { selector, calls };
}
const signal = () => new AbortController().signal;

for (const protocol of ['openai-chat-completions', 'anthropic-messages']) {
  it(`${protocol}: ordinary expand then choose sends complete rules once per request without changing the input`, async () => {
    const first = ordinary(), expanded = ordinary(1), before = JSON.stringify([first, expanded]);
    const expand = { kind: 'expand', decisionId: 'synthetic-decision', groupId: 'group-4' };
    const choose = { kind: 'choose', decisionId: 'synthetic-decision', actionId: 'action-11' };
    const { selector, calls } = fixture(protocol, [expand, choose]);
    expect(await selector.request(first, signal())).toMatchObject({ status: 'response', response: expand });
    expect(await selector.request(expanded, signal())).toMatchObject({ status: 'response', response: choose });
    expect(calls).toHaveLength(2);
    for (const [i, input] of [first, expanded].entries()) {
      const call = calls[i], body = call.body;
      const system = protocol === 'openai-chat-completions' ? body.messages[0].content : body.system;
      const dynamic = body.messages.at(-1).content;
      expect(system.startsWith(`${rulesText}\n\n`)).toBe(true);
      expect(system.split(rulesText)).toHaveLength(2);
      expect(system).toContain('ohuo-choose-expand-v1');
      expect(dynamic).not.toContain(rulesText);
      expect(JSON.parse(dynamic)).toEqual({ ...input, observation: { ...input.observation, rulesText: undefined } });
      expect(Object.hasOwn(JSON.parse(dynamic).observation, 'rulesText')).toBe(false);
      expect(body).toMatchObject({ model: 'synthetic', stream: true, max_tokens: 100, temperature: 0.2 });
      expect(call.url).toBe(`https://synthetic.invalid/v1/${protocol === 'openai-chat-completions' ? 'chat/completions' : 'messages'}`);
      expect(call).toMatchObject({ method: 'POST', redirect: 'error', headers: protocol === 'openai-chat-completions' ? { authorization: 'Bearer SYNTHETIC_ONLY' } : { 'x-api-key': 'SYNTHETIC_ONLY', 'anthropic-version': '2023-06-01' } });
    }
    expect(JSON.stringify([first, expanded])).toBe(before);
  });

  it(`${protocol}: ordinary projection retains strict input and response identities`, async () => {
    const choose = { kind: 'choose', decisionId: 'synthetic-decision', actionId: 'action-0' };
    const { selector, calls } = fixture(protocol, [{ ...choose, extra: true }, { ...choose, decisionId: 'other' }, { ...choose, actionId: 'not-offered' }]);
    const invalid = ordinary(); Object.assign(invalid.observation, { hiddenState: [] });
    expect(await selector.request(invalid, signal())).toMatchObject({ status: 'remote_failure', reason: 'invalid_request' });
    expect(calls).toHaveLength(0);
    for (const reason of ['invalid_response_shape', 'decision_id_mismatch', 'action_id_not_offered']) {
      expect(await selector.request(ordinary(), signal())).toMatchObject({ status: 'remote_failure', reason });
    }
    expect(calls).toHaveLength(3);
  });

  it(`${protocol}: common-view and project-rules keep complete model body bytes and address mapping`, async () => {
    const row = Array(423).fill(0); row[395] = 1;
    const common = buildCommonTeacherView([{ actionId: 'local-action', input423: row }], { inputDim: 423, passEncoding: 'action64' });
    for (const project of [false, true]) {
      const input = { schema: COMMON_VIEW_WIRE_SCHEMA, decisionId: 'local-id', modelPayloadBytes: common.modelPayloadBytes, addressMap: common.addressMap,
        ...(project ? { schema: PROJECT_RULES_TEACHER_WIRE_SCHEMA, promptId: PROJECT_RULES_TEACHER_PROMPT_ID, systemPromptSHA256: PROJECT_RULES_TEACHER_SYSTEM_SHA256, ruleOptions: PROJECT_RULE_OPTIONS } : {}) };
      const before = JSON.stringify(input), { selector, calls } = fixture(protocol, [{ kind: 'choose', decisionId: project ? 'common-view-project-rules-v1' : 'common-view-r2', actionId: 'c0', note: 'synthetic' }]);
      expect(await selector.request(input, signal())).toMatchObject({ status: 'response', response: { decisionId: 'local-id', actionId: 'local-action' } });
      const system = project ? PROJECT_RULES_TEACHER_SYSTEM : COMMON_VIEW_RESPONSE_CONTRACT;
      expect(JSON.stringify(calls[0].body)).toBe(JSON.stringify({ max_tokens: 100, temperature: 0.2, model: 'synthetic', stream: true,
        ...(protocol === 'openai-chat-completions' ? { messages: [{ role: 'system', content: system }, { role: 'user', content: common.modelPayloadBytes }] } : { system, messages: [{ role: 'user', content: common.modelPayloadBytes }] }) }));
      expect(JSON.stringify(input)).toBe(before);
    }
  });
}
