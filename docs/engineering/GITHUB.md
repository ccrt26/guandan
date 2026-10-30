# 源码与 GitHub 同步范围

当前仓库默认分支 main。同步入口是 https://github.com/ccrt26/guandan 。本次保存当前有效源码、目录治理和必要规范，整合P13公开摘要；网页AI仍为原clean2完整政策，没有切换C1400，也不启动新功能或学习。

入库：四个packages的源码、必要资源/许可、当前运行权重及配置模板、程序和研究测试、研究实现/协议配置、退役工具原文、项目目录与工程说明。研究代码是源码，完整运行仍依赖本机未公开的牌谱、协议工件和检查点；不能把 clone 成功当作完整恢复或新能力验收。

本地保留且不入库：真实.env/API配置/密钥、个人工具配置、node_modules/.venv/dist、原始牌谱/外部检查点、训练与评测输出、运行日志/源索引/封存题目、完整模型恢复资产、deliverables及治理恢复bundle。少量packages下运行资源和测试fixture按用途保留，不是完整训练数据。

## 现有公开记录

- [P1—P13公开汇总](../history/reviews/20261030-review62-p13-public-summary/README.md)。保留原摘要字节；它不代表模型已晋级或部署。
- [原REVIEW6.1公开材料固定版本](https://github.com/ccrt26/guandan/tree/review6-1-materials-20261029/docs/reviews/20261029)。该既有tag及历史提交保留；当前主树不重复放入829项旧材料副本。没有重写或删除其Git历史。

原本本地UI分支是同一祖先链，其源码贡献已进入当前工作树。旧本地Git历史含历史数据/私人工具配置，不接到GitHub新提交的父链。本机治理目录保留原refs映射、修改patch和完整Git bundle；GitHub主线基于实际远端main及摘要提交前进。

## 检查范围

`npm run typecheck`检查四个程序包。`npx vitest run packages`是程序检查入口；原npm test还包含依赖本地研究工件的lab检查。此次Git整理不运行真实API、牌局、模型前向、训练或build。新build/preview使用docs/PROJECT-LAYOUT.md规定的同一任务目录，保留原dist字节证据。
