# 掼蛋训练场 · 对战 + AI 复盘

本地 Web 应用：与所选 AI 打饭局掼蛋（2 打到 A、逢人配、双升级），支持逐手回放、引擎标注、反事实分析与 LLM 教练讲解。首页难度控制的固定档不表示模型能力已达“中级”；当前规范要求产品名及“实际策略：标准”按准确模型身份呈现，具体命名/UI生效以对应接收与运行回件为准。

## 快速开始

<a id="local-startup"></a>

日常入口固定为 **http://localhost:5180**，本地代理为 **http://localhost:8787**。现有服务正常时直接使用，不重新安装依赖、不重复启动，也不换端口。以下命令从项目根运行，仅用于依赖已就绪且相应服务确实未运行的冷启动：

```bash
# 只启动前端：固定 5180
npm run dev:ui

# 另一个终端：仅当本地代理未运行时启动，使用既有 8787
npm run server

# 两个服务都未运行时，也可只用这一条；不要与上面重复启动
# npm run dev
```

端口占用先只读核 `lsof -nP -iTCP:5180 -sTCP:LISTEN` / `lsof -nP -iTCP:8787 -sTCP:LISTEN`，再核监听 PID 的 user/start/cwd 与原启动记录。更新源码不等于运行生效：前端按实际受影响模块检查，只有确需重载才经原管理入口停自有服务并同口恢复；`npm run dev:ui` 不连带重启后端，`npm run server` 只用于获准且受影响的后端。未知占用不停止、不另开端口；说明更新不重启任何服务。验收优先 Codex 内置浏览器，已有同身份证据复用。

### AI 设置：只保留 GLM 与 DeepSeek 两项

打开首页 **AI 设置**，只修改确需修改的项并明确保存；已有配置无需重新输入 Key，取消不确认迁移。设置、AI选择与复盘教练读取同一后台保存的公开 provider 状态和 exactRef，不以每个浏览器的私有 binding 决定连接是否可用；个人席位选择/旧局存档仍保各自原语义。公开 preset、私有凭据、历史来源、已保存 exactRef 与真实调用结果分开，“已配置”不等于刚做过连接测试。当前原连接的协议/参数如下，源码合同见 [provider-presets.ts](packages/web/src/game/provider-presets.ts)：

| 连接 | 实际协议与 base URL | requestedModel | 实际思考参数 |
|---|---|---|---|
| 原 GLM | `anthropic-messages`；`https://open.bigmodel.cn/api/anthropic` | `glm-5.3` | `thinking.type=enabled`、`output_config.effort=max`、`max_tokens=32768` |
| DeepSeek | `openai-chat-completions`；`https://api.deepseek.com` | `deepseek-flash` | `thinking.type=enabled`、`reasoning_effort=max` |

GLM 实际请求沿 `/v1/messages`，DeepSeek 沿 `/chat/completions`；不能把 GLM 的原 Anthropic route/Key 换成同品牌 OpenAI preset，也不能互换两协议的 effort 参数。支持列表与已选请求值分开，保存一项不覆盖另一项。真实 Key 只在本机设置/私有存储，`.env*`、认证头与签名下载地址不进 Git、日志、截图或交付；`.env.example` 只是无密钥模板，不要 `cp` 覆盖已有 `.env`。

[原 provider 恢复](deliverables/ohuo-batches/S31-PROVIDER-RESTORE/accepted-code.json)中的 DS/GLM 各一次真实连接已成功并消费，**不要再次测试**；[共享状态 r3](deliverables/ohuo-batches/S31-PROVIDER-STATE/accepted-code.json) 已接受后台共享 saved exactRef 与历史诊断的限定证明，原历史时点不能冒新测试。每浏览器关联/Chrome解锁已不是可用性前置，但实际 fresh browser context、生产 coach DOM、选择页历史时间可见仍未观察；不把这一接受写成所有浏览器、真实混合局或教练生成都已验证。两弹窗恢复、用户手动测试按钮等后继仍按各自真实接收回件确认，不能仅凭设计/源码通过称已交付。完整当前事实入口见 [AGENTS](AGENTS.md#current-software-delivery)。

## 玩法

- 你坐南位，AI 队友坐北位，东西为 AI 对手
- 点选手牌出牌（万能配牌会自动代入并显示"当作 X"）；跟不住可以「不要」；「提示」按钮 = 引擎替你选牌
- 一局结束 → 「复盘本局」：时间轴上 ✅🟡❌ 是引擎对你每手牌的判定，点开看建议与原因
- 「深度分析」：从你的失误点用真实手牌平行重演几十局，给出"当时该怎么打"的胜率差
- 「教练报告」：LLM 基于引擎数据生成口语化讲解（未配置 Key 时自动降级为离线报告）

## 当前新局模型与历史难度设计

新局默认设置是 `auto_latest`，解析 [产品模型目录](packages/web/src/game/local-model-releases.json) 中当前正式 **ohuo-v1-1031**（内部 releaseRef `ohuo-1030-b-v1`）；显式更换后采用用户的 `explicit` 席位选择。“恢复默认”只恢复后续新局设置；已开始局/存档继续原 pin，不改科学 O 或旧模型身份。默认解析失败应明确报错，不静默回退旧 O 或另一连接。选择/旧局边界见 [ai-selection.ts](packages/web/src/game/ai-selection.ts) 及 [S31 接收凭据](deliverables/ohuo-batches/S31-UI/accepted-code.json)。

### 当前正式 ohuo 权重的固定恢复入口

<a id="formal-weight-recovery"></a>

当前正式模型的推理/工程父 `weights.f32` 已有精确核准的历史原件：Library `libfile_5f32373c4e388191bdda77c1672e0f37`，具体 file ID `file_0000000003a881fd830a5f8e6c4e9457`，文件 `guandan-review62-through-p13-evidence-20261030.zip`（**101113909 B**，SHA256 `d40f55895a78aee70dd0206dfa6cb39949eb956c88c4327462b7f48c07a49066`）。唯一目标成员为 `lab/review6_2/runs/r62-p8c-control/checkpoints/u001400-41c9a38f/weights.f32`，已核为非 symlink 的 regular 文件、完整读取至 EOF、**673796 B**、CRC32 `eca507d3`、SHA256 `d05c52bbd28883760da11f042be2d110fd3b3a9affd97edd7aed43c9421eb081`。

1. 需要恢复时，先复用已有同身份原包；确需获取才按当前支持的 Library 流程取上述固定对象一次，放本次 `lab/out/<task-id>/` 并核 outer 长度/SHA。不每个代码批重复下载或复制权重，也不新上传重复备份。
2. 只定位该精确成员，拒绝重复同名、目录、symlink 或越界路径；在本次隔离输出中 exclusive 写这一成员，读到 EOF 并核 CRC32、长度与 SHA。不整包解出其他数据、不执行包内脚本、不加载模型。
3. 核当前 `lab/model-index.json` 与产品目录仍绑定 policy `r62-p8c-control-u1400-greedy`、releaseRef `ohuo-1030-b-v1` 和上述 SHA，再按已批准范围恢复项目内原 run 路径（同成员路径）及网页 serve 路径 `packages/web/public/ai/ohuo/ohuo-1030-b-v1/weights.f32`：缺失才 exclusive 落回，同字节复用；已有不同字节或活动写者相交则保留现场并报冲突，不覆盖用户修改。回件记录固定包/成员和两目标前后身份；不自动切默认、重启、调用 API 或训练。

两个本地用途仍需保留；归档可恢复不等于允许删除当前模型。此入口只证明这份产品/工程父 weights 可恢复，**不证明 learner、optimizer、RNG 或完整训练状态/环境已备份**。源码 clone 不提供这份 C 权重；新 serve 副本不加入本次 Git 发布清单，不 `git add` 该权重。

### 历史规则 AI 三档设计（不是当前模型评级）

以下为原启发式规则 AI 的设计和当时实验记录。原首页三档锁中间是历史呈现；现行“实际策略：标准”的命名/UI落实按当前规范与真实接收回件核，不把旧三档表当当前能力开关。这些表格和旧自对弈结果不构成 ohuo 当前牌力或等级结论。

分级依据掼蛋专项调研（掼蛋竞技教程体系、掼蛋 AI 学术研究 DanZero、棋牌 AI 难度设计方法 Stockfish/Maia/Suphx），映射民间高手体系公认的三段位 **会打 / 能赢 / 近道**（对应平台等级制的 十级~六级 / 五级~二级 / 一级~大师）：

| 能力维度 | 🌱初级·会打 | ⚔️中级·能赢 | 👑高级·近道 |
|---|---|---|---|
| 合法行牌 + 基础组牌（贪心减手数） | ✓ | ✓ | ✓ |
| 牌理底线（不炸队友、不顶队友大牌） | ✓ | ✓ | ✓ |
| 记牌（王/级牌/炸弹余量） | ✗ | ✓ | ✓ |
| 手牌全局规划（最少出手次数） | ✗ | ✓ | ✓ |
| 配合（让牌/顶牌/送牌/接力） | ✗ | ✓ | ✓ |
| 首攻口诀（对子先行）、枪不打四、报牌封锁 | ✗ | ✓ | ✓ |
| 读牌（从让牌行为推断手牌） | ✗ | ✗ | ✓ |
| 算无敌牌、残局提前封锁（剩4/5张） | ✗ | ✗ | ✓ |
| 随手率（温度采样，前几名候选乱挑） | 30% | 5% 抖动 | ≈1% |

难度机制遵循 Stockfish/Maia 模式：**同一强决策核心 + 能力开关 + 温度采样**；降档只降"记牌/算牌/配合"维度，不制造违反牌理的行为（玩家调研表明：非理性失误比算得深更伤害公平感）。不做局内动态难度（rubber-banding）。

### 公平性（防作弊）红线

三档 AI 一律**只使用自己手牌 + 公开信息**（已出牌、各家剩余张数、让牌历史）决策：
- 不读取任何玩家的暗牌；发牌洗牌 RNG 与 AI 完全独立
- 允许的是合法推断：记牌、从让牌行为反推（读牌）、对暗牌做蒙特卡洛采样（PIMC，仅模拟用）
- `packages/ai/tests/fairness.test.ts` 回归测试持续验证：把对手手牌整体替换成任意牌（张数不变），三档 AI 的决策必须逐位一致；发牌可复现且不受 AI 状态影响

历史自对弈记录（5000+ 局实验）：三档胜率差 ≤3pp（中级对初级约 49-52%，高级对中级约 51-53%，均在统计噪声边缘）。原因经实验定位：贪心+牌理底线已 captured 绝大部分可实现胜率（2v2 中节奏>>精细技巧），而"灾难性失分行为"（坑队友）已在所有档位杜绝——这正是当初档位差距的主要来源。真正的强度分层需要 DanZero 式 DMC 自博弈训练（对规则 AI 90%+，见路线图）。**当时三档的差异是风格与稳定性的差异**（配合/记牌/读牌/随手率），人类玩家对初级的乱炸与随手的感知会强于 AI 互搏数据所示。`npm run sim` 是历史模拟入口；不作为本次说明更新或软件接收检查。

## 工程

```
packages/
├── engine/  规则引擎（纯 TS，无依赖）：牌型/逢人配枚举、压牌判定、状态机、升级计分、对局记录+完整性铁律校验
├── ai/      AI：记牌器、手牌拆解、启发式决策、三档能力矩阵、快速自对弈模拟器
├── review/  复盘：牌张归属驱动的确定性回放、每手决策打分标注、反事实胜率模拟、LLM 反幻觉剧本+牌张 lint、套路知识库
└── web/     React 前端 + LLM 本地代理（server/index.mjs）
```

- `npm test`：仓库测试入口，包含可能依赖本地研究工件的 lab 检查；不以旧固定测试数量表示当前验收。软件交付只运行本批冻结 checkId 与直接受影响范围，说明更新不跑产品测试。
- `npm run typecheck`：全包类型检查
- `npm run build`：构建写入 `lab/out/web-build/`（或已指定的任务输出），不覆盖旧 `packages/web/dist`；构建不等于正式发布。

### 数据可信性（复盘的根基）

复盘讲解曾因"记录器把出牌人记成下家"连出三起张冠李戴事故（详见 [docs/history/POSTMORTEM-2026-10-25.md](docs/history/POSTMORTEM-2026-10-25.md)）。现已固化为契约（详见 [docs/engineering/ARCHITECTURE.md](docs/engineering/ARCHITECTURE.md)）：

- **牌张归属唯一**：每手牌的出牌人由"牌张 id 属于谁的手牌"唯一确定，与规则版本、轮次推演无关；
- **落盘即校验**：每局保存时跑完整性铁律（108 张合法牌/归属唯一/handsAfter 逐手一致），复盘入口再校验一次，损坏记录直接拦截、绝不进分析；
- **LLM 只讲剧本里的牌**：报告生成后自动做牌张 lint，出现剧本之外的牌会在页面上黄牌告警；
- **反作弊**：对局 AI 只用公开信息决策（fairness 回归测试守护）。

### 规则配置

按《掼牌（掼蛋）竞赛规则》实现：两副牌 108 张；牌型全集＝单张、对子（**含对大王/对小王**）、三同张（可单出）、三带二（3+2 共 5 张）、顺子（恰 5 张，**A 可作 1 也可作 K+1，2 参与序列**：A2345/23456…10JQKA，级牌位置不入）、三连对（恰 3 对 6 张：AA2233/223344…QQKKAA）、二连三/钢板（恰 2 连三 6 张光板，无带对版本）、同花顺（同花 5 连，含 A2345/23456）、炸弹（4~8 张，张数多大越大）、天王炸（4 王仅限两大两小）。**除三连对、钢板（各 6 张）与炸弹外，任何牌型一手最多 5 张**。大小：天王炸＞8炸…＞4炸＞同花顺＞普通牌型。轮转：上游出完且无人接时**由对家领出**（对家已走则下家）。**进贡还贡**（第二副起）：单贡=末游贡手中最大牌（红心级牌不贡）给上游、上游还 2~10 的牌、末游先出；双贡=三游/末游各贡、较大者给上游、贡大者先出；下游方抓两大王**抗贡**（免贡、上游先出）。报牌：剩 ≤10 张张数高亮。双级模式（两队各自的级牌均大于 A 小于王，级高者大）、所有红心级牌逢人配；升级 +3/+2/+1；过 A 默认官方口径（头游且同伴非末游），可在首页切换。

`DEFAULT_RULES`（packages/engine/src/types.ts）支持：levelMode、passA、顺子/连对/钢板长度等参数。

## 路线图（未完成）

- 进贡还贡 / 抗贡
- 高级档蒙特卡洛 rollout（设施已备，小样本实测为负收益，默认关闭）
- 更多套路知识点与针对性训练模式

## 目录与输出

实际目录职责、历史资料新位置、构建与各类输出约定见 [项目目录规范](docs/PROJECT-LAYOUT.md) 及 [全项目后续落位与收尾](AGENTS.md#project-files-and-output)。规则覆盖整个项目，不只一次接收目录；一次任务输出进 `lab/out/<task-id>/`，批次凭据进 `deliverables/ohuo-batches/<batchId>/`，代码/配置/完整恢复组留各自正常位置。P13 已停止；历史训练命令不构成新授权。

## GitHub 源码起点

GitHub默认分支为main。上传范围、保留的历史材料和本机研究依赖见[同步说明](docs/engineering/GITHUB.md)；P1—P13只公开[汇总记录](docs/history/reviews/20261030-review62-p13-public-summary/README.md)。

现行正式入口为 **《掼蛋项目实施方案和执行计划文档_v5.4.3.docx》＋《掼蛋项目需求文档_v5.4.3.docx》＋《掼蛋项目模型迭代说明文档_v1.0.0.docx》**；本步固定身份、读序和具体模块检查见 [AGENTS](AGENTS.md#current-software-delivery) 与 [模块检查表](AGENTS.md#module-checks)。B10、[B snapshot preparer](deliverables/ohuo-batches/B-probe-preparer/accepted-code.json) 和 provider 共享状态已有各自限定软件接收；命名、R14、两弹窗/按钮、R15 的实际阶段与缺口沿 [lab 工程状态](lab/README.md#current-engineering-status) 和真实回件查询，不预填全部完成。当前按用户最新指令暂停训练、构题、教学、screen、科研采样及参数学习，待与 GLM 沟通完成并依用户最新指令接续；只继续工程修复、必要离线验证和文档维护，不以旧持续执行授权恢复模型请求。Git 操作按用户当次明确授权执行；Git 同步不阻软件交付，Library/Space 归档也不替代远端源码恢复证明。

本仓库不是完整训练恢复包；完整报告、原始数据、检查点和治理恢复资产留本机。
