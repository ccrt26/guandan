import { useState } from 'react';
import { NEURAL_TIER_LABELS, type NeuralTier } from '@gd/ai';
import type { AppSettings } from '../App';
import { loadStats, loadCurrentMatch } from '../game/storage';
import { PreviewBackdrop } from './PreviewBackdrop';
import { RANK_NAME } from '@gd/engine';

// D1 三档（NeuralTier）：难度只作用于两个对手，队友固定满血新 AI（相对难度，非人类段位）
// 档位→预览资产映射：easy→0 / standard→1 / hard→2（复用三档预览图）
const TIERS: { key: NeuralTier; assetTier: 0 | 1 | 2; no: string; name: string; hint: string }[] = [
  { key: 'easy', assetTier: 0, no: '01', name: NEURAL_TIER_LABELS.easy, hint: '对手会在几步差不多的选择里犹豫' },
  { key: 'standard', assetTier: 1, no: '02', name: NEURAL_TIER_LABELS.standard, hint: '对手更果断，偶有松着' },
  { key: 'hard', assetTier: 2, no: '03', name: NEURAL_TIER_LABELS.hard, hint: '满血新 AI，读牌与残局' },
];

const PASSA: { key: AppSettings['passA']; name: string; hint?: string }[] = [
  { key: 'head', name: '头游即过' },
  { key: 'head3', name: '头游 + 三游', hint: '头游且同伴非末游' },
  { key: 'double', name: '双上游' },
];

const PREVIEW_COPY: Record<NeuralTier, { title: string; sub: string }> = {
  easy: { title: '轻松训练', sub: '对手近并列随机 · 容错空间大' },
  standard: { title: '标准训练', sub: '记牌判断 · 同伴配合 · 出牌规划' },
  hard: { title: '挑战训练', sub: '满血新 AI · 读牌判断 · 残局推演' },
};

export function HomePage({
  settings, onStart, onResume, onAbandon,
}: {
  settings: AppSettings;
  onStart: (s: AppSettings) => void | Promise<void>;
  onResume: () => void;
  onAbandon: () => void;
}) {
  const [tier, setTier] = useState<NeuralTier>(settings.tier);
  const [passA, setPassA] = useState<AppSettings['passA']>(settings.passA);
  const [starting, setStarting] = useState(false);
  const stats = loadStats();
  const resume = loadCurrentMatch();
  const copy = PREVIEW_COPY[tier];
  const passAName = PASSA.find((p) => p.key === passA)!.name;

  const start = async () => {
    if (starting) return; // 防连击
    setStarting(true);
    try {
      await onStart({ tier, passA });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="tz">
      {/* 页头：标题 + 真实战绩 */}
      <header className="tz-head">
        <div className="tz-head-title">
          <h1>以局练策</h1>
          <p>读局 · 协同 · 决策</p>
        </div>
        <div className="tz-head-stats" aria-label="我的战绩">
          {stats.games > 0 ? (
            <>
              <span className="tz-stat"><b>{stats.games}</b><i>场</i></span>
              <em className="tz-vsep" />
              <span className="tz-stat"><b>{Math.round((stats.wins / stats.games) * 100)}%</b><i>胜率</i></span>
              <em className="tz-vsep" />
              <span className="tz-stat"><b>{stats.headFinish}</b><i>次头游</i></span>
            </>
          ) : (
            <span className="tz-stat tz-stat-empty">暂无战绩，打完一场后显示</span>
          )}
          {stats.games > 0 && stats.games <= 5 && <span className="tz-stat-note">仅{stats.games}场，仅供参考。</span>}
        </div>
      </header>

      {/* 铝质训练台 */}
      <main className="tz-console">
        {/* 左：训练设置 */}
        <section className="tz-settings">
          <h2 className="tz-panel-title">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2.4" />
              <circle cx="10" cy="17" r="2.4" />
            </svg>
            训练设置
          </h2>
          <hr className="tz-hr" />

          <h3 className="tz-section">对手强度</h3>
          <div className="tz-radiogroup" role="radiogroup" aria-label="对手强度">
            {TIERS.map((d) => (
              <button
                key={d.key}
                type="button"
                role="radio"
                aria-checked={tier === d.key}
                className={`tz-row${tier === d.key ? ' tz-row-dark' : ''}`}
                onClick={() => setTier(d.key)}
              >
                <span className="tz-led" aria-hidden />
                <span className="tz-no">{d.no}</span>
                <span className="tz-name">{d.name}</span>
                <span className="tz-hint">{d.hint}</span>
              </button>
            ))}
          </div>
          <p className="tz-note">难度只影响两名对手；队友始终为满血新 AI。相对难度，非段位。</p>

          <hr className="tz-hr" />
          <h3 className="tz-section">过 A 规则</h3>
          <div className="tz-radiogroup" role="radiogroup" aria-label="过 A 规则">
            {PASSA.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={passA === p.key}
                className={`tz-row tz-row-thin${passA === p.key ? ' tz-row-lite' : ''}`}
                onClick={() => setPassA(p.key)}
              >
                <span className="tz-led" aria-hidden />
                <span className="tz-name">{p.name}</span>
                {p.hint && <span className="tz-hint">{p.hint}</span>}
              </button>
            ))}
          </div>

          {resume && (
            <div className="tz-resume">
              <span className="tz-led" aria-hidden />
              <span className="tz-resume-txt" title={resume.activeGame ? '当前牌局与贡还确认状态已保存，继续不会重新发牌' : '旧存档保存在局末，继续进入下一局'}>
                <b>上次比赛 · 我方 {RANK_NAME[resume.levels[0]]} 对方 {RANK_NAME[resume.levels[1]]} · {resume.activeGame ? `第${resume.gameNo}局进行中` : `已打${resume.gameNo}局`}</b>
                <i>{resume.activeGame ? '恢复当前牌局及确认状态' : '旧存档：从下一局继续'}</i>
              </span>
              <button type="button" className="tz-resume-btn" onClick={onResume}>继续</button>
              <button type="button" className="tz-resume-drop" onClick={onAbandon} aria-label="放弃上次比赛进度">✕</button>
            </div>
          )}
          <hr className="tz-hr" />
          <div className="tz-neural">
            <div className="tz-neural-head">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M9.5 3.5a2.6 2.6 0 0 0-2.6 2.6c-1.7.4-3 1.9-3 3.8 0 .9.3 1.8.9 2.5-.6.6-.9 1.5-.9 2.4a3.7 3.7 0 0 0 3.7 3.7h.4a2.9 2.9 0 0 0 5.6 0h.4a3.7 3.7 0 0 0 3.7-3.7c0-.9-.3-1.8-.9-2.4.6-.7.9-1.6.9-2.5 0-1.9-1.3-3.4-3-3.8a2.6 2.6 0 0 0-2.6-2.6c-.6 0-1.2.2-1.8.6-.6-.4-1.2-.6-1.8-.6Z" />
                <path d="M12 8v10M12 8c-1.4 0-2.2.7-2.6 1.6M12 12c1.6 0 2.5.8 2.9 1.8" />
              </svg>
              <b>对手 · 新 AI</b>
            </div>
            <p className="tz-neural-warn">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                <path d="M12 3 1.8 20.2h20.4L12 3Zm0 5.2c.7 0 1.2.5 1.2 1.2l-.2 4.6h-2l-.2-4.6c0-.7.5-1.2 1.2-1.2Zm0 9.9a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z" />
              </svg>
              模型 clean2-ck7051（2026-10-27）：正式确认赛对上一代 57.4%（独立种子复训复现 60.9%）。对手默认即此模型，权重加载失败时自动回退启发式并在牌桌横幅如实提示。
            </p>
          </div>
        </section>

        {/* 右：牌桌预览 + 启动栏 */}
        <section className="tz-right">
          <div className="tz-preview">
            <PreviewBackdrop tier={TIERS.find((t) => t.key === tier)!.assetTier} />
            <div className="tz-preview-text" key={tier}>
              <h2>{copy.title}</h2>
              <p>{copy.sub}</p>
            </div>
            <span className="tz-preview-tag">训练预览</span>
          </div>

          <div className="tz-actionbar">
            <span className="tz-ab-label">本次训练</span>
            <em className="tz-ab-sep" />
            <span className="tz-ab-item">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="8" r="3.6" />
                <path d="M4.5 20c.8-3.6 3.9-5.6 7.5-5.6s6.7 2 7.5 5.6" />
              </svg>
              <b>{TIERS.find((d) => d.key === tier)!.name}</b>
            </span>
            <em className="tz-ab-sep" />
            <span className="tz-ab-item">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="5" y="3.5" width="14" height="17" rx="2" />
                <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
              </svg>
              <b>{passAName}</b>
            </span>
            <em className="tz-ab-sep" />
            <span className="tz-ab-item">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
                <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
              </svg>
              <b>从 2 打到 A</b>
            </span>
            <button type="button" className="tz-cta" onClick={start} disabled={starting}>
              <span>{starting ? '正在准备…' : '开始练习'}</span>
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 18 18 6M9 6h9v9" />
              </svg>
            </button>
          </div>
        </section>
      </main>

      {/* 页脚 */}
      <footer className="tz-foot">
        <span>TRAINING / {String(resume ? resume.gameNo + 1 : 1).padStart(2, '0')}</span>
        <span className="tz-foot-ready"><i aria-hidden /> 准备就绪</span>
      </footer>
    </div>
  );
}
