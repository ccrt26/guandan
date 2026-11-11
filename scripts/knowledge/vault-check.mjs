#!/usr/bin/env node
// vault-check.mjs — 公开 CLI 入口（v3）：通过参数数组调用 Python 后端 vault_check.py
// 后端不可用时返回退出码 2（工具执行失败），不拼 shell 命令、不内嵌真实库路径。
// 退出码：0 通过；1 结构/内容错误；2 参数/解析器/I-O 工具失败。报告由后端写入 --report（已存在则拒绝覆盖）。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKENDS = [join(HERE, 'vault_check.py')];
const PYTHONS = ['/Library/Developer/CommandLineTools/usr/bin/python3', 'python3'];
const usage = '用法：node vault-check.mjs validate|reverse|inventory --root <库> --report <报告> [--source SRC:E] [--baseline F] [--mapping F]';

const args = process.argv.slice(2);
const cmd = args[0];
if (!['validate', 'reverse', 'inventory'].includes(cmd) || !args.includes('--root') || !args.includes('--report')) {
  console.error(usage); process.exit(2);
}
let backend = null, python = null;
for (const b of BACKENDS) if (existsSync(b)) { backend = b; break; }
if (!backend) { console.error('vault_check.py 后端不可用'); process.exit(2); }
for (const p of PYTHONS) {
  if (spawnSync(p, ['-B', '-c', 'import yaml'], { encoding: 'utf8' }).status === 0) { python = p; break; }
}
if (!python) { console.error('Python/PyYAML 不可用（工具执行失败，退出码 2）'); process.exit(2); }
const r = spawnSync(python, ['-B', backend, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
process.exit(r.status === null ? 2 : r.status);
