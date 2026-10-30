# P7后固定control800的128块开发比较

依据T4-after-P7-cost-diagnosis：新中盘weak对照差的区间跨0，不能称已证有害；control800点估计较有希望，但32块不足。仅执行一次固定128块开发扩展，不再训练、不同时筛14weak、不启动正式attempt。128不是必须通过或足够的保证，不因结果再自动加到256。

固定r62-p7-control-u800-greedy权重、完整政策、registry、seed和原开发布局。目标cooperation/M1/M2各128基础块，J保留已测32。已有ordinal0–31的512完整比赛复用，只新增32–127的96块/1536场。合并样本128包含已经用于选择模型的旧32，不是全新独立确认；保留旧raw/报告，单列新增96与合并128结果，正式门不改变。

前缀复用采用一次小的元数据准备器，不改evaluate.ts或任何模拟/统计代码。它须重算当前固定candidate/registry/layouts/phase/seed/code的32与128 identity，要求旧manifest身份正好匹配；连续32块逐一核ordinal、完整16布局/政策角色、原始胜负与重算aggregate、固定source公式及旧block identity。每块保存原路径/SHA/identity与旧manifest路径/SHA，并在新128目录生成新数据集成员记录；旧block/manifest的字节与identity不改。新记录明确reusedFrom，不冒充新模拟。准备前后复核旧32全部SHA；已有目标目录身份或内容不一致拒收。

当前evaluatePolicy的缓存验证仍逐块复核原始行、布局、来源和aggregate；原模拟与bootstrap完全不变。prepared记录只属于dev，禁止sealed复用；不重新运行已保存32块。若当前代码/政策/来源不匹配，不绕过检查，停止准备修明白。

实际新增96完成后，输出一次合并128报告及单独新增96描述性报告，随后独立子审解释。新增96不当作事前独立候选确认，不据小样本作胜率保证。若碰到非法/不完整/谱系冲突只停该任务并保留记录，按主故障表修，不以输赢结果更换来源。全部写同一索引的操作串行；本阶段没有新教学世界或主模型更新。
