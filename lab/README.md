# 研究目录

当前研究实现是 review6/；既有 P1–P13 的执行主体和完整运行材料在 review6_2/；前置数据与封存证据在 review6_1/。**P13 已完成并停止，不启动训练或新实验。**

src/ 保留被这些身份校验引用的旧模块和真实依赖，src/legacy_learner.py 是旧 bridge 的配套程序。review2/ 留外部原包、旧 O 完整恢复树；review5/artifacts/ 留当前注册表引用的搭档及数据证据。退役命令、旧调优任务、旧支持资料和早期输出已实际归入 archive/legacy-through-20261030/。不要在归档里执行旧写入命令。

一次任务输出统一 out/<task-id>/；模型的 checkpoint/optimizer/state/manifest 不拆散。环境 .venv 留原位。详细职责、全部原位例外、输出参数及迁移映射见 [项目目录规范](../docs/PROJECT-LAYOUT.md) 和 deliverables/file-governance-20261030/batch2.json。
