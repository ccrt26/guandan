#!/usr/bin/env python3
"""REVIEW5 T3 第一步：KSCB 牌码→物理牌映射的约束求解（只读资产，输出候选映射+一致性统计）。

证据来源（全部来自数据本身，非频率猜测）：
  - event 9 melds: {pattern, tiles, value} 三元组（pattern 1=单张 value=点数档）
  - event 3 出牌: pattern + tiles；顺子/连对约束码的连续性
  - event 2 手牌: 每码至多 2 张（两副拷贝）
  - event 6/7/8 贡还: 贡牌通常是最大牌（辅助校验）
输出: lab/review5/artifacts/kscb-mapping.json
"""
import gzip, json, sys
from collections import Counter, defaultdict

DATA = 'lab/review2/assets/kscb-guandan/1e5c5d1b7634a4eb973ad3364a46ef494074e205/guandan_matches.jsonl.gz'
OUT = 'lab/review5/artifacts/kscb-mapping.json'

def main():
    max_matches = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    # 1) 单张 meld: code -> set(values)
    single_val = defaultdict(Counter)
    pair_val = defaultdict(list)     # (c1,c2,value)
    trio_val = defaultdict(list)
    straight_tiles = []              # tiles of pattern-8-like melds
    pattern_len = defaultdict(Counter)  # pattern -> tile count dist
    pattern_value = defaultdict(Counter) # pattern -> value dist
    play_pattern_len = defaultdict(Counter)
    n_matches = 0
    with gzip.open(DATA, 'rt') as f:
        for line in f:
            if n_matches >= max_matches: break
            n_matches += 1
            d = json.loads(line)
            for r in d['rounds']:
                for e in r['events']:
                    if e['event_id'] == 9 and isinstance(e.get('data'), dict):
                        for m in (e['data'].get('melds') or []):
                            pat, tiles, val = m.get('pattern'), m.get('tiles', []), m.get('value')
                            pattern_len[pat][len(tiles)] += 1
                            pattern_value[pat][val] += 1
                            if pat == 1 and len(tiles) == 1:
                                single_val[tiles[0]][val] += 1
                            elif pat == 2 and len(tiles) == 2:
                                pair_val[tuple(sorted(tiles))].append(val)
                            elif pat == 3 and len(tiles) == 3:
                                trio_val[tuple(sorted(tiles))].append(val)
                            elif pat in (5, 8) and len(tiles) >= 5:
                                straight_tiles.append(sorted(tiles))
                    elif e['event_id'] in (3, 15) and 'pattern' in e:
                        play_pattern_len[e['pattern']][len(e.get('tiles', []))] += 1
    print('matches scanned:', n_matches)
    print('meld pattern→len:', {k: dict(v) for k, v in sorted(pattern_len.items())})
    print('meld pattern→value:', {k: dict(sorted(v.items())[:8]) for k, v in sorted(pattern_value.items())})
    print('play pattern→len:', {k: dict(v) for k, v in sorted(play_pattern_len.items())})
    # 单张 value 分布
    vals = Counter()
    for c, cnt in single_val.items():
        for v, n in cnt.items(): vals[v] += n
    print('single meld value dist:', dict(sorted(vals.items())))
    # 每码 value 一致性
    conflicts = {c: dict(cnt) for c, cnt in single_val.items() if len(cnt) > 1}
    print('single-value conflicts:', len(conflicts), list(conflicts.items())[:5])
    code_rank = {c: next(iter(cnt)) for c, cnt in single_val.items() if len(cnt) == 1}
    print('codes with single value:', len(code_rank))
    print('code→value sample:', dict(sorted(code_rank.items())[:30]))
    # 对子: 两码同 rank?
    pair_ok = pair_bad = 0
    for (c1, c2), vs in pair_val.items():
        v = Counter(vs).most_common(1)[0][0]
        r1, r2 = code_rank.get(c1), code_rank.get(c2)
        if r1 is not None and r2 is not None:
            if r1 == v and r2 == v: pair_ok += 1
            else: pair_bad += 1
    print(f'pairs consistent with single values: ok={pair_ok} bad={pair_bad}')
    # 对子直接给 rank（两码同点）
    pair_rank = {}
    for (c1, c2), vs in pair_val.items():
        v = Counter(vs).most_common(1)[0][0]
        pair_rank.setdefault(c1, Counter())[v] += 1
        pair_rank.setdefault(c2, Counter())[v] += 1
    # 合并 code→rank
    merged = defaultdict(Counter)
    for c, v in code_rank.items(): merged[c][v] += 100
    for c, cnt in pair_rank.items():
        for v, n in cnt.items(): merged[c][v] += n
    final_conflicts = {c: dict(cnt) for c, cnt in merged.items() if len(cnt) > 1}
    print('merged conflicts:', len(final_conflicts), list(final_conflicts.items())[:5])
    mapping = {str(c): max(cnt, key=cnt.get) for c, cnt in merged.items()}
    print('merged mapping size:', len(mapping))
    # 顺子: 排序后码差是否全 1（同花连）与 value 范围
    consec = 0; nonconsec = 0
    for tiles in straight_tiles:
        if all(b - a == 1 for a, b in zip(tiles, tiles[1:])): consec += 1
        else: nonconsec += 1
    print(f'straight-ish melds: consecutive-code={consec} non-consecutive={nonconsec}')
    json.dump({
      'matchesScanned': n_matches,
      'meldPatternLen': {str(k): dict(v) for k, v in pattern_len.items()},
      'singleValueConflicts': len(conflicts),
      'mergedConflicts': len(final_conflicts),
      'codeToRank': mapping,
      'straightConsecutive': consec, 'straightNonConsecutive': nonconsec,
    }, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('wrote', OUT)

main()
