import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 开发期错误显性化：Vite 只覆盖编译错误，运行时异常钉在页面角落，冒烟时一眼可见
if (import.meta.env.DEV) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;z-index:99999;display:none;max-height:30vh;overflow:auto;' +
    'background:#7f1d1d;color:#fecaca;font:12px/1.5 monospace;padding:6px 10px;white-space:pre-wrap';
  document.body.appendChild(box);
  const show = (msg: string) => {
    box.style.display = 'block';
    box.textContent += `${new Date().toLocaleTimeString()} ${msg}\n`;
  };
  window.addEventListener('error', (e) => show(`Error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => show(`Promise: ${String(e.reason)}`));
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
