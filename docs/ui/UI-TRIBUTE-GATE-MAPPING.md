# 贡还确认门接入映射

更新：2026-10-28。规则和交换选择来自本地 `@gd/engine`；控制器负责展示、确认与本地恢复。没有多人服务器或网络确认协议。

## 本地契约

| 规范概念 | 当前实现 |
|---|---|
| 比赛与局号 | `MatchSave.matchId` 是持久化比赛身份；`match.gameNo` 是当前局号 |
| 交换事件 | 每局 `state.tribute`，由引擎 `startGame/applyTribute/completeReturn` 实际交换；UI 不执行交换 |
| 用户看见的结果版本 | `exchangeResult().version: string`，由比赛身份、局号、真实 pairs 和首出者组成；普通订阅通知或存档修订不改变此版本 |
| 一般存档修订 | `MatchSave.snapshotRevision` 每次成功保存后改变，独立于结果版本 |
| 确认主体 | 本机人类玩家，座位 0；没有整桌确认或跨设备确认语义 |
| 确认入口 | `acknowledgeExchange(viewedVersion: string): boolean`；必须传入本次渲染已展示的版本；仅首次有效确认返回 `true` |
| 门控 | `exchangeAckPending` 加 `exchangeError` 同时挡住人类合法动作、提示、出牌/不出、控制器 `step` 及 AI 调度 |
| 错误 | `exchangeError: string \| null`；无合法结果、手牌不一致、恢复失败和确认写盘失败均保持冻结；无状态可恢复时 `state === null`，UI 展示恢复失败与已有返回入口 |
| 只读历史 | `exchangeHistory: readonly ExchangeHistoryEntry[]`，递归冻结；条目有 `pairs/leader/version/gameNo/confirmedAt`。读取历史不会确认、重开门或修改游戏 |

`pairs` 每组包含 `tribute` 与 `ret`，二者均为 `{ from: number, to: number, card: { id, suit, rank } }`。`confirmedAt` 在确认前为 `null`，成功确认后为本机时间戳。卡牌 `id` 是实体身份；两副同牌面不能按花色点数误判为重复。

## 执行时序

1. 人类欠还贡时沿用现有选牌阶段，`pendingReturns` 非空，交换结果为 `null`。AI 收贡方由现有引擎自动还牌；人类还牌仍调用 `completeReturn`。
2. 全部还贡完成后，以同一份交换后状态校验：四家各 27 张、108 个合法唯一实体、完整单/双组、反向还牌、实体最终归属及首出者。缺失还牌不会用贡牌补造。校验失败不开放出牌。
3. 普通模式进入待确认。`exchangeResult()` 返回已校验结果；同版本手牌改变会报错。抗贡与无贡沿用跳过流程，开发用 autopilot 沿用自动通过确认。
4. 点击“继续”传入展示版本。版本不匹配或结果无效时返回 `false`；有效确认先保存确认记录，保存成功后再释放门并调度。确认本身不调用发牌、交换、扣牌或首步出牌。重复点击无额外通知或调度。
5. 写入本地存储失败时保留结果和门，显示错误；恢复存储后可用同一个版本重试。此流程是同步本地写入，不宣称具有网络请求或未知远端提交状态。

## 刷新恢复

新 `MatchSave.activeGame` 保存交换完成后的局初快照、记录器元数据、已执行公开动作和 `acknowledgedVersion`。现有 `new MatchController({ resumeMatch }); startGame()` 入口可恢复：

- 未确认：保留同一局号、实体牌与结果版本，继续等待人工确认。
- 已确认：恢复正常对局，不重新显示活动确认门。
- 已有后续动作：恢复 `ctx.ranks` 的 `Set`，重放动作以重建行牌方、手牌、桌面、公开记牌器、神经观察器及记录器；重放不写对局记录、不增加战绩、不执行 AI 决策。局结束时沿用原记录 ID 正常归档一次。
- 旧档没有 `activeGame`：沿用局末存档开启下一局。人类还牌尚未提交、交换未完整时仍没有新的局中快照；不能宣称此阶段已具有半局恢复。
- 旧标签页或延迟读到旧档：存档修订不一致时停止旧控制器，提示从首页继续最新档，不覆盖已写入的新快照。App 应在异步权重加载完成后重新读取当前存档。

`snapshotRevision` 是 localStorage 乐观检查，并非跨标签页原子锁；真正同时发生的跨进程写入、跨设备并发、服务器响应乱序和网络断线重连仍需服务器或事务协议，未实现也未验收。AI 私有随机流与 rollout 已用预算不序列化，恢复后未来选择可能与未中断运行不同，但牌局状态、既有动作和公开记忆保留。浏览器阻止存储或配额不足时不能保证刷新恢复；确认写入失败会明确阻止释放门。

## 不出展示

引擎在最后一次 `pass` 同批返回 `trickEnd` 时立即完成规则轮转。控制器只保留完成轮次的展示，让每个座位最后一次“不出”能进入订阅通知；下一轮首家实际 `play` 时先清旧展示，再写入新牌。不添加时间延迟、不改变行牌规则；新局清空展示。

## 验证证据及界面边界

- `packages/web/tests/table-presentation.test.ts`：真实引擎，四个座位分别作为最后过牌者；通知可见“不出”，首出清旧，新局重置。
- `packages/web/tests/exchange-safety.test.ts`：人类/AI 双门控、版本缺失/过期/改变、重复确认、六类异常实体/方向、同版本手牌变化、单贡/双贡/真实抗贡、只读历史、本地写失败重试、待确认/已确认/已有动作恢复、坏档阻止、迟到旧页面阻止；恢复后打完整局校验记录完整且仅归档/计战绩一次。
- `packages/web/tests/exchange-gate.test.ts`、`match-save.test.ts`：原有真引擎门控和旧存档兼容回归，现显式传入展示版本。
- `packages/engine/tests/tribute-entity.test.ts`：复现双贡末游较大分支原来只保有 107 个唯一实体的问题；最小修复仅让三游/末游各移动自身已选中的牌，不改变选牌、目标和顺序规则。
- `lab/out/layout-fix-20261028/fixtures/`：真实首局自对弈结果生成的第二局单/双贡待确认存档，附生成脚本与种子来源。其初始牌来自引擎，不由视觉样例拼造。

以上自动化测试证明控制器与引擎契约，不能替代浏览器点击、键盘、视觉布局及各视口检查。具体浏览器已完成项和截图由本轮界面交付报告另记；原始 `05` 示例只用于独立视觉验收，不能解除真实门控。


2026-10-30 整体清理：本文所述旧截图、测量与验收日志已按用户“可留可不留尽量不留”指令移入废纸篓。批准的设计参考仍在 `deliverables/ui/reference-20261030/`；实际程序使用的贡还 fixture/provenance 在 `packages/web/src/dev/fixtures/tribute/`。可复用比较和 fixture/隔离浏览器种子工具迁入 `scripts/ui/`。历史叙述保留，旧 out 路径不再表示在线文件；恢复位置查 `deliverables/file-governance-20261030/batch2.json`。
