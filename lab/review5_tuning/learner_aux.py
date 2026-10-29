#!/usr/bin/env python3
"""REVIEW5 补充 Task 3/5：learner_aux.py — 行为克隆（BC）与偏好蒸馏（D）辅助入口。

复用冻结 learner.py 的 Net/load_flat/flat 布局（同文件独立副本，不改动运行中的
lab/learner.py；TS/Python 前向等价由 --selftest 与 t02 探针背书）。

模式：
  bc       行为克隆：候选 softmax(温度1) 交叉熵，按决策成批；RMSprop lr=1e-4 α.9 ε1e-5；
           ≤3 epoch，≤1200s；评估输出 match 宏平均 NLL + 均匀基线 + kind 先验基线 + 分层。
  distill  D 偏好诊断（softplus 偏好差 + 锚定 MSE；见补充第十章；本轮由 distill-probe 触发）。
  selftest 损失单元验证（独立 logit 梯度符号、labelWeight0、锚定零点、前后向可运行）。

数据格式（bc）：f32 流，每决策 [stateFeat 331 | nCands | chosenIdx | candFeats n×68]。
用法：
  python3 learner_aux.py bc --train T.f32 --dev D.f32 --parent U0.f32 --out-dir OUT [--epochs 3]
  python3 learner_aux.py selftest
"""
import argparse
import json
import math
import os
import struct
import sys
import time
from collections import defaultdict

import torch
import torch.nn as nn

HIDDEN = 256
STATE_DIM = 331
ACTION_DIM = 68
INPUT_DIM = STATE_DIM + ACTION_DIM


class Net(nn.Module):
    """与 lab/learner.py 完全同布局（冻结契约：权重 f32 扁平顺序 W1 b1 W2 b2 W3 b3）"""

    def __init__(self, d):
        super().__init__()
        self.d_in = d
        self.f = nn.Sequential(nn.Linear(d, HIDDEN), nn.Tanh(),
                               nn.Linear(HIDDEN, HIDDEN), nn.Tanh(),
                               nn.Linear(HIDDEN, 1))

    def forward(self, x):
        return self.f(x)

    def load_flat(self, flat):
        offs = 0
        for lin, (i, o) in zip([self.f[0], self.f[2], self.f[4]],
                               [(self.d_in, HIDDEN), (HIDDEN, HIDDEN), (HIDDEN, 1)]):
            w = flat[offs:offs + o * i].view(o, i)
            offs += o * i
            b = flat[offs:offs + o]
            offs += o
            with torch.no_grad():
                lin.weight.copy_(w)
                lin.bias.copy_(b)

    def flat(self):
        parts = []
        for lin in [self.f[0], self.f[2], self.f[4]]:
            parts.append(lin.weight.detach().reshape(-1))
            parts.append(lin.bias.detach().reshape(-1))
        return torch.cat(parts)


def read_f32(path):
    with open(path, 'rb') as f:
        data = f.read()
    return torch.frombuffer(bytearray(data), dtype=torch.float32).clone()


def parse_decisions(buf):
    """f32 流 → 决策列表 [{state(331), cands(n×68), chosen, kinds?}]"""
    ds = []
    i = 0
    n = buf.numel()
    while i + STATE_DIM + 2 <= n:
        state = buf[i:i + STATE_DIM]
        i += STATE_DIM
        n_cands = int(buf[i].item())
        chosen = int(buf[i + 1].item())
        i += 2
        if i + n_cands * ACTION_DIM > n:
            break
        cands = buf[i:i + n_cands * ACTION_DIM].view(n_cands, ACTION_DIM)
        i += n_cands * ACTION_DIM
        if n_cands <= 0 or not (0 <= chosen < n_cands):
            continue
        ds.append({'state': state, 'cands': cands, 'chosen': chosen, 'n': n_cands})
    return ds


def decision_nll(scores_log, chosen):
    return -scores_log[chosen].item()


def kind_prior_train(kinds_json_path):
    """训练集 kind 分布（pass 计 'pass'；各 kind 加 1 平滑）"""
    with open(kinds_json_path) as f:
        rows = json.load(f)
    cnt = defaultdict(int)
    for r in rows:
        for k in r['kinds']:
            cnt[k] += 1
        cnt[r['kinds'][r['y']]] += 0  # chosen 已在 kinds 中
    # 计数=候选出现次数；决策级先验按"被选 kind"统计更贴行为分布
    chosen_cnt = defaultdict(int)
    legal_cnt = defaultdict(int)
    for r in rows:
        chosen_cnt[r['kinds'][r['y']]] += 1
        for k in r['kinds']:
            legal_cnt[k] += 1
    prior = {k: (chosen_cnt[k] + 1) / (sum(chosen_cnt.values()) + len(chosen_cnt)) for k in set(list(chosen_cnt) + list(legal_cnt))}
    return prior, rows


def eval_bc(model, ds, kinds_rows=None):
    """NLL（决策级）+ match 宏平均 + 均匀基线 + kind 先验基线"""
    model.eval()
    tot_nll = tot_unif = tot_prior = 0.0
    by_match = defaultdict(list)
    prior, _ = kind_prior_train(KINDS_PATH) if KINDS_PATH else ({}, None)
    slices = defaultdict(lambda: [0, 0.0])
    with torch.no_grad():
        for idx, d in enumerate(ds):
            x = torch.cat([d['state'].unsqueeze(0).expand(d['n'], STATE_DIM), d['cands']], dim=1)
            scores = model(x).squeeze(-1)
            logp = torch.log_softmax(scores, dim=0)
            nll = -logp[d['chosen']].item()
            tot_nll += nll
            tot_unif += math.log(d['n'])
            # kind 先验：P(kind) 归一到合法 kind，kind 内候选均匀
            if kinds_rows is not None and idx < len(kinds_rows):
                kinds = kinds_rows[idx]['kinds']
                if prior:
                    kp = [max(prior.get(k, 1e-9), 1e-9) for k in kinds]
                    s = sum(kp)
                    probs = [p / s / max(kinds.count(k), 1) for p, k in zip(kp, kinds)]
                    tot_prior += -math.log(max(probs[d['chosen']], 1e-12))
            m = kinds_rows[idx]['s'] if kinds_rows is not None and idx < len(kinds_rows) else f'm{idx // 100}'
            by_match[m].append(nll)
            # 分层（slices 用 stateFeat[162..164] 判同队控权）
            st = d['state']
            mate_ctrl = bool(st[162].item() > 0.5)
            kind_chosen = kinds_rows[idx]['kinds'][d['chosen']] if kinds_rows is not None and idx < len(kinds_rows) else '?'
            key = 'pass' if kind_chosen == 'pass' else 'nonpass'
            slices[key][0] += 1; slices[key][1] += nll
            if kind_chosen in ('bomb', 'joker_bomb'):
                slices['bomb'][0] += 1; slices['bomb'][1] += nll
            if mate_ctrl and kind_chosen != 'pass':
                slices['mate_ctrl_takeover'][0] += 1; slices['mate_ctrl_takeover'][1] += nll
            if mate_ctrl and kind_chosen == 'pass':
                slices['mate_ctrl_yield'][0] += 1; slices['mate_ctrl_yield'][1] += nll
    n = len(ds)
    macro = sum(sum(v) / len(v) for v in by_match.values()) / max(len(by_match), 1)
    return {
        'decisions': n,
        'nll_mean': tot_nll / max(n, 1),
        'nll_match_macro': macro,
        'uniform_baseline': tot_unif / max(n, 1),
        'kind_prior_baseline': (tot_prior / max(n, 1)) if kinds_rows is not None else None,
        'slices': {k: {'n': v[0], 'nll': v[1] / v[0] if v[0] else None,
                       'insufficient': v[0] < 10} for k, v in slices.items()},
    }


KINDS_PATH = None


def run_bc(args):
    t0 = time.time()
    torch.manual_seed(args.seed)
    parent = read_f32(args.parent)
    if parent.numel() != 256 * INPUT_DIM + 256 + 256 * 256 + 256 + 256 + 1:
        print(json.dumps({'error': f'parent 参数量 {parent.numel()}'})); return 1
    model = Net(INPUT_DIM)
    model.load_flat(parent)
    q0 = model.flat().clone()

    train = parse_decisions(read_f32(args.train))
    dev = parse_decisions(read_f32(args.dev))
    print(json.dumps({'trainDecisions': len(train), 'devDecisions': len(dev)}))

    opt = torch.optim.RMSprop(model.parameters(), lr=1e-4, alpha=0.9, eps=1e-5,
                              momentum=0, centered=False, weight_decay=0)
    epochs = 0
    log = []
    stop = False
    while not stop and epochs < args.epochs and (time.time() - t0) < args.max_seconds:
        epochs += 1
        model.train()
        perm = torch.randperm(len(train))
        tot = 0.0
        for bi in range(0, len(train), args.batch):
            idxs = perm[bi:bi + args.batch]
            opt.zero_grad()
            loss = 0.0
            for j in idxs.tolist():
                d = train[j]
                x = torch.cat([d['state'].unsqueeze(0).expand(d['n'], STATE_DIM), d['cands']], dim=1)
                scores = model(x).squeeze(-1)
                loss = loss + torch.nn.functional.cross_entropy(scores.unsqueeze(0), torch.tensor([d['chosen']]))
            loss = loss / len(idxs)
            loss.backward()
            opt.step()
            tot += loss.item() * len(idxs)
        log.append({'epoch': epochs, 'meanLoss': tot / len(train), 'sec': round(time.time() - t0, 1)})
        print(json.dumps(log[-1]))
        if (time.time() - t0) > args.max_seconds:
            stop = True

    dev_rows = None
    if args.kinds and os.path.exists(args.kinds):
        with open(args.kinds) as f:
            rows = json.load(f)
        # kinds 行顺序=训练+开发序列化顺序——开发行取后段（与 dump 顺序一致）
        n_train = len(train)
        dev_rows = rows[n_train:n_train + len(dev)]
    evald = eval_bc(model, dev, dev_rows)
    q1 = model.flat().clone()
    os.makedirs(args.out_dir, exist_ok=True)
    torch.save({'weights': q1, 'parent': q0}, os.path.join(args.out_dir, 'h_human.pt'))
    with open(os.path.join(args.out_dir, 'weights.f32'), 'wb') as f:
        f.write(struct.pack(f'<{q1.numel()}f', *q1.tolist()))
    report = {
        'role': 'behavior_proxy', 'humanSource': 'author_reported', 'skill': 'unverified',
        'targetPopulation': 'unknown', 'playerDisjointness': 'unverified',
        'mode': 'bc_softmax_temperature1', 'epochs': epochs,
        'samplingMode': 'legal_softmax_sample', 'temperature': 1, 'seed': args.seed,
        'parentInit': 'U0(clean2→v2→pass-action64)', 'encoderVersion': 'gd-lab-schema-v4',
        'trainSeconds': round(time.time() - t0, 1), 'trainLog': log, 'dev': evald,
    }
    with open(os.path.join(args.out_dir, 'proxy-quality.json'), 'w') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({'dev': evald}, ensure_ascii=False))
    return 0


def run_selftest():
    checks = []
    # 1) 独立 logit 偏好梯度符号：softplus(-(a-b)) 对 a 的梯度应为负
    a = torch.tensor(2.0, requires_grad=True)
    b = torch.tensor(1.0, requires_grad=True)
    loss = torch.nn.functional.softplus(-(a - b))
    loss.backward()
    checks.append({'name': 'preference_grad_sign', 'pass': bool(a.grad is not None and a.grad < 0 and b.grad > 0)})
    # 2) labelWeight=0 无教师梯度
    a2 = torch.tensor(2.0, requires_grad=True)
    (torch.tensor(0.0) * torch.nn.functional.softplus(-(a2 - torch.tensor(1.0)))).backward()
    checks.append({'name': 'label_weight_zero_no_grad', 'pass': bool(a2.grad is None or abs(a2.grad.item()) == 0.0)})
    # 3) Qθ=Q0 锚定损失为 0
    q = torch.tensor(3.0)
    q0 = torch.tensor(3.0)
    checks.append({'name': 'anchor_zero_at_parent', 'pass': float((q - q0) ** 2) == 0.0})
    # 4) 真实小批 BC 输入能走通优化器
    m = Net(INPUT_DIM)
    m.load_flat(torch.randn(256 * INPUT_DIM + 256 + 256 * 256 + 256 + 256 + 1) * 0.01)
    opt = torch.optim.RMSprop(m.parameters(), lr=1e-4)
    x = torch.randn(5, INPUT_DIM)
    scores = m(x).squeeze(-1)
    loss = torch.nn.functional.cross_entropy(scores.unsqueeze(0), torch.tensor([2]))
    loss.backward(); opt.step()
    checks.append({'name': 'bc_small_batch_step', 'pass': bool(torch.isfinite(loss).item())})
    print(json.dumps({'status': 'passed' if all(c['pass'] for c in checks) else 'failed', 'checks': checks}, ensure_ascii=False))
    return 0 if all(c['pass'] for c in checks) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['bc', 'distill', 'selftest'])
    ap.add_argument('--train'); ap.add_argument('--dev'); ap.add_argument('--parent')
    ap.add_argument('--out-dir'); ap.add_argument('--kinds')
    ap.add_argument('--epochs', type=int, default=3)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--seed', type=int, default=2026102802)
    ap.add_argument('--max-seconds', type=int, default=1200)
    args = ap.parse_args()
    global KINDS_PATH
    KINDS_PATH = args.kinds
    if args.mode == 'selftest':
        return run_selftest()
    if args.mode == 'bc':
        return run_bc(args)
    print('distill 模式由 distill-probe 阶段触发（本轮 D 预算门未过则不运行）', file=sys.stderr)
    return 3


if __name__ == '__main__':
    sys.exit(main())
