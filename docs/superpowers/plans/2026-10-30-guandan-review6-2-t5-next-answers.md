# T5第二小批：两条独立公开提案，复用原答案计算

目的仍是完成主计划的独立答案库，不改变训练、考试标准或候选，不新建工具平台。原16根中其余11根由独立学习子审只看净化的public-proposal-input.json给建议；4010弃权。此次只选已明确公开理由的4014和4015，不能按N/O成绩筛题。提案固定在任何本批模拟结果前：4014 PASS(action-0002)优于对10(action-0000)；4015小王(action-0000)优于四王炸(action-0002)。两个判断均只是weak假设，精确事实/保领权不能代替完整收益证明。

1. 输入及方向锁在sealed-question-source-001/next-fixed-proposals.jsonl、next-answer-batch-plan.json，记录SHA与公开提案来源。source family/root SHA及合法性用现有准入检查；仅sealed，0梯度，不导入训练。不看当前N/O选择。此前主执行查来源manifest时带出了源U0排序，发生在独立作者已给出这两条固定方向之后；不按它改变方向或是否验证，作者始终只看净化题面。
2. 复用原verify-teaching：primary256/secondary128独立world，每world同源双支完整g+W；总计1536预定完整分支。原注册表、public-observation-only-v2种子、20k percentile/type7及primary lower>.02/secondary>0不变。两根均不满足现有公开终局/两活家精确界，不冒称可用该捷径。未知/不支持保持未知，不翻向或增加world求显著；技术中断沿相同目录恢复，完成记录不重算。
3. P10开发控制器完全退出后，唯一source-index writer串行执行；内部workers4。保存raw、统计、谱系和结果。将实际worker活跃、controller墙钟有无真实测量分开写，不把文件时间跨度冒称wall，不把1536预定当实际完成。
4. 若有新增strong，另建sealed-exam-bank-002：合并原bank001的1条与本批实际获支持卡，保留001历史。复用normalizeTeachingCards(sealed)、createAnswerManifest(kind skills60)、assertFrozenExamEvidence；仍partial且ready=false，按真实类别/根/家族统计缺项。没有新增strong则保留001当前bank，不伪造扩容。全候选保留，未验证第三动作仍unknown。不得用fixture容纳sealed，不开N/O分、不占attempt、不宣称完整60/75或24完成。
5. 原始卡和计划先经增量子审再执行；新部分bank及原始结果再独立核验。没有改核心算法/证据消费者，不重跑旧测试或旧四open答案。总目标与正式35k比赛要求原样保留。

已存在入口，审核通过且无writer运行时的命令：

```sh
node --import tsx lab/review6_2/run.ts verify-teaching --input lab/review6_2/data/sealed-question-source-001/next-fixed-proposals.jsonl --out lab/review6_2/data/sealed-next-answers-001
```
