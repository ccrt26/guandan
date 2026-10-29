import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [react()],
  resolve: {
    alias: {
      '@gd/engine': r('../../packages/engine/src/index.ts'),
      '@gd/ai': r('../../packages/ai/src/index.ts'),
      '@gd/review': r('../../packages/review/src/index.ts'),
    },
  },
  server: {
    // 固定地址：http://localhost:5180/（strictPort=被占用即报错，不悄悄漂移端口；
    // 释放旧进程：lsof -ti:5180 | xargs kill）
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
