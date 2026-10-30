# T5原16题源的剩余八条固定假设

直接承接已审T5两题方法，不新建平台。T5-urgent-resource-proposals-review.txt在两题验证结果出现前已固定全部11根的10条weak和4010弃权。本批按ordinal验证剩余全部八条prefer：4002 0004>0003、4003 0000>0003、4006 0000>0001、4007 0035>0036、4011 0003>0012、4018 0002>0003、4022 0000>0002、4023 0152>0155（action-前缀）。不是按N/O成绩或刚完成两题的答案选/改方向。4010继续abstain；既有open及4014/4015不重试、不翻向。

输入remaining-fixed-proposals.jsonl与remaining-answer-batch-plan.json保存在原sealed-question-source-001中，绑定原公开projection/独立作者回执/root SHA。每根原primary256/secondary128、同world双完整g+W、原两profile/种子/20k type7/阈值不变；八根预定6144完整分支。技术中断同目录承接，未支持保持未知，不补world求显著。无候选评分/梯度/attempt；原完整候选保留。这批仍不是60/75或24已建成。

同source-index唯一writer串行运行，内部4worker。已有两题任务完全退出后才启动；RAM只读train诊断可并行，核心证据/模拟文件保持冻结。通过普通本地窗口接续，不设研究总额度或再做预算停止门。实际分支、worker活跃、实测controller wall/CPU分开记录；未测不编造。

复用现有CLI；部分bank合并helper只增加固定remaining参数（expected8/previous002/output003，原next默认行为不变），重建旧bank证据和新strong后另建003，若无新增strong则保留002。未知第三动作不当错，不使用sealed fixture，不运行评分。适配是现有合并helper的小改，无核心变化，scoped类型检查和实际shared consumer重建足够；完成结果再独立核验，不重跑旧测试/旧模拟。

本计划和固定输入须先独立子审通过。命令：

```sh
node --import tsx lab/review6_2/run.ts verify-teaching --input lab/review6_2/data/sealed-question-source-001/remaining-fixed-proposals.jsonl --out lab/review6_2/data/sealed-remaining-answers-001
node --import tsx lab/review6_2/prepare-sealed-next-book.ts remaining
```
