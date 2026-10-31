# M / E09 — static fake UI entry (not a daily delivery entry)

Purpose: `legacy-visible-ui-check`, approved 5.2.3 §36 A3 P2014–2019 and M P2238–2243. Only origin `http://127.0.0.1:15183/`. Never direct the user here as a replacement for daily `http://localhost:5180`.

This mounts the actual changed `SettingsModal` and `VerifiedReportTab`; it does not mount App, load a game/controller, load weights, or run a model. The fixture is entirely artificial public facts plus a named fake profile. The whole browser storage object is replaced with a fresh memory-only Map before mounting; existing origin storage is never read. `fetch` is replaced without retaining native fetch. Only the three fake API paths are recognized; all others fail. API calls never leave the browser. Static HTTP handler has no API/proxy route and sets `connect-src 'none'`; bundle has no HMR/WebSocket. No Vite config, dotenv or environment-secret exposure. Fake import retains the full artificial source draft without saving/selecting/testing it.

## Preparation and exact commands

After the owner has independently reviewed/frozen product + helper bytes, the integrator freezes the new A browser contract and records source/build/runtime refs. Only the later authorized local owner starts this helper. Current author has **not** started a listener, used IAB or touched the Mac.

From the exact reviewed checkout root, using its existing dependencies (do not install):

```
node scripts/ui/m-legacy-chat/check-helper.mjs --offline-only
node scripts/ui/m-legacy-chat/serve.mjs --fake-ui-only
```

The first command builds static output and does only finite in-process helper preflight; `build-manifest.json` binds every actual input SHA and emitted `index.html/helper.js/helper.css` bytes. It does **not** listen. The second validates those output hashes and listens **only** on `127.0.0.1:15183`; occupied port fails, never picks another port or kills another service. Its console reports actual PID, cwd and static root. Capture the owner-managed foreground session identity/start/entry. This is not the B03 helper or production `server/index.mjs`.

Output: `lab/out/m-legacy-chat-ui/` only. Preserve original `packages/web/dist`, default O, C release assets, saves and 5180/8787. No package lock, registry or historical accepted receipt changes.

## One bounded IAB pass — actual controls, not another matrix

The authorized reviewer uses the current tool-provided IAB capability and fixed origin. Do not use Chrome as a second suite. Read/capture actual visible status and fixture counters; never infer pass from template booleans.

1. **Explicit test + completion.** Open “打开真实设置”; in the real “明确选用连接” select choose the sole **fake** revision (nothing is auto-selected). Keep toolbar `完整 completed`, click real “测试连接”; observe full-success status and `chatRequests` increments once. This proves only the fake completed UI path, not real API/B03/H qualification.
2. **Test cancel/close + late suppression.** Set toolbar `hold`, click test then real “取消测试”. Observe cancellation before pressing toolbar “释放已挂起的迟到假响应”. Record status and `memoryWrites` immediately before/after release; late response must not show success or increment writes. A second hold/test then real “关闭设置” covers dismissal; release only after close, then reopen to observe no restored late success. No transport timeout is used.
3. **Fake explicit import draft.** In real settings click “显式读取本机 Coding Plan 草稿” once. Observe “未验证、未保存”, blank explicit protocol, no auto test/save/selection and unchanged import-time `memoryWrites`/`chatRequests`; `importRequests` increases once. Do not click real credential inputs or save. Close settings to discard in-memory draft. This does not test the production same-origin importer; backend finite request vectors provide that separate evidence.
4. **Coach normal + interruption/scope.** With settings closed, select the fake connection in the real report. Set completed, click “生成 AI 讲解”; observe “已核验讲解” and supported fact text (unchanged production `acceptCoachResponse`). Set hold and generate, then real “取消讲解”; release and observe no accepted late result/cache increment. Hold/generate again, press helper “切换公开记录 scope”; cancellation must happen before release, no late accepted output/write. Return to the original displayed record before any further positive generation. Optionally use “关闭真实讲解页” for the same unmount route only if the frozen required action list calls for it; not a new suite.
5. **Stop only the owned helper.** Close the IAB page per its supported tool, then send normal Ctrl-C/stop through the exact session that started `serve.mjs`. Await that owned session's actual exit/close output. Do not use broad port kill, unrelated process scans or restart daily services. Record true cleanup state; uncertainty remains pending.

Toolbar `held/aborted/released`, API request counts and memory-only report write counts assist observation, but the toolbar never self-certifies acceptance. A held fake deliberately ignores transport abort until explicit release, so the real UI generation guards must suppress the late result. `nativeFetchCalls:0` describes the adapter construction; it is not a substitute for tool/network evidence. No real provider stream parser is tested here; the independent backend finite vectors own completed/error/EOF framing proof.

## Evidence and boundaries

Freeze/capture current source refs, `fixture.json`, `build-manifest.json`, actual browser entry/tool capability, exact origin/URL, session runtime/source identity and action-level receipts/screens. Record required actions in one new effective A contract; don't claim any old B03/manual evidence as this run. Hook-runner unit checks are callback evidence only. Current static build/offline preflight is **not IAB, local acceptance, daily publication, live API or training**. Any missing tool/denial stays pending with action/target/reason; no alternate-channel workaround.
