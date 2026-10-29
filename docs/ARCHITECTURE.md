# 架构与数据契约（2026-10-25 大修后定稿）

本文回答一个问题：**这个系统里，什么数据是可信的、由什么保证、坏了怎么发现**。
2026-10-25 晚连出三起"复盘胡说"事故（详见 [POSTMORTEM-2026-10-25.md](./POSTMORTEM-2026-10-25.md)），
根因都不在 LLM，而在"喂给 LLM 的数据没有被验证"。本文的契约就是为此而设。

## 1. 分层与数据流

```
engine（规则状态机，唯一真相源）
   │  对局过程中 Recorder 落盘
   ▼
GameRecord（localStorage 持久化，schemaVersion=2）
   │  ReviewPage 入口：normalizeRecord → validateRecord
   ▼
review/replay（确定性重建任意时刻局面）
   │  牌张归属驱动，不信任 player 字段与状态机轮次
   ▼
analyzer（每手打分）→ counterfactual（反事实胜率）→ coach（反幻觉剧本）
   │  剧本 = 只有引擎记录的牌张，LLM 只允许原样引用
   ▼
LLM 报告 → lintReportCards（剧本外牌张 = 黄牌告警）→ UI（复现卡/回放跳转）
```

## 2. 不变量（Invariants）——违反任何一条就是 bug

### I1 牌张归属唯一（回放的根基）
**每手牌的所有牌张 id 必须属于同一玩家当时的手牌。** 牌张 id 全局唯一且随对局只减不增，
因此"谁的牌"可以由归属唯一确定，不依赖任何易错字段。
- 实现位置：`engine/record.ts checkRecordIntegrity`（校验）、`review/replay.ts applyRecordedMove`（回放时以归属定出牌人）。
- 历史教训：player 字段曾整体错位（记录器在 applyMove 推进 turn 之后才取值）；旧版引擎轮次规则不同导致状态机轮次漂移。两者都被"以牌张归属为准"一次性免疫。

### I2 handsAfter 逐手一致
**按"初始手牌 − 已出 id"重建的各家手牌数，与每手记录的 handsAfter 完全相等**（Pass 手也要比）。
这是"记录内部自洽"的完整判据：I1+I2 成立 ⇒ 回放与真实牌局逐张吻合。

### I3 落盘即校验，复盘再校验
- 落盘：`web/controller` finish 时跑 `checkRecordIntegrity`，问题当场 console.error（最早暴露记录器回归）。
- 复盘：`ReviewPage` 入口 `validateRecord`（同一实现），不通过的记录**绝不进分析**——宁可拦下也不产出似是而非的建议（4A 事故的教训：错误数据 + 自信 LLM = 最有欺骗性的错误）。

### I4 记录带 schemaVersion，读取方按版本分支
- `schemaVersion=2`：player 字段正确，完整性校验**强制** player 与牌张归属一致（记录器回归的门禁）。
- 无版本号（旧记录）：player 允许错位，`normalizeRecord` 按归属修好再用于分析；版本化字段是未来任何记录格式变更的兼容层。

### I5 LLM 只讲剧本里的牌
- 输入侧：coach.ts 给 LLM 的剧本只含引擎记录的牌张，系统提示含反幻觉铁律。
- 输出侧：`lintReportCards` 提取报告中全部牌张（♠10/大王等），逐一核对存在于剧本；剧本外的牌触发 UI 黄牌告警。
- 属性：LLM 的责任被限定为"组织语言"，数据责任全部在引擎侧。

### I6 反作弊（AI 对局公平）
AI 决策只输入自己手牌 + 公开信息；`fairness.test.ts` 用"平行世界替换对手手牌 → 决策必须逐位一致"持续验证。与 I1-I5 同属"数据契约"：复盘可信的前提是对局本身可信。

## 3. 回放设计：为什么"牌张归属驱动"

状态机重演（用当前引擎规则推 legal/beat/轮次）在**规则演进**面前是脆弱的——引擎每改一次规则，
历史记录就可能无法重演。因此回放降级为：
- **手牌内容**：只由牌张 id 归属决定（I1），与规则版本无关；
- **轮次上下文**（lastCombo/trickPlays/finished）：由状态机尽力重建；遇到"压不过却出牌"（旧规则轮次差异）强制视为新一轮领出，宁可轮次上下文略有出入，也不让手牌漂移；
- **已删除的旧牌型**（如 10 张"钢板带两对"）：信任记录里存的 comboKind/mainRank 构造回放用牌型。

## 4. LLM 通道（GLM-5.3 Coding Plan 实测口径）

- 端点：Anthropic 协议（open.bigmodel.cn/api/anthropic），本地代理 127.0.0.1:8787 双协议转发。
- 思考控制：`thinking.type=disabled` 有效（约 6 秒）；`budget_tokens` **被无视**；不传 thinking 模型默认思考（复盘级 prompt 约 5 万字/6 分钟）。
- 思考 token 计入 max_tokens：额度太小 ⇒ 正文为 0（曾表现为静默回初始态，现已显式报错）。
- 现行档位：off/std=disabled（约 30 秒），max=enabled+32768 tokens（约 5~7 分钟）。
- 报告缓存 sessionStorage `gd_report_v2_{recordId}`（键含版本：归因逻辑变更后旧报告作废）。
- 复盘页两个 tab 用 CSS 隐藏而非卸载：生成中切页不中断。

## 5. 测试即契约

| 测试 | 守住的不变量 |
|---|---|
| `engine/tests/combo+game`（65） | 规则口径锁（官方牌型/贡还/轮转/尺寸上限） |
| `review/tests/integrity`（7） | I1/I2/I4：含"错记下家"事故复刻必须被抓、篡改 handsAfter 必须被拒、normalize 修复旧记录 |
| `review/tests/review` | 回放确定性、分析器、反事实 |
| `ai/tests/fairness` | I6 反作弊 |

**新增数据生产者时**（训练日志、导出工具等）：必须在 integrity.test 里加"生产→checkRecordIntegrity 干净"的往返用例，才允许合入。

## 6. 已知权衡

- 旧记录（无 schemaVersion）的轮次上下文（谁领出/谁压谁）在强制开轮处可能与史实有出入——手牌与出牌序列永远准确，仅 trick 边界的展示可能有偏差；schemaVersion=2 的新记录无此问题。
- LLM 报告不做逐句事实审核（只做牌张级 lint）——句子级语义（如"这手该炸"的战术判断）由剧本与反事实数据约束，不追求完全校验。
