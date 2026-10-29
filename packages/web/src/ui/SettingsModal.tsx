import { useState } from 'react';
import { clearLLMConfig, llmHeaders, loadLLMConfig, saveLLMConfig, thinkingParams } from '../game/storage';

/**
 * LLM 设置弹窗：Base URL / API Key / 模型。
 * 配置存浏览器 localStorage，经本地代理转发（Key 不进代码库/网络日志之外的地方）。
 * 支持任何 OpenAI 兼容服务：智谱 GLM、DeepSeek、通义、本地 Ollama 等。
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const saved = loadLLMConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? '');
  const [model, setModel] = useState(saved?.model ?? '');
  const [effort, setEffort] = useState<'max' | 'std' | 'off'>(saved?.effort ?? 'max');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const valid = baseUrl.trim() && apiKey.trim() && model.trim();

  const save = () => {
    if (!valid) return;
    saveLLMConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), effort });
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 1500);
  };

  const clear = () => {
    clearLLMConfig();
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setEffort('max');
    setTestResult(null);
  };

  const test = async () => {
    if (!valid) return;
    setTesting(true);
    setTestResult(null);
    try {
      // 先保存再测试（代理从请求头读，但保持本地与测试一致）
      saveLLMConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), effort });
      const think = thinkingParams(effort);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...llmHeaders() },
        body: JSON.stringify({
          messages: [{ role: 'user', content: '请只回复两个字：正常' }],
          max_tokens: 256,
          temperature: 0,
          ...(think.thinking ? { thinking: think.thinking } : {}),
          ...(think.reasoning_effort ? { reasoning_effort: think.reasoning_effort } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(text.slice(0, 180) || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let out = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, '');
          if (!data || data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? '';
            out += delta;
          } catch { /* 忽略 */ }
        }
      }
      setTestResult(`✅ 连接成功${out ? `（模型回复：${out.trim().slice(0, 20)}）` : ''}`);
    } catch (e) {
      setTestResult(`❌ ${String((e as Error).message || e).slice(0, 200)}`);
    } finally {
      setTesting(false);
    }
  };

  const importZcode = async () => {
    setTestResult(null);
    try {
      const imp = await (await fetch('/api/import-zcode')).json();
      if (!imp.apiKey) throw new Error(imp.error || '未找到');
      setBaseUrl(imp.baseUrl);
      setApiKey(imp.apiKey);
      setModel(imp.model);
      saveLLMConfig({ baseUrl: imp.baseUrl, apiKey: imp.apiKey, model: imp.model, effort });
      setTestResult(`✅ 已导入 ${imp.note || 'Coding Plan'}，可点「测试连接」验证`);
    } catch (e) {
      setTestResult(`❌ 导入失败：${String((e as Error).message).slice(0, 120)}`);
    }
  };

  return (
    <div className="modal-mask settings-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <h2>⚙️ AI 教练设置</h2>
        <p className="settings-sub">
          支持任何 OpenAI 兼容接口；本机装有 ZCode Coding Plan 的可一键导入。
          配置只保存在本机浏览器，经本地代理转发，不上传任何地方。
        </p>
        <button className="btn-primary import-btn" onClick={importZcode}>
          ⚡ 一键导入本机 Coding Plan（GLM-5.3）
        </button>
        <label className="settings-field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://open.bigmodel.cn/api/paas/v4"
            spellCheck={false}
          />
        </label>
        <label className="settings-field">
          <span>API Key</span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴你的 Key"
            type="password"
            spellCheck={false}
          />
        </label>
        <label className="settings-field">
          <span>模型名</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="glm-5.3 / glm-4.7 / deepseek-chat …"
            spellCheck={false}
          />
        </label>
        <label className="settings-field">
          <span>复盘思考强度</span>
          <div className="effort-seg">
            {([['max', '最高（深度思考约5~7分钟）'], ['std', '标准（约1分钟）'], ['off', '极速（不思考）']] as const).map(([val, label]) => (
              <button
                key={val}
                className={`seg-btn${effort === val ? ' on' : ''}`}
                onClick={() => setEffort(val)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </label>
        {testResult && <div className={`settings-result ${testResult.startsWith('✅') ? 'ok' : 'err'}`}>{testResult}</div>}
        <div className="actions">
          <button className="btn-ghost" onClick={test} disabled={!valid || testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="btn-ghost" onClick={clear}>清除</button>
          <button className="btn-primary" onClick={save} disabled={!valid}>
            {savedOk ? '✓ 已保存' : '保存'}
          </button>
        </div>
        <p className="settings-tip">
          保存后无需重启。示例（智谱）：Base URL 填 <code>https://open.bigmodel.cn/api/paas/v4</code>，
          模型填你套餐里的型号（如 glm-4.7）。
        </p>
      </div>
    </div>
  );
}
