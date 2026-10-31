/**
 * 本地 LLM 代理：命名 profile 的显式协议/模型/options/secret 整体解析。
 * /api/chat 不读取旧请求头或 .env 凭据，不猜协议、不自动二发。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createProfileRoutes } from './llm-profile-routes.mjs';
import { createPlayRoutes } from './play-routes.mjs';
import { createChatRoutes } from './chat-routes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envPath = join(root, '.env');

const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(env.PORT || 8787);

/** 从本机 ZCode 配置读取 Coding Plan（bigmodel-coding-plan）的接入信息 */
function importZcodePlan() {
  const v2 = join(homedir(), '.zcode', 'v2');
  const plan = { baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'GLM-5.3' };
  try {
    // 来源1：provider_config.json 的 access 规则
    const pc = JSON.parse(readFileSync(join(v2, 'provider_config.json'), 'utf8'));
    const rule = (pc?.config?.providerConfigRules?.providerRules ?? [])
      .find((r) => /coding-plan/.test(r.providerId ?? '') && r.config?.access?.apiKey);
    if (rule?.config?.access?.apiKey) {
      return { ...plan, apiKey: rule.config.access.apiKey, note: `BigModel Coding Plan（${rule.providerId}）` };
    }
  } catch { /* 尝试来源2 */ }
  try {
    // 来源2：config.json 的 provider 段（enabled 的 coding plan）
    const cfg = JSON.parse(readFileSync(join(v2, 'config.json'), 'utf8'));
    const providers = cfg?.provider ?? {};
    for (const [id, p] of Object.entries(providers)) {
      if (/coding-plan/.test(id) && p?.enabled !== false && p?.options?.apiKey) {
        return { baseUrl: p.options.baseURL || plan.baseUrl, apiKey: p.options.apiKey, model: plan.model, note: `Coding Plan（${id}）` };
      }
    }
  } catch { /* ignore */ }
  return null;
}

const handleNamedProfiles = createProfileRoutes({ port: PORT });
const handlePlay = createPlayRoutes({ port: PORT });
const handleChat = createChatRoutes({ port: PORT, importZcodePlan });

createServer(async (req, res) => {
  if (await handleNamedProfiles(req, res)) return;
  if (await handlePlay(req, res)) return;
  // Sensitive chat/import handlers run before legacy generic CORS.
  if (await handleChat(req, res)) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-llm-base, x-llm-key, x-llm-model');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url === '/api/health') {
    const { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model } = env;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, configured: Boolean(baseUrl && apiKey && model), model: model || null }));
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[gd-server] LLM 代理已启动 http://127.0.0.1:${PORT} (model=${env.LLM_MODEL || '未配置'})`);
});
