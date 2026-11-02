# 掼蛋项目执行约束

## 当前软件交付入口（2026-11-01）

<a id="current-software-delivery"></a>

现行正式入口为需求与方案同业务版本 5.3.0，以及独立模型迭代说明 1.0.0；不能拼接旧版本作为执行步骤：

- **《掼蛋项目实施方案和执行计划文档_v5.3.0.docx》**：Library `libfile_3f00fde4b97481919c96e65c185d5e4b`。保留由需求解读得出的**当前需求明细**，并给出实际模块、实现步骤、测试与交接/完成条件。
- **《掼蛋项目需求文档_v5.3.0.docx》**：Library `libfile_5d7f7f95fcf08191a9389c59c86a63ea`。保存需求来源、原话、需求解读、变更与历史审核，通过稳定 U/R 编号与方案明细对应；方案同步保留由这些解读形成的当前需求明细。

- **《掼蛋项目模型迭代说明文档_v1.0.0.docx》**：Library `libfile_ffb729e85ea88191b4aaa416f044d762`，区分编制基线、科研来源、正式产品与实际运行身份。

本步实际使用的 Library version/SHA 由已核准 NAV-00 或精确 HANDOFF 固定；业务版本不等于 Library 历史版本，不把滚动状态反复复制到本说明。

当前事实查既有《ohuo_项目背景与交接索引.json》（Library `libfile_a9318b2419108191b779067ffde42d6a`）的实际当前版本、`current_execution_ref`、`sourceBaseline.acceptedCurrentProjectCodeRef`、`currentEngineeringBlockers` 与 `nextSteps`，并核本批真实回件；旧索引快照只作历史，不拿过时 pending 阻断后继。正式文件已保存不等产品或本地说明已应用。旧 [5.2.1 执行计划](deliverables/ohuo-batches/v521-instructions-sync-20261031/execution-plan-5.2.1.md)、原执行包 `libfile_31fa5ef99c44819186f885b396e2dff4` v1 与 5.2.6/v14、5.2.7/v15 审核记录保持历史，不倒改旧 planRef/accepted/SHA；v15 曾有的接线缺口不能当作后继已接受版本的当前未完项。源码审、本地接受、日常启用、文件收尾和远端恢复分别取证。

历史REVIEW6.2的P13停止仅适用于旧训练任务r62-p13-anchor及其原连续执行授权。该任务已于2026-10-29T23:21:02.380Z停止；不得据旧计划恢复P13、进入P14、追加旧研究或部署。旧停止记录及结果保持原字节。它不撤销用户后来单独批准的ohuo v5.2软件开发、程序包接收和规定的本地检查。方案内已授权步骤按有效执行卡推进，不因旧停止记录重复要求用户批准；仅实质偏离方案、超出授权、必要权限或真实工具拒绝按既定规则处理。真实研究/训练按现行方案 R29/NAV-00、该任务实际授权与前置回件判定；已授权且前置满足则续接，未满足的具体步骤保持 `NOT_DUE`，不由软件通过自动启动，也不沿用编制时状态重复审批。当前新局默认已按 S31 授权采用 `auto_latest` 的正式 `ohuo-v1-1031`；用户 `explicit` 选择、旧局/存档 pin 与科学 O 身份保留。GLM 恢复与 DS/GLM 各一次真实连接已按独立授权完成并消费，不能因接收、说明更新或“确认可用”再测；不扩展为新的 API 调用权限。

软件仅做冻结checkId及有实际直接影响的检查，同源未变证据复用。下述旧研究第3项学习产出要求、第12项发布前全套测试不作为B00—B10软件交付前置；软件验证不能证明牌力。真实API、科研比赛/采集、凭据和部署仍受各自有效授权及科学前置约束。科研planClosed和`STOP_AND_DISCUSS_NEW_PLAN`仍只约束其固定科研planRef，不能换taskId绕过；也不跨停不同软件批。真实工具拒绝后不换通道、改审批设置或删记录，文案同步不强迫或保证审批通过。

### 读序与本模块检查

<a id="module-checks"></a>

1. 先读正式方案 §37 **NAV-00**（以章节锚点定位，不沿用旧版页码）和当前固定回件，选出本步；再读该 NAV 指向的准确模块段及 §38 编制/交接合同，不通读历史卡猜下一步。查“为什么需要”才按 U/R 回独立需求文档，查“现在具体做什么”以方案中的需求明细和当前执行卡为准。 已实际读入且身份核准的同版、同范围合同可复用；已审、自包含且固定本阶段必需输入的精确 HANDOFF 足以直接执行对应步骤，不为每一步重复下载/通读整本 Word。只有缺少本步必需的具名条款或输入时，才暂停依赖该缺项的步骤并向原 owner 索取具名补件；读取工具不可用不跨停其他已授权步骤，真实工具拒绝仍不绕过。
2. 本模块 owner 写清用户作用及关键失败，沿真实输入→模块→consumer→可观察结果选最少必要 case。§40 **F01—F25 是对应表，不是全表执行清单**；F号不是新的 CLI selector。每项必须有真实入口/argv、输入与前置、精确预期、执行或同源复用证据、未证层，进入原严格 `checkPlan`，非作者 V 核“少测不漏关键”，O 固定 sourceRef/inputRefs 与本批范围。
3. 当前相关模块按下表接线；表内未来/候选入口须先由本批执行卡确认已存在，不因说明出现就执行，也不把源码已审写成 local accepted。命名、R14、两弹窗/按钮、R15 的本地进展会变化，以各自实际回件更新，不能预填“全部完成”。

| 模块／方案定位 | 最小必要核验与明确不外推的边界 |
|---|---|
| 共享 provider 设置／历史诊断：§39第5项，F04/F16/F19 | 真实 handler＋fake transport/临时 store 核 exactRef、空/旧 binding、未改保存0写、部分失败/并发、历史适用/失效；设置/选择/coach 各 consumer 分层证明。已接受同源证据复用，实际 fresh context、生产 coach DOM、选择页历史时间缺观察仍如实保留；不重测供应商。 |
| 模型命名/标准档：§39命名合同，F14 | 原 `scripts/check-ai-selection.ts`；web 的 `ai-selection-ui.test.ts`、`provider-state.test.ts`、`review-model-display.test.ts`、`seat_display.test.ts` 及 review 的 `seat_display.test.ts`，另 `m-chat-ui.test.ts` 仅已审六个 coach 子集（准确 selector 见表后）。按本批卡核 review/web 类型、web-only build；同生产 ReviewFilters 的既有 DEV 内存夹具一窗七筛选项可达/选中，不打开普通 ReviewPicker 读用户记录。纯 adapter 反例一次＋每个真实 consumer 接线，不训练或改权重。 |
| 牌桌正常呈现/严格本地接续：§39第4A项 R14，F05/F06/F25 | 原 B04 `response-identity` 仅同源复用或受影响 selector；实际 controller/handler 核等待、取消/迟到、明确不可用、输入/身份错误和 commit 未知的真实 origin 到终态。移除手动接手；等待不按耗时推断失败，未知不补手。只原卡具名 finite/fake 组，不复制解析器矩阵或发真实 API。 |
| 已批准两弹窗：§39第8/9项，F15/F24 | 原图/实际 winning CSS、长文本、header/body/footer、焦点及关闭确认；原1280×720与触发宽屏断点最多两 viewport 的真实 BCR/computed/paint，受影响键盘逻辑只核一次。原首页同源证据复用，不重设计尺寸或扩全浏览器矩阵。 |
| 用户手动测试按钮：§39第10项，F17 | 真实 route/客户端/handler＋fake transport/临时 store 核 click 幂等、版本竞态、完整终态/持久化失败、dirty/取消/迟到四组；打开/保存0上游、一次 click 至多一次 fetch，unknown/写回失败不重发。本轮生产只观察可用/禁用，不点击真测，也不称新 Key 已测试。 |
| 余牌数字/单位：§39第4B项 R15，F23 | 目标定向入口 `packages/web/tests/table-count-unit.test.tsx` 的三组：`count values and four-seat labels`、`return-pick 28 and tribute-result visibility`、`shared unit structure and unchanged actions`；实际 GameTable＋合成 VM，不建 MatchController。字体资源身份、状态与渲染按现行 R15 Task A/C5 只读联合方法核，不调用 `fonts.load` 或插入 DOM probe；四席 baseline/gap/BCR由有限浏览器层核，最多当前桌面及1366×768（当前相同则1800×874）；jsdom或静态CSS不能冒布局实测。 |
| 真实混合牌手与复盘：F07/F18/F19 | 配置/认证 probe 不等用户牌局决策提交或真实 coach 报告；旧局 list/load→resume/replay→analysis 使用受控记录、准确 analysisSeat 与固定身份。只有确要作用户真实链可用主张且有独有缺口，才沿原范围取得对应最小真实链证据；本轮不因表存在新开局、读取私局或生成报告。 |

命名卡的六个 coach 子集使用 `npm test -- packages/web/tests/m-chat-ui.test.ts -t '^coach |^review: semantically unchanged'`；只在该批已冻结检查中使用，不运行整文件。

### 当前接收与后继

- 从本批 `deliverables/ohuo-batches/<batchId>/HANDOFF.md` 核实际父、具名文件与冻结 checkId；工程入口见 [M9 说明](docs/engineering/ohuo-delivery.md)，使用 `node scripts/ohuo-delivery.mjs inspect --batch deliverables/ohuo-batches/<batchId>/engineering-batch.json` 查看本批状态，不借通用示例重跑已接受批。只补实际受影响检查，同源未变证据复用；说明-only 差异只核文本、链接、命令存在性与四文件冲突，不跑产品测试或重启服务。
- 新 revision 的 active 结果槽与不可变历史分开。升级前先读取现场实际 active manifest（含已写入的真实失败结果）及 ledger，分别记录实测 raw SHA/bytes，不拿云端失败前 ready 文件的全文 SHA 代替现场。冻结意图必须同时核原 M9 `intentHash`，以及排除**本次明确允许的 `RESULT_KEYS` 子集**后的其余字段全等；`intentHash` 单独通过不足以准入，也不能放宽任意结果字段。当前 B10 r2 已审 `SUPPLEMENT.json`（SHA256 `e25db31ce782439a294f91ffbdbbb05f2a7f6dd877763dbda791adccf784fc45`）仅允许顶层 `unresolved` 为字符串数组的变化；其他字段含其他结果字段必须全等，不放宽 source、plan、authorization、revision。仅对执行卡具名的 `activePath`、新 bytes/SHA、旧值准入规则及恢复映射操作：准入后将现场完整 manifest 原 raw 按实测 SHA exclusive 保存到 hash 命名 history（同名已存在须逐字节相同），ledger 仍按原已审固定映射保留完整原件；核全量保旧与恢复身份后，才原子切换具名新版 active。中断仅据已核 before/after、历史原件与实际切换回执续行，未知字节停止该项，不把新版可变结果冒成旧原件。S31 r2 的 `S31-R2-ACTIVE-CANONICAL-SWITCH.json`（历史区 `revision1/active-canonical-before-r2`）是已完成实例，不是其他路径的通行证；源码冲突、用户数据和不可变回执不在结果槽规则内。首阻快回的最小 payload 同时给当前 active manifest/ledger 的实测 SHA+bytes、是否仅允许结果字段变化及具体 field diff；未测得或无法确认的项如实 `null`，不猜。
- 协调者收到真实回件，核同一批/版本/输入及原执行终态后，直接启动执行卡指定的下一位作者、非作者审核或唯一接收者；缺件只登记具体 producer/条件并继续独立已授权项，不把“已通知/下一步”写成已启动。首个必须云端改源码的本地阻断，立即回最小失败证据及已过/失败/未做清单，安全结束原执行后交原作者定点修、非作者复核、整合，再由原本地接收者续行；不等整组检查或大归档才报告。
- 当前已接受的软件沿 [S31 UI](deliverables/ohuo-batches/S31-UI/accepted-code.json)、[provider 恢复](deliverables/ohuo-batches/S31-PROVIDER-RESTORE/accepted-code.json)、[L](deliverables/ohuo-batches/B07-L/accepted-code.json)、[H](deliverables/ohuo-batches/M0-H/accepted-code.json)、[B10 r2](deliverables/ohuo-batches/B10/accepted-code.json) 原件查询。B10 与 [B snapshot preparer](deliverables/ohuo-batches/B-probe-preparer/accepted-code.json) 的有限软件接收已完成；[provider 共享状态 r3](deliverables/ohuo-batches/S31-PROVIDER-STATE/accepted-code.json) 已限定接受。后继与各层缺口见 [研究目录的工程状态](lab/README.md#current-engineering-status)，不从这些回件推出所有功能、科研或 UI 后继已完成。
- 日常前端固定 `http://localhost:5180`、已有后端固定 `8787`；正常启动/必要更新见 [README](README.md#local-startup)。凡需浏览器先实际尝试 Codex 内置浏览器，核准确 origin、现有能力与真实可行的隔离方式；同命题/前置已完成观察复用，不另把 Chrome/解锁或每浏览器关联设为前置。provider 已由同一后台共享 saved exactRef/历史诊断；实际 fresh context、生产 coach DOM、选择页历史时间仍未观察，不因限定合取证据通过改成 observed，也不重导 Key/重测两家连接。

- 交接仍走 D 窄差异/有限证据→非作者 V→O 固定实际父/manifest→Q04逐件保存→唯一 L 在Q02核真实 before、定向应用/有限接收→确需的Q03同口加载→Q04结果保存/具名后继；源码审、保存成功、传输、应用、accepted、运行采用不能互代。每次保存/上传只提交一个文件，确认其实际ID/version/SHA及可读结果后才处理下一件；unknown先核原操作，不批量重传或另建副本。
- 现行方案已授权的既定任务非必要不停，旧 P13 停止不跨停软件。当前本地同一时间只有原接收 writer；其他云端独立准备可继续，四说明须等同一 L 串行再核四 before，冲突保用户修改回作者/O合并。Git 操作按用户当次明确授权执行，不把它当软件交付前置；原提交/拒绝证据保留，见 [Git 说明](docs/engineering/GITHUB.md)。

当前目录清理仍由用户暂停；下述落位规范不构成恢复清理或删除既有文件的授权。

## 历史 REVIEW6.2 规则（仅旧研究任务）

以下REVIEW6.2规则用于旧研究的AI训练、教学、能力评估和相关复盘工作，不扩展无关UI或新软件交付任务。来源是用户2026年10月29日要求：科学减负、实际调优、允许长时间分段执行、全部方案和计划由子智能体审核。最新用户指令优先。

用户随后已明确采用本方案执行，并要求：遇到方案外且必须与方案有较大出入的问题，先停下来与用户讨论。重大出入不得仅靠子智能体审核后自行决定；计划内常规修复继续自主执行。

旧REVIEW6.2/P13任务的历史收尾指令：完成P13既定训练、评测、必要复核与结果保存后结束该旧任务，不得进入P14或其他新实验，不部署。当时要求不得中断P13，完成后明确报告已停止。此边界覆盖该旧任务此前“继续到最终AI交付”的一般续行授权；后续新工作须有另行授权，现行软件授权见上节。

旧任务最终状态：P13训练400新更新到1800、固定512场开发、独立结果复核和保存均完成，该旧任务已停止。停止记录为`lab/review6_2/stop-after-p13.json`，结果为`deliverables/review6-2-audit-20261029/P13结果与停止记录_20261030.md`。不得将下面的历史连续执行规则当作新的研究续行授权；不P14、不追加旧研究、不部署。

## 旧研究资料入口

核对该旧研究时先读（不是现行软件接收的执行入口）：

- `docs/superpowers/specs/2026-10-29-guandan-review6-2-design.md`
- `docs/superpowers/plans/2026-10-29-guandan-review6-2-execution.md`
- `deliverables/review6-2-audit-20261029/execution-policy.json`
- `deliverables/review6-2-audit-20261029/审核闭环.md`

旧研究的独立复核交付了报告和计划，用户曾采用并授权执行至该次收尾边界。历史研究进度见`lab/review6_2/progress.md`，P13收尾时网页模型尚未替换。此前同一run连续推进窗口的授权已在P13完成后结束；旧计划里的未来命令既不代表已经实现，也不构成当前研究执行授权。

## 必须实际推进学习

1. 附件和历史报告是证据；旧NEXT_ACTION、72资源小时总门、100强标签最低档不自动否定用户本次新授权。旧账及失败结果原样保留，新方法标记REVIEW6.2，不伪装通过旧协议。
2. 探索训练不以“六run齐备、H合格、全封存答案完成、整体预算能装下”为前置。实际存在的合法性、信息隔离、数据分区、成熟奖励和身份错误必须先修。
3. 每段必须有可消费的训练功能、真实数据/更新或实际测量之一，并交代下一步；软件测试数、hash数、文档数、梯度非零不能替代牌力成果。
4. 不因会话切换重做已通过且未变化的18根/40更新等先导。只补当前变更对应的验证。

## 方法和结果底线

5. 只有训练split进入梯度。来源家族及衍生变体不跨训练、开发、封存；当前玩家和LLM建议只能看到自己的牌与公开信息。
6. 真人/LLM建议可以是弱教学信号，不需要H先通过；弱标签不能冒充完整g+W强证据，未验证动作不能自动叫错误。
7. 初轮不同时更改网络、奖励、候选和搭档池。A/B共用起点及开发比较条件；旧网页完整政策另作产品对照。
8. 冻结候选后才正式确认；所有正式门见policy，未知不能填0或通过，失败题不能重新叫新题。旧24缺件必须按设计公开处理，不得悄悄替换并声称原24通过。
9. 只在全套能力和完整比赛通过后称合格；只有实际网页加载身份一致才称已部署。开发改进、正式通过、部署完成分开写。

## 减负与监督

10. 所有方案和执行计划必须由独立上下文子智能体审核。奖励、信息、分区、统计、发布基准或主要表示改变做增量审核。每根/每窗无需双审；风格偏好不能无限阻断。
11. 保留一次运行身份记录、原子检查点、真实恢复验证、自有进程清理。不要新增企业级执行治理平台，不每个任务复制或hash全部依赖。
12. 默认关闭模块debug日志。针对变更做测试，发布前跑一轮全套；文档改动不跑全套。性能优化必须用相同输入验证结果一致，收益按实测报告。
13. 墙钟、worker占用、实测CPU、工程耗时、外部费用分开记录；不以自定义混合额度取代能力目标。普通4小时窗口到期保存并承接，不当项目停止条件。
14. OOM、NaN、非法动作、信息泄漏、身份错配或失控进程只先停止受影响任务，保存最小反例并修。能继续的其他工作继续。连续无收益先诊断，不盲目加量，也不拿预算门掩盖工具未实现。
15. 不擅自购买云服务、付费API或硬件。没有调度器时不能承诺断线后自动唤醒；保存已授权任务状态和可执行恢复命令。
16. 同一source-index的训练、构题、教学验证和比赛任务串行启动；各任务内部worker并行由单一控制器合并。不要并行启动多个索引写入控制器。

这些是正式项目要求。训练split、证据、身份、配置与原子恢复入口现已实现；正式考试、确认与发布守卫按T5—T7的实际完成情况报告，不能把本文件存在当作全套自动监督已完成。若规则与设计冲突，按最新用户指令和已审核差异处理，禁止悄悄放宽最终成绩门。

## 整个项目目录与输出（2026-10-30 用户最新整理要求）

<a id="project-files-and-output"></a>

[项目目录规范](docs/PROJECT-LAYOUT.md) 覆盖**整个项目目录及后续全部文件**，不只本次下载或 lab。产品源码/同包测试进 `packages/<包>`，可复用脚本进 `scripts/`，现行工程说明进 `docs/engineering/`，ohuo 研究与工程实现沿既有 `lab/review6_2/`；根配置、私有配置和环境保持正常工程布局。截图、诊断、下载/解压、导出暂存、build 等一次任务写 `lab/out/<task-id>/`；冻结接收包、manifest、accepted/收尾凭据沿 `deliverables/ohuo-batches/<batchId>/`；最终研究交付写 `deliverables/research/<任务>/`、UI 参考写 `deliverables/ui/<任务>/`；同一治理追加现有治理目录。禁止重新在根、lab 根、docs 根散落实验或交付。既有 REVIEW6.2 HOME 和完整 checkpoint/optimizer/state/manifest 组不拆；封存账本、manifest、原包不改身份。

每次交接在原任务记录中列实际 outputRoot、必要最终落点与 `fileCloseoutRef`，只盘点本任务登记目录和已知新产物；逐项给用途、活动依赖、恢复身份及保留/实际 Trash/blocked 结果。唯一源码、研究证据、恢复资产和仍活动项保留；可恢复、无依赖且原授权覆盖的重复传输/临时项才收尾。已确认 retained 与旧 noop 不倒改，后续真实去向引用原记录；归档不等于已清理，GitHub 有仓也不等于当前文件可恢复。已有治理已完成事实保留，不重新全盘扫描或为“基础完成”删光。

退役工具原文在 `lab/archive/legacy-through-20261030/tooling/src` 及 review2-support/review5-support/review5_tuning；不要在归档目录运行旧 writer。剩余 lab/src 为身份锁定依赖，未来重新启用须新运行身份适配输出，不为治理修改学习策略。新 build 用 Vite 配置的 task 输出，不能覆盖 `packages/web/dist`。`scripts/exports/review62` 是要求显式新输出目录的导出工具副本，封存资料内部 tools 不作为当前生成入口。移动原件查 `deliverables/file-governance-20261030/batch2.json`；不批量改写历史旧路径来伪造来源。
