# 源码与 GitHub 同步范围

当前仓库默认分支 main。同步入口是 https://github.com/ccrt26/guandan 。以下记录2026年10月30日此次Git整理的操作范围：当时保存有效源码、目录治理和必要规范，整合P13公开摘要；网页AI为原clean2完整政策，没有切换C1400，也没有启动新功能或学习。本段是历史记录，不表示此后 ohuo 软件的授权或默认状态；现行正式 5.2.7 方案 v18、独立需求文档 v0、事实索引及具名批次入口见 [AGENTS](../../AGENTS.md#current-software-delivery)。

2026年10月30日当次入库范围：四个packages的源码、必要资源/许可、当时运行权重及配置模板、程序和研究测试、研究实现/协议配置、退役工具原文、项目目录与工程说明。该历史范围不授权上传后续新增权重或私有数据。研究代码是源码，完整运行仍依赖本机未公开的牌谱、协议工件和检查点；不能把 clone 成功当作完整恢复或新能力验收。

本地保留且不入库：真实.env/API配置/密钥、个人工具配置、node_modules/.venv/dist、原始牌谱/外部检查点、训练与评测输出、运行日志/源索引/封存题目、完整模型恢复资产、deliverables及治理恢复bundle。少量packages下运行资源和测试fixture按用途保留，不是完整训练数据。

## 现有公开记录

- [P1—P13公开汇总](../history/reviews/20261030-review62-p13-public-summary/README.md)。保留原摘要字节；它不代表模型已晋级或部署。
- [原REVIEW6.1公开材料固定版本](https://github.com/ccrt26/guandan/tree/review6-1-materials-20261029/docs/reviews/20261029)。该既有tag及历史提交保留；当前主树不重复放入829项旧材料副本。没有重写或删除其Git历史。

原本本地UI分支是同一祖先链，其源码贡献已进入当前工作树。旧本地Git历史含历史数据/私人工具配置，不接到GitHub新提交的父链。本机治理目录保留原refs映射、修改patch和完整Git bundle；GitHub主线基于实际远端main及摘要提交前进。

## Git 当前同步授权

2026年11月2日，用户明确要求把本地最新程序推送到 GitHub，并授权判断现有分支是否可以合并；随后明确要求移除旧“Git 由用户自行处理”的限制。本次已授权暂存、提交和推送经核对的程序源码与必要工程说明。此前暂停 Git 操作的约束已撤销；原本地提交 `3165152b7501d7d6b9c411a90225a6f1450040a3` 与历史拒绝记录保留。旧 `47a7ec3cec0a1efd9729c62ad8ad230b765d26c6` 是历史源码起点，不用它覆盖真实已接受源码或用户 dirty。Git 同步不阻既定软件、四说明同步或其他独立工作。

Library/Space 归档、云恢复树和本地 `accepted-code.json` 不等于已推 GitHub；正式来源仍沿当前事实索引与各批不可变接收凭据。本次同步结果以实际远端提交读回为准，源码同步范围与恢复边界如下：

- 只考虑明确列出的源码、必要工程说明和无密钥模板；`.gitignore` 存在不证明已跟踪秘密未入库。真实 `.env.llm-profiles.json`、`.env*`/lock/temp、密钥、签名 URL、用户存档、真实权重/checkpoint/optimizer、研究数据、临时截图日志与交付归档均排除；不 `git add .` / `git add -A` 或整树打包，既有公开 tag/资源不删、不改历史。
- 保护当前 branch/HEAD、已核 remote 身份与用户修改，不 reset/clean、强推或接入含私密的旧本地父链。未来如用户要求核远端恢复，须绑定实际 commit、parent/branch/tree 和明确文件清单，读回 exact remote commit，再在 `lab/out/<task-id>/` 受控恢复所列字节，与真实 accepted sourceRef/四说明 after SHA 对齐；不能只凭本地 HEAD 或归档成功报完成。
- 源码 clone 不替代 C1400/O/P13 模型、优化器、数据与私有配置的原恢复链；当前正式 C 权重的精确既有原件见 [README恢复入口](../../README.md#formal-weight-recovery)，不为每个代码批再复制/入Git。必要恢复资产与活动文件继续保留，临时物按同任务 `fileCloseoutRef` 实际收尾。

本次 Git 同步按用户上述授权执行；实际发布/远端恢复未核如实记录，不改历史拒绝证据，也不把 Git 状态设为软件暂停条件。

## 检查范围

`npm run typecheck`检查四个程序包。`npx vitest run packages`是程序检查入口；原npm test还包含依赖本地研究工件的lab检查。上述入口存在不表示本次应全跑；当前说明-only 同步只做四文件 before/after、差异、链接和命令存在性核，不运行产品测试、真实API、牌局、模型前向、训练或build。新build/preview使用docs/PROJECT-LAYOUT.md规定的同一任务目录，保留原dist字节证据。
