/**
 * 本地 LLM 代理：前端 → localhost:8787 → LLM API（OpenAI 兼容 /chat/completions）。
 * Key 存放在项目根 .env（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），不进前端代码。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envPath = join(root, '.env');

const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE_URL = env.LLM_BASE_URL || '';
const API_KEY = env.LLM_API_KEY || '';
const MODEL = env.LLM_MODEL || '';

const PORT = Number(env.PORT || 8787);

/** 配置来源：请求头（游戏内设置，优先）→ .env（回落） */
function resolveConfig(req) {
  return {
    baseUrl: req.headers['x-llm-base'] || env.LLM_BASE_URL || '',
    apiKey: req.headers['x-llm-key'] || env.LLM_API_KEY || '',
    model: req.headers['x-llm-model'] || env.LLM_MODEL || '',
  };
}

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

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-llm-base, x-llm-key, x-llm-model');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url === '/api/health') {
    const { baseUrl, apiKey, model } = resolveConfig(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, configured: Boolean(baseUrl && apiKey && model), model: model || null }));
    return;
  }
  if (req.url === '/api/import-zcode') {
    const plan = importZcodePlan();
    if (!plan) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '未在本机 ZCode 配置中找到 BigModel Coding Plan' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(plan));
    return;
  }
  if (req.url === '/api/chat' && req.method === 'POST') {
    const { baseUrl, apiKey, model } = resolveConfig(req);
    if (!baseUrl || !apiKey || !model) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'LLM 未配置：请在游戏内「设置」填写 Base URL / API Key / 模型，或在项目根 .env 配置' }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }

    const openAiHeaders = { 'content-type': 'application/json' };
    const openAiBody = JSON.stringify({
      model,
      messages: payload.messages,
      stream: true,
      temperature: payload.temperature ?? 0.5,
      max_tokens: payload.max_tokens ?? 4096,
      ...(payload.thinking ? { thinking: payload.thinking } : {}),
      ...(payload.reasoning_effort ? { reasoning_effort: payload.reasoning_effort } : {}),
    });

    // Coding Plan 的 Key 通常只开通 Anthropic 兼容端点：OpenAI 端点 401/404 时自动切换重试
    const isAnthropicDirect = /\/api\/anthropic\/?(\/v\d)?$/.test(baseUrl.replace(/\/$/, '').replace(/\/v\d+$/, ''));
    let upstream;
    if (isAnthropicDirect) {
      // 直接 Anthropic 通道：伪造一个 401 让下方 anthropic 分支接管
      upstream = { ok: false, status: 401, text: async () => '' };
    } else {
      upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { ...openAiHeaders, authorization: `Bearer ${apiKey}` },
        body: openAiBody,
      });
    }
    if ((upstream.status === 401 || upstream.status === 404) && /open\.bigmodel\.cn/.test(baseUrl)) {
      const anthropicBase = 'https://open.bigmodel.cn/api/anthropic';
      const sys = (payload.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const msgs = (payload.messages ?? []).filter((m) => m.role !== 'system');
      const up2 = await fetch(`${anthropicBase}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'authorization': `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: payload.max_tokens ?? 4096,
          stream: true,
          ...(sys ? { system: sys } : {}),
          messages: msgs,
          ...(payload.thinking ? { thinking: payload.thinking } : {}),
        }),
      });
      if (up2.ok && up2.body) {
        // Anthropic 通道成功：把事件流转为 OpenAI chunk 格式给前端
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
        const reader = up2.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const d = line.replace(/^data:\s*/, '');
            if (!d || d === '[DONE]') continue;
            try {
              const ev = JSON.parse(d);
              if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ev.delta.text } }] })}\n\n`);
              } else if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.thinking === 'string') {
                // 思考增量：透传给前端显示进度（gd_thinking 字段，不进正文）
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' } }], gd_thinking: ev.delta.thinking })}\n\n`);
              } else if (ev.type === 'message_stop') {
                res.write('data: [DONE]\n\n');
              }
            } catch { /* 心跳等忽略 */ }
          }
        }
        res.end();
        return;
      }
      if (up2.status === 401 || up2.status === 400) {
        const t2 = await up2.text().catch(() => '');
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Key 被智谱拒绝（OpenAI 与 Anthropic 两个通道均 401/400）。请检查：1) Key 是否完整粘贴（开头结尾无缺失/空格）；2) 到 bigmodel.cn 控制台确认 Key 状态有效。Anthropic 通道返回: ${t2.slice(0, 160)}`);
        return;
      }
    }
    try {
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => '');
        res.writeHead(upstream.status || 502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`上游错误 ${upstream.status}: ${text.slice(0, 500)}`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      res.end();
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`代理错误: ${String(err)}`);
    }
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[gd-server] LLM 代理已启动 http://127.0.0.1:${PORT} (model=${env.LLM_MODEL || '未配置'})`);
});
