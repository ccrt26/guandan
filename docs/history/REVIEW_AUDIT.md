# 复盘链路自审报告（REVIEW-AUDIT-1.0，2026-10-27）

**背景**：用户结论——AI 复盘的问题不是某一处，而是"觉得都是问题"。本文档做两件事：①把复盘从游戏记录到最终报告的**全部逻辑逐层写清**（供 ChatGPT 诊断时无需读代码也能定位）；②**自审挖出的问题全量列出**（29 项，分 A/B/C 三级，每项含证据位置与状态）。已知两起事故（10-25 编 4A、10-26 第 25 手自相矛盾）的细节在 REVIEW2_BRIEFING.md §2.3，本文不重复展开，只纳入其根因条目。

当前代码健康度：测试 133/133 通过、typecheck 0 错——**以下问题全部存在于"测试绿"的现网代码里**（测试没有覆盖这些语义正确性）。

---

## 第一部分：复盘完整逻辑（逐层）

### L1 记录层（packages/engine/src/record.ts + web/game/controller.ts）

对局进行时，Recorder 逐手写 `MoveRecord`：moveNo、player、pass、cards（**物理牌张**，含花色点数与全局唯一 id）、comboKind/mainRank（出牌时的牌型解释）、handsAfter（出牌后四家手牌数）、toBeatKind/toBeatRank。整局合成 `GameRecord`：ruleOpts（含 levelMode）、levelsBefore、stageTeam（stage 口径的台上方）、leader、humanSeat、difficulties、**initialHands（四家初始 27 张全牌面）**、moves、result。存 localStorage（gd_record_*），另存 aiPolicies（每座位实际策略，含神经回退标记）。

关键点：记录里**存的是物理牌张 + 出牌时的牌型声明**，万能牌代入信息（wildAs：哪张♥级牌当了什么）**没有单独存储**，只能靠回放时重新判型。

### L2 校验与规范化层（review/replay.ts validateRecord/normalizeRecord）

进复盘先跑 108 张完整性铁律（checkRecordIntegrity）：①初始 108 张且张张合法；②每手牌的 id 属于同一玩家当时手牌；③按"初始手牌−已出 id"重建的手牌数与 handsAfter 逐手一致；schemaVersion≥2 还查 player 字段与归属一致。坏记录直接拒（复盘选择页置灰并显示原因）。normalizeRecord 用牌张归属修正旧记录 player 字段错位。

### L3 回放层（review/replay.ts）

`buildInitialState` 从记录重建任意时刻完整局面（含四家手牌）：createMatch(record.ruleOpts) + levelsBefore + **stageTeam（stage 口径下决定谁是级牌：ranks={台上方的级数}，makeLevelCtx）**。回放采用"牌张归属驱动"：出牌人 = 牌张 id 属于谁；旧版轮次差异（压不过却出牌）强制开新轮；旧牌型信任记录的 comboKind 兜底。`replay()` 生成器逐步产出 {move, state(出手前局面), combo(重判型), events}；`stateBefore(n)`/`memoryBefore(n)` 重建第 n 手前局面与公开信息记牌器（PlayMemory：各家已出/已过的公开历史）。

### L4 裁判层——一阶打分（review/analyzer.ts analyzeGame）

对人类玩家的每一手：
1. 用出手前局面跑 `legalCombos`（合法候选枚举）+ `scoreCandidates`（启发式打分，packages/ai/src/heuristic.ts）打分。分析口径 ANALYSIS_CAPS = { memory:true, inference:false, cooperation:true, planning:true, noise:0, rolloutIters:0 }——**一阶打分、无搜索、无隐藏牌推断、无随机**（rand:()=>0）。
2. 实际动作按 comboKey 在打分表里找到对应项得 actualScore；找不到罚 best.score−20。
3. scoreGap = round(best−actual)；分级：sameAsBest=good；gap<8=ok；否则 **bad**（gap≥8 即判失误）。
4. bad 手打标签：压队友大牌/拆炸弹（decompose 计划含炸弹且共享 id）/压得过大/对手报牌领小单/炸弹过早/错失清牌（仅当存在"整手恰好一手出完"的合法牌）/万能牌低价值。note 生成一句话理由。
5. 全局量化指标：让队友/压队友/炸弹使用与握到终局/万能牌使用/missedFinish/actualHands vs decompose 拆解手数；overall 评级 = badRate（bad 手数/人类总手数）<8% 且胜=S、<15%=A、<28%=B、否则 C。

### L5 反事实层（review/counterfactual.ts runCounterfactual）

取 bad 手按 scoreGap 降序前 4 个。每个目标手：stateBefore 重建该决策点 → 两个分支（实际打法 vs **scoreCandidates top-1**，即与裁判层同源的"引擎建议"）→ 每分支用 `simulateToEnd` 从该点打到终局 40 次，数本队获胜次数 → actualWinRate / betterWinRate / delta。simulateToEnd：四家全部用 SIM_CAPS（=LEVEL_CAPS[1] 中级能力矩阵 + noise:0 + inference:false）续打、**完全信息**（直接用真实 state.hands）；RNG 种子 = Date.now()。UI 分片执行不卡界面。

### L6 模型建议层（review/nnAdvisor.ts analyzeWithModel，10-27 新增）

前端 fetch ai/clean1.f32（部署权重 ck180，164,865 参数 MLP）→ 逐手重放（公开信息驱动 NeuralDecider 的 PublicTracker）→ 对每个人类决策：当前候选集上模型打分排名 → 实际动作按"牌张多重集（花色+点数，同点同花双副本视为等价）+ 声明语义（comboKey）"匹配 → 四档判语：match（一致）/ prefer_other（更推荐另一种，附模型前三与实际名次）/ single_candidate（唯一候选，不评价）/ uncovered（模型候选未覆盖此出法，不评价）/ same_cards_diff_decl（同牌不同声明，不强配）。全局统计覆盖数/首选一致率。**只做建议排名，不做客观裁判**（system prompt 有声明）。

### L7 剧本与提示词层（review/coach.ts buildCoachMessages）

system prompt：掼蛋规则速览 →【铁律：禁止编牌】三条 →【四层信息，分清来源，不许混称】（对局事实/引擎建议/模型建议/反事实模拟，禁止把任何一层说成客观正确）→ 输出格式（每关键手 [[MOVE:N]] 标记 + 四段式讲解；总评→逐手→2-3 条建议；800-1200 字；口语化）。

user 消息组装：对局信息（含"本局级数：我方打X、对方打Y（红心…为万能配牌）"）→ 引擎量化分析（含模型覆盖统计行）→ 关键手复现剧本 ≤6 手（bad 手 + 带标签 good 手，不足补"出手分量最大"的手；每手含：领出背景/本轮此前各家动作（**只有牌张序列**）/你打出+判定图标/引擎建议（牌张+describeCombo）/模型建议行/紧接下一手/各家剩牌张数——**不含 note/tags/scoreGap**）→ 反事实模拟行（"打A胜率X% vs 打B胜率Y%（各40局）"）→ 涉及知识点简报（knowledge.ts，13 条）。

### L8 LLM 调用层（web/server/index.mjs + ReviewPage.tsx）

前端 POST /api/chat（localhost:8787 本地代理，防 key 进前端）→ OpenAI 兼容 /chat/completions（或 Anthropic 通道）；模型 = 游戏内设置或 .env 或 ZCode Coding Plan 默认 GLM-5.3；思考参数 effort=max（thinking enabled + 大 max_tokens）；**未设 temperature、未设 seed**；流式返回，[[MOVE:N]] 交给前端渲染。生成完跑 lintReportCards：报告中每个"♠8/♥K/小王"式牌张 token 必须在喂给 LLM 的文本里出现过，否则显示告警。报告存 localStorage，重进不重生成。

### L9 渲染层（ReviewPage.tsx + TrickRecap.tsx）

回放 tab：逐手牌面、判定图标（✅🟡❌⏭️）。每手下方：nn-advice 块（模型判语+前三+名次+来源标签）、cf-box（反事实两分支胜率）。LLM 报告 tab：Markdown + [[MOVE:N]] 替换为 TrickRecap 复现卡（本轮各家牌面/你的动作高亮❌/**引擎建议金框**/回放跳转）。**同一手最多同时呈现四个"权威"**：红叉（裁判）、金框建议（裁判）、模型判语（ck180）、模拟胜率（反事实）。

---

## 第二部分：问题全量清单（29 项）

分级：**A=正在把错误事实/矛盾喂给 LLM 或用户**；**B=结构性缺陷（误导、未校准、脆弱）**；**C=体验与工程债**。状态：🔴现网活着 / 🟡待拍板 / ⚪低风险。

### A 类（8 项）

| # | 问题 | 证据 | 影响 | 修复方向 |
|---|---|---|---|---|
| A1 | **打分与反事实无仲裁**：裁判判"实际差、建议好"，反事实却常给出"建议分支 0%"——引擎自己的模拟否了引擎自己的建议，两者同屏无调停 | 第25手事故根因；counterfactual.ts 与 analyzer.ts 无任何交叉 | LLM 被迫在矛盾里编故事 | 仲裁层：delta<0 时撤销/降级判罚、不金框（已在 REVIEW2 §2.5 提案） |
| A2 | **反事实表头误标来源**："建议来源=ck180"——实际建议分支=启发式 top-1；且该行缺右括号 | coach.ts:134 | 直接教 LLM 混称四层来源，与 system prompt 第③层定义冲突 | 1 行改"建议来源=启发式引擎"；无论其他项是否拍板都应先修 |
| A3 | **万能牌行用旧 'both' 语义**：stage 口径新对局（双方级数不同）会告诉 LLM"红心5/2为万能配牌"——**假事实**（只有台上方级数的红心能配） | coach.ts:85；replay 层已修 stage（replay.ts:26-29）但 prompt 层没跟上 | LLM 会按"两张红心都能配"去解释/建议牌型——编造的又一直接来源 | 按 record.stageTeam+levelMode 生成正确表述 |
| A4 | **确定性伪胜率**：noise=0 时 heuristic 打分对相同局面给出相同结果（rand 调用但乘 0），40 次 simulateToEnd = **同一条对局线重放 40 遍**，胜率只能 0%/100%，却以"胜率 X%（各模拟40局）"呈现 | heuristic.ts:224；sim.ts SIM_CAPS noise:0；counterfactual.ts 40 sims | 用户和 LLM 都把它当抽样估计（"胜率从100%掉到0%"即此） | 信息集重采样（对手暗牌重洗）或降级为定性符号 |
| A5 | **反事实完全信息续打**：续打四家都看得到全部手牌 | sim.ts simulateToEnd 直接用真实 hands | 系统性高估"强牌方"分支、低估诈唬/隐蔽价值 | 同 A4 的重采样方案一并解决 |
| A6 | **判罚理由不进剧本**：note/tags/scoreGap 只进离线报告，LLM 剧本里只有"❌ + 建议"，不知为何判错 | coach.ts moveScript（无这些字段） | LLM 只能自己发明因果（第25手"3333零件"式脑补） | 剧本补 note/tags/scoreGap |
| A7 | **剧本牌张无万能牌代入语义**：cardsText 注释声称"万能牌标注♥级牌当5"但实现只标大小王；describeCombo 对 pair/trio/bomb 也不显示 wildAs（只有顺子/同花的 describeCards 显示"8↩"） | coach.ts:7-12；combo.ts describeCombo | LLM/用户看到"你打出 ♠8 ♥5"对不上"对子 88"，认定记录有错或自行脑补代入 | cardsText 接 combo.wildAs 标注；describeCombo 全牌型补代入 |
| A8 | **部署模型世界错位**：ck180 训练于旧 'both' 世界，新对局是 'stage'；双方级数不同的副里 encodeState 的 wild 特征位（ctx.ranks 决定）分布错位 | schema.ts:148；REVIEW2 §1.4 披露 | 这些副的模型建议（L6 整层）排名可信度下降，且无任何提示 | 短期在 nn-advice 标注"级数不同的副建议可信度降"；根治=CLEAN2 于 stage 世界重训 |

### B 类（15 项）

| # | 问题 | 证据/位置 | 说明 |
|---|---|---|---|
| B1 | **三裁判无优先级**：红叉（一阶打分）、金框（同源建议）、模型判语（ck180）、模拟行（反事实）同屏，互相可能矛盾，呈现层无一致性检查 | ReviewPage/TrickRecap | A1 的呈现面；即使 prompt 修好，屏幕上的矛盾仍在 |
| B2 | **裁判棋力=中级一阶**：ANALYSIS_CAPS 无 rollout/inference；gap≥8 阈值从未校准；actualScore 缺项罚 best−20 是拍的常数；高手的前瞻让牌/弃保会被误判 bad | analyzer.ts:72-79,207-223 | 所有判罚的根基；"中级裁判判所有人" |
| B3 | **知识点与建议对撞无消解**：knowledge.ts 13 条静态简报，可与本局金框建议直接冲突（【不拆炸弹】vs 建议拆） | coach.ts 知识点段 | 第25手对撞实况 |
| B4 | **"最优拆解"命名失实**：decompose 是启发式拆解非最优，却写"开局手牌最优拆解约 N 手" | coach.ts:82 | LLM 可能引用它当基准批评玩家 |
| B5 | **S/A/B/C 评级阈值无依据**：8%/15%/28% 拍脑袋；失误率分母=人类手数（pass 多的局分母大反而"好看"） | analyzer.ts:137-142 | 评级是用户第一眼看到的结论 |
| B6 | **剧本只喂 ≤6 手**：LLM 对全局的理解只剩几个汇总数字，其余全靠脑补 | coach.ts:115 | 覆盖率与 token 预算的取舍未设计 |
| B7 | **trickBefore 无牌型描述**：只给牌张序列，顺子/三带二/同花要 LLM 自己认——LLM 数牌/认型能力弱 | coach.ts moveScript | 认错牌型→错误讲解（第25手"把对3当炸弹"同源） |
| B8 | **800-1200 字 × 6 手 × 四段式**：信息密度被压到只能写套话，与"老教练口语化"进一步挤占 | coach.ts system 末段 | 报告"空话多"的直接原因 |
| B9 | **LLM 调用无 temperature/seed**：报告不可复现，同局两次生成两个版本；错误无法归因（是模型漂移还是 prompt 问题） | ReviewPage.tsx /api/chat body | 排障与验收的基本功缺失 |
| B10 | **lint 只查牌张 token**：语义断言（"那是炸弹"“队友剩X张”）查不住 | coach.ts lintReportCards | 最后防线只防"编牌"不防"编事实" |
| B11 | **反事实 RNG 种子=Date.now()**：连伪胜率都不可复现 | counterfactual.ts:46 | 复盘结果不可复现 |
| B12 | **missedFinish 检测不全**：只查"整手恰好一手出完"；两手清牌走人不检测 | analyzer.ts:265-270 | 该指标漏报 |
| B13 | **模型排名建立在截断候选集上**：class-2 资源不同变体未枚举（62% 首牌候选有未列变体，B3 画像），prefer_other 的"前三"是截断集排名 | engine/combo.ts 枚举；cand_profile | 模型"没见过"的合法好棋会被当不存在 |
| B14 | **seatNames 硬编码"你（南）"**：humanSeat≠0 时全剧本座位标签错位（web 恒 0 暂无实害，脆弱） | coach.ts:59 | 工程债 |
| B15 | **裁判口径与正式中级 AI 是两份手写配置**：ANALYSIS_CAPS 与 LEVEL_CAPS[1] 当前唯一差异=noise（分析层故意 0 求确定性，合理），但两份配置今后各自改动无对账机制 | analyzer.ts:72-79 vs ai/types.ts LEVEL_CAPS | "引擎建议"与"中级陪练实际打法"可能静默漂移 |

### C 类（6 项）

| # | 问题 | 说明 |
|---|---|---|
| C1 | GLM-5.3 max 思考档首字 1-2 分钟、全程 5-7 分钟 | 用户体验差；曾出现思考吃光额度正文为 0（已加显式报错） |
| C2 | 知识点库仅 13 条 | 教学深度受限，且与标签体系耦合 |
| C3 | 报告缓存无版本化 | 管线口径改了（如四层规则），旧缓存报告不会提示过期 |
| C4 | "AI 判断（硬事实）vs GLM 解读（讲解）"呈现未分层 | 项目记忆中已定调，UI 未落地——用户把 GLM 的推测当引擎结论 |
| C5 | 反事实只跑 bad 手 top4（按可疑的 gap 排序选样） | B2 可疑则选样可疑 |
| C6 | cloneForSim 细微克隆差异（trickPlays 清空等） | 未证实有实害，登记备查 |

---

## 第三部分：我对"胡说八道"的完整归因模型

用户感知的"基本属于胡说八道"不是单一 bug，而是四类输入缺陷的叠加，每一类都在把 LLM 往编造方向推：

1. **假事实输入**（A3 万能牌行、A7 代入不显示、A8 模型世界错位）：LLM 拿到的前提本身是错的，它忠实地基于错误前提推理——输出必然与用户看到的牌面冲突。
2. **矛盾输入无仲裁**（A1/A2/B1/B3）：四个权威互相打架又禁止 LLM 仲裁，连贯叙事只能靠编。
3. **理由缺失**（A6/B7）：判罚不给原因、牌型不给描述，LLM 补全空白的唯一手段是想象。
4. **数字误导**（A4/A5/B11）：伪胜率以百分比呈现且不可复现，LLM 引用后方向/量级皆可错。

已有防线（108 张铁律、牌张 lint、四层口径声明）挡得住"编牌张"（10-25 那类），**挡不住"编因果、编方向、编来源"**（10-26 那类）——因为后者的输入端问题（上表 A 类）一个都没修。

## 第四部分：修复优先级建议（供 ChatGPT 优化）

- **P0-立即**（1 行级修复，无设计争议）：A2（表头）、A3（万能牌行）、B4（"最优"命名）。
- **P0-设计**（需拍板但应尽快）：A6（判罚理由进剧本）、A4/A5（反事实改信息集重采样或降级定性）、A1/B1（仲裁层+呈现一致性）、A7（代入语义显示）。
- **P1**：B2（裁判校准或换神经裁判——与"复盘 AI 与训练 AI 关系定调"联动）、B9（temperature/seed）、B10（事实断言 lint）、B3（知识点消解）、A8 标注。
- **P2**：B5-B8（呈现与篇幅）、C 类。

**给 ChatGPT 的具体问题**（REVIEW2 §2.5 Q1-Q6 之外新增）：
- Q7：A3/A7 这类"prompt 事实层"修复，是否应该由代码从 record.ctx 直接生成牌型/代入描述，彻底不留给 LLM 文字推断空间（我倾向是）？
- Q8：B2 裁判层若维持启发式，gap 阈值如何校准（有无低成本标注方案）？若换 ck180 当裁判，A8 世界错位期间是否宁缺毋滥？
- Q9：29 项里有没有我漏掉的类别？（自查方法=逐层读代码+对照两起事故复盘，未做真实对局的端到端抽样验证——可补）
