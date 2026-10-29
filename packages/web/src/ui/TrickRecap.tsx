import { RANK_NAME, type Card, type LevelCtx } from '@gd/engine';
import type { MoveAnalysis } from '@gd/review';
import { gradeIcon } from '@gd/review';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', J: '' };

/**
 * 关键手可视化复现卡：教练报告里 [[MOVE:N]] 占位符的落点。
 * 复现这一轮：各家出的牌面（图）→ 你的动作高亮 → 引擎建议 → 一键跳回放。
 */
export function TrickRecap({
  moveNo, mv, ctx, seatNames, onJump,
}: {
  moveNo: string;
  mv: MoveAnalysis | undefined;
  ctx: LevelCtx;
  seatNames: string[];
  onJump: (moveNo: number) => void;
}) {
  if (!mv) {
    return (
      <div className="recap-card">
        <div className="recap-head">第 {moveNo} 手（详情暂缺）</div>
      </div>
    );
  }
  const mini = (cards: Card[], wild = false) => (
    <span className={`recap-cards${wild ? ' recap-wild' : ''}`}>
      {cards.map((c) => (
        <span key={c.id} className="recap-chip">
          {c.suit === 'J' ? (c.rank === 17 ? '大王' : '小王') : `${SUIT_GLYPH[c.suit]}${RANK_NAME[c.rank]}`}
        </span>
      ))}
    </span>
  );

  return (
    <div className={`recap-card grade-${mv.grade}`}>
      <div className="recap-head">
        <span className="recap-title">第 {mv.moveNo} 手复现</span>
        <span className="recap-grade">{gradeIcon(mv.grade)}</span>
        <button className="btn-ghost btn-small recap-jump" onClick={() => onJump(mv.moveNo)}>▶ 回放此手</button>
      </div>
      <div className="recap-body">
        {mv.trickBefore.map((a, i) => (
          <div key={i} className="recap-row">
            <span className={`recap-who ${a.player === 0 ? 'me' : a.player === 2 ? 'mate' : ''}`}>{seatNames[a.player]}</span>
            {a.pass ? <span className="recap-pass">不出</span> : mini(a.cards ?? [])}
          </div>
        ))}
        <div className={`recap-row recap-you ${mv.grade}`}>
          <span className="recap-who me">你</span>
          {mv.pass ? <span className="recap-pass">不出</span> : mini(mv.playedCards)}
          <span className="recap-mark">{mv.grade === 'good' ? '与首选一致' : mv.grade === 'forced' ? '无牌可跟' : mv.grade === 'ok' ? '略有分歧' : mv.grade === 'uncovered' ? '候选未覆盖' : '分歧较大'}</span>
        </div>
        {(mv.grade === 'divergent' || mv.grade === 'ok') && !mv.recommendedPass && mv.recCards.length > 0 && (
          <div className="recap-row recap-rec">
            <span className="recap-who">启发式更偏好</span>
            {mini(mv.recCards, true)}
            <span className="recap-mark rec">{mv.recommendedText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
