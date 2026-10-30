# P13锚点覆盖数据对照：64根与原损失保持

P12 M1相对无资源对照出现全负配对区间。固定首例的首次动作改为PASS在同P12续策下本副g+W反而更好，两支都输，不能据它叫PASS错误或归因整场。已查明原64锚根全部来自同一train match第一副、四席各16、823候选行。覆盖局限不是已经证明的遗忘原因。按独立科学子审唯一下一建议，改变锚点来源覆盖作对照，不改奖励、网络、强标签、λ或原U0锚目标。

## 锚点数据固定

1. 复用已存在P10训练native父的首四个家族，按ordinal固定5011/5012/5017/5018，不从dev失利/误差筛样，也不用sealed6001。读取各自native-prefix/root/source绑定；从默认2级和原indexed seed完整重放目标副前所有已完成局，所有实际家族必须现已train。只apply原合法moves，不重新模拟U0政策，不创建新独立来源。
2. 每父令n=rootGameNo−1，固定四个不同已完成副号[1,1+floor((n−1)/3),1+floor(2(n−1)/3),n]。实际四个n为12/9/5/14，分别选[1,4,8,12]、[1,3,6,9]、[1,2,3,5]、[1,5,9,14]。每选中副取按时间第一次轮到每个seat决策的真实公开root，保留其完整合法候选；合计4来源×4副×4席=64根，四席各16。完整source/default行为原样重放，不能手填中间状态、等级或拼未发生动作。
3. features399复用toVisibleRoot的331与rootCandidates的68，只自手/公开信息。保存rootId/source record+prefix SHA、源家族/本副家族、gameNo/seat/实际级牌、完整candidateActionKeys/features399和原U0源权重d5ff1001…；不读当前N/O或dev题分数。没有正确动作标签，锚目标仍是原U0对每个候选的分数，绝不改为C1400靶。原64文件不覆盖，新anchor-set另存。
4. 这改变整个锚输入分布（家族、等级、副与状态），不是只增加一个统计样本数。每副每席首次决策实际偏开局，覆盖的是多家族/多级牌/多副的开局状态，不自动补齐副内中后盘锚定，不能将结果称全阶段覆盖效果。源native U0是epsilon0，原旧来源U0 epsilon.05；权重/目标相同但原轨迹不同，记录这点，不把实验拆成纯家族数的因果结论。根内全候选mean后64根mean、anchor系数.01保持；实际候选行数无需等于823，实测报告，不能把候选行当独立根或拿拍脑袋行数门停训。

## 唯一新处理，复用既有控制

5. 新run r62-p13-anchor，同C1400父d05/同seed2026102901/LR.0001/hinge.16/原λ.1/strong1 weak.25、P10 book20、P12 slots5、原heur伙伴池、原optimizer/RNG/queues，400到1800。主要复用P12旧anchor处理及已完成512开发，保留p9c-control无资源风险参照。P11 RAM/新的sealed题均不进入梯度。除了新anchors，生产配方不变。
6. 最小新增anchor数据替换清单old/new Ref+SHA、父1400与source/prefix/选点绑定。train identity纳入显式anchor-set SHA，Node只在审核后的新run初始化替换anchors；resume仍校验已提交新anchor文件。旧父manifest/checkpoint/anchors不改。沿现有curriculum适配器在原restore中临时校验旧anchor digest，再使用既定新anchor tensors和原U0目标；主learner/optimizer/loss数学不改，未配置新字段时路径保持。新teacher20仍原P10 append、额外10曝光置0，不能借换anchor重置optimizer/RNG。
7. 新runtime身份准确记录源码改动；34数值源若未变则逐字验证，不谎称Node数据路径没改。先实际1400零步：模型/完整optimizer/Python及Torch RNG/Node queues/cursors/source/旧teacher曝光全同，新增teacher根0；唯一额外允许差异是预锁新anchorRef/digest/target scores。独立实现与实际恢复审通过才跑400。恢复后新checkpoint必须可按同新anchors断点续行，不能恢复时悄悄换回旧锚。
8. 测试仅对应替换身份/分区/固定64选点、未授权替换拒绝及真实恢复，不重跑全套/旧训练。原根内均值数学保留，不为此新增治理平台；generic审核标记仍绑定本次计划SHA。训练中核心固定，中点1600只读全候选/曝光；1800才唯一32块开发，不跑J、不重评控制、不自动续1900。
9. 新末点−P12及−无资源按原32基础块直接配对、20k type7、单项q=.0125/.9875，核192旧O轨迹与布局。若局部7/10变好但M1仍退化，不称净收益；若无收益，不把锚覆盖自动叫原因/已排除原因，依据结果再选一项。实际wall/worker/CPU各列，未测不填假值，不设混合总额度。正式51/60、各12/15、24严重、34958比赛门全不变，attempt0、网页旧O。

出现固定源文件缺失、家族非train、非法历史、少于64或重复选点时保留具体反例，先修局部提取逻辑，不能补dev/sealed根凑数或无界换源；源码/数据/身份改变后新配置绑定，不覆旧实验。若确需改变奖励、表示或验收等较大偏离，再先与用户讨论。本计划及实际方法经增量子审后才实施。
