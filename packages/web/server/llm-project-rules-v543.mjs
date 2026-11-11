/** New 5.4.3 rule/prompt identity. Browser observation, designer and teacher
 * share describeRules. The v541 module and every old request remain immutable;
 * an old prompt cannot be resumed by substituting these new bytes. */
import {createHash} from 'node:crypto';
import {describeRules} from '../../engine/src/rules-text.mjs';

export const PROJECT_RULE_OPTIONS = Object.freeze({levelMode:'stage',passA:'head3',pairSeqMin:3,pairSeqMax:3,trioSeqMin:2,trioSeqMax:2,flushLen:5,straightLen:5});
export const PROJECT_RULES_ID = 'ohuo-project-rules-v543-v1';
export const PROJECT_RULES_TEXT = [
 '项目规则合同 '+PROJECT_RULES_ID+'。',
 describeRules(PROJECT_RULE_OPTIONS),
 '团队目标是赢得本副并推进整场过A；须按可见局面权衡领出、跟牌、PASS及合法接管，不预设PASS或接管总是正确。',
 '本合同固定stage/head3；历史both/high不适用。构题与教师共用此规则正文；题面缺失的公开转移归属保持未知。'
].join('\n');

export const PROJECT_RULES_TEACHER_WIRE_SCHEMA = 'ohuo-common-view-project-rules-request-v543-v1';
export const PROJECT_RULES_TEACHER_PROMPT_SCHEMA = 'ohuo-common-view-project-rules-prompt-v543-v1';
export const PROJECT_RULES_TEACHER_PROMPT_ID = 'ohuo-common-view-project-rules-teacher-v543-v1';
export const PROJECT_RULES_TEACHER_RESPONSE_ID = 'common-view-project-rules-v543-v1';
export const PROJECT_RULES_TEACHER_SYSTEM = [PROJECT_RULES_TEXT,
 '教师信息边界：仅根据当前共同423视图及给定候选地址。423是每候选特征维数，不是候选数量。本人手牌、公开状态和事件只限该编码实际表达的信息；不提供其他席私牌、完整底牌、构题意图、之前题目或答案、模拟收益、S0分、额外历史或RNG。unplayedOutsideOwnHand是己牌之外未公开总量，不含归属；recentMoves仅为每个相对其他席最近三次动作；publicHighCardMemory仅为编码已有公开累计，LEVEL_OTHER不补全贡还归属。缺失历史保持未知，当前领先不等于本墩已赢。候选是冻结有限C，不宣称全部合法动作；禁止扩展或自造动作。',
 '仅返回一个JSON对象：{"kind":"choose","decisionId":"common-view-project-rules-v543-v1","actionId":"c0","note":"一句与本题可见事实相符的必要理由"}。actionId必须是本题候选地址。理由只保留支持所选动作的一句必要说明，不输出长推演、markdown或额外字段。'
].join('\n\n');
export const PROJECT_RULES_TEACHER_SYSTEM_SHA256 = createHash('sha256').update(PROJECT_RULES_TEACHER_SYSTEM,'utf8').digest('hex');

export const PROJECT_RULES_DESIGN_PROMPT_ID = 'ohuo-designed-synthetic-project-rules-v543-v1';
export const PROJECT_RULES_DESIGN_SYSTEM = [PROJECT_RULES_TEXT,
 '构题角色：只按本次具名设计契约提出designed-synthetic题目。提交贡还前完整108张实体底牌（四席各27张且实体不重复）、可验证起点、顺序合法前缀及目标决策位置，供原引擎核验；不能提交不可还原的孤立余牌，也不能声称天然seed采样或已完成比赛。设计家族和衍生题不得跨split。题面、共同423、C和候选地址由本地原路径产生，不由构题者填写或伪造。构题底牌和意图仅属构造资产，不传入独立教师请求；不要附教师答案、收益或S0分。按本次具名设计契约返回结构化候选，无长推演。'
].join('\n\n');
export const PROJECT_RULES_DESIGN_SYSTEM_SHA256 = createHash('sha256').update(PROJECT_RULES_DESIGN_SYSTEM,'utf8').digest('hex');

export function assertProjectRuleOptions(value) {
 const keys=Object.keys(PROJECT_RULE_OPTIONS);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)||value[k]!==PROJECT_RULE_OPTIONS[k]))throw Error('project_rules_options_mismatch');
}
export function validateProjectRulesPrompt(value) {
 const keys=['schema','promptId','wireSchema','viewSchema','systemPromptSHA256','ruleOptions'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||value.schema!==PROJECT_RULES_TEACHER_PROMPT_SCHEMA||value.promptId!==PROJECT_RULES_TEACHER_PROMPT_ID||value.wireSchema!==PROJECT_RULES_TEACHER_WIRE_SCHEMA||value.viewSchema!=='first-round-common-view-r2'||value.systemPromptSHA256!==PROJECT_RULES_TEACHER_SYSTEM_SHA256)throw Error('project_rules_prompt_identity');
 assertProjectRuleOptions(value.ruleOptions);return value;
}
export function assertProjectRulesTerminal(terminal,prompt,promptRef) {
 validateProjectRulesPrompt(prompt);
 if(terminal?.schema!=='ohuo-common-view-terminal-r2'||terminal.requestSchema!==PROJECT_RULES_TEACHER_WIRE_SCHEMA||terminal.promptId!==prompt.promptId||terminal.actualPromptRef!==promptRef||terminal.systemPromptSHA256!==PROJECT_RULES_TEACHER_SYSTEM_SHA256)throw Error('project_rules_terminal_identity');
}
/** Same serialization for both independent roles; never includes previous turns.
 * The candidate teacher transport uses this; the designed-source producer is a
 * separately reviewed successor and must use role=designer, not teacher output. */
export function serializeProjectRulesChat(profile,{role,modelPayloadBytes}) {
 if(!['teacher','designer'].includes(role)||typeof modelPayloadBytes!=='string'||!modelPayloadBytes.trim()||!['openai-chat-completions','anthropic-messages'].includes(profile?.protocol))throw Error('project_rules_serialization_input');
 const system=role==='teacher'?PROJECT_RULES_TEACHER_SYSTEM:PROJECT_RULES_DESIGN_SYSTEM;
 const common={...profile.requestOptions,model:profile.requestedModel,stream:true};
 return JSON.stringify(profile.protocol==='openai-chat-completions'?{...common,messages:[{role:'system',content:system},{role:'user',content:modelPayloadBytes}]}:{...common,system,messages:[{role:'user',content:modelPayloadBytes}]});
}
