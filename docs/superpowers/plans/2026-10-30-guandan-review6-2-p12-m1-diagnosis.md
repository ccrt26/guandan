# P12 M1退化：唯一首个负翻转的四次执行诊断

依据独立P12审查：相对无资源control，M1−.15625，预声明区间[-.296875,−.03125]全负；局部7/10不抵消退化。暂不训练/调λ。按(ordinal,side)锁首次control胜/P12负，固定block00000/M1-s0、seed1718165852、namespace review6-2-dev-M1-deals-v1。不扫描其余14负翻转找更好解释。

1. 原始block文件分别为development/r62-p9c-control-u1800-greedy-32blocks/block-00000.json（SHA cc50fd1594a8640aa4296829339cdec47bd18b575400ff193bbb852efa2633ee）与r62-p12-dose同名目录（SHA 1dd0245b23f47b5c3360f7cb207f34598693f624099b941b1afe5794a8683a9a）。固定policy权重e1c606a4…和81ed4d1c…、原O、原布局/epsilon0/counter/indexed-deal规则，不按重放结果改输入。
2. 各实际重放一次完整原策略，记录紧凑逐动作key/public摘要；必须复现原trace/winner/副数及round family序列：control winner0/10副/trace7ad9a1a2…，P12 winner1/6副/traceffb9610b…。不符先保留并停该诊断，不再补源或改RNG迎合。重放不是新独立比赛样本。
3. 从共享前缀首次动作key分歧捕获同一个真实root，核actor/gameNo/moveNo/完整state与history在动作前确实同源。保存公开root、自手/身份/剩牌与完整候选、两动作；不预设首次分歧就是错，更不预设它是资源题。动作各由真实模型只用自身/公开输入选择，诊断可用模拟内部真实world固定两支，但不把暗手提供给模型作决策。
4. 再只运行两条root-only反事实：同一真实rootState/rootHistory、同P12双N续策与O对手、同seed/namespace/RNG，分别强制原control动作和原P12动作，之后全由P12政策继续完整对局。g固定为首次分歧所在本副、分歧actor队视角的本副分，不把后续副分累加；W为该队整场结果，y=g+W。记录完整状态/赢家/副数/trace和实际家族；未知/不完整不补成胜负。forced P12支除兑现相同原P12终局，还须逐动作后缀及family序列吻合原P12（或拼回原共享前缀后full trace SHA吻合）；仅终局相同不足以证明RNG/前缀正确。若不符查重建，不增加更多局挑结果。
5. 上限两原轨迹重放＋两反事实续局；单例只能解释该同world/固定续策的局部影响，不能归因15个负翻转、证明平均策略有害或给原action普遍强标签。若两个动作完整结果相同，明确这一例的首次差异没有解释退化，不能继续扫根挑故事。该root及所有衍生始终dev，禁止产生teacher/梯度或混入封存题。
6. 独立helper diagnose-m1-regression.ts复用原match-play/evaluationLayouts，不改核心数学。CLI沿owned/canonical writer串行，实际涉及的新future家族核foreign后绑定dev；不与sealed source/构题writer并行。技术中断保留已完成记录；同内容恢复不把重放变新增开发统计。另列诊断实际执行数、wall/CPU，不计作512场主对照的扩样或新增训练。
7. 计划先子审；实现只核固定输入、动作前状态和最大执行数等必要一致性，再运行，结果独立窄审。不重跑全套或384world敏感性工具，不导新权重。正式60/75、24、完整比赛门及attempt保持。若需大改既定方案才可解决，先与用户讨论。
