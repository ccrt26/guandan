/** 部署包重载验证：deploy_init 权重 → MLP 前向，与原模型逐位一致 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INPUT_DIM } from './schema';
import { MLP } from './mlp';
const dir = join(import.meta.dirname, '..', 'out', 'deploy_init');
const buf = readFileSync(join(dir, 'weights.f32'));
const w = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const a = new MLP(20261025);
const b = new MLP(1); b.setWeights(w);
const X = new Float32Array(32 * INPUT_DIM);
let seed = 7;
for (let i = 0; i < X.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; X[i] = (seed / 0x7fffffff) * 2 - 1; }
const sa = a.forward(X, 32), sb = b.forward(X, 32);
let max = 0; for (let i = 0; i < 32; i++) max = Math.max(max, Math.abs(sa[i] - sb[i]));
console.log(`权重文件 ${buf.byteLength} 字节，重载后前向最大差 ${max.toExponential(2)} →`, max === 0 ? '逐位一致 ✓' : '不一致 ✗');
process.exit(max === 0 ? 0 : 1);
