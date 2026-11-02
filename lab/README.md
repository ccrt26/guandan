# 研究目录

旧REVIEW6.2研究实现是 review6/；既有 P1–P13 的执行主体和完整运行材料在 review6_2/；前置数据与封存证据在 review6_1/。**旧REVIEW6.2 P1—P13研究已停止；该状态不作为新软件接收/检查的阻断条件。任何真实研究仍须有效的具名计划、当前授权及科学前置；当前暂不启动。** 新软件按 [当前正式 5.2.7、独立需求文档与事实索引](../AGENTS.md#current-software-delivery) 及各批有效执行卡推进，不据旧研究命令恢复P13或进入P14。用户要求既定基础建设全部完成后再统一讨论，真实研究/训练保持 `NOT_DUE`；软件接受不自动开启真实快照采集、比赛或训练。

src/ 保留被这些身份校验引用的旧模块和真实依赖，src/legacy_learner.py 是旧 bridge 的配套程序。review2/ 留外部原包、旧 O 完整恢复树；review5/artifacts/ 留当前注册表引用的搭档及数据证据。退役命令、旧调优任务、旧支持资料和早期输出已实际归入 archive/legacy-through-20261030/。不要在归档里执行旧写入命令。

## 当前 ohuo 工程入口

<a id="current-engineering-status"></a>

`review6_2/` 同时承载现行 ohuo 的 Task/host、比赛消费者、probe、选样/数据冻结、离线标签和 distill 工程代码，不是“整个目录均退役”。接收/收尾入口为 [scripts/ohuo-delivery.mjs](../scripts/ohuo-delivery.mjs) 与 [M9 说明](../docs/engineering/ohuo-delivery.md)；实现/有限 checker 在 `review6_2/`、`review6_2/checks/`，实际可调用能力以当前 registry、批次 HANDOFF 和不可变接收凭据为准。M9 说明中的 B00 历史命令示例不是重复检查已接受批的要求。

| 已有入口/能力 | 当前事实与下一步 |
|---|---|
| [B08 stored-parity](../deliverables/ohuo-batches/B08/accepted-code.json)；`checks/check-stored-parity.ts` | 已接受，只复用原公开记录读回证据，不再造科研 Task 或重跑来补输入。 |
| [L](../deliverables/ohuo-batches/B07-L/accepted-code.json)；`offline-label-consumer.ts`、`teacher-snapshot.ts` | 有限软件接收已完成；teacher-snapshot 随 L 携带，B10 独立功能接收见下行，不由携带源码代替。 |
| [H](../deliverables/ohuo-batches/M0-H/accepted-code.json)；`ohuo-run.mjs`、`task-consumer.mjs`、`task-control.mjs` | 已接受，原九项 CLI 检查复用，不重跑；有限接线不是所有真实科研前置已齐。 |
| [B10 r2 接收凭据](../deliverables/ohuo-batches/B10/accepted-code.json)；[执行卡](../deliverables/ohuo-batches/B10/HANDOFF.md)；`checks/check-distill.py` | 已接受：原 lane 的 `loss-mask`、`optimizer-isolation`、`resume-two-step`、`engineering-load-only` 在 r2 各实际执行一次并通过。仅修 checker 一行 NumPy 序列化桥接，未安装依赖或更换环境；r1 首次失败及运输阻断原件保留，不倒改历史。后续复用真实接收证据，不在这里另造测试命令或重跑。 |
| [B snapshot preparer 接收凭据](../deliverables/ohuo-batches/B-probe-preparer/accepted-code.json)；正式方案 NAV-S11 | 已实际软件接受；原有限 cloud 检查/类型证据按同源规则消费，本地未因此重跑产品。只证明已接收的 preparer 能力，不表示真实12来源快照、科研资格或真实采集已完成。 |
| [provider 共享状态 r3](../deliverables/ohuo-batches/S31-PROVIDER-STATE/accepted-code.json)；§39第5项，F04/F16/F19 | 后台共享 saved exactRef/历史诊断已限定接受，不再以个人浏览器 binding 或 Chrome 解锁为前置。实际 fresh context、生产 coach DOM、选择页历史时间仍未观察；历史测试/类型/build 的回读不冒新执行或 M9 reused。 |

B10/preparer 的软件接收已有真实回件，后继命名、R14、两弹窗/手动测试按钮、R15 仍须各自源码审、实际本地接收与必要运行证据；已审代码或文件可用不能替代其中一层。读序为方案 NAV-00→本模块当前需求明细/具体步骤→其引用的 F 行→本批已冻结 HANDOFF/checkPlan，具体有限检查见 [AGENTS模块表](../AGENTS.md#module-checks)，不执行整张F表或几百项无关测试。 已读且核准的同版/同范围合同或自包含、已审并固定本阶段必需输入的精确交接可直接复用，不重复下载整本方案；只有具体必需缺项才暂停依赖它的步骤并取具名补件，读取工具缺口不全停，真实拒绝不绕过。接口/接收状态只消费原真实回件，不重跑已完成项。B10 前三项是有限 synthetic forward/backward/step，不能把全批叫“零 optimizer”；`engineering-load-only` 才是固定工程真父 load/flat 读回、零 forward/update。科研12来源/阶段资格与真实训练授权仍独立满足，不拿软件检查代替。

## 文件与输出位置

目录规范覆盖整个项目。一次任务下载/解压、诊断、截图、临时导出和 build 统一 `out/<task-id>/`；冻结批次 manifest、接收与收尾凭据沿 `../deliverables/ohuo-batches/<batchId>/`；最终研究交付沿 `../deliverables/research/<任务>/`。checkpoint/optimizer/state/manifest 不拆散，`.venv` 留原位；独特证据和恢复资产不会因为在 out 下就成为可删临时物。每任务沿原文件清单给 `fileCloseoutRef`、恢复/活动依赖及真实保留/Trash/blocked 结果，旧 retained/noop 保原记录。详细职责、全部原位例外、输出参数及迁移映射见 [项目目录规范](../docs/PROJECT-LAYOUT.md)、[全项目后续落位规则](../AGENTS.md#project-files-and-output) 和 `deliverables/file-governance-20261030/batch2.json`。
