/** Candidate v5.4.1 prefix. Pure constants/serialization: no store, model or I/O.
 * Rule facts reuse observation.describeRules and the current engine branches.
 * This explicitly supports the fixed stage/head3 project rules only; legacy
 * describeRules, r2 prompt bytes and historical RuleOptions remain unchanged. */
import {createHash} from 'node:crypto';

export const PROJECT_RULE_OPTIONS = Object.freeze({levelMode:'stage',passA:'head3',pairSeqMin:3,pairSeqMax:3,trioSeqMin:2,trioSeqMax:2,flushLen:5,straightLen:5});
export const PROJECT_RULES_ID = 'ohuo-project-rules-v541-v1';
export const PROJECT_RULES_TEXT = [
 '项目规则合同 '+PROJECT_RULES_ID+'。两副牌108张，每席初始27张；0/2同队、1/3同队，对家为搭档。按席号循环行动并跳过已出完者。双方从2起，最高A级。',
 '团队目标：争取己方团队赢得本副并推进整场过A获胜；不能把个人先出完、当前压住搭档或一时牌权当成团队胜利。须依可见局面权衡领出、跟牌、PASS及合法接管，不预设PASS或接管总是正确。',
 '本合同固定levelMode=stage：本副全场有效级牌为台上一方所打级数，台上方为上副头游所在队；首副双方打2。教学视图levels.effectiveRank给出本副有效级牌，不沿用上一副。普通点数2<3<…<K<A，级牌高于普通A，小王高于级牌，大王最高。历史both/high分支不适用于本合同。',
 '合法牌型：单张single；同点对子pair（含两小王或两大王）；非王同点三张trio；三带二trio_pair（非王三张加另一点数非王对子）；顺子straight（固定5张）；三连对pair_seq（固定3组对子，共6张）；钢板trio_seq（固定2组连续三张，共6张，不带对子）；非王同点炸弹bomb（4至8张，万能补足也不超过8）；同花顺flush（固定5张同花连续单牌）；天王炸joker_bomb（两小王加两大王）。王只用于单张、同种王对或天王炸。',
 '序列剔除当前有效级牌的位置，不能靠万能牌补入被剔除的位置；2若不是级牌可以参与。A可作最低位置1或最高位置14，不绕圈；序列按最大位置比较，例如可用时A2345为5，10JQKA为14。',
 '比较优先级：天王炸 > 6至8张炸弹 > 同花顺 > 5张炸弹 > 4张炸弹 > 普通牌型。6至8张炸弹先比张数再比keyRank；同档4/5张炸弹及同花顺比keyRank。普通牌型须kind、size、length相同且keyRank严格更大；三带二只比较三张主体，不比较带对。等值不能压，普通花色不分高低，天王炸不能再被压。',
 '红心有效级牌是万能牌，可在组合中补非王点数，同花顺须有目标花色声明；也可按级牌自然身份使用，不能代王。万能牌单张按本副级牌牌力。候选地址绑定原物理资源和必要声明，不能凭牌型、牌面或相同分数擅换另一动作；教学视图没有表达的声明细节由本地严格合法性及表示等价校验处理，教师不能补造。',
 '领出时目标为空，必须出牌；跟牌时即使能压也可以PASS，PASS不证明不能压。有人压牌后重新累计pass；其余在场者全过后重开一轮。最后出牌者尚有牌则由其领出；其已出完而搭档未出完则搭档接风；搭档也出完时由顺序下一位未出完者领出。',
 '首副无贡还。后续应贡者为上副末游；三游与末游同队时两人都贡。仅应贡者合计持有两大王才抗贡，抗贡时上副头游先出。否则各贡牌力最大的非万能牌。单贡末游给头游并由末游先出。双贡较大贡牌给头游、较小给二游，贡较大者先出；同牌力按当前引擎实际分支：末游给头游并先出，三游给二游。',
 '收贡者各还一张给对应贡者。手动还贡仅允许点数2至10的非万能牌；本地自动还贡优先选这些牌中牌力最小者，若没有则按既有自动策略回退为最小非万能牌。贡还完成后才能出牌。贡还规则不表示本教学题面已提供完整转移归属；缺失归属保持未知。',
 '第三人出完即结算本副，余下一人为末游；头游所在队获胜。头游搭档为二游、三游、末游时分别升3、2、1级，最多升至A，另一队级数不变。固定passA=head3：获胜队本副开始已在A，且头游搭档不是末游，才过A并赢得整场；已在A但未满足者继续打A。刚升级到A不等于已过A。',
 '当前实现与旧注释存在冲突时使用此冻结项目规则和本地严格引擎；依赖冲突的题单独诊断，不据常见玩法补规则，也不把局部冲突扩大为所有题不可用。'
].join('\n');

export const PROJECT_RULES_TEACHER_WIRE_SCHEMA = 'ohuo-common-view-project-rules-request-v1';
export const PROJECT_RULES_TEACHER_PROMPT_SCHEMA = 'ohuo-common-view-project-rules-prompt-v1';
export const PROJECT_RULES_TEACHER_PROMPT_ID = 'ohuo-common-view-project-rules-teacher-v1';
export const PROJECT_RULES_TEACHER_RESPONSE_ID = 'common-view-project-rules-v1';
export const PROJECT_RULES_TEACHER_SYSTEM = [PROJECT_RULES_TEXT,
 '教师信息边界：仅根据当前共同423视图及给定候选地址。423是每候选特征维数，不是候选数量。本人手牌、公开状态和事件只限该编码实际表达的信息；不提供其他席私牌、完整底牌、构题意图、之前题目或答案、模拟收益、S0分、额外历史或RNG。unplayedOutsideOwnHand是己牌之外未公开总量，不含归属；recentMoves仅为每个相对其他席最近三次动作；publicHighCardMemory仅为编码已有公开累计，LEVEL_OTHER不补全贡还归属。缺失历史保持未知，当前领先不等于本墩已赢。候选是冻结有限C，不宣称全部合法动作；禁止扩展或自造动作。',
 '仅返回一个JSON对象：{"kind":"choose","decisionId":"common-view-project-rules-v1","actionId":"c0","note":"一句与本题可见事实相符的必要理由"}。actionId必须是本题候选地址。理由只保留支持所选动作的一句必要说明，不输出长推演、markdown或额外字段。'
].join('\n\n');
export const PROJECT_RULES_TEACHER_SYSTEM_SHA256 = createHash('sha256').update(PROJECT_RULES_TEACHER_SYSTEM,'utf8').digest('hex');

export const PROJECT_RULES_DESIGN_PROMPT_ID = 'ohuo-designed-synthetic-project-rules-v1';
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
