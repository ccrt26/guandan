/** Frozen prose for this engine revision, not generic/official-rule folklore.
 * Values come from all eight RuleOptions; dynamic levels remain in Observation.
 * Source: combo.ts classify/powerClass/beats, rank.ts, game.ts tribute/apply/settle.
 * Changing those semantics requires reviewing/bumping this text contract. */
export const RULES_TEXT_VERSION = 'ohuo-engine-rules-v543-v1';
export function describeRules(r) {
  const level = { stage: '全场级牌为台上一方本副级数', both: '历史both模式：双方级数均为级牌', high: '历史high模式：双方较高级数为级牌' }[r.levelMode];
  const passA = { head: '拿头游', head3: '头游且同伴不是末游', double: '双上游' }[r.passA];
  return [
    `规则合同 ${RULES_TEXT_VERSION}。两副牌108张，每席初始27张；0/2一队、1/3一队，按席号循环行动并跳过已出完者。`,
    `级牌模式levelMode=${r.levelMode}：${level}。当前生效级牌以effectiveLevelRanks数组为准，不沿用上一副。普通点数2<3<…<K<A，级牌高于普通A、小王高于级牌、大王最高；多级牌按其rank大小比较。`,
    `合法牌型：单张single；同点对子pair（含两小王或两大王）；非王同点三张trio；三带二trio_pair（非王三张加另一点数非王对子）；顺子straight（straightLen=${r.straightLen}张连续单牌）；连对pair_seq（pairSeqMin=${r.pairSeqMin},pairSeqMax=${r.pairSeqMax}组连续对子）；钢板trio_seq（trioSeqMin=${r.trioSeqMin},trioSeqMax=${r.trioSeqMax}组连续三张，钢板不带对子）；同点非王炸弹bomb（4—8张，万能补足也不超过8）；同花顺flush（flushLen=${r.flushLen}张同花连续单牌）；天王炸joker_bomb（两小王加两大王）。王只用于单张、同种王对或天王炸。`,
    '顺子、同花顺、三连对、二连三中，级牌按原始点数参加序列，2也参与；红心级牌可自然使用或按现有万能规则替代非王牌点。A（包括级A）可处于最低位置1或最高位置14，不绕圈；序列按最大自然位置比较（A2345的keyRank=5，10JQKA=14），不使用普通单张的级牌加权。本版本B枚举只在straightLen=5时提案顺子；严格分类按实际straightLen检查。',
    '比较优先级：天王炸 > 6—8张炸弹 > 同花顺 > 5张炸弹 > 4张炸弹 > 普通牌型。6—8张炸弹先比张数再比keyRank；同档4/5张炸弹及同花顺比keyRank；普通牌型须kind、size、length都相同且keyRank严格更大，三带二比较主体而非所带对子。天王炸不能被另一手压过；等值不能压，花色不是普通牌力高低。',
    '万能牌是红心有效级牌，可在组合中补非王点数（同花顺还须声明目标花色），也可按级牌自然身份使用；万能牌不能代王。单张万能牌按当前有效级牌的最大rank计牌力。选择必须保留候选的实际花色/点数资源与必要声明：kind、mainRank/keyRank、length、size、pairRanks、万能代入rank，以及同花顺suit/代入花色。自然点数自代入与非同花顺代入花色只是注记，不凭牌型或弱键替换另一组资源。',
    '领出目标为空时必须出牌；跟牌可过牌，即使能压也可过，过牌不证明没有能压牌。有人压牌则重新累计pass；其余在场者全过后重开一轮。最后出牌者未出完由其领出；最后出牌者已出完则由其未出完的搭档领出，搭档也出完才由顺序下一位未出完者领出。',
    '首副无贡还。后续应贡者为上副末游；若三游与末游同队则两人都贡。应贡者合计有两大王则抗贡、上副头游先出；否则各贡牌力最大的非万能牌。单贡末游→头游，末游先出。双贡较大贡牌→头游、较小→二游，贡较大者先出；同牌力时按本引擎实际分支，末游贡给头游并由末游先出，三游贡给二游。',
    '收贡者各还一张给对应贡者。人机共用同一合法集合：有原始点数2—10的非万能牌时只能选该集合（非红心低点级牌不排除）；无此类牌时只能选按本引擎既有牌力序最小的非万能牌，同点最小实体均可。自动还贡在合法集合内按既有牌力及手牌顺序取最小。进还贡完成后才能正常出牌；公开转移只形成牌面数量下界，打出同牌面任一副本都扣减下界，不追踪隐含物理副本归属。',
    `第三名出完时结算本副，剩下一人为末游；头游所在队获胜。头游搭档为二/三/末游时分别升3/2/1级，最多到A，另一队级数不变。只有获胜队本副开始已在A且满足passA=${r.passA}（${passA}）才过A并结束整场；已在A但未满足者继续打A。下一副台上方为上副头游所在队。`,
    '信息边界：只用己牌与完整因果公开前缀；未见牌不按席断言，不接收其他席私牌、RNG或未来结果。仅选择本decision已展示actionId；一次扩展只能增加原池选项。候选是本地有限提案，不宣称覆盖全部数学合法动作；裁判始终是本地冻结引擎。',
  ].join('\n');
}

