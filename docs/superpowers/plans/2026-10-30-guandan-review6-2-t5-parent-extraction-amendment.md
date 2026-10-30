# T5父历史提取修订：不再要求无关的单张终局

固定sealed来源6001–6016已全部真实完整，173副、0个“队友头游/敌二游/两活家各单张”的terminal根。原sealed-condition-001已记录无父/0strong，不换方向、模板、源或伪造bank。这个terminal条件是旧终局命题的需要，但新构造只需要默认2级可达的A级父历史；把它当父历史的前置门没有必要。

1. 不追加来源、不扩大16上限，也不重跑16场。固定重放既有第一条source6001，原seed由sealed源6001决定，原完整trace0124c562f769c54d5f5c23be4eccf9c1fc0c59ecfb1a49a61114086d50422bd0、winner0/8副/695 decisions、8个actual families必须逐一复现。只在回调提取按时间第一个gameNo>=2、实际出牌actor队levelsBefore=14且match未结束的公开root；不看模型分数/构造答案或当前N/O选择。若没有则保留失败，不扫描第二源找故事。
2. 新parent-source prefix明确命名native-a-stage-parent-source-v1，不冒充terminal证明；保存原native动作、root公开信息、source receipt与绑定。nativeParent复用器仅增加对该前缀格式和对应parent-source-binding.json的允许，不改其从默认2级重放完整前副、检查actor队A且match未完的逻辑。目标副仍由完整108ID声明牌堆和实际规则创建；不注入级牌或中间状态。
3. 下游原declared-proof/teaching-evidence/exam全部保持字节不变。固定模板仍[1,5,7,11,10]、同四/五反向假设、输入去重、sealed谱系、两profile完整目标下界及条件共享合法类都原样。新的输出sealed-condition-a-parent-001及sealed-condition-002保留原失败001；成功才另建bank004，5family/6root/context1，失败不换源/模板或降门。
4. 新提取helper沿owned/canonical writer；source6001已全sealed，复放不产生新独立来源/世界，也不进入主RL/开发统计。只增加一次原轨迹复放，实测wall/CPU另列。保留16完整源/失败记录，不把0terminal说成0达到A级的比赛。
5. 先独立增量审修订必要性及绑定，再核最小接口/实际闭环；不重跑原16场或旧强证据。此修订删除的是与构造父历史无关的生产门，原合法性/信息/强标签/正式验收标准不变；仍属于主T5的生成器修复，无新奖励/表示/模型。若还必须大改主方案，再先与用户讨论。
