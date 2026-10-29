# lab/ — 神经网络训练实验目录（独立于 npm workspaces）

隔离 PyTorch 路线的专用实验环境。**正式三档 AI 与游戏主体零改动**；本目录所有产物仅为实验候选。

## 环境

- venv：`lab/.venv`（CLT python3 3.9.6 arm64 + torch 2.8.0，`--only-binary=:all:`，无其他依赖）
- 复建：`python3 -m venv lab/.venv && lab/.venv/bin/python -m pip install --only-binary=:all: "torch==2.8.0"`

## 文件

| 文件 | 作用 |
|---|---|
| `src/schema.ts` | 输入编码唯一权威（state 317 + action 68 = 385 维；`SCHEMA_VERSION=gd-lab-schema-v1`） |
| `src/mlp.ts` | 纯 TS 前向（385→256×2→1，tanh 隐层；与 PyTorch 逐位一致，实测差 3e-7） |
| `src/seat.ts` | 神经席位：受限观察 + 候选去重 + ε-greedy |
| `src/sampler.ts` | 整场采样（y = g + W）与评测跑者 |
| `src/bridge.ts` + `learner.py` | Node↔Python 二进制帧协议；RMSprop(lr1e-3,α0.9,ε1e-5)+MSE |
| `src/run.ts` | 主控：`bench [分钟]` 性能窗口 / `train [分钟]` 学习窗口 |
| `src/checks.ts` | 14 项基础验证（含平行世界反作弊） |
| `src/reload_check.ts` | 部署包重载确定性 |
| `out/` | 报告与权重包（bench_report.json / train_report.json / train_progress.jsonl / deploy_*） |
| `out/candidate_danzero/` | rlcard-guandan DanZero 候选只读检查（源码 + pickle 反汇编，**未执行**） |

## 常用命令（在项目根）

```bash
npx tsx lab/src/checks.ts            # 基础验证
npx tsx lab/src/run.ts bench 8       # 性能窗口
npx tsx lab/src/run.ts train 230     # 学习窗口（230 分钟）
npx tsx lab/src/reload_check.ts      # 部署包重载验证
tail -5 lab/out/train_progress.jsonl # 训练进度
```

## 权重包

- 部署包 `deploy_*/`：`weights.f32`（float32 LE 扁平，层序 W,b×3）+ `schema.json` + `config.json`——游戏端推理所需全部。
- 恢复包 `deploy_*/resume.pt`：权重+优化器状态+配置（torch.save，恢复试验用）。
- 换模型：同 `SCHEMA_VERSION` 与层结构可直接替换 weights.f32。

## 安全纪律

- venv 只是依赖隔离，不是沙箱：未知 pickle 不 `pickle.load`（候选 ckpt 仅用 `pickletools` 反汇编）。
- 特征只用自家手牌+公开信息；`checks.ts` 平行世界测试锁死。
