# C1400 独立普通浏览器验收入口

这是 C1400 已批准卡内的取证/隔离修复，不是新模型、训练、默认采用或最终接受回执。原 C r1 186 源字节不改；4 个新增 helper 源和测试必须由唯一整合 owner 纳入未 accepted C 的新 revision/sourceRef，再交 Mac。原 accepted B05、旧 C r1 文件/expected 均保留，不覆盖历史。

## 为什么需要此入口

IAB 无创建 profile/context 接口，原 `[::1]:5180` 已有保存，不能清存储。原卡 §4 允许独立 origin。普通 UI 无 HTTP 摘要/完整 loader 身份和网络尝试可见面板。新固定 `http://127.0.0.1:15182/` 在读取存储值前先核 local/session storage 均空，非空拒绝且不清；不用禁止 forward 的 15181。

原真实 App/loader/controller/MLP 源码全部未改。只做静态 build（无 Vite dev/HMR），因为实核 Vite dev 即使 `hmr:false` 仍有客户端 WebSocket 尝试。build 使用 inline `configFile:false,envFile:false,envPrefix:[]`，清继承 VITE_*；`publicDir:false,copyPublicDir:false`，不复制 C/O。只读 Node 服务无 API/proxy；固定 C/O 从原公共路径读取且每次响应前核 SHA/长度。实际 HTTP 摘要仍由浏览器从真实 Response 字节另算，不拿磁盘摘要冒充。

## 最短 Mac 步骤（仅独审及 owner 新 revision 绑定后）

1. 先核本批新文件 absent/精确 after，不覆盖用户修改；核 owner sourceRef、既有 C/O 固定磁盘身份。已有 5180/8787 只读归属保持原样；它们未被本 helper 采纳/替代。确认 15182 未占用，不杀任何原服务。
2. 在真实项目根运行既有 Node/tsx，不安装依赖、不使用 `npm run dev`：
   ```sh
   node --import tsx scripts/ui/c1400-browser-evidence/serve.mjs --isolated-one-new-game
   ```
   固定端口先独占；占用即报错、不换口、不读/build。启动失败会关自己 listener。stdout 是实际 root/pid/C/O磁盘身份/14边界源码hash/实际bundle hash，保存到本批工具回执。输出 build 仅 `lab/out/C1400-browser-evidence/web-build`，不写 `packages/web/dist`。
3. 正常浏览器打开 `http://127.0.0.1:15182/`。若非空拒绝，**不清、不改origin、不绕过**，回报具体拒绝。首次面板不自动开局；点击“核实际 C HTTP / loader → 打开真实首页”。浏览器独立 HTTP SHA/673796、真实 loader identity/encoder/descriptorEncoder、source/bundle identity 可见；load-only 不算 forward。
4. 观察首页默认 O 三档；勾选自选四席。0 真人，1/2/3 选择 `ohuo-1030-b-v1 · C1400 · 本地B（候选）`。H 连带 available 是真实情况，需 profile 才能使用；只记录不选择。点击真实“开始练习”一次。wrapper 只接受精确 C 四席；错误席位或重入在真正 start 前拒绝。
5. 面板记录第一次实际 localStorage 保存的脱敏身份投影（无手牌/动作）。真实 MLP 前向 attempted/completed/failed、inputDim、batchRows、featureLength 分列；原实参/返回/异常不变。第一次同步前向结束后 microtask 调用 public `destroy()`，停止进一步推进，保留新局存档。若真人回合 forward 仍0，可只点真实页面“提示”一次（不出牌），触发本局已冻结 C 的本地 neuralHint 并自动停止；若仍无完成前向，如实记录0/pending，不隐藏 eval、不造动作或扩大试玩。
6. 点击“刷新可见证据”取最新服务计数；保留面板可见身份/计数的工具观察。`blockedNetworkAttempts` 所有拒绝尝试都计数；C/O HTTP 和 helper evidence GET 分列。空 public-profile 列表是明确本地隔离适配，不发 HTTP/API，不是读取真实 profile。任何 blocked/failed 都不能写成零尝试或通过。
7. 身份投影/工具回执写入本批新manual证据，按既有15键回填；不上传私牌截图/权重。只有实际证据齐才由 M9 run-checks/finish生成接受回执。本 helper 不写 manual/registry、不自动宣告通过。原5180/8787只读归属与15182实际root/source分开记。
8. `Ctrl-C` 只停此进程。记录端口已释放；不要 kill 按端口检索到的其他进程。保留隔离origin的新局存档与C资产，不清浏览器、不删模型。

## 9缺证的可见来源

- `httpAssetSHA256/httpAssetBytes`：actual.httpResponses 中 C 的 completed、HTTP 200、实际responseUrl/bytes/SHA。
- `resolvedCIdentityMatchesFrozen`：actual.loader 的实际identity、encoder、descriptorEncoder、parameterCount逐字段对原冻结卡；actual.firstSave.seats再对本次局。
- `existingSaveUntouched/isolatedProfileUsed`：新15182 exact origin、initialStorage 0/0、旧5180未操作工具回执；这是原卡允许的独立origin，不是假称创建了profile。
- `candidateReleaseRefVisible`：真实页面option及actual.lastObservedHomeChoices，所选ref值单列。
- `actualTrialSeatsMatch`：actual.firstSave.seats/recorderPolicies，0human，1/2/3 localC/no profile；实际 matchId/revision。
- `realUpstreamRequests`：实际blockedNetworkAttempts（含尝试）、failed/completed HTTP记录、server.blockedRequests 与无proxy服务证据共同核；不是预填expected。
- `hybridEffectRecordedNotSelected`：actual.loader.releaseChoices及真实lastObservedHomeChoices；lastObservedHomeSelectedRefs/currentSave证明未选H，profile列表仅明确空适配。

## 已做/未做

云端：恢复186源精确SHA；隔离helper Node边界测试、原3项UI SSR、TypeScript和真实App静态build；构建插件强制唯一真实MLP/controller module且禁止Vite客户端。未读/复制任何真C/O权重，未起验收listener，未开浏览器真实新局，未执行模型前向或API。完整工程/研究矩阵不重跑；不将有限检查说成全部15项已过。
