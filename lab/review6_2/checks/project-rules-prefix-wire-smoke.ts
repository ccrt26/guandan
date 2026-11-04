/** One request-construction fixture only. No fetch/SSE, model, match or learner.
 * Pending V execution; this is not a designed-source reachability certificate. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildCommonTeacherView} from '../first-round-common-view';
import {COMMON_VIEW_WIRE_SCHEMA,COMMON_VIEW_SYSTEM_PROMPT_SHA256,COMMON_VIEW_RESPONSE_CONTRACT,freezeCommonViewRequest,freezeProjectRulesRequest,parseCommonViewSelection,parseProjectRulesSelection} from '../../../packages/web/server/llm-selection-wire.mjs';
import {PROJECT_RULE_OPTIONS,PROJECT_RULES_TEXT,PROJECT_RULES_TEACHER_WIRE_SCHEMA,PROJECT_RULES_TEACHER_PROMPT_ID,PROJECT_RULES_TEACHER_SYSTEM_SHA256,PROJECT_RULES_TEACHER_SYSTEM,PROJECT_RULES_DESIGN_SYSTEM,serializeProjectRulesChat} from '../../../packages/web/server/llm-project-rules-v541.mjs';

const pass=Array(423).fill(0);pass[1]=2;pass[108]=1;pass[162]=1;pass[165]=1;pass[175]=2/41;pass[176]=1/10;pass[312]=3/12;pass[320]=1;pass[330]=1;
for(let i=0;i<3;i++)pass[177+3*i]=(i+1)/27;
for(let i=0;i<9;i++)pass[186+14*i+13]=1;
pass[395]=1;const play=pass.slice();play[395]=0;play[332]=1;play[385]=1;play[396]=3/41;play[397]=1/10;
const projected=buildCommonTeacherView([{actionId:'a-pass',input423:pass,equivalenceKey:'pass'},{actionId:'a-play',input423:play,equivalenceKey:'single-S3'}],{inputDim:423,passEncoding:'action64'});
const old={schema:COMMON_VIEW_WIRE_SCHEMA,decisionId:'fixture-one',modelPayloadBytes:projected.modelPayloadBytes,addressMap:projected.addressMap};
assert.deepEqual(freezeCommonViewRequest(old),old);
assert.equal(createHash('sha256').update(COMMON_VIEW_RESPONSE_CONTRACT).digest('hex'),COMMON_VIEW_SYSTEM_PROMPT_SHA256);
assert.equal(COMMON_VIEW_SYSTEM_PROMPT_SHA256,'dfe4025f08ce991a6b100f93f53ff7e7415c5d2087ba2e1573d119616b2f8469'); // actual immutable r2 baseline
const request={...old,schema:PROJECT_RULES_TEACHER_WIRE_SCHEMA,promptId:PROJECT_RULES_TEACHER_PROMPT_ID,systemPromptSHA256:PROJECT_RULES_TEACHER_SYSTEM_SHA256,ruleOptions:PROJECT_RULE_OPTIONS};
assert.deepEqual(freezeProjectRulesRequest(request),request);
// Synthetic option values only: assert exact preservation, not production tuning.
const profile={protocol:'openai-chat-completions',requestedModel:'fixture-model',requestOptions:{max_tokens:8192,temperature:0.2,thinking:{type:'enabled'}}};
const body=JSON.parse(serializeProjectRulesChat(profile,{role:'teacher',modelPayloadBytes:projected.modelPayloadBytes}));
assert.deepEqual(body,{...profile.requestOptions,model:profile.requestedModel,stream:true,messages:[{role:'system',content:PROJECT_RULES_TEACHER_SYSTEM},{role:'user',content:projected.modelPayloadBytes}]});
assert.equal(createHash('sha256').update(body.messages[0].content).digest('hex'),PROJECT_RULES_TEACHER_SYSTEM_SHA256);
assert(body.messages[0].content.startsWith(PROJECT_RULES_TEXT));
assert(PROJECT_RULES_TEXT.includes('头游搭档为二游、三游、末游时分别升3、2、1级'));
assert.equal(body.messages[1].content,old.modelPayloadBytes); // exactly the old 423 projection
const designer=JSON.parse(serializeProjectRulesChat(profile,{role:'designer',modelPayloadBytes:'{"schema":"fixture-design-contract"}'}));
assert.deepEqual(designer.messages,[{role:'system',content:PROJECT_RULES_DESIGN_SYSTEM},{role:'user',content:'{"schema":"fixture-design-contract"}'}]);
assert(PROJECT_RULES_DESIGN_SYSTEM.startsWith(PROJECT_RULES_TEXT));
assert.throws(()=>freezeProjectRulesRequest({...request,systemPromptSHA256:'0'.repeat(64)}));
assert.throws(()=>freezeProjectRulesRequest({...request,ruleOptions:{...PROJECT_RULE_OPTIONS,levelMode:'high'}}));
assert.throws(()=>freezeProjectRulesRequest({...request,modelPayloadBytes:JSON.stringify({...projected.modelPayload,history:[]})}));
const choice={kind:'choose',decisionId:'common-view-project-rules-v1',actionId:projected.addressMap[0].address,note:'x'.repeat(241)};
assert.equal(parseProjectRulesSelection(JSON.stringify(choice),request).actionId,projected.addressMap[0].actionId);
assert.throws(()=>parseProjectRulesSelection(JSON.stringify({...choice,actionId:'not-offered'}),request));
assert.throws(()=>parseProjectRulesSelection(JSON.stringify({...choice,note:''}),request));
assert.throws(()=>parseCommonViewSelection(JSON.stringify({...choice,decisionId:'common-view-r2'}),old));
process.stdout.write('PASS project-rules prefix: one synthetic construction, no upstream/model/research execution\n');
