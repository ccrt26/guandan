# 项目目录与输出规范

本规范覆盖整个 guandan。2026-10-30 第二批已实际归并；完整逐项映射见 `deliverables/file-governance-20261030/batch2.json`。不靠符号链接冒充迁移，不清空废纸篓，不将文件移出项目作为整理。

## 当前目录

```text
guandan/
  packages/{engine,ai,review,web}/   产品源码、同包 tests、静态资源与 server
  scripts/                        自对弈入口、输出路径工具、可复用导出工具
    ui/                          截图比较、fixture 生成、隔离浏览器验收源代码
    exports/review62/             读取既有结果生成新交付的工具
  docs/
    engineering/                 当前架构、人工 smoke 说明
    ui/                          当前 UI 接入说明
    history/                     历史报告原文，非当前操作命令
    superpowers/{specs,plans}/    已审核方案原件，身份引用不搬
  deliverables/
    research/review6-2/           训练前复查和 P13 后完整报告、封存包
    ui/reference-20261030/        四组 UI 参考，保持相邻关系
    file-governance-20261030/     两批治理回执、恢复副本、先前盘点
    review6-2-audit-20261029/      身份锁定的 policy 与正式审核原件
  lab/
    review6/                     现用研究基础实现（规则观察、完整比赛、教师、采样与恢复）
    review6_2/                   既有 P1–P13 的代码、配置、runs/data/development/receipts
    review6_1/                   前置原始/加工数据、源索引、账本及封存证据
    src/                         身份锁定的旧评测/训练/解码器及其真实依赖
    src/legacy_learner.py         旧 bridge 的配套 Python 学习器，实际归入源码目录
    review2/{assets,runs,frozen,selected}/  外部原包、旧 O 恢复树与选择原件
    review5/artifacts/           当前注册表引用的六个搭档与历史数据消费记录
    tests/                       研究相关现有测试，不因治理触发模型或比赛
    out/<task-id>/               截图、诊断、构建、导出暂存等一次任务的全部输出
    archive/legacy-through-20261030/
      {round2,round2_bugregime,diag_b,tiers,clean1,guardfix_evidence}/
      tooling/{src,tests}/       退役命令、旧专用工具与对应旧测试原文
      review2-support/           退出活动链的旧入口、协议、报告、缓存与诊断
      review5-support/           旧报告、探针脚本和交付 zip
      review5_tuning/            退出活动链的调优入口、绑定和账本整组
      initial-training/candidate_danzero/  尚未证实重复的外部静态检查原件
    .venv/                       原依赖环境；不移动环境以免破坏绝对路径
```

根目录的 package.json/package-lock.json、tsconfig、vitest、AGENTS、README、.gitignore、.env.example 和正常工程入口留原位。`.git`、各 node_modules、`.venv` 属于工程/环境，不因视觉整洁搬动。`.env` 等私有配置只在原约定位置，禁止进入归档交付和 Git；本次没有读取密钥。根、lab、deliverables、web 中已核出的 Finder `.DS_Store` 已移入废纸篓。`.zcode` 私有工具配置保留原位。

`packages/web/src/public/server/tests`、index.html、Vite 与包配置均是正常布局；`public/ai` 为实际产品发布权重。现有 `dist` 是旧发布字节证据，只读保留；新 build 不覆盖它。

## 输出规则

- 产品源码进对应 packages，测试进同包 tests。研究通用代码复用 lab/review6；既有 REVIEW6.2 的身份目录不拆，run 的 checkpoint/state/optimizer/manifest/events 保持同组。
- 新实验每个 run/data/development/receipts 都以其已有任务/运行 ID 单独落目录，禁止把同一 run 的恢复材料拆到其他新模型目录。当前 P13 仍停止；本规范不授权任何新学习。
- 截图、比较热图、诊断、fixture 再生成和构建统一 `lab/out/<task-id>/`。Node 使用 `scripts/project-paths.mjs` 的 taskOutput；Python 使用 `scripts/project_paths.py` 的 task_output。可设 `GD_TASK_ID` 或 `GD_TASK_OUTPUT_ROOT`，后者必须位于 lab/out 的一个任务子目录。默认日期时间加进程号，避免覆盖旧任务。
- `npm run build`、web 包 build 与 Vite preview 经同一配置默认使用固定的 `lab/out/web-build/`，不会每次解析生成不同时间目录。需要保留不同版本时，build 与 preview 使用相同 `GD_TASK_ID` 或相同 `GD_TASK_OUTPUT_ROOT`；preview 不会猜选最新目录。`emptyOutDir=false`；自定义输出也必须在 lab/out 的任务目录，拒绝写旧 dist。只有另获发布授权后才允许正式发布。
- 最终研究交付进 `deliverables/research/<任务>/`；UI 参考进 `deliverables/ui/<任务>/`；同一次治理只追加现有治理目录。原始大包只留一份，使用引用，不在多个交付里复制完整环境。
- 现有 REVIEW6.2 的三份导出工具已提取小份可复用版本到 `scripts/exports/review62/`。必须显式指定新的 `GD_DELIVERY_OUTPUT_ROOT=deliverables/research/<new-task>`，拒绝覆盖既有 review6-2 封存资料。文档转换依赖若缺失，不自动安装。原封存包内 tools 保持原字节，属于历史证据，不从中生成新交付。
- 本地 GitHub 文件准备工具另需 `GD_PUBLICATION_OUTPUT_ROOT=lab/out/<new-task>`，只在项目内暂存，不直接写 /tmp clone、提交或上传；分享范围每次另行按用户指令确定。
- 浏览器里下载的事故 JSON/复盘属于用户导出，仍通过浏览器下载管理；程序无权控制下载目录。需归入项目时放 `deliverables/research/<任务>/`，不要用服务端擅自改用户下载路径。
- 第一批旧工具的 legacy-files 路径守卫仍有效：写旧六组历史输入必须显式选择 lab/out 子任务。第二批归档的工具原文停止作为当前入口，不在归档内执行。需要复现时，在隔离恢复树按 batch2 映射恢复原布局，另行批准运行并采用新任务输出，不能把历史协议替换成新协议后声称复现。

## 原位例外与原因

1. lab/review6、review6_2、review6_1 和上面列出的旧模型/数据来源是当前记录身份的一部分，原位归类说明优于改写历史 manifest。C1400、O、P13 的权重、optimizer、state 和恢复依赖均保留。
2. lab/src 的 review5train.ts、review5eval.ts、review5_tuning/kscbReplay.ts 被当前源码身份校验直接列入，剩下 bridge/learner/clean1/seat/stats/兼容壳是它们的依赖。kscbReplay 的运行导入/数值校验与 train/eval 的来源指纹引用各有用途，不能把整个依赖文件夹都称为数值锁。旧 bridge 的 Python 配套已从 lab 根迁到 lab/src/legacy_learner.py，Python 原字节不变，bridge 只更新 SCRIPT URL，原内容有副本。未改变表示、奖励、采样或优化器；当前 R62 数值身份文件不变。未来若重新启用旧训练器，先用新运行身份适配输出目录；本次不执行它们。
3. deliverables/review6-2-audit-20261029/execution-policy.json 被当前协议固定引用；同目录的结果及停止记录又被 stop-after-p13.json 绑定。保留完整正式审核组，不把它拆散或伪造旧路径。
4. 封存 JSON、账本、ZIP、报告原文中的旧路径是当时身份，不批量改写。实际新位置由迁移记录给出。历史原文内部的旧命令不是新执行授权。

## 恢复与新增清理

每个迁移对象有原路径、新路径、迁移前 hash/字节；被改文件有第二批前置副本。恢复先停止相关写入、核对两端无冲突，再逆序把新路径移回；恢复源码前合并随后用户修改，不能盲目整仓覆盖。详见第二批回执。第一批 Trash 和外部备份保持不动。

用户最新授权清掉已证实可选/无用材料。本次移入废纸篓：早期独立实验的五组模型、日志/报告/截断诊断输入，以及旧 UI 截图/热图/测量/日志/视频和 Finder 元数据；保留唯一参考、当前模型、正式封存、完整数据和恢复链。逐项恢复路径见 batch2.json；未清空废纸篓，逻辑体积不等于即时释放磁盘。尚未证实非必要的独特历史源码/封存备份不盲删，剩余项在回执单列。
