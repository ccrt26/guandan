/**
 * lab/src/bridge.ts — Node↔Python 子进程管道（二进制帧，无 HTTP/队列）。
 * 帧格式：1B 类型 + 4B 小端长度 + payload。
 * 采样（TS）→ 批量样本 → learner（PyTorch）一步更新 → 权重回传 → 下一场生效。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PY = new URL('../.venv/bin/python', import.meta.url).pathname;
const SCRIPT = new URL('./legacy_learner.py', import.meta.url).pathname;

const T_INIT = 1, T_TRAIN = 2, T_GETW = 3, T_SAVE = 4, T_SHUT = 5, T_EVAL = 6, T_LOADOPT = 7;
const R_ACK = 129, R_TRAIN = 130, R_WEIGHTS = 131, R_SAVE = 132, R_EVAL = 136, R_LOADOPT = 137;

export interface TrainReply {
  lossBefore: number; lossSub: number; gradNorm: number;
  nonfinite: boolean; nTrain: number; stepMs: number; rssKb: number;
}
export interface LearnerEnv {
  torch: string; python: string; arch: string; device: string;
  mpsBuilt: boolean; mpsAvailable: boolean; torchThreads: number;
}

export class LearnerBridge {
  private proc: ChildProcess;
  private buf = Buffer.alloc(0);
  private waiter: { resolve: (v: { type: number; payload: Buffer }) => void } | null = null;
  env: LearnerEnv | null = null;
  private crashed = false;

  constructor(device: 'cpu' | 'mps', verbose = false) {
    mkdirSync(new URL('../out', import.meta.url).pathname, { recursive: true });
    this.proc = spawn(PY, [SCRIPT, device], {
      stdio: ['pipe', 'pipe', verbose ? 'inherit' : 'pipe'],
    });
    this.proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.trim() && !s.includes('Failed to initialize NumPy')) process.stderr.write(`[py] ${s}`);
    });
    this.proc.on('exit', (code) => {
      this.crashed = true;
      this.waiter?.resolve({ type: -1, payload: Buffer.from(`learner exited: ${code}`) });
    });
    this.proc.stdout!.on('data', (d: Buffer) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    while (true) {
      if (this.buf.length < 5) return;
      const type = this.buf[0];
      const len = this.buf.readUInt32LE(1);
      if (this.buf.length < 5 + len) return;
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      const w = this.waiter;
      if (w) { this.waiter = null; w.resolve({ type, payload }); }
      else if (type !== 129) process.stderr.write(`[bridge] 未匹配帧 type=${type}\n`);
    }
  }

  private send(type: number, payload: Buffer): void {
    if (this.crashed) throw new Error('learner 已退出');
    const head = Buffer.alloc(5);
    head[0] = type;
    head.writeUInt32LE(payload.length, 1);
    this.proc.stdin!.write(Buffer.concat([head, payload]));
  }

  private recv(expectType: number, timeoutMs = 120000): Promise<{ type: number; payload: Buffer }> {
    if (this.waiter) throw new Error('bridge 并发请求');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`bridge 超时 type=${expectType}`)), timeoutMs);
      this.waiter = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
      };
      void reject;
    });
  }

  async init(inputDim: number, weights: Float32Array, cfg: Record<string, unknown>): Promise<LearnerEnv> {
    const cfgBuf = Buffer.from(JSON.stringify(cfg));
    const p = Buffer.alloc(8 + weights.length * 4 + cfgBuf.length);
    p.writeUInt32LE(inputDim, 0);
    p.writeUInt32LE(weights.length, 4);
    Buffer.from(weights.buffer, weights.byteOffset, weights.length * 4).copy(p, 8);
    cfgBuf.copy(p, 8 + weights.length * 4);
    this.send(T_INIT, p);
    const r = await this.recv(R_ACK);
    if (r.type !== R_ACK) throw new Error(`init 异常 type=${r.type}`);
    this.env = JSON.parse(r.payload.toString());
    return this.env;
  }

  async train(feats: Float32Array, targets: Float32Array, n: number, d: number, stepSeed?: number): Promise<TrainReply> {
    const p = Buffer.alloc(8 + (n * d + n) * 4 + (stepSeed !== undefined ? 8 : 0));
    p.writeUInt32LE(n, 0);
    p.writeUInt32LE(d, 4);
    Buffer.from(feats.buffer, feats.byteOffset, n * d * 4).copy(p, 8);
    Buffer.from(targets.buffer, targets.byteOffset, n * 4).copy(p, 8 + n * d * 4);
    if (stepSeed !== undefined) p.writeBigUInt64LE(BigInt(stepSeed), 8 + (n * d + n) * 4);
    this.send(T_TRAIN, p);
    const r = await this.recv(R_TRAIN);
    if (r.type !== R_TRAIN) throw new Error(`train 异常 type=${r.type}`);
    return JSON.parse(r.payload.toString());
  }

  async loadOpt(path: string): Promise<{ ok: boolean; restored: boolean; error?: string }> {
    this.send(T_LOADOPT, Buffer.from(JSON.stringify({ path })));
    const r = await this.recv(R_LOADOPT);
    if (r.type !== R_LOADOPT) throw new Error(`loadOpt 异常 type=${r.type}`);
    return JSON.parse(r.payload.toString());
  }

  async getWeights(): Promise<Float32Array> {
    this.send(T_GETW, Buffer.alloc(0));
    const r = await this.recv(R_WEIGHTS);
    if (r.type !== R_WEIGHTS) throw new Error(`getWeights 异常 type=${r.type}`);
    return new Float32Array(r.payload.buffer.slice(r.payload.byteOffset, r.payload.byteOffset + r.payload.length));
  }

  async evalBatch(feats: Float32Array, n: number, d: number): Promise<Float32Array> {
    const p = Buffer.alloc(8 + n * d * 4);
    p.writeUInt32LE(n, 0);
    p.writeUInt32LE(d, 4);
    Buffer.from(feats.buffer, feats.byteOffset, n * d * 4).copy(p, 8);
    this.send(T_EVAL, p);
    const r = await this.recv(R_EVAL);
    if (r.type !== R_EVAL) throw new Error(`eval 异常 type=${r.type}`);
    return new Float32Array(r.payload.buffer.slice(r.payload.byteOffset, r.payload.byteOffset + r.payload.length));
  }

  async save(deployDir: string): Promise<unknown> {
    this.send(T_SAVE, Buffer.from(JSON.stringify({ deployDir })));
    const r = await this.recv(R_SAVE);
    return JSON.parse(r.payload.toString());
  }

  async shutdown(): Promise<void> {
    try {
      this.send(T_SHUT, Buffer.alloc(0));
      await new Promise((res) => {
        const t = setTimeout(res, 5000);
        this.proc.on('exit', () => { clearTimeout(t); res(); });
      });
      if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
    } catch { /* 尽力而为 */ }
  }
}
