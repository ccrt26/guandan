/**
 * lab/src/external_probe.ts — DanZero 外部参照（REVIEW3-EXEC §7）。
 * adapter 阶段：资产完整性→权重受限加载可行性→兼容矩阵框架落盘。
 * 当前如实状态：ckpt 为旧式 torch pickle（含 numpy 数组），weights_only 拒绝
 * （Unsupported operand 149）；受限 numpy 垫片在 torch tensor setstate 层失败；
 * 按执行令不自动改用不受限 pickle、不安装 numpy。→ adapter 受阻，
 * 输出具体差异与解锁条件，不冒充通过；dev/confirm 阶段在前置不满足时退出码 4。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const R2 = join(ROOT, 'lab', 'review2');
const CKPT = join(R2, 'assets', 'danzero-dmc', 'e2b900b01096e0743de945f9963df35cd544f36d', 'q_network.ckpt');

const COMPAT_MATRIX = {
  'DanZero(论文/仓库)': {
    '级牌口径': '双方各自级数（训练世界差异）——本项目现行 stage 口径=台上队唯一级牌',
    '万能牌': '红心级牌逢人配（方向一致；双级 vs 单级的级牌集合不同）',
    '顺子': '五张（A 位置口径需在能跑推理时逐例核对）',
    '王对': '对王合法（方向一致）',
    '进贡/还贡': 'DanZero+ 进贡含启发式模块（非学习）——本项目已全规则化+人类自选还贡',
    '接风/轮次': '需在能跑推理时逐例核对（论文未细化）',
    '观察编码': 'DanZero 原生 567 维（历史 pickletools 反汇编：6 层 567→512×5→1）；与本项目 385 维不同——不得直送',
    '动作空间': 'DanZero 原生动作编码（75 维动作块）；须用其原生候选/映射，不得限制在本项目 top-k 后称完整外部策略',
  },
  note: '矩阵为文档级比对（论文+仓库代码阅读）；运行级逐项核对因权重加载受阻未执行——如实标注',
};

function run(phase: string): number {
  if (!existsSync(CKPT)) { console.error('ckpt 不存在（先下载校验）'); return 4; }
  const data = readFileSync(CKPT);
  const sha = createHash('sha256').update(data).digest('hex');
  const outDir = join(R2, 'external');
  mkdirSync(outDir, { recursive: true });

  if (phase === 'adapter') {
    // 受限加载尝试（venv python，不安装任何东西）
    const probe = spawnSync(join(ROOT, 'lab', '.venv', 'bin', 'python'), ['-c', `
import torch
try:
    sd = torch.load(${JSON.stringify(CKPT)}, map_location='cpu', weights_only=True)
    print('WEIGHTS_ONLY_OK', len(sd))
except Exception as e:
    print('WEIGHTS_ONLY_BLOCKED', str(e)[:120])
`], { encoding: 'utf8', timeout: 60000 });
    const loadResult = (probe.stdout || '').trim();
    const blocked = loadResult.startsWith('WEIGHTS_ONLY_BLOCKED') || probe.status !== 0;
    const result = {
      phase: 'adapter', at: new Date().toISOString(),
      asset: { path: CKPT, bytes: data.length, sha256: sha, source: 'Danzero_plus@e2b900b (actor_torch/q_network.ckpt，DMC 候选评分权重，非最终 PPO 模型)' },
      weightLoad: { status: blocked ? 'blocked' : 'ok', detail: loadResult.slice(0, 200) },
      numpyAvailable: false,
      blockingReasons: [
        '旧式 torch pickle 含 numpy 数组：weights_only 拒绝（Unsupported operand 149）',
        '受限 numpy 垫片解包在 torch tensor setstate 层失败（不执行任意 pickle 的前提下无法重建）',
        '安装 numpy 需用户授权（红线）；不受限 pickle 执行被 §11.5 明令禁止',
      ],
      unlockConditions: [
        '用户批准在隔离 venv 添加 numpy（仅解包用途）',
        '或由信任源提供转换后的纯权重文件（.safetensors/.npy）',
      ],
      compatMatrix: COMPAT_MATRIX,
      status: 'adapter_blocked',
    };
    writeFileSync(join(outDir, 'adapter.json'), JSON.stringify(result, null, 1));
    console.log(`adapter: 受阻（权重加载层）。资产 sha256=${sha.slice(0, 16)}，详见 ${join(outDir, 'adapter.json')}`);
    return 4; // 前置条件不满足：如实退出
  }
  if (phase === 'dev' || phase === 'confirm') {
    const adapter = existsSync(join(outDir, 'adapter.json'))
      ? JSON.parse(readFileSync(join(outDir, 'adapter.json'), 'utf8'))
      : null;
    if (!adapter || adapter.status !== 'ok') {
      console.error(`external ${phase}: 前置不满足（adapter 未通过：${adapter?.status ?? '未运行'}）——对战不执行，不产生伪结果`);
      return 4;
    }
    console.error('adapter 已通过路径未实现（本轮未达此前置）');
    return 3;
  }
  console.error('phase 需为 adapter|dev|confirm');
  return 2;
}

const argv = process.argv.slice(2);
const phaseIdx = argv.indexOf('--phase');
if (process.argv[1] && process.argv[1].includes('external_probe')) {
  process.exit(run(phaseIdx >= 0 ? argv[phaseIdx + 1] : ''));
}
export { run };
