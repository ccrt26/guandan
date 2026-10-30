#!/usr/bin/env python3
"""lab/learner.py — PyTorch learner：批量样本一步更新，权重回传。
用法: learner.py cpu|mps
帧协议见 lab/src/bridge.ts（1B 类型 + 4B 长度 + payload）。
优化器/损失为本项目配置（参考 Danzero_plus commit e2b900b 实际行为：普通 MSE + RMSProp）：
  RMSprop(lr=1e-3, alpha=0.9, eps=1e-5, momentum=0, centered=False, weight_decay=0)
"""
import json
import os
import resource
import struct
import sys
import time

import torch
import torch.nn as nn

DEV = torch.device("cpu" if len(sys.argv) < 2 or sys.argv[1] == "cpu" else "mps")
HIDDEN = 256
TRAIN_SUB = 1024      # 每批 2048 条中均匀抽 1024 条训练（预算抽样，其余不用）
OPT_CFG = dict(lr=1e-3, alpha=0.9, eps=1e-5, momentum=0.0, centered=False, weight_decay=0.0)


def tensor_bytes(t):
    t = t.detach().cpu().contiguous().reshape(-1)
    return bytes(t.untyped_storage())[: t.numel() * 4]


def read_frame():
    head = sys.stdin.buffer.read(5)
    if len(head) < 5:
        return None, None
    t = head[0]
    (ln,) = struct.unpack("<I", head[1:5])
    payload = b""
    while len(payload) < ln:
        chunk = sys.stdin.buffer.read(ln - len(payload))
        if not chunk:
            return t, None
        payload += chunk
    return t, payload


def send(t, payload: bytes):
    sys.stdout.buffer.write(bytes([t]) + struct.pack("<I", len(payload)) + payload)
    sys.stdout.buffer.flush()


def send_json(t, obj):
    send(t, json.dumps(obj).encode())


class Net(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.d_in = d
        self.f = nn.Sequential(nn.Linear(d, HIDDEN), nn.Tanh(),
                               nn.Linear(HIDDEN, HIDDEN), nn.Tanh(),
                               nn.Linear(HIDDEN, 1))

    def forward(self, x):
        return self.f(x)

    def load_flat(self, flat):
        i0 = self.d_in
        offs = 0
        lins = [self.f[0], self.f[2], self.f[4]]
        for lin, (i, o) in zip(lins, [(i0, HIDDEN), (HIDDEN, HIDDEN), (HIDDEN, 1)]):
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


def main():
    torch.set_num_threads(2)
    model = None
    opt = None
    d_in = None

    while True:
        t, payload = read_frame()
        if t is None:
            break

        if t == 1:  # INIT
            d_in, cnt = struct.unpack("<II", payload[:8])
            n_weights = cnt
            cfg_len = len(payload) - 8 - n_weights * 4
            cfg = json.loads(payload[8 + n_weights * 4:8 + n_weights * 4 + cfg_len]) if cfg_len > 0 else {}
            model = Net(d_in).to(DEV)
            flat = torch.frombuffer(bytearray(payload[8:8 + n_weights * 4]), dtype=torch.float32).clone()
            model.load_flat(flat)
            opt = torch.optim.RMSprop(model.parameters(), **OPT_CFG)
            send_json(129, {
                "torch": torch.__version__, "python": sys.version.split()[0],
                "arch": os.uname().machine, "device": str(DEV),
                "mpsBuilt": bool(torch.backends.mps.is_built()),
                "mpsAvailable": bool(torch.backends.mps.is_available()),
                "torchThreads": torch.get_num_threads(),
                "cfg": cfg,
            })

        elif t == 2:  # TRAIN（payload 尾部可选 8B 显式 step 种子）
            n, d = struct.unpack("<II", payload[:8])
            fixed_seed = None
            body_end = 8 + n * d * 4 + n * 4
            if len(payload) >= body_end + 8:
                (fixed_seed,) = struct.unpack("<Q", payload[body_end:body_end + 8])
            x = torch.frombuffer(bytearray(payload[8:8 + n * d * 4]), dtype=torch.float32).view(n, d).to(DEV)
            y = torch.frombuffer(bytearray(payload[8 + n * d * 4:body_end]), dtype=torch.float32).view(n).to(DEV)
            sub = min(TRAIN_SUB, n)
            seed_val = fixed_seed if fixed_seed is not None else int(time.time() * 1000) & 0x7fffffff
            g = torch.Generator(device="cpu").manual_seed(seed_val)
            idx = torch.randperm(n, generator=g)[:sub]
            xb, yb = x[idx], y[idx]
            model.eval()
            with torch.no_grad():
                loss_before = torch.mean((model(x).squeeze(-1) - y) ** 2).item()
            model.train()
            t0 = time.perf_counter()
            opt.zero_grad()
            pred = model(xb).squeeze(-1)
            loss = torch.mean((pred - yb) ** 2)
            nonfinite = not torch.isfinite(loss).item()
            grad_norm = -1.0
            if not nonfinite:
                loss.backward()
                grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1e6).item()
                if torch.isfinite(torch.tensor(grad_norm)).item():
                    opt.step()
                else:
                    nonfinite = True
            if DEV.type == "mps":
                torch.mps.synchronize()
            step_ms = (time.perf_counter() - t0) * 1000
            with torch.no_grad():
                loss_sub = torch.mean((model(xb).squeeze(-1) - yb) ** 2).item()
            send_json(130, {
                "lossBefore": loss_before, "lossSub": loss_sub, "gradNorm": grad_norm,
                "nonfinite": nonfinite, "nTrain": sub, "stepMs": round(step_ms, 2),
                "rssKb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // (1024 if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss > 10**7 else 1),
            })

        elif t == 3:  # GET_WEIGHTS
            send(131, tensor_bytes(model.flat()))

        elif t == 4:  # SAVE
            req = json.loads(payload)
            deploy_dir = req["deployDir"]
            os.makedirs(deploy_dir, exist_ok=True)
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(),
                        "cfg": req.get("cfg", {}), "d_in": d_in, "hidden": HIDDEN},
                       os.path.join(deploy_dir, "resume.pt"))
            ok = True
            send_json(132, {"ok": ok, "resumePt": os.path.join(deploy_dir, "resume.pt")})

        elif t == 7:  # LOAD_OPT：从父 resume.pt 恢复优化器状态（weights_only 受限加载）
            req = json.loads(payload)
            try:
                ck = torch.load(req["path"], map_location="cpu", weights_only=True)
                opt.load_state_dict(ck["opt"])
                send_json(137, {"ok": True, "restored": True})
            except Exception as e:
                send_json(137, {"ok": False, "restored": False, "error": str(e)[:200]})

        elif t == 5:  # SHUTDOWN
            send_json(129, {"bye": True})
            break

        elif t == 6:  # EVAL
            n, d = struct.unpack("<II", payload[:8])
            x = torch.frombuffer(bytearray(payload[8:]), dtype=torch.float32).view(n, d).to(DEV)
            model.eval()
            with torch.no_grad():
                out = model(x).squeeze(-1)
            send(136, tensor_bytes(out))

    sys.exit(0)


if __name__ == "__main__":
    main()
