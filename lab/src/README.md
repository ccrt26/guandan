# 锁定的遗留依赖

review5train.ts、review5eval.ts 与 review5_tuning/kscbReplay.ts 被 REVIEW6/6.2 的来源身份校验引用，保留原路径和原内容。bridge.ts、clean1.ts、seat.ts、stats.ts、legacy-files.ts、mlp.ts/schema.ts 为其依赖；lab/src/legacy_legacy_learner.py 是 Python 配套。它们不是新的训练执行授权。

其余退役命令已整组进入 ../archive/legacy-through-20261030/tooling/src/，保留原文字节。当前比赛、教师与训练逻辑入口见 ../review6 和 ../review6_2。未来重新启用旧训练器必须使用新运行身份并适配 task 输出，不直接覆盖旧 artifacts。
