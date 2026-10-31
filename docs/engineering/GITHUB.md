# 源码与 GitHub 同步范围

当前仓库默认分支 main。同步入口是 https://github.com/ccrt26/guandan 。以下记录2026年10月30日此次Git整理的操作范围：当时保存有效源码、目录治理和必要规范，整合P13公开摘要；网页AI为原clean2完整政策，没有切换C1400，也没有启动新功能或学习。本段是历史记录，不表示此后 ohuo 软件的授权或默认状态；现行正式 5.2.6 v14、事实索引及具名批次入口见 [AGENTS](../../AGENTS.md#current-software-delivery)。

2026年10月30日当次入库范围：四个packages的源码、必要资源/许可、当时运行权重及配置模板、程序和研究测试、研究实现/协议配置、退役工具原文、项目目录与工程说明。该历史范围不授权上传后续新增权重或私有数据。研究代码是源码，完整运行仍依赖本机未公开的牌谱、协议工件和检查点；不能把 clone 成功当作完整恢复或新能力验收。

本地保留且不入库：真实.env/API配置/密钥、个人工具配置、node_modules/.venv/dist、原始牌谱/外部检查点、训练与评测输出、运行日志/源索引/封存题目、完整模型恢复资产、deliverables及治理恢复bundle。少量packages下运行资源和测试fixture按用途保留，不是完整训练数据。

## 现有公开记录

- [P1—P13公开汇总](../history/reviews/20261030-review62-p13-public-summary/README.md)。保留原摘要字节；它不代表模型已晋级或部署。
- [原REVIEW6.1公开材料固定版本](https://github.com/ccrt26/guandan/tree/review6-1-materials-20261029/docs/reviews/20261029)。该既有tag及历史提交保留；当前主树不重复放入829项旧材料副本。没有重写或删除其Git历史。

原本本地UI分支是同一祖先链，其源码贡献已进入当前工作树。旧本地Git历史含历史数据/私人工具配置，不接到GitHub新提交的父链。本机治理目录保留原refs映射、修改patch和完整Git bundle；GitHub主线基于实际远端main及摘要提交前进。

## 当前源码发布与恢复待办

最新软件修改尚未 commit/push，远端是否具备最新 accepted 源码恢复身份也未核；旧 `47a7ec3cec0a1efd9729c62ad8ad230b765d26c6` 只是已核源码起点，Library/Space 归档、云恢复树和本地 `accepted-code.json` 均不证明已推 GitHub。当前父沿事实索引的 `sourceBaseline.acceptedCurrentProjectCodeRef`，最终发布范围须包含实际最后接受的源差异与审过的四说明，不能预写尚未接受的 preparer 结果。

原 Mac 单一 Git writer 按原发布授权与明确文件清单完成以下步骤；本文件不新增发布授权，也不要求重新批准已涵盖范围：

1. 只读核项目根、branch、HEAD、upstream、实际 remote 身份及用户 dirty：`git rev-parse --show-toplevel`、`git branch --show-current`、`git rev-parse HEAD`、`git status --short`。远端地址仅报告已脱敏身份，保护原用户修改，不 reset/clean 或强推。
2. 对明确清单逐项核 `git ls-files -- <path>`、`git check-ignore -v -- <path>` 与 staged/unstaged diff；`.gitignore` 的存在不能证明已跟踪秘密未入库。只发布已批准源码、必要工程说明和无密钥模板，不 `git add -A` 或整树打包。真实 `.env.llm-profiles.json`、`.env*`/lock/temp、密钥、签名 URL、用户存档、真实权重/checkpoint/optimizer、研究数据、临时截图日志与交付归档排除；既有公开 tag/资源不删、不改历史。
3. 原 writer 沿既有可公开远端祖先定向提交/推送，保留实际 commit、parent、branch/tree 与文件清单。由 `git ls-remote --heads <已核remote> <已核branch>` 或原等价入口读回 exact commit，再从该固定远端 commit 在 `lab/out/<task-id>/` 受控恢复已列文件，逐字节对齐 accepted sourceRef 与四说明 after SHA。只本地 `git show HEAD`、只列 tar 成员或“已上传归档”不足以报远端恢复完成。

恢复验证只涉及上述源码/模板/说明，不安装依赖、不重跑已闭软件或真实 API/模型/训练。真实 C1400/O/P13 模型、优化器、数据与私有配置仍依原保护/恢复链，clone 不能替代；临时恢复文件沿同任务 `fileCloseoutRef` 收尾。缺权限、冲突或实际远端回件只阻相应发布步骤，不阻独立说明准备或软件接收。

## 检查范围

`npm run typecheck`检查四个程序包。`npx vitest run packages`是程序检查入口；原npm test还包含依赖本地研究工件的lab检查。上述入口存在不表示本次应全跑；当前说明-only 同步只做四文件 before/after、差异、链接和命令存在性核，不运行产品测试、真实API、牌局、模型前向、训练或build。新build/preview使用docs/PROJECT-LAYOUT.md规定的同一任务目录，保留原dist字节证据。
