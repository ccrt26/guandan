# 掼蛋训练场

本地运行的掼蛋对战与复盘程序，使用 TypeScript、React 和 Vite。规则引擎、AI、复盘和网页分别位于 `packages/engine`、`packages/ai`、`packages/review`、`packages/web`。

## 当前状态

- 包含四席复盘、队友动作查看、事实与建议来源区分，以及当前可运行的出牌模型。
- 网页仍使用原完整政策 `frozenChampion-clean2-ck7051-encv1-candv2`；`clean2.f32` SHA-256 为 `b8badb4b04290110c093c31219cec23880c837c4bc84e3a5828cc201a15dde55`。
- 已做教学和训练小规模试验，但“基础协作版V1”的正式训练、独立技能考试与完整比赛验收尚未完成。不能据此声称牌力提高或达到真人等级。
- 本仓库是可公开的源码与必要资源版本。完整本机研究数据、实验快照和恢复包不包含在内。

## 本地启动

使用 Node.js 22 或更高版本（本次上传验证使用本机 Node.js），在仓库根目录执行：

```bash
npm ci
npm run dev:ui
```

打开 <http://localhost:5180>。只玩牌和使用离线复盘不需要 API Key。

需要在线教练讲解时，在本机复制配置模板并自行填写：

```bash
cp .env.example .env
# 编辑 .env：填写 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
npm run dev
```

`.env` 只留本机，不要提交。也不要把真实 Key 写入源码、截图、报告或示例配置。

## 验证与构建

```bash
npm run typecheck
npx vitest run packages
npm run build
```

`npx vitest run packages` 验证网页、规则引擎、AI 与复盘程序。原 `npm test` 还包含 `lab/tests` 中依赖本机研究工件的检查；部分研究数据和运行状态未公开，因此它与上面的可移植程序测试范围不同。完整研究不能仅靠这个源码仓库恢复或重新验收。

## 目录

- `packages/engine`：牌型、合法动作、对局状态、升级及进贡还贡。
- `packages/ai`：启发式决策与本地神经网络推理。
- `packages/review`：确定性回放、复盘事实、建议与讲解校验。
- `packages/web`：网页和可选的本地 LLM 代理。
- `lab/src`、`lab/review6` 等：研究程序源码，保留其身份、预算和失败关闭校验；实际运行需要对应的本机数据、协议与资源，不应直接重启历史任务。
- `docs`：设计、架构和历史问题记录；历史报告不代表当前模型验收通过。

公开资源中的字体和图片许可见 `packages/web/public/licenses` 及相应资源说明。详细上传范围见 [docs/GITHUB_UPLOAD.md](docs/GITHUB_UPLOAD.md)。
