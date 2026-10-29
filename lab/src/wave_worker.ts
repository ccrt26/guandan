/**
 * lab/src/wave_worker.ts — 并行采样 worker（REVIEW3-EXEC §5.2）。
 * 由主进程 fork（child_process IPC，非 worker_threads——parentPort 在 fork 下恒为 null）。
 * 主→worker 消息携带不可变权重快照（结构化克隆拷贝）与全局 matchId；
 * worker 用派生种子跑 sampleMatchStrict（严格契约，违例即报错，不静默改写），
 * 每场完成后回传二进制块（feats 连续 n×385 + ys），不 JSON 展开。
 * 每消息恰一场（主进程单任务派发）——不发 done 消息：done+busy 双翻转会提前放行整波。
 * 随机性只来自 (namespace, master, matchId, purpose)——与 worker 身份/完成顺序无关。
 */
import { MLP, mulberry32 } from './mlp';
import { sampleMatchStrict, type StrictCounters } from './clean1';
import { deriveSeed } from '@gd/ai';

interface WaveMsg {
  type: 'wave';
  waveId: number;
  tasks: number[];
  weights: Float32Array;
  eps: number;
  namespace: string;
  master: number;
  matchGameCap: number;
  /** REVIEW4-F：v2=399 维编码（ctxFill: control=zero / treatment=rule-context） */
  schema?: 'v1' | 'v2';
  ctxFill?: 'zero' | 'rule-context';
  inputDim?: number;
  /** REVIEW5 T0.2：pass 编码（training 必须显式；缺省 legacy 兼容旧 run） */
  passEncoding?: 'legacy-phys10' | 'action64';
}

let currentInputDim = 385;
let model: InstanceType<typeof MLP> = new MLP(1, 385);
const counters: StrictCounters = { illegalIntent: 0, fallback: 0, semanticRewrite: 0, encodingMismatch: 0, labelMismatch: 0 };

process.on('message', (msg: WaveMsg) => {
  if (!msg || msg.type !== 'wave') return;
  if (msg.inputDim && msg.inputDim !== currentInputDim) {
    // 输入维度切换：重建模型实例（权重由主进程随消息下发）
    currentInputDim = msg.inputDim;
    model = new MLP(1, currentInputDim);
  }
  model.setWeights(msg.weights);
  for (const matchId of msg.tasks) {
    const matchSeed = deriveSeed(msg.namespace, msg.master, matchId, 'deal');
    const rand = mulberry32(deriveSeed(msg.namespace, msg.master, matchId, 'explore'));
    // REVIEW5 T0.3：汇报逐场增量（主进程跨 worker 求和，不再覆盖）
    const before: StrictCounters = { ...counters };
    try {
      const r = sampleMatchStrict(model, msg.eps, matchSeed, rand, counters, {
        schema: msg.schema, ctxFill: msg.ctxFill, passEncoding: msg.passEncoding ?? 'legacy-phys10',
      });
      const n = r.samples.length;
      const feats = new Float32Array(n * currentInputDim);
      const ys = new Float32Array(n);
      r.samples.forEach((s, i) => { feats.set(s.feat, i * currentInputDim); ys[i] = s.y; });
      process.send!({
        type: 'match', waveId: msg.waveId, matchId,
        games: r.games, decisions: r.decisions, capped: r.capped, n,
        feats, ys,
        counters: {
          illegalIntent: counters.illegalIntent - before.illegalIntent,
          fallback: counters.fallback - before.fallback,
          semanticRewrite: counters.semanticRewrite - before.semanticRewrite,
          encodingMismatch: counters.encodingMismatch - before.encodingMismatch,
          labelMismatch: counters.labelMismatch - before.labelMismatch,
        },
      });
    } catch (e) {
      process.send!({ type: 'error', waveId: msg.waveId, matchId, message: String(e) });
      return; // 严格契约：违例中止本 worker
    }
  }
});
