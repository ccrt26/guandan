# 掼蛋AI执行复查材料 2026年10月29日

本目录收录用户授权公开的 REVIEW6.1 执行复查资料。目标是让ChatGPT或其他审查者无需访问本机即可阅读要求、执行结果、失败、预算依据和未完成项，并提出独立复查与优化意见。

**当前状态：整体能力目标未完成，网页仍用旧出牌政策。** 发布这份材料不代表新AI通过验收，不包含新训练、正式确认或部署。

## 建议阅读顺序

1. [完整在线报告](REPORT.md)：31页Word报告的网页阅读版，32个主题章节、4个附录、21项重点复查问题。
2. [给ChatGPT的复查请求](REVIEW_REQUEST.txt)：需要独立回答的问题及输出要求。
3. [在线证据索引](ONLINE_INDEX.md)：原方案、实际执行源码、收据与小型原始记录。
4. [下载完整复查材料包 约54MB](https://github.com/ccrt26/guandan/releases/download/review6-1-materials-20261029/guandan-review6-1-materials-20261029.zip)：1404个文件，包含不能在网页直接展开的大型JSON/JSONL、代表检查点及完整公开源码副本。

其他格式：[纯文本报告](REPORT.txt) · [Word报告](REPORT.docx) · [使用说明](USAGE.txt) · [Release页面](https://github.com/ccrt26/guandan/releases/tag/review6-1-materials-20261029)

## 建议优先核对的证据

- [stages/C1-stage-acceptance-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/stages/C1-stage-acceptance-001.json)
- [stages/C3-cost-stop-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/stages/C3-cost-stop-001.json)
- [data/H-evaluation-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/data/H-evaluation-001.json)
- [teacher-pilot-001/teacher-pilot-interim-018.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/teacher-pilot-001/teacher-pilot-interim-018.json)
- [teacher-pilot-001/teacher-quality-receipt-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/teacher-pilot-001/teacher-quality-receipt-001.json)
- [teacher-pilot-001/pilot-label-manifest-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/teacher-pilot-001/pilot-label-manifest-001.json)
- [teacher-pilot-001/variance-results-001/variance-report.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/teacher-pilot-001/variance-results-001/variance-report.json)
- [teacher-pilot-001/mature-results-001/mature-report.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/teacher-pilot-001/mature-results-001/mature-report.json)
- [data/stats-plan-pre-cost-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/data/stats-plan-pre-cost-001.json)
- [data/budget-plan-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/data/budget-plan-001.json)
- [data/budget-optional-world-sensitivity-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/data/budget-optional-world-sensitivity-001.json)
- [data/budget-setup-overhead-correction-001.json](materials/%E8%AF%81%E6%8D%AE/lab/review6_1/data/budget-setup-overhead-correction-001.json)

## 完整材料包的身份

- 文件：`guandan-review6-1-materials-20261029.zip`
- 字节数：`53839827`
- SHA256：`fb0dfbc618324cdf81bbe0e689837ebb50d8ea9c6eb7b25fb7dd13dd40740bd9`
- ZIP内容：1404个文件，解压约210MB。
- 发布为复查资料的预发布，不是软件或AI能力升级发布。

## 范围与隐私

包内有原方案、18个教师根的原始模拟与统计输入、64个方差块、40次更新收据、代表检查点、66条原账结算和实际执行版本。正文不依赖审查者读取本机路径；原始记录中的本机路径可通过证据索引找到对应副本。

没有提供真实API Key、个人工具配置、真人原始牌谱数据库或未来封存题内容。材料不是完整可执行恢复包；完整依赖、全部成熟特征和全部检查点没有包含。请勿直接运行历史训练、重新初始化预算或打开正式确认。

原报告是在本机编制和核验后定稿，其中“未自动上传GitHub”描述编制时的状态。本目录依据用户随后明确提出的上传要求发布；未改写原Word、TXT或ZIP，校验值保持一致。

所有“通过”均有范围：事实回归不代表新牌力，四条先导不代表教师总体准确率，二十次更新不代表正式训练。请独立复查，不把执行者自述或hash当作真实执行的充分证明。
