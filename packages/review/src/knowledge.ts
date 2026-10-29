/** 掼蛋套路知识库：复盘标注关联的教学知识点 */
export interface KnowledgePoint {
  id: string;
  name: string;
  /** 一句话定义 */
  brief: string;
  /** 什么时候用 */
  when: string;
}

export const KNOWLEDGE: Record<string, KnowledgePoint> = {
  card_power: {
    id: 'card_power',
    name: '牌权意识',
    brief: '无人再压时，下一轮领出权按规则确定；行动者已经出完时还要核对接风规则。',
    when: '评估要不要用大牌压牌时，先想清楚：赢了这轮我能领出什么？',
  },
  yield_to_mate: {
    id: 'yield_to_mate',
    name: '牌权让渡',
    brief: '队友控权时，可以比较让牌和接管；需要结合余牌、后续出牌与团队名次目标。',
    when: '队友手牌不多时，先检查接管是否有具体收益；对手过牌不能证明他们压不动。',
  },
  minimal_beat: {
    id: 'minimal_beat',
    name: '最小压制',
    brief: '比较较小压制与较大出法时，同时核对余手用途、出完机会和团队目标；多出一张不必然浪费。',
    when: '有多种合法压制时，分别核对打后的手牌；单凭牌力大小不能判定哪种更好。',
  },
  bomb_timing: {
    id: 'bomb_timing',
    name: '炸弹时机',
    brief: '是否用炸弹需要比较牌权、余手与团队名次收益，不能只按固定场景决定。',
    when: '对手接近出完或牌权可能影响团队名次时，可比较炸与不炸；具体收益仍需证据。',
  },
  no_break_bomb: {
    id: 'no_break_bomb',
    name: '炸弹资源',
    brief: '部分消耗炸弹会改变后续资源；整组用于更大组合与拆出一部分应分别核对。',
    when: '比较具体余手用途和收尾机会，不能把所有资源消耗都判为浪费。',
  },
  wild_value: {
    id: 'wild_value',
    name: '配牌价值',
    brief: '红心级牌可以按规则代入多种组合；实际可代入的牌型和点数需由引擎核验。',
    when: '比较现在使用与保留后的具体用途；保留配牌并不自动代表更好。',
  },
  endgame_lock: {
    id: 'endgame_lock',
    name: '终局封锁',
    brief: '对手接近出完时，要比较不同领出牌型对其接牌机会和我方后续行动的影响。',
    when: '公开余牌数不能确定对手具体牌张；没有相应证据时不宣称已经封死出口。',
  },
  hand_plan: {
    id: 'hand_plan',
    name: '手数规划',
    brief: '参考拆牌可以帮助比较余手，但它是上界或启发式估计，不是团队最优证明。',
    when: '比较计划时同时考虑取得牌权的机会，并在公开局面变化后重新核对。',
  },
  feed_mate: {
    id: 'feed_mate',
    name: '送牌接力',
    brief: '队友接近出完时，可以比较让牌、接管或改变领出牌型；接力是否成立需要合法信息支持。',
    when: '先核对公开余牌和已知贡还牌，不把事后看到的队友手牌当作事前知识。',
  },
  double_up_awareness: {
    id: 'double_up_awareness',
    name: '团队名次',
    brief: '比较动作时应考虑双方整体名次与比赛目标，不能只看自己是否先出完。',
    when: '队友已出完或公开局势改变时，重新比较自身出完与阻止对手的收益。',
  },
  keep_big_for_opp: {
    id: 'keep_big_for_opp',
    name: '大牌留给对手',
    brief: '大牌可能用于阻止对手、取得牌权或收尾；单张大王和级牌并非所有牌型下的绝对牌权。',
    when: '想用大王压牌时先看：这轮是对手在冲，还是队友在走？',
  },
  straight_shape: {
    id: 'straight_shape',
    name: '顺子结构',
    brief: '顺子长度、序列点数、级牌处理、万能牌代入、同花顺和三连对均按当前规则上下文核验。',
    when: '参考结构不等于可直接出牌，仍需核对具体牌张、声明和当前待压目标。',
  },
};

export function knowledgeOf(ids: string[]): KnowledgePoint[] {
  return ids.map((id) => KNOWLEDGE[id]).filter(Boolean);
}
