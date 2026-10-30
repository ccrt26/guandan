# 掼蛋 AI 分阶段调优实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户要求所有方案和执行计划经子智能体审核；本计划采用主智能体实施、独立子智能体审查计划与实质变更，不强制每个小任务另建实现代理。最新用户授权和本计划的减负规则优先于通用技能中的重复审批、重复全量测试建议。

**Goal:** 实际训练、评估并交付更会配合的本地掼蛋AI；如实报告未达标，不以工程通过替代能力。

**Architecture:** 复用现有规则、合法信息集、完整match模拟、399维MLP和损失。增加薄的REVIEW6.2训练/教学/评测入口，用可恢复小批学习和独立开发测量迭代，最后运行固定标准的正式确认。

**Tech Stack:** 现有Node/TypeScript/tsx、Python/PyTorch CPU、JSON/JSONL和原子检查点；不新增云服务或平台依赖。

**Spec:** `/Users/ccrt/game/guandan/docs/superpowers/specs/2026-10-29-guandan-review6-2-design.md`

## Global Constraints

- 本轮是复核与计划交付；以下复选框未勾选即尚未实施。下一轮用户采用本计划后开始执行。
- 删除72资源小时总准入门，不修改旧账；默认4小时可恢复窗口，窗口结束承接同一run。
- 探索训练无需先有100条强标签、六个run、全部封存答案或联合功效模拟。
- 保留最终60家族75根、51/60及各12/15、24严重家族、主比赛+0.03及所有分组/M1/M2门；定义详见设计。严重旧24缺件按明确替代条款处理，不能静默替换。
- 数据split按来源家族；未知暗牌只由环境持有，不进入学生或LLM观察。完整g+W奖励只能等match真正结束后回填。
- A/B用同一U0、配置和开发种子表；初轮唯一学习差异是B的教学偏好项。
- 不重跑完整历史18根先导/40更新，不重新拟合旧H，不把已开题重新命名为封存。
- 模型、优化器、队列、RNG/游标、标签曝光必须恢复；失败记录不覆盖。
- 使用现有工作树时先保留未提交内容。若隔离，必须把已核实的未提交实验代码纳入起点，不能只从旧HEAD开空worktree然后重写已有工作。
- 所有科学阈值改变必须写入差异表并经过子审；普通实施细节和同等结果的性能优化自主处理，不每窗问用户。

## Review Focus

1. 多worker热更新后仍使用上一模型缓存：T2核相同输入的模型版本、Q和动作。
2. 写完权重但未写游标时崩溃：T1核事务检查点、断点重放及更新不重计。
3. 只有弱标签时归一化抵消权重：T3核总偏好项确实是强标签版本的0.25倍。
4. 条件对改变不可见信息或构造不可能牌账：T3/T5核可见变化、完整合法历史与家族归属。
5. 正式候选选了未验证第三动作、超时或缺失：T5/T6固定分母，记unverified/timeout/missing，禁止改题凑通过。

## 文件与接口边界

新增目录`lab/review6_2/`只放新入口与必要消费者，不复制整个旧目录。预计新增7个核心文件：`run.ts`（CLI与阶段检查）、`train.ts`（采样/训练/恢复）、`learner.py`（可恢复持久学习器）、`teacher.ts`（教学卡与分级标签）、`evaluate.ts`（开发/正式比赛与技能）、`protocol.ts`（少量输入与身份检查）、`config.json`（运行配置）。实际实现可合并很小模块，不为凑结构拆文件。

必要小修改：`lab/review6/training_core.py`可选教学权重；`teacher-engine.ts`分支可选推理模式；`compute-pool.mjs`若实现持久池则保留旧一次性接口；`paired_stats.py`复用核心bootstrap而非复制。先确认纯函数没有顶层历史启动副作用。

每次run统一输出`lab/review6_2/runs/<runId>/`：`manifest.json`、`events.jsonl`、`checkpoints/`、`development.jsonl`、`summary.json`。每个检查点一个完整状态包与模型文件，避免给每个字段各造一套收据。状态字段不明时用null或未实现，不预填通过。

下文命令是**待T1实现的接口规范**，不是当前已存在可直接执行的命令。当前旧`node lab/review6/run.mjs --help`明确有not_implemented，禁止把它当完成证据。

## T0 接管与本轮规则落地

**Files:** 根`AGENTS.md`、本目录设计与计划、`deliverables/review6-2-audit-20261029/execution-policy.json`；新增`lab/review6_2/config.json`与一次增量源码清单。

**Consumes:** 当前未提交工作区、旧模型/旧账/已完成先导、子审结论。

**Produces:** 新run可使用的代码与政策身份、独立数据分区引用、具体可启动任务；不虚构“已恢复原24”。

- [ ] 读取本计划、设计、最新用户指令、审核闭环；如果存在未关闭的结果正确性问题，只阻断相关任务。
- [ ] 读取`git status`并保存一次本次要动文件的增量备份或明确提交；不覆盖用户原改动，不复制全部lab、venv、node_modules。
- [ ] 配置U0/O完整政策身份、train/dev/sealed来源索引、worker默认4、Torch线程2/interop1、窗口14400秒；内存和磁盘阈值按实际设备可用量设置并记值，不编造硬件配置。
- [ ] 记录旧账16.359528小时为历史口径，`hardTotalResourceHours=null`；新墙钟/worker/可用CPU计时/外部费用分开。确认无新增付费API。
- [ ] 对旧24仅查原始索引、已知原资料路径和备份，列缺件。恢复失败时按设计登记`severe24-v2`变更，继续训练路线，不让缺原件堵住所有工作。

**验收：** 清单能定位现有可复用代码；不重复C0-C3全部审计。下一任务是T1，不能把T0或文件齐全宣布为能力成果。

## T1 做出可持续训练和真实恢复闭环

**Files:** 新`run.ts,protocol.ts,train.ts,learner.py`；复用`training_core.py,training-collector.ts,mature-match.ts,mature-queues.ts,python-rpc.mjs`。

**Interfaces:**

```text
RunConfig: runId, protocolId, parentPolicy, arm, seed, updateTarget,
           windowSeconds, trainSplitRef, devSplitRef, teacherSetRef,
           opponentRegistryRef, checkpointEveryUpdates, outputDirectory
runTraining(config: RunConfig, resumePath?: string) -> RunSummary
learner RPC: init | restore | step | save | close
checkpoint: model, optimizer, rngStates, queueSnapshot, sourceCursors,
            pendingTasks, absoluteUpdate, teacherExposures, configIdentity
```

- [ ] 先为真实故障写少量行为检查：连续4步与2步后恢复再2步一致；未提交事务不会双计；加载错误维度/编码被拒；dev/sealed标签被拒；未完成match不产生y。
- [ ] 实现配置化持久学习器，移除新入口对历史TASK、4根、20步的硬依赖。复用原loss和优化器，不借此重写网络。
- [ ] A先用真实成熟样本完成2步，B用经核的训练标签完成2步。T1可只读复用旧4条开放先导标签作新入口的smoke fixture，先核来源未属dev/sealed、语义和399身份，再标记`fixture_only`、不计新教学根、不作为正式训练题或考试；T3完成后B正式训练改用新的train标签集。若无法核实则另从合法训练来源准备一个最小fixture，A恢复检查可独立继续。这用于新生产链路测试，不能把旧20步再跑一次叫新增研究。
- [ ] 实现原子checkpoint与resume。固定同设备同配置时比较权重、优化器step、队列、游标、下一批样本ID；若平台有非确定性，事前写明数值容差并核动作一致，不事后随便放宽。
- [ ] 把必要强制检查接到实际`train`、`resume`入口：split/模型身份/合法数据/有限值/成熟目标/重复任务。导入policy.json的强制语义，不只是打印它。
- [ ] 进程超时保存或安全退出自有任务；复用现有可靠关闭能力。检查一次父任务退出后无遗孤，正常训练不反复故障注入。

**待实现命令与成功含义：**

```bash
node --import tsx lab/review6_2/run.ts train --config lab/review6_2/config.json --run smoke-A --arm A --updates 2
node --import tsx lab/review6_2/run.ts resume --run smoke-A --updates 4
```

`--updates`表示本run的绝对目标更新号，已达到时no-op并报告原状态，不能暗中多更新；`--run`存在则train拒绝覆盖，只允许resume。B的smoke另以`--arm B`及fixture专用配置启动，所有smoke检查点不进入正式训练父模型。成功不是退出0，而是新增成熟更新、有效检查点和连续性对照通过。T1失败只修这一闭环；不去增加审核平台。阶段报告应给用户一个真实可恢复run。

## T2 消除已发现的重复开销

**Files:** `train.ts,teacher.ts`；按需小改`compute-pool.mjs,teacher-engine.ts`；复用`exact-inference.ts`。

**Interfaces:** `evaluateTeacherBranch(..., inferenceExecution='original')`保留旧默认；新入口显式选`exact-prefix-v1`。持久池任务带完整`policyVersion`，换版本时清缓存并确认加载。

T3尚未创建teacher入口时，T2只修改现有`teacher-engine.ts`的可选推理模式，并以开发fixture测量，不为等T3生成空壳平台。T2非关键优化未完成不阻挡T3/T4。

- [ ] 新入口默认清除`NODE_DEBUG`，不输出模块树；常规日志只留进度、总计、异常和代表失败样本。日志达到配置大小轮转，不能悄悄删原始正式结果。
- [ ] 使用同一小组开发局面/seed检查原推理与fast的全部Q、动作、轨迹一致。出现任一差异就回退该优化，训练可继续用原模式。
- [ ] 只对16至32个固定开发match计时，拆出启动/加载/模拟/推理/学习/写盘；这是性能微测，不是胜率比较。
- [ ] 若重复启动占比显著，改常驻worker，权重按版本推送；验证连续两版和A/B切换无旧缓存。效果不大则保留简单版本，不继续做重架构。
- [ ] 根动作教学模式仅计算有消费者的A/B分支；在T3强标签复核仍保留两续打配置与完整g+W。Plan尾部单独研究时才启用，不追改旧先导。

**验收：** 相同输入输出一致、测得端到端吞吐和内存；禁止预写“提速数倍”。T2与T3无需等待全面性能优化做完才开训。

## T3 让人工建议和模拟教学真正进入梯度

**Files:** `teacher.ts,protocol.ts,learner.py`；`training_core.py`添加可选`teacher_weights=None`，默认全1保留旧行为；新增少量`lab/tests/review6_2_teacher.test.ts`和Python行为检查。

**Interfaces:**

```text
validateTeachingCard(card, sourceIndex, engine) -> ValidCard | Rejection
makeWeakLabels(cards, frozenStudent, trainWorlds) -> LabelBatch
makeStrongLabels(cards, independentWorlds, profiles) -> LabelBatch
importLabelBatch(batch, expectedSplit='train') -> TrainingLabelSet
```

- [ ] 先锁训练来源家族，优先采学生实际首选分歧和可修正错误；记录未入选原因，不从正式考试挑错回流。
- [ ] 执行者按设计生成结构化建议卡；可以使用用户真人建议，但不能要求用户先标几十题。LLM仅给建议，无外部付费调用为默认。
- [ ] 引擎重建局面与候选、验证建议在合法动作集合、验证条件变化历史可达；399特征由程序生成，不直接相信卡片提供的浮点数组。使用rootKey合并同根多来源/多pair；tie/abstain/conflict不消费有方向偏好。每batch每来源族最多一个根；依赖未编码公开信息的卡单独隔离，条件对不能把不可见变化当需要改动作的理由。
- [ ] 首批默认最多16根；真人/LLM合法明确建议可0-world直接作为weak。只有rollout来源weak采用固定探索预算例如每根32世界两动作配对；完整match失败、信息集不可采、均值近零的模拟记录保持不确定，不能凭空补赢家。无模拟卡不得写已验证团队收益。
- [ ] 强标签按256/128独立验证世界和原根动作支持门制作；搜索/选择世界不混入验证；主lower>0.02、次lower>0。这里不减少最终强证据要求。
- [ ] 修改loss按根平均加权，强1、弱0.25；测试同根弱版本偏好项是强版本0.25倍，且根内多动作对不能提高该根总权重。
- [ ] 运行一次B真实更新，检查teacher IDs确实消费、加权偏好梯度和参数更新，记录全候选首选前后。梯度非零只是接线证据，随后必须进入T4。

**验收：** 有至少一个经合法性检查的真实教学信号被正确消费；不用“凑100强根”作开训门。可用根不足时继续采下一批，不反复同4根冒充扩充数据。

**待实现命令：** `node --import tsx lab/review6_2/run.ts teach --config lab/review6_2/config.json --input <训练建议卡JSONL> --tier weak --out <新标签集目录>`；strong模式走独立验证。已有输出目录拒绝覆盖，汇总列接收/拒收/不确定及原因。

## T4 第一轮A/B与持续改进

**Files:** `train.ts,evaluate.ts,config.json`及run输出，不先做新UI。

**Interfaces:** `evaluateDevelopment(policyRefs, devManifest, nBlocks=32) -> DevelopmentReport`；输入O、U0和同终点A/B，输出每家族选择与完整比赛指标，列相关样本量。

- [ ] 固定第一对A/B的同一U0、种子和配方，各100更新；A无偏好，B有同批教学。保留原桶配比、半采样、团队奖励和优化器。在线轨迹分化正常，不把两臂视为逐样本相同训练。
- [ ] 与开训并行准备训练外开发局面，默认20家族四类各5；缺题不阻断训练与完整比赛测量，覆盖不足照报。弱标只报建议一致，不报“正确”。首个checkpoint各项覆盖与未验证要可见。
- [ ] 在同一开发配置上测O/U0/A/B的全候选动作；对候选跑配对完整比赛，默认32基础块，每块三搭档×新旧×换边，另M1/M2各32换边块。小样本区间宽正常，不能当正式通过。
- [ ] 将未见开发差异与训练题变化分开：全候选动作没变但分差增大，不算学会新行为；动作变但整场变差，优先诊断错教或遗忘。
- [ ] 有方向性收益且无新的严重问题则同run继续下一100更新；每批新教学先按学生训练轨迹找分歧，保留训练家族归属。看了开发集后为它定制的相似题都属于开发衍生，不进入“未见成绩”。
- [ ] 连续两次无实用改善，按下方故障表做一次单变量诊断；选择有理由的改动，记录假设与比较。不要同时换网络、奖励、搜索和数据，导致无法判断什么有效。
- [ ] 路线有用后按需补两对种子判断稳定性。若A更好，保留A也可继续产品路线，但教学有效性结论为未证。候选选择用预定共同开发终点，不能在无限checkpoint里只汇报最佳瞬间。
- [ ] 沿用现有评测输出S与J作为过拟合诊断，保留U0/O参照，不将原三对研究选拔法当探索训练前置；J接口未接时明确未测并补薄接线。不得将缺J结果写成已过原开发门。

**每段必须交付：** 标签新根数/强弱/来源、实际更新、恢复命令、训练与未见开发表现、完整比赛结果或明确未测、下一具体动作。只有工程日志不能关闭T4。

**待实现命令：** `node --import tsx lab/review6_2/run.ts evaluate-dev --config lab/review6_2/config.json --run <真实runId> --blocks 32`；输出固定开发manifest身份及实际checkpoint。`status --run <真实runId>`返回更新号、已提交checkpoint、最近开发结果和下一恢复命令，不能只返回预设阶段名。

## T5 同时补齐最终考试工具与答案

**Files:** `teacher.ts,evaluate.ts,protocol.ts`；复用`capability-lineage.ts,paired_stats.py,variance-layout.ts`，新增正式manifest而非另建平台。

**Interfaces:** `buildExam(sourceQueue, ruleContract) -> ExamManifest`；`scoreSkills(policy, sealedManifest) -> SkillResults`；`validateConfirmationInputs(candidate, exams, matchPlan) -> Ready | Reasons`。

- [ ] 构题只能依预锁来源与规则，不看新候选成绩筛题。60家族=45单根+15条件双根；资源与条件配额按设计，不由执行者自由改数字。
- [ ] 保存合法动作集合、supported集合、contradicted集合、unverified集合及证据。枚举多个合理动作，避免只接受一个字符串；标签不完备时显示未验证，不强判错误。
- [ ] 正式答案用同完整目标、双续打与强证据契约。先制作少量题并验证生成/统计/评分闭环，再按批扩展，避免训练结束才发现做不出题。
- [ ] 恢复原24映射，或按已采用的新24替代条款建立`severe24-v2`。覆盖不得只挑容易题；24不同家族，条件对计数明确，跟60集重合如实列明。
- [ ] 没有足够强标签时，继续构题/改独立生成器，不降低门。最终发布仍未就绪，但训练和开发可以继续。
- [ ] 在正式运行前固定统计协议：默认2695/262/1047块、bootstrap20000、type7、合作alpha=0.05/3、M1/M2 lower q=.0125。不新增“联合80%”硬门。任何减少N必须先有独立设计和子审。
- [ ] 正式搭档ID与四席组合沿设计及旧no-H注册表锁定，检查confirmationPartners未进入本轮训练/教师/调参。M1=N+N对O+O；M2使用固定legacy heuristic H，禁止替换成失败的人类代理。协议同时保存公开的历史共享谱系限制。
- [ ] 实现缺失、超时、不完整块、错误候选身份、split冲突、旧题重复的拒绝路径。不同策略实际执行同种子配对，不把“旧对旧50%”当基线能力。

**验收：** 小型开发fixture能覆盖全部结果类别，正式来源清单与强答案完整且未向训练/选模型泄漏。schema/空JSON不算工具完成。

## T6 固定候选正式确认

**Files:** `evaluate.ts,protocol.ts`、`candidate.json,confirmation.json`与原始逐块结果。

- [ ] 只用开发结果选一个候选，冻结完整政策身份。候选参数与在线搜索配置都不能在确认中改变。
- [ ] 技能、严重例、比赛共同登记一个attempt，在任一正式结果打开前登记；承接旧计数，不换日期归零。
- [ ] 分段跑足预定固定N。技术中断原位恢复，已完成块不重复计入；不因为赢得多提前停止，不用新seed替换难局。
- [ ] 逐项验60/75、24、主增益/分组/M1/M2；正式非法/信息泄漏/身份错配立即判相关结果无效，修后按污染规则处理。
- [ ] 全通过才状态`qualified_candidate`；一项未知就是未完成，一项未达就是未达。不把合法未验证动作混为已证严重错，也不把未验证当已通过。
- [ ] 未达后将用过考试退为诊断，定位新假设，继续开发。若再确认，必须新题新来源；3次机会用完后仍可开发，再确认须用户明确采用新研究设计并处理累计误报，不自动新赠3次。

**待实现命令：**

```bash
node --import tsx lab/review6_2/run.ts lock-candidate --run <真实runId> --checkpoint <真实checkpoint>
node --import tsx lab/review6_2/run.ts confirm --candidate <候选清单路径> --attempt 1
```

命令中的占位符必须由实际产物替换。无具体文件不能称“已可执行”。

## T7 候选交付与网页验证

**Files:** `packages/ai/src/nn/nnplayer.ts`及必要模型选择代码、`packages/web/public/ai/`新候选、版本状态；沿用旧模型备份。

- [ ] 发布前跑一轮`npm test -- --reporter=dot`、`npm run typecheck`和`npm run build`；仅修改文档无需重跑。实验lab专项行为测试按改动范围运行，不能以四包typecheck冒充lab全绿。
- [ ] 检查网页加载399维候选时的编码、pass、候选集合、规则与难度一致；不把399权重直接覆盖385文件。
- [ ] 有部署授权则切换实际默认牌手并读取网页实际加载文件/hash与policyId；尚无部署授权则交付可审阅候选包，不提前写“已上线”。
- [ ] 实际页面走一段对局与复盘，验证模型加载失败时明确提示，不静默回退却显示新AI。
- [ ] 报告12个预定开发示例、至少一个仍不足或最低余量例；展示原/新动作与条件。正式成绩按真实benchmark版本标注，真人适配未测就直说。

**验收：** 交付身份=验收身份=实际加载身份，能恢复旧模型。开发候选、合格候选、已部署三个状态不能混同。

## 故障处置表

| 发生的事 | 默认处理 | 何时继续/需重新审核 |
|---|---|---|
| 标签少、统计不显著 | 降为weak或unverified，采新的训练分歧；不叫答错 | 合法弱信号可继续探索，强门不改 |
| 全候选动作不变 | 查教师是否本来同意、动作对是否覆盖实际首选、梯度是否被冲淡 | 单变量调整来源/权重；变更loss需增量子审 |
| 训练题改善、开发退步 | 回到最近良好checkpoint，减少弱源/曝光，加强来源多样性 | 相同开发对照重新比较；不用封存调参 |
| 胜率小样本摇摆 | 保留区间，按预定开发节奏继续 | 不把小样本负差自动判失效，也不挑最佳点 |
| 某搭档明显退化 | 查桶配比、过度自配合和来源偏差 | 局部诊断；最终分组门保留 |
| 表示不足 | 做同编码但不同正确决策的见证；先补最小公开特征 | 改编码须新身份/迁移与公平对照；GRU不是默认 |
| 池缓存错版本或fast不一致 | 禁用该优化，保留样例 | 原推理可继续；相关产出隔离重算 |
| NaN/非法/牌账错/泄露 | 停受影响run，保存最小反例，修正后从最后有效点继续 | 相关强标签与评测结果失效；不重新造全项目 |
| OOM/磁盘满/热降频 | 停当前自有任务并保存，减少并发/日志/批量 | 保持相同随机流与身份；硬件迁移另记录 |
| 超时/控制器死 | 结束自有进程组、原子checkpoint恢复 | 只重做未提交任务；未完match不计输赢 |
| 连续无进展 | 一次定向诊断，给新假设及验证 | 没有新假设就诚实报告路线失败，不无限空转 |
| 原24找不到 | 登记缺件和新的严重基准变更 | 新方案采用后按v2，不能称原24已通过 |
| 正式不达标 | 保留旧牌手、报告差距，已开题降为诊断 | 新来源下一attempt；不能修改本次答案 |
| 子审意见冲突 | 要求文件/数据/反例证据，主执行者写取舍 | 结果正确性问题先解；纯风格偏好不阻断 |
| 计划外故障 | 判断是否影响目标/信息/数据/统计/发布身份 | 局部技术修复自主做；实质方法改变走增量子审，不私自改目标 |

## 时间与成本的使用方式

第一轮实施工时尚未实测，不能给保证完成时刻。基于既有测量，100强标签原法约76.9至92.6资源小时的外推和一次正式比赛约10.44资源小时仍可作为“不要原样铺满”的参照，不能作为新方案报价。

T1至T3先用小任务拿到实际吞吐；每段最多4小时，正常窗口结束自动保存并按已授权计划接续。记录段开始/结束、匹配场数、新根、更新数和工程耗时。耗时明显异常先定位当前任务，不使用新拍脑袋总小时门再次封死目标。

每个工程阶段必须交付一个后续学习实际会消费的功能；不得以“需要更完整的审计”无限延长。已完成且未变的先导和测试复用。若完整路线需多天，分段报告真实进展，不把“长”直接判成不值得做。

只有付费计算、新硬件、不可逆数据操作等超出现有授权的变更才请用户决定；普通本地训练续窗不用再申请一点点额度。真正环境额度用完或会话终止时保存状态与下一命令，如实说明，不能保证无人值守自动唤醒。

## 交接核对

- [ ] 设计与计划全部经过子智能体审查，阻断问题关闭；重大修订做差异审查。
- [ ] 执行报告列已完成/未实现/未运行/未达标，不能只给“完成百分比”。
- [ ] 教学卡导入、真实更新、未见开发、正式考试、候选交付都有对应产物或明确缺口。
- [ ] 用户的7项疑问逐一回应；没有把研究目标改成“过程合规”。
