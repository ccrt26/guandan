/**
 * packages/ai/src/nn/mlp.ts — 纯 TS 前向实现（采样/陪练/复盘共用；学习由 Python learner 完成）。
 * 结构：INPUT_DIM → 256 → 256 → 1（tanh 隐层，线性输出）。
 * 权重扁平布局（与 Python 端逐层一致）：每层先 W(out×in 行主序) 后 b(out)。
 */
import { INPUT_DIM } from './schema';

export const LAYER_SIZES: readonly number[] = [INPUT_DIM, 256, 256, 1];

/** mulberry32：确定性小 RNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MLP {
  readonly sizes: readonly number[];
  /** 输入维度（默认 v1=385；F 分支 399）——forward 行距按它取 */
  readonly inputDim: number;
  W: Float32Array[] = [];
  b: Float32Array[] = [];

  constructor(seed = 20261025, inputDim: number = INPUT_DIM) {
    this.inputDim = inputDim;
    this.sizes = [inputDim, 256, 256, 1];
    const rand = mulberry32(seed);
    // Box-Muller 正态 + He/LeCun 缩放（std = 1/sqrt(fan_in)）
    let spare: number | null = null;
    const gauss = (): number => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const fin = this.sizes[l], fout = this.sizes[l + 1];
      const w = new Float32Array(fout * fin);
      const std = 1 / Math.sqrt(fin);
      for (let i = 0; i < w.length; i++) w[i] = gauss() * std;
      this.W.push(w);
      this.b.push(new Float32Array(fout)); // 偏置 0 起
    }
  }

  get paramCount(): number {
    return this.W.reduce((s, w) => s + w.length, 0) + this.b.reduce((s, b) => s + b.length, 0);
  }

  getWeights(flat = new Float32Array(this.paramCount)): Float32Array {
    let o = 0;
    for (let l = 0; l < this.W.length; l++) {
      flat.set(this.W[l], o); o += this.W[l].length;
      flat.set(this.b[l], o); o += this.b[l].length;
    }
    return flat;
  }

  setWeights(flat: Float32Array): void {
    let o = 0;
    for (let l = 0; l < this.W.length; l++) {
      this.W[l].set(flat.subarray(o, o + this.W[l].length)); o += this.W[l].length;
      this.b[l].set(flat.subarray(o, o + this.b[l].length)); o += this.b[l].length;
    }
  }

  /**
   * 批量前向：X 长度 n×INPUT_DIM，返回 n 个打分。
   * 中间层 tanh、输出线性。为复用内存，内部 h1/h2 按层分配。
   */
  forward(X: Float32Array, n: number, out = new Float32Array(n)): Float32Array {
    const D = this.sizes[0], H1 = this.sizes[1], H2 = this.sizes[2];
    const W1 = this.W[0], b1 = this.b[0], W2 = this.W[1], b2 = this.b[2 - 1], W3 = this.W[2], b3 = this.b[2];
    const h1 = new Float32Array(H1), h2 = new Float32Array(H2);
    for (let s = 0; s < n; s++) {
      const xo = s * D;
      for (let j = 0; j < H1; j++) {
        let acc = b1[j];
        const wo = j * D;
        for (let i = 0; i < D; i++) acc += X[xo + i] * W1[wo + i];
        h1[j] = Math.tanh(acc);
      }
      for (let j = 0; j < H2; j++) {
        let acc = b2[j];
        const wo = j * H1;
        for (let i = 0; i < H1; i++) acc += h1[i] * W2[wo + i];
        h2[j] = Math.tanh(acc);
      }
      let acc = b3[0];
      const wo = 0;
      for (let i = 0; i < H2; i++) acc += h2[i] * W3[wo + i];
      out[s] = acc;
    }
    return out;
  }
}
