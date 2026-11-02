import { defineConfig } from 'vite';
import { policyIndexPlugin } from './policy-index-plugin';
import react from '@vitejs/plugin-react';
import { taskOutput, assertBuildOutput } from '../../scripts/project-paths.mjs';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [react(), policyIndexPlugin({indexFile:r('../../lab/model-index.json'),catalogFile:r('./src/game/local-model-releases.json'),releasesFile:r('../ai/src/policy/releases.json')}), {
    name: 'task-build-output',
    configResolved(config) {
      if (config.command === 'build') assertBuildOutput(config.root, config.build);
    },
  }],
  build: { outDir: taskOutput('web-build', 'web-build'), emptyOutDir: false },
  resolve: {
    alias: {
      '@gd/engine': r('../../packages/engine/src/index.ts'),
      '@gd/ai': r('../../packages/ai/src/index.ts'),
      '@gd/review': r('../../packages/review/src/index.ts'),
    },
  },
  server: {
    // 固定地址：http://localhost:5180/（strictPort=被占用即报错，不悄悄漂移端口）。
    // 占用时只读查 lsof -nP -iTCP:5180 -sTCP:LISTEN；PID 必须取自本次监听结果。
    // 再核 ps -p <PID> -o pid=,ppid=,user=,lstart=,comm= 和 lsof -a -p <PID> -d cwd -Fn，
    // 结合原启动记录确认是本项目自己启动且获准停止的服务；不 dump argv/env，不猜 launchctl 标签。
    // 应用/重载/回滚先按 5.2.3 §36 J 核 changedFiles/服务引用与已登记 active/unknown 执行源交集；
    // 归属未知不停止、不换端口；源相交且无已核只读执行快照时推迟相关操作，不杀研究或清未知锁。
    // 必要且获准重启时，停止前再次核身份，只经原管理会话/原服务管理器正常停止，禁止按端口批量 kill。
    // 确认停止后在已核项目根用 npm run dev:ui 恢复同一 5180，不用会连带启动后台的 npm run dev；
    // 8787 仅在本次变更及授权涉及时处理；已解决的 5180 不为本注释重启/重验。
    port: 5180,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
