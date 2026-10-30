# 牌桌与贡还确认修复计划

> **For agentic workers:** Use superpowers:executing-plans for UI work; use superpowers:dispatching-parallel-agents for the independent controller domain. Steps use checkbox syntax.

**Goal:** 按用户本轮提供的 DOT 原始交接包修复当前本地正常牌桌与贡还页，使四方出牌、手牌和“不出”提示可靠显示。

**Architecture:** 保留 React/Vite 和现有规则引擎。1800×874 为基准，外层三行布局；手牌用实际容器宽居中、底部锚定，紧凑视口调整区域间距。状态变化在控制器适配层解决，不改牌型/升级/进贡规则。

**Tech Stack:** React 18, TypeScript, CSS, Vitest, CUA browser.

**Spec:** `ui_play_tribute_handoff/{01_完整UI规格.txt,03_layout.json,04_状态机与验收.txt,07_视觉与交付验收.txt}`；已逐文件核验与用户 ZIP 相同。

## Global Constraints

- 本轮新提供的原始包为视觉依据：标签在手牌上方居中，正常页没有虚线占位框。
- 基准1800×874；验证2048×994、1440×900、1366×768及2551×1242。
- 顶栏66，底栏85；基准手牌135×189，整排1570；不缩数字、不换牌素材、不整页贴图。
- 贡还结果页主按钮只能是“继续”，确认前禁止人类与AI出牌；不虚构贡还牌。
- 最后一次过牌仍应显示“不出”，到下一轮首家实际出牌时清除上一轮展示。
- 复用当前工作目录，保留已有未提交AI/复盘修改；不部署、不修改规则、不提交他人修改。

## Review Focus

- 0/1/27/28张手牌在宽窄视口的居中、选中抬升和不裁切。
- 最后一次过牌与trickEnd同一批事件，订阅者仍能读到该方“不出”。
- 贡还双组、单组、无贡及异常结果，确认不得越权或绕过。
- 旧版本确认、连点、刷新待确认/已确认后的本地恢复路径。
- 手牌与已出牌、标签、底栏以及窄屏页头不相互覆盖；按钮/键盘可用。

## Task 1: 控制器展示与确认安全

**Files:** `packages/web/src/game/controller.ts`, 必要时独立的本地恢复/交换模块与`storage.ts`；新增`packages/web/tests/table-presentation.test.ts`及交换安全测试。

**Interfaces:** 保持`tableCombos` / `buildGameTableVM`；确认携带用户看见的稳定结果版本，暴露只读交换历史与错误信息供UI显示。若原存档不支持某路径，优先做本地安全适配，不能假称测试通过。

- [x] 写并运行真实引擎回归：第三次过牌可见；新一轮首出清旧展示。
- [x] 修复展示时序，不延迟或改变规则轮转。
- [x] 写并运行确认版本、异常结果、人类绕过、幂等及本地恢复测试，然后实现对应适配。
- [x] 向UI交付明确接口，运行相关控制器测试。

## Task 2: 牌桌布局与呈现

**Files:** `packages/web/src/ui/gt/{GameTable.tsx,gt.css,layout.ts,viewmodel.ts}`, `packages/web/src/ui/TablePage.tsx`, `packages/web/tests/gt-layout.test.ts`。

**Interfaces:** `handLayout(width, count)` / `tableLayout(width,height,phase)`返回可测试的实际坐标；组件与DOM验收共享该布局结果。

- [x] 写宽窄视口、0/1/27/28张手牌、牌组对齐/边界测试并确认失败。
- [x] 实现基准坐标、实际宽度居中、底部锚定、紧凑视口间距、牌组实际宽度对齐。
- [x] 对照参考调校背景、头像、页头、底栏、贡还面板，修复选中抬升和设置滑杆。
- [x] 接入版本确认、错误状态和只读历史；保持真实/fixture隔离。

## Task 3: 最终验收

- [x] 对当前代码跑完整测试、typecheck、build；记录基线已有错误。
- [x] 用当前浏览器重新截正常/贡还页所有规格视口，保存DOM几何及可访问性验收。
- [x] 真实本地对局验证选牌、提示、出牌和不出；fixtures只证明视觉。
- [x] 独立代码复核，修复重要问题，更新接入映射与交付报告。

## Decisions / progress

- 用户已明确要求直接完成、不重复审批。本轮在已运行5180服务的现有功能分支原地修改，避免分支副本与实际访问页面不一致。
- 并行域只限控制器与界面：独立代理拥有controller/storage及其测试，主代理拥有gt/TablePage及UI测试；不得同时修改同一文件。
- 基线测试已启动，日志 `/private/tmp/guandan-ui-baseline.log`。

- 全部任务已完成。最终 366 tests、typecheck、build 通过；五个视口两状态、真实单/双贡、刷新、历史和四方不出已验。独立审查三个 P2 已修复。详见 `docs/UI-TABLE-RESTORATION-20261028.md`；未模拟减少动态效果及无服务器网络路径，不虚报为通过。
- 补充最小引擎修复：双贡末游较大分支搬错实体牌，回归先证明 108 张仅 107 个唯一实体，再修正搬牌来源；未改选牌和收牌目标规则。
