# B05 restore UI — 最薄本地验收设计与手册

## 已批准范围与实现计划

实施 v5.2 的 B05.restore_refs / B05.restore_ui；不扩展原 B05 产品行为。基线为重建候选 f2049d072e3238d832b1aa6d85ada4ca453a8769，原 B05 30 文件不改。只有下列 helper 是本次增量，正式父链及 check registry 由单一整合者管理。

只有一个符合本范围的方案：单 loopback Vite 原 App + 可见人工 fixture bootstrap。复用正常开发服务会继承真实环境及 API proxy，不采用；新增 fake-H/远端状态机或专用 UI 会重复已验边界，不采用。

- [x] 先写窄测试并确认缺 helper 导致失败：存储所有权、只读请求、InlineConfig 环境隔离；另核原旧 fixture 的 seed1234 首位为 human0。
- [x] 新增 `scripts/ui/b05-restore-ui/{safety.mjs,config.mjs,serve.mjs,bootstrap.ts}`。只在显式 `--local-restore-only` 启动 127.0.0.1:15181，端口冲突失败、不杀进程。InlineConfig 的 configFile/envFile 为 false、envPrefix 为空数组、proxy 为空；清除进程继承的 VITE_*。
- [x] 原 App 动态导入前，用可见按钮安装**原样两份人工存档**。仅空 origin 或由本 fixture marker 且 matchId 归属本 fixture 的 origin 允许写；不 clear，不读写用户存档。DOM 显示 fixture、save 是否保持原字节、已记录动作数与 forward/被拒请求计数，IAB 不必直接读 localStorage。
- [x] 真正 O 文件只读预检 659460 B / SHA b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55。真实 MLP.prototype.forward 在动态 main 前拦截并抛错，绝不生成替代权重。Fetch 仅允许同源 O GET 和空 public profile GET；无 API代理、无新API服务、所有其他请求拒绝。
- [x] 云只做合成/配置解析，不监听、不加载真实权重、不跑新比赛。输出本 helper 窄证据；交独审及单一整合者。Mac 实际 UI 回执保持 pending。

不测：云已验长等、cancel/failure/execution-uncertain矩阵；不点提示/出牌，不新局、不全AI、不打整局；不改 C、默认 O、发布或旧局。

## 本地接收执行（待审核后由 Mac 接收者执行）

准确命令/观察项如下。真实浏览器检查尚未执行，`B05.restore_ui` 不得标 passed。

### 已实现命令

接收者在已接收 B05+此 helper 的 **Mac 项目根**，先确认本轮 capability 批准并保留用户原服务/浏览器。不可用云端同名路径代替 Mac 文件。

```sh
node --import tsx scripts/ui/b05-restore-ui/serve.mjs --local-restore-only
```

只有该启动器可用；不要改用 `vite --config` 或 `npm run dev`。它预检本机已有 O 的固定字节数/SHA，未匹配就拒绝，不生成、不下载、不复制替代权重。成功后输出精确 URL、资产身份与自身 PID。只开 `http://127.0.0.1:15181/`（不用 localhost、不带 query/hash）。端口冲突停止本步骤，**不杀占用进程、不换端口**。结束 Ctrl-C 仅终止启动的 helper；保留用户现有服务。

用隔离浏览器 profile / IAB 新的干净 origin 打开 URL。初始只显示黄色人工fixture面板，原 App 未挂载；若该 origin 已有非本fixture数据，整个入口拒绝，绝不清空它。无需浏览器工具直接读 localStorage。

1. 点“安装人工旧 O 存档 → 进入真实首页”，再点真正首页“继续”。应进入真实牌桌：human0、对手 standard、队友 hard，O 身份与规则仍旧语义。刷新黄色观测：真实 controller `humanTurn=true, turn=0, moveNo=0, waitingRemote=false`；`savedActions=0`；`savedPolicies` 中0为human，1/3为固定O SHA+standard，2为固定O SHA+hard。`oGet>=1`（真实浏览器读O），`blockedForward=blockedStep=playRequests=blockedFetch=0`。正常恢复会更新**本fixture自己的**存档，`unchangedSinceInstall=false`允许且预期；不是要求旧O永远原字节。
2. 用真实牌桌“离桌”或正常导航回首页，确认不留思考/远端等待，仍无动作/请求。没有人为造 pending 远端链；旧pending不复活的完整因果证据沿用同源码已验 controller nonce/cancel case，当前面板只补“没有新请求”的实际 UI 观察，不能冒充曾有pending的浏览器实验。点黄色“返回验收入口（刷新，不改存档）”。
3. 点“安装人工缺 release 存档 → 进入真实首页”，再点“继续”。应留在首页并出现“引用缺失或恢复被暂停：Error: unsupported_release”（真实resolver返回该错误码；它不会把缺失ref字符串拼进提示）；不替O/其他policy，不开牌桌。点“刷新观测”：`unchangedSinceInstall=true`、`currentMatchId=B05-manual-missing`、`actualController=null`、`savedActions=0`、`playRequests=blockedForward=blockedStep=blockedFetch=0`。这份输入才要求恢复失败前后存档**原字节不变**。
4. 在真实首页勾选“自选四席”：四个select可见，human仅0号有；C本地与H选项均明确“浏览器资源未准备”且disabled，O可选。可以改0号为O仅观察配置，但**不点开始新局**；本地profile读取返回人工空 `[]`，无真实 API 服务或凭据。`emptyPublicProfileGet>=1`，`playRequests=0`；DOM另有原产品文案“C未准备时不会用O代替”。
5. 截图或工具观察逐项写入手动回执，绑定实际接收代码身份与命令，再 Ctrl-C 关闭自有helper。以上任一计数/身份不符即未通过，保留信息交产品owner；不移除guard绕过验收。

**防误操作：**在动态导入原 main 之前，helper拦同一真实 `MLP.prototype.forward` 与 `MatchController.prototype.step`，只计数并抛错；并拒绝不是原旧fixture恢复的 startGame。不用fake network、不把出牌伪装成功。它不是可打完整比赛的试用站。真实四席配置、App、Controller仍来自原B05源码；没有复刻另一个牌桌。

### 输入和登记请求

- `lab/review6_2/checks/fixtures/B05-old-o-save.json` SHA `274b85bdc89539095c852ad820f61d9aee2082b3277e3a8031933f631a25de69`。
- `lab/review6_2/checks/fixtures/B05-missing-release-save.json` SHA `67e4057c9c0706c24200e802466498dae8049221268b4774e36359843d3a039b`。
- 两者是已有人工 fixture，不来自用户私牌。原件未改；helper只安装它们，不导入用户存档。
- `B05.restore_ui` requires 请求：`local_ui`（上列URL及隔离origin内可见交互）、`local_service`（唯一127.0.0.1:15181、自有Vite、无API proxy）、`private_asset_read`（只 `packages/web/public/ai/clean2.f32`，659460 B，上列固定SHA）。模型资产不入包。
- manual观察key建议（由唯一registry owner实际登记）：`oldOSemanticsPreserved`、`missingReleasePausedAndSaveUnchanged`、`fourSeatConfigVisibleCUnavailable`、`noActionsOrRemoteRequests`、`ownedControllerExitObserved`。最后一项只观察真实离桌/导航；取消pending的源码证据复用原 B05.cancel_late，不声称本helper发过请求。
- 仅 `B05.restore_refs` 的既有 fixed selector/受控接受身份由整合者保留，本helper不扩大成一轮新的云矩阵或替代本地真实资产验收。

### 作者已执行／未执行

作者执行：5项helper窄合成（storage guard、fetch whitelist、真实两prototype拒绝、seed1234真人首手）通过；Inline Vite fake-env解析、实际公共注册表投影、HTML入口替换、API/其他模型URL拒绝、TS转译通过；bootstrap及真实导入依赖严格typecheck通过。seed检查无模型加载，只证明原fixture首手拓扑，不冒充真实O恢复。输出在 `lab/out/B05-restore-ui/`。

作者未执行：Vite创建/监听、真实浏览器、真实O文件读取/forward、用户牌局、新比赛、API、build/部署。`B05.restore_ui` 仍 **pending**，此文与合成检查不是实际UI接受回执。原30产品文件SHA在最终scope检查再次核对。
