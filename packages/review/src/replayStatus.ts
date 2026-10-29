/**
 * packages/review/src/replayStatus.ts — R2（REVIEW2-EXEC §4.2）：严格回放分级。
 * exact：逐手按原规则合法、声明明确，无任何猜测修补。
 * migrated_verified：仅使用了有唯一依据、经合法性复核的旧格式迁移
 *   （player 字段按牌张归属修正 / 无万能牌歧义时的旧 comboKind 兜底 / 旧轮首 Pass 跳过）。
 * ambiguous：存在多个不等价解释（含万能牌的旧声明兜底、"压不过却出牌"的强制开轮改写）。
 * invalid：无法合法重放。
 * ambiguous/invalid 之后依赖错误局面的评分、模型建议与续打全部禁用（由调用方把关）。
 */
import {
  applyMove, beats, bestResponse, checkRecordIntegrity, type GameRecord, type GameState, rankOrder,
} from '@gd/engine';
import { buildInitialState, resolveCombo, resolveDeclaredFirst } from './replay';

export type ReplayStatus = 'exact' | 'migrated_verified' | 'ambiguous' | 'invalid';

export interface ReplayMigration {
  moveNo: number;
  kind: 'player_fixed_by_ownership' | 'legacy_combo_fallback_nowild' | 'legacy_lead_pass_skip';
}

export interface ReplayClass {
  status: ReplayStatus;
  /** 首个导致非 exact 的手号（invalid/ambiguous 时给全量前缀终点用） */
  firstBadMove?: number;
  reason?: string;
  migrations: ReplayMigration[];
  /** 逐手核实的最长前缀（moveNo；全部通过=最后一手） */
  verifiedPrefixEnd: number;
}

/** 可进入正常教学分析的迁移种类（其余一律降级 ambiguous） */
const SAFE_MIGRATIONS = new Set<ReplayMigration['kind']>([
  'player_fixed_by_ownership', 'legacy_combo_fallback_nowild', 'legacy_lead_pass_skip',
]);

export function classifyReplay(record: GameRecord): ReplayClass {
  const integrity = checkRecordIntegrity(record);
  if (integrity.length > 0) {
    return { status: 'invalid', firstBadMove: integrity[0].moveNo, reason: integrity[0].message, migrations: [], verifiedPrefixEnd: Math.max(0, (integrity[0].moveNo ?? 1) - 1) };
  }

  const state = buildInitialState(record);
  const migrations: ReplayMigration[] = [];
  let status: ReplayStatus = 'exact';
  let firstBadMove: number | undefined;
  let reason: string | undefined;
  let verifiedPrefixEnd = 0;

  const degrade = (s: ReplayStatus, moveNo: number, why: string) => {
    if (status === 'exact' || (status === 'migrated_verified' && s === 'ambiguous')) {
      status = s;
      firstBadMove = moveNo;
      reason = why;
    }
  };

  for (const move of record.moves) {
    if (state.over) break;

    // 出牌人核对：牌张归属唯一 → 允许记为迁移；pass 无牌可归属，player 字段照单信任（与现代引擎一致）
    if (!move.pass && move.cards?.length) {
      const ids = new Set(move.cards.map((c) => c.id));
      const owner = state.hands.findIndex((h) => [...ids].every((id) => h.some((c) => c.id === id)));
      if (owner < 0) {
        degrade('invalid', move.moveNo, `第 ${move.moveNo} 手的牌不属于任何一位玩家当时的手牌`);
        break;
      }
      if (owner !== move.player) migrations.push({ moveNo: move.moveNo, kind: 'player_fixed_by_ownership' });
    }

    if (move.pass) {
      if (!state.lastCombo) {
        // 旧记录的轮首 Pass：现代规则下不存在；跳过仅推进手数（分析时该手不得按正常决策解读）
        migrations.push({ moveNo: move.moveNo, kind: 'legacy_lead_pass_skip' });
        state.moveNo += 1;
        verifiedPrefixEnd = move.moveNo;
        continue;
      }
      state.turn = move.player;
      applyPass(state);
      verifiedPrefixEnd = move.moveNo;
      continue;
    }

    // 声明优先（2026-10-27）：与 replay.resolveCombo 同源——bestResponse 对领出会
    // 重选更强声明，含万能牌时与真实对局分歧（见 resolveDeclaredFirst 注释）
    const resolved = resolveDeclaredFirst(move, state, record);
    const combo = resolved.combo;
    if (combo) {
      if (state.lastCombo && !beats(combo, state.lastCombo)) {
        // 旧版引擎轮次差异：压不过却出牌。这不是可唯一复源的迁移——语义被改写
        degrade('ambiguous', move.moveNo, `第 ${move.moveNo} 手压不过上一牌型却出牌（旧引擎轮次差异，语义无法唯一恢复）`);
        break;
      }
      state.turn = move.player;
      applyPlay(state, combo);
      verifiedPrefixEnd = move.moveNo;
      continue;
    }

    // bestResponse 无法解释 → 旧 comboKind 兜底。含万能牌时声明不唯一 → ambiguous
    if (!move.comboKind || move.mainRank == null) {
      degrade('invalid', move.moveNo, `第 ${move.moveNo} 手牌型无法解释且无兜底声明`);
      break;
    }
    const wildPossible = (move.cards ?? []).some(
      (c) => c.suit === 'H' && state.ctx.ranks.has(c.rank) && c.rank < 15,
    );
    if (wildPossible) {
      degrade('ambiguous', move.moveNo, `第 ${move.moveNo} 手含万能牌且无原始声明，代入方式不唯一`);
      break;
    }
    const fallback = resolveCombo(move, state, record);
    if (!fallback) {
      degrade('invalid', move.moveNo, `第 ${move.moveNo} 手兜底构造失败`);
      break;
    }
    // 兜底构造的声明同样可能压不过（重建轮次与真实轮次分歧）：与 bestResponse 分支
    // 同口径降级 ambiguous，不得把引擎异常当成分类结果
    if (state.lastCombo && !beats(fallback, state.lastCombo)) {
      degrade('ambiguous', move.moveNo, `第 ${move.moveNo} 手兜底声明压不过上一牌型（轮次语义无法唯一恢复）`);
      break;
    }
    migrations.push({ moveNo: move.moveNo, kind: 'legacy_combo_fallback_nowild' });
    state.turn = move.player;
    applyPlay(state, fallback);
    verifiedPrefixEnd = move.moveNo;
  }

  if (status === 'exact' && migrations.length > 0) status = 'migrated_verified';
  if (status === 'migrated_verified' && migrations.some((m) => !SAFE_MIGRATIONS.has(m.kind))) {
    status = 'ambiguous';
  }
  return { status, firstBadMove, reason, migrations, verifiedPrefixEnd };
}

/** 与引擎 applyMove 等价的推进（只做状态推进以继续校验，事件不关心） */
function applyPass(state: GameState): void {
  applyMove(state, { pass: true });
}

function applyPlay(state: GameState, combo: NonNullable<ReturnType<typeof bestResponse>>): void {
  applyMove(state, { pass: false, combo });
}

export { rankOrder };
