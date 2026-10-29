/**
 * packages/ai/src/nn/wave.ts — 并行采样核心纯函数（REVIEW3-EXEC §5.2/5.3）。
 * 种子派生：experiment namespace + master seed + 全局 matchId + purpose，
 * 禁止由 workerId、完成顺序、当前时间、进程启动顺序参与训练随机性。
 * 归并：整波完成后按 matchId、场内决策序固定归并，与谁先完成无关。
 * 版本年龄：行为权重快照 → 更新时刻的滞后统计（p50/p95/max）。
 */

/** 双 lane FNV 派生（与 lab 侧工具一致的非密码学身份哈希） */
function fnv32(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 派生一个 uint32 种子：namespace 内 (master, matchId, purpose) 唯一决定 */
export function deriveSeed(namespace: string, master: number, matchId: number, purpose: string): number {
  return fnv32(`${namespace}|${master}#${matchId}|${purpose}`, 0x811c9dc5);
}

/** 派生更新步种子（全局 updateId 驱动；learner 子抽样确定性） */
export function deriveStepSeed(namespace: string, master: number, updateId: number): number {
  return fnv32(`${namespace}|${master}|step#${updateId}`, 0x9e3779b9);
}

/** 波任务列表：[from, from+waveSize) 的连续全局 matchId（与 workers 数无关） */
export function waveTasks(nextMatchId: number, waveSize: number): number[] {
  return Array.from({ length: waveSize }, (_, i) => nextMatchId + i);
}

/** 归并顺序：按 matchId 升序（场内顺序由 worker 内部决策序保证） */
export function mergeOrder(results: Array<{ matchId: number }>): Array<{ matchId: number }> {
  return [...results].sort((a, b) => a.matchId - b.matchId);
}

/** 本波更新数：继承尾部 r_w 与本波成熟标签 N_w */
export function waveUpdateCount(tailLen: number, waveMature: number, groupSize: number): number {
  return Math.floor((tailLen + waveMature) / groupSize);
}

export interface AgeStat { p50: number; p95: number; max: number }

/** 块内样本的版本年龄（样本来自 waveId 快照；当前已进行到 updateNow） */
export function agesOf(
  mix: Array<{ waveId: number; count: number }>,
  updatesAtWaveEnd: Map<number, number>,
  updateNow: number,
): AgeStat {
  const ages: number[] = [];
  for (const { waveId, count } of mix) {
    const born = updatesAtWaveEnd.get(waveId) ?? 0;
    const age = Math.max(0, updateNow - born);
    for (let i = 0; i < count; i++) ages.push(age);
  }
  if (ages.length === 0) return { p50: 0, p95: 0, max: 0 };
  ages.sort((a, b) => a - b);
  const q = (p: number) => ages[Math.min(ages.length - 1, Math.round(p * (ages.length - 1)))];
  return { p50: q(0.5), p95: q(0.95), max: ages[ages.length - 1] };
}

/** 波合并缓冲的块切分（供消费侧）：返回每个 2048 块的 waveId 构成（年龄统计用） */
export function sliceBlocks(
  stream: Array<{ waveId: number; count: number }>,
  groupSize: number,
): Array<Array<{ waveId: number; count: number }>> {
  const blocks: Array<Array<{ waveId: number; count: number }>> = [];
  let cur: Array<{ waveId: number; count: number }> = [];
  let curLen = 0;
  for (const seg of stream) {
    let remain = seg.count;
    while (remain > 0) {
      const take = Math.min(remain, groupSize - curLen);
      const last = cur[cur.length - 1];
      if (last && last.waveId === seg.waveId) last.count += take;
      else cur.push({ waveId: seg.waveId, count: take });
      curLen += take;
      remain -= take;
      if (curLen === groupSize) { blocks.push(cur); cur = []; curLen = 0; }
    }
  }
  return blocks;
}
