# REVIEW3-EXEC-1.0 执行情况汇报（供外部复查）

日期：2026-10-27（深夜收尾）
执行者：GLM-5.3（本地会话，连续执行）
对象：REVIEW3-EXEC-1.0 执行令（~/Downloads/REVIEW3_能力定位与并行训练连续执行令_20261027.txt）
性质声明：本文件只汇报事实与数字，全部来自落盘工件；推测与已知缺陷单列。执行令要求"不得把本文件说成 ChatGPT 已验收代码"——本文件只是执行侧汇报，复查结论以你为准。

---

## 0. 一页总览

| 阶段 | 状态 | 关键数字 |
|---|---|---|
| §1 接手核对 | ✅ | typecheck 全绿；测试 160/160 起步（151/152=旧快照）→ 终态 **191/191**；备份 lab/review2/backups/20261027-170646-review3/（12 文件+SHA256SUMS） |
| §3 R3 收尾+R4 | ✅（页面渲染未接线） | LLM 验收 **5/5 通过、0 重试、账本 5/6**；R4 采样 6 决策×64 分配 0 拒绝 |
| §4 T0 | ✅ | 候选 v2：200 小手牌独立穷举 **0 缺失/0 多余/0 apply 失败**（修复前 31% 局缺合法动作）；observation-audit 落盘 |
| §5 并行采样 | ✅ | 三段探针 14.6min≤30；1/4/8 workers 逐位一致；**5515 成熟标签/s（8w）**；决策=8 workers |
| §6 CLEAN2 | ✅ | main：7051/7051 updates、**103.2min active**、计数五项全零；**confirm-attempt2 过门晋级**（M1 57.4% [50.4,64.5]） |
| §7 外部 DanZero | ⛔ 受阻 | 权重安全加载失败（pickle 语义）；详见 §7 本文件 |
| §8 KSCB/人类 | ⛔ 受阻 | 牌码映射无公开来源；用户两局 unavailable |
| §9 T2 | ✅ 分支 A | replica：7051/7051、99.3min、dev M1=60.9%——跨种子复现成立 |
| §10 D1 | ✅ 已锁定 | 轻松 ε0.5（5.2%）/标准 ε0.3（11.5%）/挑战 ε0（44.8%），政策=ck-7051 |
| §11 命令/工件 | ✅ | 见 §11 索引 |
| 部署 | ✅（用户拍板后执行） | clean2.f32 逐字节=ck-7051；deploy_check 4/4 |

---

## 1. 接手核对（执行令 §1）

1. 只读核对命令全部执行（pwd/run.mjs --help/PROGRESS/COMMANDS/package.json scripts/文件搜索）。
2. typecheck（npm run typecheck = 4 包 tsc --noEmit）：**接手时全绿**。执行令提到 engine/game.ts:95 pendingReturns 类型错已由并行会话修复（game.ts mtime 2026-10-27 08:03），我只验证未改动 engine 的进贡部分。
3. npm test：接手时 **160/160**（151/152 为旧快照口径差异，按令不追数字，统一以当次运行落盘为准）。
4. pendingReturns 生命周期核查点：创建（game.ts:112）、applyTribute push（:200）、completeReturn shift（:237）、克隆（ai/player.ts:142、ai/sim.ts:31、review/counterfactual.ts:130、review/replay.ts:145）齐备；未做任何修复。
5. R2 一次性接线核查结论：
   - 记录保存结构化声明：record.ts 保存 cards+comboKind+mainRank（非仅显示字符串）✓
   - actionIdentity 契约：接手时仅 analyzer 接入——**本轮已收口 4 处**（analyzer 原有；nnAdvisor 的 matchMoveToRanking 重写为调用 matchAction；teach.ts 比较改 sameAction→matchAction；counterfactual 结果新增 actualActionId/alternativeActionId）✓
   - 神经建议上线证据：加载路径 packages/web/src/App.tsx:42 fetch（当时 clean1.f32，现已切 clean2.f32）、权重 sha256 576e0c88680fc01b…c76、真实调用证据=packages/review/tests/nnAdvisor.test.ts（在全量测试中通过）+ 复盘页 nnAdvisor 四层呈现 ✓
6. 增量备份：lab/review2/backups/20261027-170646-review3/，12 个将被修改的文件（review 源码 8 个+run.mjs+PROGRESS+COMMANDS+App.tsx+ReviewPage.tsx）+SHA256SUMS。未复制整个项目。
7. 陈旧口径修正按令执行：未再引用"三档≤3pp"（本轮所有汇报使用 CLEAN1 任务B 校准值 99.6%/63.7%/97.7% 并注明"旧规则与协议下的内部比较"）；E1 区间跨 0 表述为"未检出差异"；参数量核实为 164,865（三处权重文件均 659,460 字节=164,865×4；此前账目 460,801 为误记已更正）；"等 ChatGPT 拍板"不再作为停止理由（三档方案与 E1 不替换部署按旧令执行）。

## 2. 能力六项证据口径

本轮汇报全部采用"内部相对比较"口径，未合成总分、未给人类段位背书。具体数字见 §6（能赢/能合作）与 §3（能教）。未测：外部稳健性（§7 受阻）、真人（§8 受阻）。

## 3. R3 收尾与 R4（执行令 §3）

### 3.1 统一证据对象（packages/review/src/decisionReview.ts）
每个被选决策产出 DecisionReview，字段覆盖执行令 §3.1 全清单：
- recordId/recordHash（fnvId 双 lane，非密码学，注明）、decisionId（`{recordId}#m{moveNo}`）、replayStatus、verifiedPrefixEnd、ruleContext（levelMode/stageTeam/levelsBefore/版本哈希）
- actual：actionId、物理牌（花色点数#id）、声明 declKey、wildAs（"♥2→当 8"逐张）、legal（降级时 null 不猜）、coverage（matchAction 四态）
- candidates：setHash（排序 actionId 串哈希）、CANDIDATE_VERSION（cand-dedup-v2）、SCHEMA_VERSION（gd-lab-schema-v1）、n、全量 ranking（actionId+程序渲染文本+分数）
- policy：proposalPolicyId+weightHash（sha256 前 16）
- heuristic：topActionId、note、perItemBreakdown:false（无逐项分解，明确记入 missing，不让 GLM 反推）
- singleStep：实际/替代各做单步转移，结构事实带 factId（f{moveNo}-a/h/n{k}）
- rollout：挂接 counterfactual（单次确定性）或 infoset（抽样），含根动作来源/续打策略/样本数/种子/假设说明
- claimLevel 五档+expressionScope（允许表达范围文本）、conflicts、missing
- facts/actionTexts 两张程序渲染表：牌名张数万能代入模拟结果全部按 ID 渲染，LLM 只能引用
选点默认=分歧最大 2 手+带标签亮点 1 手（与 teach 同源）；回放降级时模型层禁用（F07 门控，有测试）。

### 3.2 JSON 与事实渲染（packages/review/src/coachJson.ts）
- 输出契约：{summary, lessons[]}，每条 lesson 必须带 decisionId/actionIds/factIds/claimLevel/title/text
- 校验六类：schema；unknown_decision；unknown_action/unknown_fact（含跨手引用，因合法集合按决策划分）；claim_level_mismatch（必须等于证据卡值）；card_out_of_fact（♠10 等牌张 token 必须出现在该证据卡渲染文本中）；percent_out_of_fact；forbidden_judgement（provable_fact/uncovered/disagreement 档禁判罚语）
- 最多一次有边界重试（错误清单回填 prompt），计入 6 次总额；重试仍败=降级事实卡（rejected_degraded_to_facts）
- "不能先流式显示判罚再校验"：CLI 流程为先校验后落盘，页面层未接入（见未完成清单）
- parseCoachJson 容忍 ```json 围栏
- COACH_JSON_PROMPT_VERSION='coach-json-v1'（缓存键组成部分）

### 3.3 缓存/真实验收（lab/src/review2case.ts）
- CLI：--cases --mode facts|coach|sampled --samples --max-moves --max-actions --max-api-calls --out-dir；退出码 0/1/2/4
- 记录来源：离线确定性生成真实执行对局（generateRecord：学生席位=初级、对手=中级、种子固定、createdAt=种子保持可复现、Recorder 在 applyMove 之后记录修 handsAfter 错位——此为开发中修的实现 bug）
- 缓存：lab/review2/cache/coach-json-v1/{key}.json，键=sha256(版本×记录哈希×证据哈希×prompt 版本×policy×weightHash)；落盘含请求参数（model/thinking:disabled/temperature:null/seed:null/max_tokens）、原始输出、校验错误、耗时、事实卡全文
- LLM 账本：lab/review2/runs/llm_ledger.json 跨阶段累计不清零，超限拒绝调用
- LLM 通道：本地代理 8787 /api/import-zcode 取配置 → 直连 Anthropic 兼容端点（thinking disabled）
- **真实验收（llm-acceptance-cases-1.1，全为 generated 真实执行局，种子固定）**：
  | case | 种子 | 语义 | 结果 |
  |---|---|---|---|
  | acc-incident-like | 81003 | 普通分歧+条件续打 | validated（首轮即过） |
  | acc-wildcard | 81002 | 万能牌代入局（第4手） | validated |
  | acc-disagreement | 81004 | 启发式与模型首选不同 | validated |
  | acc-uncovered | 81038 | 不可评（该局实际为回放降级→模型层禁用型不可评；exact+uncovered 型在 81009-81090 扫描中未出现，如实说明） | validated（10.0s，0 重试） |
  | acc-regen-most-dangerous | derived from 81003 | 复生成 | validated（复用同一证据不同表述） |
  账本合计 **5/6**，第 6 次未使用（按令无须补满）。输出抽查：acc-uncovered 讲解正确引用 ♣Q♣Q♥Q+♣7♣7 三带二与模型排序、并排两种偏好、无事实外牌张。
- 30 案例教学验证集：以 packages/review/tests/r3.test.ts（9 项语义测试）+ 上述真实局执行覆盖；未要求用户手工标注。
- 原第 25 手/4A：仍 unavailable，未构造冒充（regression pack 原样保留）。

### 3.4 R4 信息集（packages/review/src/infoset.ts + review --mode sampled）
- 64 份暗牌分配：自家手牌+全部已出牌固定、其余均匀分给三席、严格张数约束（不守恒直接抛错）；分配种子=fnv(namespace, matchNo, i)，禁时间/顺序
- 实际/替代同一分配配对；四席续打=heuristic:mid noise=0（INFOSET_CONTINUATION_POLICY）
- g=本副名次分（±1/2/3，双上/三游归属同引擎升级公式）
- 拒绝分配计数（试点 0）；进还贡公开信息未入记录→如实写入 assumptionNote（记录器自 beginPlay 起）
- "过牌≠压不过"：分配不从此推断；"更换续打策略就反转的建议须标依赖后续打法"——证据卡表达范围已含
- 试点（rollout-pilot-cases-1.1，3 局真实生成局，种子 81003/81004/81005）：6 个决策点全部 64 样本 0 拒绝，输出各根 g 均值/胜率+配对差（如 m5：实际 pair:14 g=0.297 vs 替代 bomb:7 g=0.797，配对 Δ=−0.5，实优16/alt优28/平20）
- 已知限制如实：均匀分配是简化假设、64 样本不能消除假设偏差、单副 g 非整场胜率——均写入输出

### 3.5 顺带修复的三个复盘线真 bug（均为用户可见）
1. **回放声明优先**（replay.ts resolveDeclaredFirst + replayStatus 主路径/兜底分支接通）：根因链=acc-uncovered 崩溃 → classifyReplay 兜底分支 applyPlay 未检查压不过 → 深层根因=bestResponse 对领出（lastCombo=null）自由重推导，把含万能牌的领出重解释成更强声明（实例：seed 81038 第34手实际领出三带二6，被重建为三带二13，毒化后续重建，第37手合法跟牌被判压不过）。修复=记录带 comboKind/mainRank 时用 classify 枚举按声明筛选（等价变体取确定序首个），bestResponse 仅作无声明兜底；兜底构造同样加压不过降级。**60 局自产记录降级数 2→0**。
2. **matchAction exact 分支缺声明比对**：同物理牌不同声明被误判 exact（违背 R2 契约"同牌异声明不强配"，nnAdvisor 案例10 测试暴露）。修复后 exact 需 declKey+物理 id 双等。
3. **counterfactual 对压不过历史动作崩局**：bestResponse 抛错炸整局 → 改跳过该手续打（DecisionReview.rollout 保持 null），不再中断。

## 4. T0 候选/观察（执行令 §4）

### 4.1 候选 v2（cand-dedup-v2）——两层根因+修法
- **发现**：cand_profile_v2 Part B 初版对照（物理键）报 31/100 屺缺 49 键、0 多余；人工诊断 case70 排除"同点非万能副本"假差异（对照键改资源等价版）后仍剩 27 键缺失/26 键多余。
- **根因 1（去重层）**：enumerateCombos 内部 push 按 comboKey（牌型:主点:长度:张数）去重——同声明不同资源消耗的合法变体（自然对8 vs ♥2当8配对8）被静默合并。
- **根因 2（构造层）**：build 的 fill 自然牌优先，自然牌充足时永不构造消耗万能的变体。
- **修法**：①push 去重键=comboKey+resourceRoles（普通牌 r、万能牌自然身份 r\*、万能牌代入 r→a；自代入归一为自然身份；同点同角色副本仍合并=真等价）；②BuildArgs 新增 forceWild，fill 支持 maxNatural；对子（c≥1 且 w≥1）与三张（c≥2 且 w≥1）额外构造强制用 1 张万能的变体。
- **验收**：Part B 终态 **200 屺 0 缺失/0 多余/0 applyMove 失败**（applyVerifiedFailCases=0）；Part A（1000 真实决策点）：候选数均值 4.6/p50 2/p95 18/max 82（领出均值 13.11、跟牌均值 2.72）、同声明异资源组 259、枚举+去重 0.038ms/状态。落盘 lab/review2/candidate_profile_v2.json。
- **锁测试变更声明**：combo.test.ts 旧锁"双级局对9 绝不出现 H5"按 v2 语义更新（H5 代入 9 与 S9 组对=合法独立变体，classify 可复认）——这是语义变更非测试放水，新锁同时验证自然变体仍在、代入变体 classify 复认通过。
- **对照方法边界**：独立枚举用手牌子集×classify（与被测 legalCombos 不同层）；classify 为共享牌型判定器，无法完全绕开，已在文件头注明。
- 历史 both 与 stage 分开：未把双级万能当 stage 应补招法；resourceRoles 在 both 局同样只认 ctx.ranks 内的级牌。

### 4.2 observation-audit（packages/ai/src/nn/observationAudit.ts → lab/review2/observation_audit.json）
- 块表：317 维状态 9 块+68 维动作 3 块，逐块位置/来源/可见性/时序（测试校验维度连续无空洞）
- 程序检查：暗牌不变性（交换东西家手牌向量逐位一致）✓；公开历史敏感性 ✓
- **pass 位怪癖备案不修**：encodeAction(null) 写 out[PASS_KIND_IDX]=out[10]，落在动作块物理区第 10 槽（绝对 317+10=327），理论位 381 恒 0；pass 与单张牌候选可由 kind/keyRank 位区分、无完整向量碰撞、训练推理两端自洽——按 §4.5 不修（修则必须 bump encoderVersion 重训）
- 信息在场清单如实缺口：stage 口径生效级牌点数/谁在台未直接编码（仅 levels 两值+wilds 张数间接）；进还贡公开亮明牌归属未编码（schema 头 knownLimitations 原有声明）；逐手历史仅每家最近 3 手。三项均登记为后续单因素试验，未扩网、未加历史网络/结构特征/奖励。

## 5. 并行采样（执行令 §5）

### 5.1 实现（lab/src/wave_worker.ts + review2train.ts WorkerPool + packages/ai/src/nn/wave.ts）
- 4→**8** 常驻 Node 子进程 + 1 个 Python CPU learner（torchThreads=2）；waveSize=8；主进程预分配连续全局 matchId；一波共享同一不可变权重快照（每任务拷贝发送）；worker 动态领任务（单任务派发）——1/4/8 workers 任务列表与随机流完全相同
- 归并：整波完成后按 matchId 升序（场内决策序由 worker 保证）；尾部继承（tailFeats/tailYs/tailWave）；U_w=floor((尾部+本波)/2048)；每块一次 RMSprop（learner 端 trainSub=1024 子抽样，stepSeed=deriveStepSeed(namespace,master,updateId) 显式传入）
- 波次临时文件：每场到货即写 runs/<run>/waves/w{id}-m{mid}.bin（含 feats+ys 连续二进制），消费后删除；崩溃恢复路径存在但本轮未触发
- 版本记账：逐 update 记录块内 waveId 构成→行为版本年龄 p50/p95/max。**已知记账 bug（见 §12 缺陷清单 #9）**：当前波出生版本误置 0，账面年龄虚高为累计 update 数；真实滞后≤1 波（约 5-6 updates，因每波产生约 5-6 次更新）。训练语义（样本内容/更新顺序/种子）完全不受影响。训后已修（波开始时登记出生版本），两个正式 run 的账本保留旧 bug 数据未改写。
- RNG：全部 deriveSeed(namespace, master, matchId, purpose)；workerId/完成顺序/时间不参与（wave.ts 有 5 项契约测试）
- 恢复：state.json（updates/consumed/activeMs/nextMatchId/waveCount/tailLen/tailWave/updatesAtWaveEnd/checkpointsHit）+current/weights.f32+resume.pt（含 RMSprop 状态）+tail.bin；loadOpt 恢复优化器。本轮两 run 均未中断，恢复路径未实战。
- 回退：串行 fallback 已声明于协议（clean1 路径），未触发。

### 5.2 三段探针（lab/review2/parallel_probe/*.json，总 14.6min ≤ 30min 预算）
1. **确定性**：固定权重（MLP(2026110003) 初始化）+同 32 个任务，1/4/8 workers 各跑 4 波×8——逐场特征哈希/标签哈希/样本数完全一致（mismatch 空）、32 场连续无漏重、总样本 63,967。开发中曾出现 4/8 场早收与 9/8 场跨波串数：根因=单任务派发下 worker 每任务回 match+done 两条消息，done 分支把 busy 置 false 后队列恰好排空提前放行整波——修复=删除 done 消息，仅由 match 驱动。
2. **端到端吞吐**（预热后各 2 分钟，learner 在环，覆盖完整"采样→归并→学习→发布"循环，记录窗口两端未消费量）：
   | workers | 成熟标签/s | updates/2min | 覆盖完整循环 |
   |---|---|---|---|
   | 1 | 1322.2 | 77 | 是 |
   | 4 | 3599.7 | 205 | 是 |
   | 8 | 5515.2 | 319 | 是 |
   RSS 记录于 end_to_end.json；系统内存压力未现持续 swap 增量。
3. **短学习对照**（同初始化 2026110002、同 stage+v2 候选+同编码，只隔离刷新频率，各上限 200 updates）：每场刷新（clean1 语义：每场结束换权）159 updates/5.01min/loss末 7.2882；波刷新 200 updates/1.69min/loss末 7.0629；两臂输出有限、保存重载一致。**决策：8 workers（8vs4 增益 53.2% ≥20%）**，写入 decision.json；未据此扩大正式训练量。

### 5.3 已知实现坑（复查者关注）
- fork（child_process）下 worker_threads 的 parentPort 恒 null：初版 worker 静默退出、事件循环排空进程 0 退出无任何报错——改用 process.on('message')/process.send
- Node IPC 默认 JSON 序列化把 Float32Array 打碎成普通对象（setWeights 报 flat.subarray is not a function）——fork 加 serialization:'advanced'（v8 结构化克隆）后保真

## 6. CLEAN2（执行令 §6）

### 6.1 配方符合性（protocol-v3.json）
stage 默认+cand-dedup-v2+gd-lab-schema-v1（385/317/68）；新随机初始化（main-init=2026102805）；不读旧样本；y=g+W；RMSprop lr1e-3/α0.9/ε1e-5（learner.py 既有，clipNorm=1e6 如实说明非强裁剪）；ε=0.05 恒定；groupSize 2048/trainSub 1024/matchGameCap 60/torchThreads 2；四席当前模型自博弈；本轮只改 stage/候选 v2/并行执行协议，未混 BC/策略池/利用率 1.0/奖励变更。

### 6.2 训练量与账目（runs/clean2-main/runtime_ledger.jsonl）
- **train-end：stopReason=maxUpdates，7051/7051 updates，activeMs=6,190,815（103.2min ≤228）**，consumed=7,220,224（=7051×1024 精确），waves=1651，一致性计数五项全零（illegalIntent/fallback/semanticRewrite/encodingMismatch/labelMismatch），deadWorkers=0，extraMatureInTail=528（同波额外完整标签留账未训练）
- 检查点 500/1800/3600/5400/7051 精确保存（ck-{n}/weights.f32+resume.pt；state.json 含可恢复尾）
- 未完成场处理：0 capped 场/1651 波
- 期间机器有第三方负载（用户 stock_analyzer 进程约 90% 单核+ChatGPT 桌面端）——按令未关闭用户应用，训练在同一负载下完成；该负载只影响 wall 时间（active 计时含等待，如实未剔除）

### 6.3 选型与确认
- dev（各 ck 32 块×2 边换位，M1=N+N vs O+O、M2=N+H vs O+H，O=部署 ck180 包；S=0.5p(M1)+0.5p(M2)；同分先 M2 再较早 ck——按令）：
  | ck | M1 | M2 | S |
  |---|---|---|---|
  | 500 | 15.6% | 23.4% | 0.195 |
  | 1800 | 17.2% | 40.6% | 0.289 |
  | 3600 | 51.6% | 46.9% | 0.492 |
  | 5400 | 57.8% | 42.2% | 0.500 |
  | 7051 | 67.2% | 45.3% | 0.563 |
  首次确认前锁定 candidate.json=ck-7051（唯一锁定，未换）
- 确认（97.5% 双侧块 bootstrap，B=2000，1.25/98.75 分位，种子派生固定；M1 128 块/M2 256 块）：
  - **attempt1：M1 54.3% [48.0,60.2]（点估计<55 且下界<50，FAIL）；M2 54.7% [50.2,59.6] PASS → confirmed=false**（如实保留 confirm_confirm-attempt1.json）
  - **attempt2（全新种子 2026110004）：M1 57.4% [50.4,64.5] PASS；M2 52.0% [47.3,56.4] PASS → confirmed=true**
  - 未用 attempt3（令禁）；样本事前固定、未中途择时
- 口径声明：以上只说明相对旧产品策略包的升级，不是"超过普通人"。M1/M2 波动（attempt 间 M1 54.3↔57.4、M2 54.7↔52.0）触发了 T2-A。

## 7. 外部参照 DanZero（执行令 §7）——受阻，如实

- 资产：q_network.ckpt 下载并校验（bytes=5,368,401、git blob sha1=422b7a55…匹配、sha256=a6f132e50e205709…、来源 manifest 落盘 lab/review2/assets/danzero-dmc/e2b900b…/source_manifest.json）
- **受阻点=权重安全加载**：
  1. torch.load(weights_only=True) 拒绝：pickle 协议 4、Unsupported operand 149（文件含旧式 numpy 数组对象）
  2. 按令不改不受限 pickle 执行；尝试受限 numpy 垫片（白名单 find_class 的自定义 Unpickler，仅放行 numpy.core.multiarray._reconstruct/_scalar/dtype 等构造路径）——在 torch tensor setstate 层失败（"state is not a dictionary"），未继续深挖
  3. venv 无 numpy 且安装需用户授权（用户红线：不经允许不装库）
- 已交付：lab/review2/external/adapter.json（status=adapter_blocked）——含文档级兼容矩阵（级牌口径/万能牌/进贡启发式模块/567 维观察 vs 本项目 385 维不得直送/75 维动作块/候选提供器缺口统计框架）+解锁条件（用户授权在隔离 venv 加 numpy 仅作解包，或信任源提供转换后纯权重文件）
- dev/confirm 未执行（前置不满足，退出码 4），**未产生任何对战结果**；对本项目核心交付零阻断

## 8. KSCB/人类决策（执行令 §8）——受阻，如实

- 资产：guandan_matches.jsonl.gz 下载并校验（bytes=17,724,210、blob sha1=5d3fccc3…匹配、gzip 魔数、sha256=72377a12553c85c2…）
- 有来源信息：README 原文 event_id 3=出牌、4=PASS；result 字段（win_index/win_type/score/levelup）语义；players=chair_id+uid
- 结构发现（12 match 流式样本，落盘 decode.json）：rounds 平均 9/场；event 计数 1:124/2:496/3:4553/4:5491/5:16/6:137/7:137/8:96/9:1613/10:8101/11:471/12:44/13:98/15:156/16:86；event2 tiles 长度恒 27（初始手牌）；tiles 宇宙 65 个整数、范围 1-95；game_rule 字符串 3 种（字段含义未逐项解释，按令不下结论）
- **受阻点=牌码映射无公开来源**：查过 KSCB/README.md、README.zh-CN.md（均只说"整数牌值编码"无表）、KSPlay guandan types.py 与 DanKS types.py（均为十六进制 0x01xx 牌码体系，与数据文件 1-95 十进制不一致）、公开检索（CardKS/KSCB 无结果）。按令"不能凭牌码频率猜一份表"→ decode_blocked_at_mapping，diagnose 前置不满足未执行
- 解锁条件：作者映射表/解码代码，或 KSCB 生成管线未公开的 tiles 转换层
- 用户两局：记录未导出，标 unavailable；未要求用户先标注（按令不阻塞）；"标记这手"入口未新增（本轮范围外）
- 信息边界设计已备（decode.json 中写明：actor 输入仅当时可见、万能牌缺声明不强行匹配、PASS/唯一合法单列）——映射到位即可执行

## 9. T2（执行令 §9）

- 决策：**分支 A（clean2-replica）**，决策记录 lab/review2/selected/t2_decision.json。排除理由：C 前提不成立（无人类认可标签）；B 无具体偏科证据（外线受阻+M1/M2 双过门）。选 A 依据：T1 attempt2 正式晋级=有清楚相对升级；attempt 间波动=需核实训练随机性。
- 执行：同冻结协议、**同代码**（ages 记账 bug 未修以保持与 protocol 快照一致，见缺陷 #9）；replica-init=2026102905/replica-train=2026102906；新初始化不继承父权重/样本/预算计数。
- 结果：**7051/7051、99.3min active、consumed 7,220,224、计数五项全零、deadWorkers 0**。dev（同规则独立 dev 种子）：ck500 M1 10.9%→ck7051 **M1 60.9% [48.4,73.4]、M2 50.0%、S 0.555**——曲线形状与 main 一致，**跨种子复现成立**（两次 run，不足以证普遍稳健，按 [S7] 口径如实）。
- 预算合计：T1 103.2 + T2 99.3 = 202.5min ≤ 456min 上限；未自动扩量（14,102 updates 未做，按 §9.5 需先有外部参照）。

## 10. D1 产品分档（执行令 §10）

- 机制（review2difficulty.ts）：只调对手两席（队友固定）；高档=政策贪心 ε=0；中低档 ε-greedy 且仅在与 top1 raw Q 差≤0.5 的 top2/3 近并列动作内均匀随机；无合格替代=top1；ε 网格 {0,0.15,0.30,0.50,0.75}；未加"永不压队友"类通则。
- dev（政策=candidate.json 的 ck-7051，24 块×2 边）：ε0=45.8%、ε0.15=45.8%、ε0.30=14.6%、ε0.50=6.3%、ε0.75=6.3%——**ε0.15 与 ε0 实测不可区分，弃用**（"ε 不一定单调/合法乱打≠像初学者"如实体现）
- 开发中修了两个我自己的实现错误（见缺陷 #13/#14）：选档器曾选出两个不可区分弱档漏掉最强档；确认档分隔检查方向写反（弱→强序下应取绝对差）
- confirm（48 块×2 边全新种子 88000+）：ε0.5=5.2%、ε0.3=11.5%、ε0=44.8%（单调、相邻差 6.3pp/33.3pp≥5pp）→ **锁定 difficulty.json：轻松 ε0.5/标准 ε0.3/挑战 ε0**
- 口径：本应用相对难度（对同政策贪心），不称人类段位
- **产品接线未做**（见未完成清单）：web 当前仍是"神经陪练开关+初/中/高禁用"旧交互；difficulty.json 已锁但 UI 未接

## 11. 命令与工件索引（全部真实执行）

真实命令（均经 node lab/review2/run.mjs 或 npx tsx 直跑，摘要落 runs/）：
- node lab/review2/run.mjs check --phase {web-integration,integrated,information-set,observation,parallel-contract,facts,replay,coach}（各 phase 测试数：web 4/30 integrated/infoset 9/observation 5/…全绿）
- node lab/review2/run.mjs review --cases lab/review2/cases/{llm-acceptance,rollout-pilot}.json --mode {coach,sampled} --samples 64 …
- node lab/review2/run.mjs candidate-profile --states 1000 --small-hand-cases 200
- node lab/review2/run.mjs parallel-probe --protocol lab/review2/protocol-v3-draft.json --max-active-min 30
- npx tsx lab/src/review2freeze.ts --workers 8（protocol-v3.json；此前 --draft 生成 protocol-v3-draft.json，train 侧拒绝 draft）
- node lab/review2/run.mjs train --run {clean2-main,clean2-replica} --max-active-min 228 --protocol lab/review2/protocol-v3.json
- node lab/review2/run.mjs evaluate --run clean2-main --split {dev,confirm-attempt1,confirm-attempt2} [--lock-candidate]
- node lab/review2/run.mjs difficulty --phase {dev,confirm} --protocol lab/review2/difficulty.json [--lock-settings]
- node lab/review2/run.mjs {external-probe,human-probe} --protocol … --phase {adapter,decode}
- node lab/review2/run.mjs report --out lab/review2/REVIEW3_EXECUTION_REPORT.md
- npx tsx lab/src/deploy_check.ts（部署后 4/4）

关键工件（打开即查）：
- 协议/种子：lab/review2/protocol-v3.json（17 源文件 SHA256、参照权重 576e0c88…、预算、命名空间、按 run 有效配置）
- 训练：lab/review2/runs/{clean2-main,clean2-replica}/runtime_ledger.jsonl、state.json、ck-*/、dev.json、confirm_confirm-attempt{1,2}.json
- 探针：lab/review2/parallel_probe/{contracts,end_to_end,short_learning,decision}.json
- T0：lab/review2/{candidate_profile_v2,observation_audit}.json
- R3/R4：lab/review2/runs/review/*.evidence.json、cache/coach-json-v1/、cases/{llm-acceptance,rollout-pilot}.json、runs/llm_ledger.json
- 外部：lab/review2/{external/adapter.json,human/decode.json}、assets/*/source_manifest.json
- D1/T2：lab/review2/{difficulty.json,difficulty_dev.json,difficulty_confirm.json,selected/{candidate,t2_decision}.json}
- 总报告：lab/review2/REVIEW3_EXECUTION_REPORT.md

源码快照：protocol-v3.json.sourceSnapshot（17 文件）；冻结后改动的文件（见偏差声明）。

## 12. 遇到的全部问题/缺陷清单（含我自己犯的，按发现序）

| # | 问题 | 定性 | 处置 |
|---|---|---|---|
| 1 | Recorder 记录时机错（handsAfter=牌前张数），离线生成局全数过不了完整性校验 | 我实现 bug | 修：applyMove 后记录（mover/toBeat 预取） |
| 2 | 学生=中级自博弈对分析器零分歧，证据为空 | 设计盲点 | 改 generateRecord 支持学生/对手不同难度 |
| 3 | classifyReplay 兜底分支 applyPlay 未查压不过→崩局；深层根因=bestResponse 对领出自由重推导毒化重建（60 局 2 降级） | 既有真 bug（R2 遗留缺口） | 修：声明优先 resolveDeclaredFirst 双路径接通；60 局 0 降级 |
| 4 | matchAction exact 缺声明比对（同牌异声明误 exact） | 既有真 bug（R2 契约违背） | 修：exact 需 declKey+物理 id 双等；nnAdvisor 案例10 复绿 |
| 5 | counterfactual 对压不过历史动作抛错炸整局 | 既有真 bug | 修：跳过该手续打 |
| 6 | 候选类 2 两层根因（comboKey 去重吞资源变体+build 自然牌优先不构造万能变体），31/100 屺缺合法动作 | 既有真缺陷（执行令预判方向坐实并量化） | 修：resourceRoles 键+forceWild；200 屺 0/0/0；combo.test 旧锁按 v2 语义更新（声明变更） |
| 7 | worker 用 worker_threads parentPort 但主进程 fork——静默退出无报错 | 我实现 bug | 修：child_process IPC |
| 8 | IPC 默认 JSON 序列化打碎 Float32Array | 我实现 bug | 修：serialization:'advanced' |
| 9 | **训练 ages 记账 bug**：当前波样本出生版本误置 0→账面年龄=累计 updates（真实滞后≤1 波≈6 updates）；训练语义（样本/顺序/种子）零影响 | 我实现 bug（纯记账） | 训后修（波开始登记出生版本）；两个 run 账本保留旧数据未改写；协议快照为修复前代码（见偏差 A3） |
| 10 | 探针第一段 worker 每任务回 match+done 双消息→提前放行整波（16/32 场、9/8 场串波） | 我实现 bug | 修：删 done 消息；32 场逐位一致 |
| 11 | run.mjs evaluate 映射/子命令转发错误（review2evaluate.ts 不存在） | 我实现 bug | 修：evaluate→review2train.ts evaluate |
| 12 | 注释含 `r*/` 提前闭合块注释→9 个测试文件收集失败 | 我实现 bug | 修：改写注释 |
| 13 | D1 选档器选出两个不可区分弱档、漏 ε0 最强档 | 我实现 bug | 修：挑战档必含+按 ≥8pp 递减选 |
| 14 | D1 确认分隔检查方向反（弱→强序下 prev−curr 恒负→误判未达门） | 我实现 bug | 修：取绝对差（确认数据本身达标：6.3/33.3pp） |
| 15 | neural-policy 测试硬编码旧版本号，换权重即红 | 既有测试脆弱点 | 修：改引用 NEURAL_MODEL_VERSION 常量 |
| 16 | Part B 对照初版用花色物理键，把同点非万能副本当"缺失"（31→27 假阳） | 我方法 bug | 修：对照键改资源等价（同引擎 resourceRoles） |
| 17 | 扫描/探针脚本在 /tmp 下无法解析 workspace 包、import 触发 CLI 自执行 | 环境坑 | 修：项目内跑+模块自执行守卫 |
| 18 | 训练期间第三方负载（用户 stock_analyzer≈90% 单核+ChatGPT 桌面端）拖慢采样 | 环境事实 | 按令未关用户应用；active 计时含等待如实未剔除；wall 拖长但 103.2min 仍远低于上限 |

## 未完成/未做清单（如实，逐条附原因与解锁条件）

1. **R3 页面渲染 DecisionReview**：证据对象+CLI+缓存+验收已交付，web ReviewPage 未接新证据结构（旧四层呈现仍在）。原因：训练关键路径优先+页面改造属产品线；后续接线即可（数据都在）。
2. **游戏内提示仍启发式**：按令 §10"如果提示仍来自启发式，页面据实标明"——现状未变，报告已如实。
3. **D1 三档未接入产品 UI**：difficulty.json 已锁定，但游戏页仍是"神经开关+初/中/高禁用"旧交互；且"继续比赛"路径不读神经配置（用户已发现并询问；已如实解释：继续=按存档难度的启发式对手）。改造方案已向用户提出待拍板。
4. **部署切换后的浏览器端到端冒烟未重跑**：部署核验做到 deploy_check 4/4（逐字节/确定性/10 副 1001 手 0 非法/推进正常）+191/191 测试（含 controller 集成），但未再做一次浏览器整局。原因：时间与范围；属可补项。
5. **LLM 第 6 次额度未用**（按令无须补满）。
6. **external dev/confirm、KSCB diagnose 未执行**：前置受阻（§7/§8），非跳过。
7. **"继续比赛"与神经配置的割裂**（见 3）。
8. **浏览器 autopilot 端到端抽样验证 Q9**（REVIEW_AUDIT 遗留）：未做。

## 偏差声明（对执行令的字面偏离）

- A1 LLM 验收四语义中"不可评"用了**回放降级型**（81038）而非 exact+uncovered 型——81009-81090 共 82 个种子扫描未出现 exact+uncovered 组合（uncovered 与重建分歧相关，本身是发现）；已在 case pack 与本报告如实标注。
- A2 R4 试点三例用真实生成局替代原 pilot 的构造局（原事故谱 unavailable；provenance=generated 标注，来源分开）。
- A3 冻结后修改了 review2train.ts（缺陷 #9 记账修复，在两个正式 run 结束后）——protocol-v3.json.sourceSnapshot 中该文件哈希为冻结时值，与当前文件不一致；两个正式 run 运行时加载的是冻结版代码。已如实声明，未改写冻结协议。
- A4 protocol-v3-draft.json 保留未删（冻结前探针用的草稿，含 draft:true；train 拒绝 draft）。
- A5 部署切换（clean1.f32→clean2.f32）发生在用户明确拍板后（"先更换吧"），属执行令范围外的用户决定，已执行并核验。
- A6 review2difficulty.ts 选档/分隔两处修复发生在 dev 数据复用之后（同种子重跑 dev+confirm），确认数据为修复后全量重跑结果。

## 部署后状态（用户拍板项的执行记录）

packages/web/public/ai/clean2.f32（逐字节=lab/review2/runs/clean2-main/ck-7051/weights.f32）+clean2.meta.json（confirm 数字与训练来源）；NEURAL_MODEL_VERSION='clean2-ck7051-20261027'；App.tsx:42 与 ReviewPage.tsx:102 fetch 指向 clean2.f32；clean1.f32 留档不用；deploy_check 4/4；191/191、typecheck 绿。

## 结尾：尚存最重要的能力短板与下一笔有限实验建议

封闭系统内没有第二个独立策略做参照（外部两路均受阻于外部条件）——牌技绝对定位仍零锚点。下一笔最有价值的有限实验：用户授权在隔离 venv 添加 numpy（仅解包用途）或取得转换权重 → 跑通 DanZero adapter（100 决策映射检查）→ 32 块开发对战；若可分辨，再决定 128 块确认。此实验回答"是否关起门称王"，不回答人类段位。

---
---

# 附篇一：对当前训练完 AI（clean2-ck7051）的完整认知

> 写给复查者：以下分三层——事实层（全部有落盘数据）、判断层（标置信度）、未知层（如实承认）。不合成总分，不给人类段位。

## A1. 事实层：它是什么

- 结构：385→256→256→1 的三层 MLP，164,865 参数，tanh 双隐层+线性头。
- 学法：四席自博弈 Deep Monte Carlo——同一模型坐四个位置、ε=0.05 探索，整场打完以 y=g+W（本副名次分±1/2/3 + 整场胜负±1）回归到（局面，动作）打分；RMSprop lr=1e-3/α=0.9/ε=1e-5，groupSize 2048 块、块内确定性子抽样 1024 训练。
- 世界：官方 stage 级牌口径（台上队级数=唯一级牌、其红心×2 为万能牌）+ cand-dedup-v2 候选集（穷举对账 0 缺失）+ gd-lab-schema-v1 编码（317 状态+68 动作）。
- 执行：8 worker 波并行（waveSize=8，波内权重快照冻结、行为滞后≤1 波≈4-5 updates）；7,051 updates / 7,220,224 梯度样本 / 103.2min active / 1,651 波 / 一致性计数五项全零 / capped 0 场。
- 训练动态：loss 从 ~8.5 降至 4.5-6 区间波动缓慢下行（DMC 回报高方差，正常形态）；每波约 1.1 万成熟样本；尾部 528 样本未消费（占比 <0.004%）。

## A2. 事实层：已测量的能力数字

| 比较 | 结果 | 出处 |
|---|---|---|
| 对旧部署包 ck180（M1，双方全神经） | **57.4% [50.4,64.5]**（128 块×2 边；attempt2） | confirm_confirm-attempt2.json |
| 同上，attempt1（另一套全新种子） | 54.3% [48.0,60.2]（未过门） | confirm_confirm-attempt1.json |
| M2 混队（各带中级 H 搭档） | attempt1 54.7% [50.2,59.6] / attempt2 52.0% [47.3,56.4] | 同上两文件 |
| 复制 run（全新初始化种子重训） | dev ck-7051 M1 **60.9%** [48.4,73.4] | runs/clean2-replica/dev.json |
| dev 学习曲线（对旧包） | 15.6%→17.2%→51.6%→57.8%→67.2%（500/1800/3600/5400/7051） | runs/clean2-main/dev.json |
| 训练成本 | 226.5min（CLEAN1 串行）→103.2min（本轮）同量级 | 两代 runtime_ledger |

未直接测量的（如实）：对启发式初/中/高的胜率（本轮无数据；由"新>旧 57:43 且旧对中级 98.4%（both 世界）"可推断只会更高，但这是推断不是测量）；对人类（零数据）；对独立外部模型（受阻未测）。

## A3. 判断层（我的解读+置信度）

**高置信**：
1. 同世界内对旧产品包确有优势——两次 attempt 点估计都在 50% 上方、四次独立测量（两 attempt×两指标）三次过门。
2. 配方可复现——独立种子第二 run 学到同等水平（60.9% vs 67.2% dev，区间大量重叠），学习曲线形状一致。
3. 无作弊、无非法动作——平行世界测试谱系+训练内五计数全零+deploy_check 1,001 手零非法。

**中置信**：
4. 真实优势幅度大概在 50-60% 区间而非准确的 57.4%——attempt 间波动（M1 54.3↔57.4、M2 54.7↔52.0、replica dev 60.9）说明单次 128 块测量的 run-to-run 噪声约 ±3pp。这个量级是"稳高一档"，不是代差。
5. 本轮提升来源是三个变量的合力，无法拆分：①规则世界修正（both→stage）②候选补全（v1→v2）③执行协议（串行→波并行）。评测口径按令用"各自配套整场对打"（旧包用旧配套），所以 57.4% 是产品包代际差，不是纯网络棋力差。**未做单变量消融**（见附篇三问题 6）。

**未知/结构限制（不变）**：
6. 绝对水平零锚点——无外部模型、无真人数据，整条阶梯仍浮在人类光谱之外。
7. 共享盲区未变：候选生成器/编码/引擎同族——候选空间外的人类招法域（本轮把"类 2"缺口清零，但表示边界之外的东西仍不可见）；观察缺口三项（stage 级牌点数/台上队、进还贡公开牌归属、仅 3 手记忆窗口）已登记未修。
8. 该配方（信息集+容量+7,051 updates）在 stage/v2 世界内离上限多远——无外部参照无法回答。

## A4. 与旧认知的衔接

- 上代结论"神经学员横扫三档"（both 世界）不因本轮失效；本轮把同一性质的成功搬到了官方 stage 世界并补齐动作词汇。
- "内部排位赛 vs 真人锚点"的表述框架继续适用：本轮交付的是内部排位赛的代际升级，锚点问题原样待解。

---

# 附篇二：后续训练计划（逻辑、参数、判据）

## B0. 总原则

1. 先修信息与参照，再加量（继承执行令 §9.5：加倍重复旧经验补不上缺失的动作或信息）。
2. 每笔实验只回答一个预先写明的问题；按"新增成熟标签/更新数"预算，不按 wall time。
3. 每轮固定不变：种子命名空间规范、显式 stepSeed、一致性五计数、反作弊平行世界、191 项测试+规则锁、97.5% 双侧块区间+两次 attempt 上限、全账本落盘。

## B1. 优先级队列

**P0 解锁外部参照 DanZero（决定后续一切排序，本身不是训练）**
- 前提：用户授权在隔离 venv 添加 numpy（仅解包用途，不进运行时）。
- 步骤：受限解包 ckpt（预期 12 numpy 数组、6 层 567→512×5→1，与早期 pickletools 反汇编核对）→ 移植其原生观察/动作编码 adapter（禁止把本项目 385 维直送）→ 100 个代表决策的映射/合法/边界检查（复用 T0 状态池）→ 32 块 dev（N+N vs D+D、N+H vs D+H）→ 可分辨则 128 块 confirm（事前定样本，不中途择时）。
- 预算：adapter ≤2 个工作会话；评测 ≤30min 运行。
- 三种结果的分支：D 明显强→进入弱点诊断循环（P3/P4 视证据）；相当→当前配方接近达标、P2 长训优先；D 明显弱→如实报告参照分辨率，P1 优先。
- 若用户不授权：跳过 P0，P1/P2 照做但"天花板未知"持续。

**P1 观察编码缺口单因素实验（每轮 ~110min，先做缺口 1）**
- 缺口 1（stage 生效级牌信号）：现编码只有两队级数 2 位+我手中万能牌张数。补法：stageTeam 1 位+生效级牌点数（归一化标量 1 位或 14 位独热，先用标量——增量最小）。encoderVersion bump 至 v2（INPUT_DIM 385→387）；新模型用新配套、对照用各自配套整场对打。
- 缺口 2（进还贡公开牌归属）：物理 54 位之外加 2 位"我已知贡给谁/收了谁的牌"或 54 位归属掩码——先用 2 位粗粒度。
- 判据：M1（新配套 vs ck-7051 旧配套）+ 若 P0 已通则加 vs D 变化；dev 曲线对比同预算学习速度。
- 每个缺口单独一轮，不叠加；两轮都过再考虑合并。

**P2 长训 14,102 updates（2×）**
- 前提：P0 产生分辨力证据，或 P1 任一缺口实验显示正收益；否则不消费。
- 参数：完全同配方（ε0.05、group2048/sub1024、RMSprop lr1e-3 恒定、8workers/wave8）；预计 ~206min。
- 检查点：500/1000/1800/3600/5400/7051/10000/14102（前段加密定位拐点）。
- 判据：M1 vs ck-7051 + dev 曲线是否仍在爬升；若 7,051 后曲线已平，如实记录平台期并停止加量。

**P3 策略池混合自博弈（仅当出现具体偏科证据）**
- 触发：对 D 或异质搭档某类局面系统性弱（需 P0 或异质搭档诊断支持）。
- 参数（执行令 §9.2 原样）：两臂从同一 ck-7051 父权重+优化器状态出发、各 1,800 updates/60min；pool 臂配比 60% 全自博弈 / 20% vs 冻结 O / 20% 单席+H 搭档 vs 双 H；共同检查点 600/1200/1800；S 开发门比父高 ≥5pp 才申请 confirm。
- learnerSeatMask/各席 policyId/行为版本全记账（只学可学习席位产生的标签）。

**P4 BC 辅助微调（条件最严，缺一不执行）**
- 前提：KSCB 解码通过 + 反复出现的具体排序错误类（合法合理动作存在但排序欠佳，非仅 top1 不一致）+ 5 万状态内冻结子集与按 match 隔离的留出集。
- 参数（执行令 §9.3 原样）：loss=logsumexp(Q/τ)−logsumexp(Q/τ over 认可集)，τ=1，按状态平均；新建 RMSprop lr=1e-4、批 64 状态、≤1 epoch、≤15min；候选多分块计算不截断；随后 DMC 1,800 updates（新优化器、BC 状态不带入）；BC 后 Q 只作排序分不称校准回报。
- 判据：独立留出认可率不低于 control + M1/M2 不退化，双门齐过才算。

**P5 扩容（最后）**
- 触发：P1 信息补全 + P2 平台期仍差。
- 方案：256→512 宽（164,865→460,801 参数）优先于加深；前向成本 ×2.8、采样吞吐预计降至 ~3,600 标签/s（7,051 updates 变 ~160min，可接受）；MPS/GPU 在此规模重测一次（小模型下 CPU 优势结论不外推）。

## B2. 基建参数的既定依据（为什么不再动）
- 波同步 waveSize=8：行为滞后≤1 波（~4-5 updates）、短学习对照 3× 速度且 loss 同量级——同步等待不是瓶颈，不引入异步/V-trace。
- 8 workers：实测 +53.2%；16GB 内存余量足。
- CPU-only：MPS 实测慢 2-3 倍（模型太小，kernel launch 主导）。
- 复用率 0.5（1024/2048）：沿用 round2 A/B 结论（1.0 更差且更慢）。
- ε=0.05 恒定：沿用 DanZero/DouZero 常规；不与产品难度 ε 混用（产品档位用近并列随机，非均匀乱打）。

---

# 附篇三：复盘能力现状与后续计划

## C1. 已交付（全部可打开验证）
1. 四层分工定型：记录员（引擎事实）→ 裁判（**ck-7051 候选排名，非客观最优**，部署切换后自动换新）→ 信息集比较（64 份暗牌均匀重发、实际/替代配对续打、g 主指标、假设如实标注）→ 解说（GLM 只引用证据卡，六类校验+一次重试+降级事实卡）。
2. 统一证据对象 DecisionReview：recordId/decisionId/观察哈希/候选集哈希/覆盖匹配（actionIdentity 四处同源）/模型排序+权重哈希/单步结构事实/续打证据/claimLevel/冲突/缺失/允许表达范围；facts+actionTexts 程序渲染。
3. 三个"胡说八道"病根修复：万能牌局重建错乱（60 局 2→0）、同牌异声明误配、压不过崩局。
4. 缓存版本化（coach-json-v1）+LLM 账本跨阶段累计（5/6）+五局真实局验收全过零重试。
5. R4 试点 6 决策点 64 样本 0 拒绝，配对差全量输出。

## C2. 已知未解决的问题（诚实清单）
1. **页面未渲染新证据对象**：ReviewPage 仍是旧四层呈现；数据与缓存全在，纯前端接线未做。
2. **双来源并存**：单次确定性推演（R1-D 口径）与信息集抽样均值同屏时，prompt 有"分清事后情景 vs 抽样均值"铁律，但验收局未覆盖两者方向相反的冲突场景。
3. **判罚理由仍未进剧本**：启发式只有偏好说明 note、无逐项评分分解（analyzer 无此导出）——GLM 对"为什么"的解释仍是推测，靠 claimLevel+禁判罚语压制，未根治。
4. LLM 调用未传 temperature/seed（Anthropic 端点 thinking disabled 已固定）；跨服务版本不保证逐字复现，缓存键已含 prompt 版本。
5. 信息集的均匀分配假设：64 样本不能消除分布偏差；续打策略固定 heuristic:mid，换续打策略结论反转须依赖"依赖续打策略"标注（已入表达范围，未实测反转例）。
6. acc-uncovered 验收为回放降级型不可评；exact+uncovered 型未在验收局出现（82 种子扫描未遇到）。
7. 旧口径记录（schema v1/无声明）复盘时正确降级拦截，但用户会看到"该局不可复盘"——缺一句解释性文案。

## C3. 复盘线后续计划
- **R-a（最高优先，一个前端会话）**：ReviewPage 接 DecisionReview——事实卡优先渲染、lessons 按 ID 引用、冲突双列呈现。
- **R-b**：同手双来源方向相反时页面强制并列+标注（把 REVIEW2 事故的"仲裁层"要求落到展示层）。
- **R-c（根治 C2-3）**：scoreCandidates 增加"评分项构成"导出（top3 候选各命中哪些加分/惩罚项），作为可验证事实进剧本——消除 GLM 推测空间。改动小（heuristic.ts 内部已有结构，加导出+测试）。
- **R-d**：用第 6 次 LLM 额度补一局定向验收（构造"双来源方向相反"局，标注 provenance=constructed）。
- **R-e**：旧记录进入复盘时的差异说明文案（规则口径差异列表）。
- **R-f**：裁判层随模型换代的验收循环规则（每代上线重跑 5 局验收、LLM 额度如何滚动，需定规）。

---

# 附篇四：请复查者裁决的问题

> 2026-10-27 用户定调：页面/接线/文案/校准这类一般工程项由本项目自行完成，不占用复查视线。原问题 5（判罚理由导出方案）与问题 6（D1 ε 网格细化）撤回自办；附篇三 C3 的 R-a/R-b/R-e、C2-6/7 的补扫描与文案、部署后浏览器冒烟、Q9 抽样验证均属自办项。以下只留真正需要研究判断的问题。

1. 晋级稳健性：M1 attempt1 54.3%（未过门）→ attempt2 57.4%（过门），两次全新种子点估计波动约 3pp——按令"最多两次尝试、第二次全新种子"我判晋级成立。你是否认同，还是认为两 attempt 合并解读应更保守？
2. 记账 bug（ages 出生版本置 0）下两个 run 的账本数据可用性判定：训练语义零影响的主张是否成立（样本内容/顺序/种子均不受该 bug 影响，仅统计字段错误）。
3. P1 编码实验用"各自配套整场对打"做新旧比较（新旧编码不可直接互喂）——此口径是否可接受，或需要额外对照？
4. 本轮 57.4% 含三个变量合力（规则世界/候选 v2/并行协议），未做单变量消融——是否值得补（每补一个变量≈一轮 103min 训练+评测），还是接受"产品包代际差"口径？
5. P0 若用户不授权 numpy：外线继续搁置、内部改进（P1/P2）先行——这个降级排序你是否同意？

---

# 附篇五：自办 11 项执行结果（2026-10-28 凌晨，用户定调"不进 ChatGPT"，方案经子智能体复查后执行）

已全部完成（198/198 测试、typecheck 绿）：三档难度上线（难度只作用两对手/队友满血/神经开关删除、新 AI 默认）；继续比赛按存档口径恢复；heuristic 评分构成导出（Σ=score）；复盘页证据卡上线（双来源续打+方向冲突强制并列+旧口径横幅+信息集 64 份按需算+干净局兜底）；提示两行来源标注；review2case 权重口径修复（复查发现的真 bug）与 recordFile 通路；浏览器整局冒烟（aiPolicies 逐席正确）与 Q9 真实局对账（证据牌张与原始记录逐张一致）。复查抓出 14 项（6 阻断）全部采纳修复。

## 两个遗留的定性（自查结论：均不提交你方出方案，如不认同可反驳）

1. **exact+未覆盖型验收局未找到**：扫描 1300+ 自产局（含高级学生）零命中。定性=这是候选 v2 与回放修复的**自然结果**（该场景类型的两个根源已消除），不是待解决的问题。处置：不构造冒充（按令 provenance 纪律）；uncovered 档的表达规则由校验层强制（有单测）；该类型若在真实对局中重现，按 R-f 规则用当轮额度验收。
2. **第 6 次 LLM 额度被权重切换的重验消耗**：换部署权重→缓存键含 weightHash→旧 5 例全部正确失效→额度花在列表首位（acc-incident-like，validated，提示词已含双来源格式）。定性=缓存语义正确、账目如实，非事故。冲突局（82048 m23，双来源反向）证据层已就绪并验证。处置：需定的只是**额度滚动规则**——我方提议"每代模型部署=新验收周期（6 次），周期内累计不清零"，属治理规则由用户批准即可，无需研究输入。
