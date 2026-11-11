#!/usr/bin/env python3
# vault_check.py — 掼蛋经验库机械结构检查器后端 v3（标准 YAML / PyYAML SafeLoader）
# 合同来源：repair3-execution-kit-v1.0 §3（逐步执行方案 v3.0）。校验器只读，不修值、不建索引、不自动降级。
# 退出码：0=通过；1=知识内容/结构不符合；2=参数/解析器/I-O 工具失败。报告写入 --report（拒绝覆盖已有文件）。
import sys, os, json, re, hashlib, datetime

TOOL_VERSION = 'vault-check/3.0.0 (python-backend)'
try:
    import yaml
except ImportError:
    print('PyYAML unavailable', file=sys.stderr); sys.exit(2)


class StrictLoader(yaml.SafeLoader):
    pass


def _no_dup(loader, node, deep=False):
    seen = set()
    for k_node, _ in node.value:
        k = loader.construct_object(k_node, deep=deep)
        if k in seen:
            raise yaml.constructor.ConstructorError(None, None, f'duplicate mapping key: {k!r}', node.start_mark)
        seen.add(k)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_dup)


class ParseErr(Exception):
    pass


def parse_doc(path, rel):
    """frontmatter 两条独立 --- 之间；返回 (metadata, body)。"""
    try:
        text = open(path, encoding='utf-8').read()
    except OSError as e:
        raise ParseErr(f'io:{e}')
    m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
    if not m:
        raise ParseErr('frontmatter missing or malformed')
    try:
        meta = yaml.load(m.group(1), Loader=StrictLoader)
    except yaml.YAMLError as e:
        raise ParseErr(f'yaml: {str(e).splitlines()[0]}')
    if not isinstance(meta, dict):
        raise ParseErr('frontmatter not a mapping')
    return meta, m.group(2), text


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 16), b''):
            h.update(b)
    return h.hexdigest()


def walk_md(root):
    out = []
    for dp, ds, fs in os.walk(root):
        for f in sorted(fs):
            if f.endswith('.md'):
                out.append(os.path.relpath(os.path.join(dp, f), root))
    return out


ENUM = {
    'status': {'adopted', 'reference', 'hold', 'retired'},
    'extraction_status': {'checked', 'unreviewed', 'issue'},
    'adoption_basis': {'user_dai_policy', 'documented_review', 'none'},
    'source_class': {'dai', 'web', 'mixed', 'editor'},
    'kind': {'action', 'inference', 'composition', 'concept'},
    'location_status': {'timed', 'text_only', 'missing'},
    'source_kind': {'video', 'web'},
    'material_level': {'audio_visual', 'transcript_only', 'fulltext', 'excerpt', 'unavailable'},
}
EXP_REQ = ['id', 'record_type', 'schema_version', 'title', 'category', 'tags', 'kind', 'source_class',
           'adoption_basis', 'review_ref', 'status', 'extraction_status', 'source_refs', 'rule_ref',
           'limitations', 'related_ids', 'created', 'updated']
SRC_REQ = ['id', 'record_type', 'schema_version', 'source_kind', 'author', 'title', 'source_class',
           'url', 'material_level', 'captured_at', 'experience_ids', 'fragments',
           'url_missing_reason', 'platform_id', 'episode', 'material_refs']
ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+08:00$')


def is_strarr(v, nonempty=True):
    return isinstance(v, list) and all(isinstance(x, str) and (x.strip() or not nonempty) for x in v) and len(set(v)) == len(v)


class Checker:
    def __init__(self, root):
        self.root = root
        self.errors = []
        self.warnings = []
        self.checks_run = []
        self.checked_files = []

    def err(self, code, path=None, field=None, actual=None, expected=None, id=None):
        e = {'code': code, 'path': path, 'field': field or id}
        if actual is not None: e['actual'] = actual if isinstance(actual, (str, int, float)) else json.dumps(actual, ensure_ascii=False)[:120]
        if expected is not None: e['expected'] = expected
        self.errors.append(e)

    def warn(self, code, path=None, id=None, detail=''):
        self.warnings.append({'code': code, 'path': path, 'id': id, 'detail': detail})

    def load_all(self):
        self.exps, self.srcs, self.tombs = [], [], []
        groups = {'02-经验': self.exps, '03-来源资料': self.srcs, os.path.join('99-历史存档', '停用内容'): self.tombs}
        self.active = []
        for prefix, bucket in groups.items():
            for sub in walk_md(os.path.join(self.root, prefix)):
                rel = os.path.join(prefix, sub)
                p = os.path.join(self.root, rel)
                try:
                    meta, body, text = parse_doc(p, rel)
                except ParseErr as e:
                    self.err('parse_error', path=rel, actual=str(e))
                    continue
                self.checked_files.append(rel)
                rec = {'rel': rel, 'meta': meta, 'body': body, 'text': text}
                bucket.append(rec)
                self.active.append(rec)
        # 维护区与手册区文档（链接检查对象）
        self.maint = []
        for prefix in ['00-知识库首页.md', '01-规则与术语', '04-实战手册', '90-知识库维护']:
            p = os.path.join(self.root, prefix)
            if os.path.isfile(p):
                self.maint.append((prefix, open(p, encoding='utf-8').read()))
            elif os.path.isdir(p):
                for sub in walk_md(p):
                    rel = os.path.join(prefix, sub)
                    if rel.startswith(os.path.join('90-知识库维护', '模板')):
                        continue
                    if rel.startswith(os.path.join('99-历史存档', '迁移前原件')):
                        continue
                    self.maint.append((rel, open(os.path.join(self.root, rel), encoding='utf-8').read()))

    # ---------- 类型与缺失 §3.1 ----------
    def check_experience(self, r):
        m, rel = r['meta'], r['rel']
        for k in EXP_REQ:
            if k not in m: self.err('exp_field_missing', rel, field=k)
        for k, allowed in ENUM.items():
            if k in m and m[k] is not None and m[k] not in allowed:
                self.err('exp_enum', rel, field=k, actual=m[k], expected='/'.join(sorted(allowed)))
        for k in ['id', 'title', 'schema_version', 'category', 'kind', 'source_class', 'adoption_basis', 'status', 'extraction_status', 'rule_ref']:
            if k in m and m[k] is not None and not isinstance(m[k], str): self.err('exp_type', rel, field=k, actual=type(m[k]).__name__, expected='str')
        for k in ['tags', 'source_refs', 'limitations', 'related_ids']:
            if k in m:
                if not isinstance(m[k], list): self.err('array_type', rel, field=k, actual=type(m[k]).__name__, expected='array')
                elif not is_strarr(m[k]): self.err('array_item_type', rel, field=k, actual=str(m[k])[:80])
        for k in ['created', 'updated']:
            if k in m and not (isinstance(m[k], str) and ISO_RE.match(m[k])): self.err('iso_time', rel, field=k, actual=str(m.get(k)))
        if m.get('adoption_basis') == 'documented_review' and not m.get('review_ref'):
            self.err('review_ref_missing', rel, id=m.get('id'))

    def check_source(self, s):
        m, rel = s['meta'], s['rel']
        for k in SRC_REQ:
            if k not in m: self.err('source_field_missing', rel, field=k, id=m.get('id'))
        for k, allowed in ENUM.items():
            if k in m and m[k] is not None and m[k] not in allowed:
                self.err('source_enum', rel, field=k, actual=m[k], expected='/'.join(sorted(allowed)))
        for k in ['material_refs', 'experience_ids', 'fragments']:
            if k in m:
                if m[k] is None: self.err('array_type', rel, field=k, actual='null', expected='array', id=m.get('id'))
                elif not isinstance(m[k], list): self.err('array_type', rel, field=k, actual=type(m[k]).__name__, expected='array', id=m.get('id'))
        mr = m.get('material_refs')
        if isinstance(mr, list) and (any(x is None or not (isinstance(x, str) and x.strip()) for x in mr) or len(set(mr)) != len(mr)):
            self.err('array_item_type', rel, field='material_refs', actual=str(mr)[:60], id=m.get('id'))
        ei = m.get('experience_ids')
        if isinstance(ei, list) and len(set(ei)) != len(ei):
            self.err('array_duplicate', rel, field='experience_ids', actual=str(ei)[:60], id=m.get('id'))
        if not m.get('author') or not m.get('title'): self.err('source_field_empty', rel, field='author/title', id=m.get('id'))
        url, reason = m.get('url'), m.get('url_missing_reason')
        if url is None and not reason: self.err('url_reason_missing', rel, id=m.get('id'))
        if url is not None and reason not in (None, 'null') and str(reason).strip() and str(m.get('url_missing_reason')).lower() not in ('null',):
            if url and str(reason or '').strip() not in ('', 'null'): pass
        sk = m.get('source_kind')
        if sk == 'web' and m.get('platform_id') is not None and m.get('platform_id') != 'null':
            pass  # WEB 不适用字段应为 null——但 legacy 允许 null；非 null 字符串才提示
        frags = m.get('fragments') or []
        seen = set()
        for f in frags:
            if not isinstance(f, dict): self.err('fragment_type', rel, id=m.get('id'), actual=type(f).__name__); continue
            fid = f.get('id')
            if not fid: self.err('fragment_id_missing', rel, id=m.get('id')); continue
            if fid in seen: self.err('fragment_id_duplicate', rel, field=fid, id=m.get('id'))
            seen.add(fid)
            ls = f.get('location_status')
            if ls not in ENUM['location_status']: self.err('fragment_enum', rel, field=f'{fid}.location_status', actual=ls)
            ub = f.get('usedBy')
            if not isinstance(ub, list) or not all(isinstance(x, str) for x in (ub or [])):
                self.err('usedBy_type', rel, field=f'{fid}.usedBy', actual=(type(ub).__name__ + ':' + str(ub)[:40]) if ub is not None else 'null', expected='string array')
            if ls == 'timed':
                st, en = f.get('start_seconds'), f.get('end_seconds')
                if not (isinstance(st, (int, float)) and isinstance(en, (int, float)) and 0 <= st < en):
                    self.err('timed_range', rel, field=f'{fid}.start/end', actual=f'{st}/{en}')
            if ls == 'missing':
                tl = f.get('text_locator') if isinstance(f.get('text_locator'), dict) else {}
                mr = f.get('missing_reason') or tl.get('reason')
                if not mr: self.err('missing_reason_absent', rel, field=fid, id=m.get('id'))
            tl = f.get('text_locator')
            if tl is not None and not isinstance(tl, dict): self.err('text_locator_type', rel, field=fid, actual=type(tl).__name__)
            if f'## {fid}' not in s['body']: self.err('fragment_body_heading_missing', rel, field=fid, id=m.get('id'))

    def check_tombstone(self, t):
        m, rel = t['meta'], t['rel']
        for k in ['id', 'record_type', 'schema_version', 'status', 'reason', 'legacy_refs', 'merged_into', 'updated']:
            if k not in m: self.err('tomb_field_missing', rel, field=k, id=m.get('id'))
        if m.get('status') != 'retired': self.err('tomb_status', rel, actual=m.get('status'), expected='retired')

    # ---------- 关系与消费者 §3.2 ----------
    def check_relations(self, baseline=None, mapping=None):
        byId = {}
        for r in self.exps + self.tombs:
            rid = r['meta'].get('id')
            if not rid: continue
            if rid in byId: self.err('id_duplicate', r['rel'], id=rid, actual=f'another: {byId[rid]["rel"]}')
            byId[rid] = r
        srcById = {}
        for s in self.srcs:
            sid = s['meta'].get('id')
            if not sid: continue
            if sid in srcById: self.err('source_id_duplicate', s['rel'], id=sid, actual=f'another: {srcById[sid]["rel"]}')
            srcById[sid] = s
        fragIndex = {}
        for sid, s in srcById.items():
            for f in (s['meta'].get('fragments') or []):
                if isinstance(f, dict) and f.get('id'):
                    fragIndex[(sid, f['id'])] = f
        # source_refs → 片段存在；集合一致（usedBy/experience_ids）
        fwd = {}
        for r in self.exps:
            m, rel = r['meta'], r['rel']
            refs = m.get('source_refs') or []
            fwd[m.get('id')] = set(refs)
            for rf in refs:
                sid, _, frag = rf.partition(':')
                if sid not in srcById: self.err('source_ref_unknown_source', rel, field=rf, id=m.get('id'))
                elif frag and (sid, frag) not in fragIndex: self.err('source_ref_unknown_fragment', rel, field=rf, id=m.get('id'))
                elif not frag: self.warn('source_ref_fragmentless', rel, id=m.get('id'), detail=rf)
            if not refs: self.err('source_refs_empty', rel, id=m.get('id'))
        for sid, s in srcById.items():
            eids = s['meta'].get('experience_ids') or []
            for f in (s['meta'].get('fragments') or []):
                if not isinstance(f, dict): continue
                fid = f.get('id'); key = f'{sid}:{fid}'
                for uid in (f.get('usedBy') or []):
                    if uid not in byId: self.err('usedBy_unknown_id', s['rel'], field=f'{fid}.usedBy', actual=uid)
                    elif key not in fwd.get(uid, set()):
                        self.err('usedBy_not_in_source_refs', s['rel'], field=key, actual=uid)
                back = {rid for rid, s2 in fwd.items() if key in s2}
                if set(f.get('usedBy') or []) != back:
                    self.err('usedBy_set_mismatch', s['rel'], field=key, actual=sorted(f.get('usedBy') or []), expected=sorted(back))
            derived = {rid for rid, ss in fwd.items() if any(x.partition(':')[0] == sid for x in ss)}
            if set(eids) != derived:
                self.err('experience_ids_set_mismatch', s['rel'], id=sid, actual=sorted(eids), expected=sorted(derived))
        # 状态组合
        for r in self.exps:
            m, rel = r['meta'], r['rel']
            if m.get('status') == 'adopted' and m.get('extraction_status') == 'issue': self.err('adopted_with_issue', rel, id=m.get('id'))
            if m.get('status') == 'adopted' and m.get('adoption_basis') == 'none': self.err('adopted_with_none_basis', rel, id=m.get('id'))
            if m.get('source_class') == 'web' and m.get('adoption_basis') == 'user_dai_policy': self.err('web_borrows_dai_policy', rel, id=m.get('id'))
        # tombstone 链
        for t in self.tombs:
            into = t['meta'].get('merged_into')
            if into is None: continue
            seen = {t['meta'].get('id')}
            cur = into
            while cur is not None:
                if cur in seen: self.err('tomb_cycle', t['rel'], id=cur); break
                if cur == t['meta'].get('id'): self.err('tomb_self', t['rel']); break
                seen.add(cur)
                nxt = byId.get(cur)
                if not nxt: self.err('tomb_target_missing', t['rel'], actual=cur); break
                cur = nxt['meta'].get('merged_into')
        # related_ids
        for r in self.exps:
            for rid in (r['meta'].get('related_ids') or []):
                if rid not in byId: self.err('related_unknown', r['rel'], field=rid, id=r['meta'].get('id'))
        # 分类
        cats = self.load_categories()
        if cats is None:
            self.err('category_registry_missing')
            cats = {}
        for r in self.exps:
            c = r['meta'].get('category')
            if c and c not in cats: self.err('category_unregistered', r['rel'], field=c, id=r['meta'].get('id'))
        # 登记表
        reg = self.load_registry()
        if reg is None:
            self.err('registry_missing')
        else:
            regExp = {e.get('id'): e for e in (reg.get('experiences') or [])}
            for r in self.exps:
                rid = r['meta'].get('id')
                e = regExp.get(rid)
                if not e: self.warn('registry_missing_entry', r['rel'], id=rid)
                else:
                    if e.get('path') and e['path'] != r['rel']: self.err('registry_path_mismatch', r['rel'], field='registry.path', actual=e['path'])
                    if 'status' in e and e['status'] != r['meta'].get('status'): self.err('registry_status_mismatch', r['rel'], id=rid, actual=e['status'], expected=r['meta'].get('status'))
            for t in self.tombs:
                e = regExp.get(t['meta'].get('id'))
                if e and e.get('status') != 'retired': self.err('registry_status_mismatch', t['rel'], id=t['meta'].get('id'), actual=e.get('status'), expected='retired')
            used = set(regExp)
            for rid in byId:
                if rid not in used and rid not in {r['meta'].get('id') for r in self.exps}: pass
        # eligible
        self.eligible = sorted(r['meta']['id'] for r in self.exps
                               if r['meta'].get('status') == 'adopted' and r['meta'].get('adoption_basis') in ('user_dai_policy', 'documented_review')
                               and r['meta'].get('extraction_status') != 'issue' and r['meta'].get('category') in cats
                               and cats.get(r['meta'].get('category'), {}).get('active', True)
                               and r['meta'].get('category') != 'CAT-PENDING')
        # 索引/手册（eligible 子集；reference/hold/retired 不得混入）
        idx_rel = os.path.join('04-实战手册', '可用经验索引.md')
        idx_text = dict(self.maint).get(idx_rel)
        if idx_text is None:
            self.warn('index_missing')
        else:
            ids_in_idx = set(re.findall(r'GD-[A-Z]+-?\d+', idx_text))
            for rid in self.eligible:
                if rid not in ids_in_idx: self.err('index_missing_eligible', idx_rel, id=rid)
            for rid in ids_in_idx:
                if rid not in self.eligible: self.err('index_contains_non_eligible', idx_rel, id=rid)
        for rel, text in self.maint:
            if rel.startswith(os.path.join('04-实战手册', '可用经验索引')) or rel.startswith('04-实战手册/可用经验索引'):
                continue
            if rel.startswith('04-实战手册'):
                for rid in set(re.findall(r'GD-[A-Z]+-?\d+', text)):
                    if rid not in self.eligible: self.err('manual_non_eligible', rel, id=rid)
        # 正文当前片段引用：排除"修订记录（历史，不作当前依据）"尾区与撤回记录
        frag_set = {f'{sid}:{fid}' for (sid, fid) in fragIndex}
        withdrawn = set()
        for s in self.srcs:
            for wm in re.finditer(r'旧片段 (SRC-\d{6}:E\d{2})', s['body']): withdrawn.add(wm.group(1))
        for r in self.exps:
            body = re.split(r'## 修订记录（历史，不作当前依据）', r['body'])[0]
            for rf in re.findall(r'SRC-\d{6}:E\d{2}', body):
                if rf not in frag_set and rf not in withdrawn:
                    self.err('body_source_ref_unresolved', r['rel'], field=rf, id=r['meta'].get('id'))
            head = re.split(r'## 来源依据', r['body'])
            if len(head) > 1:
                cur_sec = re.split(r'\n## ', head[1])[0]
                cur_ids = set(re.findall(r'SRC-\d{6}:E\d{2}', cur_sec))
                if cur_ids != set(r['meta'].get('source_refs') or []):
                    self.err('body_source_section_mismatch', r['rel'], id=r['meta'].get('id'), actual=sorted(cur_ids), expected=sorted(r['meta'].get('source_refs') or []))
        # 孤立来源（警告：无任何经验引用——尚未提炼或迁移漏接）
        for sid, s0 in srcById.items():
            used_any = any(x.partition(':')[0] == sid for x in [r for ss in fwd.values() for r in ss])
            if not used_any:
                self.warn('orphan_source', s0['rel'], id=sid, detail='来源无任何经验引用——尚未提炼或迁移漏接，请人工分辨')
        # 链接检查（活动区）
        self.check_links()
        # baseline/mapping
        if baseline and mapping:
            bl = json.load(open(baseline)) if isinstance(baseline, str) else baseline
            mp = json.load(open(mapping)) if isinstance(mapping, str) else mapping
            bl_cards = bl.get('cards', [])
            entries = mp.get('entries', [])
            mapped_keys = {e.get('legacy_key') for e in entries}
            for c in bl_cards:
                if c.get('legacy_key') not in mapped_keys: self.err('migration_uncovered', id=c.get('legacy_key'))
            for e in entries:
                if e.get('legacy_key') not in {c.get('legacy_key') for c in bl_cards}: self.err('migration_extra', id=e.get('legacy_key'))
                for t in e.get('target_ids', []):
                    if t not in byId: self.err('migration_target_missing', id=t, actual=e.get('legacy_key'))
        return {'byId': byId, 'srcById': srcById, 'fragIndex': fragIndex, 'cats': cats}

    def load_categories(self):
        p = os.path.join(self.root, '90-知识库维护', '分类登记表.md')
        if not os.path.isfile(p): return None
        cats = {}
        for line in open(p, encoding='utf-8'):
            m = re.match(r'\|\s*(CAT-\d+|CAT-PENDING)\s*\|([^|]+)\|', line)
            if m:
                active = 'retired' not in line
                cats[m.group(1)] = {'path': m.group(2).strip(), 'active': active}
        return cats

    def load_registry(self):
        p = os.path.join(self.root, '90-知识库维护', '编号登记表.json')
        if not os.path.isfile(p): return None
        try:
            return json.load(open(p))
        except Exception:
            return None

    def link_target_exists(self, target, cur_rel):
        # Markdown 相对当前文件；角括号路径；wiki 相对 root / root 父 / 唯一文件名
        cands = []
        base_md = os.path.dirname(os.path.join(self.root, cur_rel))
        cands.append(os.path.join(base_md, target))
        cands.append(os.path.join(self.root, target))
        parent = os.path.dirname(self.root.rstrip('/'))
        cands.append(os.path.join(parent, target))
        for c in cands:
            if os.path.isfile(c): return True
        # 唯一文件名匹配（root 内递归）
        name = os.path.basename(target)
        hits = [r for r in self.all_files if os.path.basename(r) == name]
        if len(hits) == 1: return True
        # 标题锚点形式 name#anchor
        if '#' in target:
            fn, anchor = target.split('#', 1)
            for c in [os.path.join(base_md, fn), os.path.join(self.root, fn)]:
                if os.path.isfile(c):
                    body = open(c, encoding='utf-8').read()
                    if re.search(r'^#+\s*' + re.escape(anchor), body, re.M): return True
        return False

    def check_links(self):
        self.all_files = []
        for dp, ds, fs in os.walk(self.root):
            for f in fs: self.all_files.append(os.path.relpath(os.path.join(dp, f), self.root))
        docs = [(r['rel'], r['text']) for r in self.active] + [(rel, txt) for rel, txt in self.maint if not rel.startswith('90-知识库维护/模板')]
        for rel, text in docs:
            t = re.split(r'## 修订记录（历史，不作当前依据）', text)[0]
            for m in re.finditer(r'\[[^\]]*\]\((<?)([^)\s]+?)(>?)(?:#[^)\s]*)?\)', t):
                target = m.group(2).strip('<>')
                if re.match(r'^[a-z][a-z0-9+.-]*://', target): continue
                if not self.link_target_exists(target, rel): self.err('md_link_broken', rel, field=target)
            for m in re.finditer(r'\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]', t):
                target = m.group(1).strip()
                if target.startswith('http'): continue
                if not self.link_target_exists(target, rel): self.err('wiki_link_broken', rel, field=target)
        self.checks_run.append('links')

    # ---------- 定位统计（从解析对象读取，§T5） ----------
    def stats(self):
        frag_stats = {'video_timed': [], 'video_exact': [], 'video_fuzzy_candidate': [], 'video_copy_note': [], 'web_clue': [], 'missing': [], 'unclassified': []}
        for s in self.srcs:
            is_web = s['meta'].get('source_kind') == 'web'
            for f in (s['meta'].get('fragments') or []):
                if not isinstance(f, dict): continue
                key = f'{s["meta"].get("id")}:{f.get("id")}'
                ls = f.get('location_status')
                tl = f.get('text_locator') if isinstance(f.get('text_locator'), dict) else {}
                match = tl.get('match')
                if ls == 'timed': frag_stats['video_timed'].append(key)
                elif ls == 'missing': frag_stats['missing'].append(key)
                elif is_web: frag_stats['web_clue'].append(key)
                elif match == 'exact-normalized': frag_stats['video_exact'].append(key)
                elif isinstance(match, str) and match.startswith('fuzzy'): frag_stats['video_fuzzy_candidate'].append(key)
                elif ls == 'text_only': frag_stats['video_copy_note'].append(key)
                else: frag_stats['unclassified'].append(key)
        counts = {'experience': len(self.exps), 'tombstone': len(self.tombs), 'source': len(self.srcs),
                  'fragment': sum(len(s['meta'].get('fragments') or []) for s in self.srcs),
                  'eligible': len(self.eligible) if hasattr(self, 'eligible') else 0,
                  'status': {v: sum(1 for r in self.exps if r['meta'].get('status') == v) for v in ['adopted', 'reference', 'hold']}}
        frag_counts = {k: len(v) for k, v in frag_stats.items()}
        return {'counts': counts, 'positioning': frag_counts, 'positioning_ids': frag_stats}


def cmd_validate(root, report_path, baseline, mapping):
    c = Checker(root)
    c.load_all()
    c.checks_run.append('parse')
    for r in c.exps: c.check_experience(r)
    for s in c.srcs: c.check_source(s)
    for t in c.tombs: c.check_tombstone(t)
    c.checks_run.append('types')
    c.check_relations(baseline, mapping)
    c.checks_run.append('relations')
    st = c.stats()
    rep = {'tool_version': TOOL_VERSION, 'command': 'validate', 'root': root,
           'errors': c.errors, 'warnings': c.warnings,
           'counts': st['counts'], 'positioning': st['positioning'],
           'eligible_ids': c.eligible if hasattr(c, 'eligible') else [],
           'checked_files': c.checked_files, 'checks_run': c.checks_run,
           'boundary_note': '机械检查通过不等于内容正确；语义/UI/牌力不在本工具范围'}
    write_report(report_path, rep)
    print(json.dumps({'command': 'validate', 'errors': len(c.errors), 'warnings': len(c.warnings), 'counts': st['counts'], 'positioning': st['positioning'], 'report': report_path}, ensure_ascii=False, indent=1))
    return 0 if not c.errors else 1


def cmd_reverse(root, report_path, source):
    c = Checker(root); c.load_all()
    src, _, frag = source.partition(':')
    s = next((x for x in c.srcs if x['meta'].get('id') == src), None)
    if s is None:
        rep = {'tool_version': TOOL_VERSION, 'command': 'reverse', 'root': root, 'query': source, 'errors': [{'code': 'source_unknown', 'path': None, 'field': src}], 'results': []}
        write_report(report_path, rep); print(json.dumps({'command': 'reverse', 'errors': 1, 'report': report_path})); return 1
    frags = s['meta'].get('fragments') or []
    if frag:
        f = next((x for x in frags if isinstance(x, dict) and x.get('id') == frag), None)
        if f is None:
            rep = {'tool_version': TOOL_VERSION, 'command': 'reverse', 'root': root, 'query': source, 'errors': [{'code': 'fragment_unknown', 'field': source, 'actual_ids': [x.get('id') for x in frags if isinstance(x, dict)]}], 'results': []}
            write_report(report_path, rep); print(json.dumps({'command': 'reverse', 'errors': 1, 'report': report_path})); return 1
        frags = [f]
    results = []
    for f in frags:
        for uid in (f.get('usedBy') or []):
            e = next((r for r in c.exps if r['meta'].get('id') == uid), None)
            if e: results.append({'experience_id': uid, 'status': e['meta'].get('status'), 'extraction_status': e['meta'].get('extraction_status'), 'path': e['rel'], 'title': e['meta'].get('title')})
    rep = {'tool_version': TOOL_VERSION, 'command': 'reverse', 'root': root, 'query': source, 'errors': [], 'fragment': [{'id': f.get('id'), 'location_status': f.get('location_status'), 'usedBy': f.get('usedBy')} for f in frags], 'results': results}
    write_report(report_path, rep)
    print(json.dumps({'command': 'reverse', 'query': source, 'results': len(results), 'report': report_path}, ensure_ascii=False))
    return 0


def cmd_inventory(root, report_path):
    files = []
    for dp, ds, fs in os.walk(root):
        for f in sorted(fs): files.append(os.path.relpath(os.path.join(dp, f), root))
    by_top = {}
    for r in files: by_top[r.split(os.sep)[0]] = by_top.get(r.split(os.sep)[0], 0) + 1
    rep = {'tool_version': TOOL_VERSION, 'command': 'inventory', 'root': root, 'errors': [], 'warnings': [], 'counts': {'files_total': len(files), 'by_top_dir': by_top}, 'checked_files': files, 'checks_run': ['inventory']}
    write_report(report_path, rep)
    print(json.dumps({'command': 'inventory', 'files': len(files), 'report': report_path}))
    return 0


def write_report(path, rep):
    if os.path.exists(path):
        sys.stderr.write(f'report exists, refuse overwrite: {path}'); sys.exit(2)
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    json.dump(rep, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else None
    opt = {}
    i = 1
    while i < len(args):
        k = args[i].lstrip('-').replace('-', '_'); opt[k] = args[i + 1] if i + 1 < len(args) else None; i += 2
    root = opt.get('root'); report = opt.get('report')
    if cmd not in ('validate', 'reverse', 'inventory') or not root or not report or (cmd == 'reverse' and not opt.get('source')):
        print('usage: vault_check.py validate|reverse|inventory --root DIR --report FILE [--source SRC:E|--baseline F --mapping F]'); sys.exit(2)
    if not os.path.isdir(root):
        sys.stderr.write('root not found'); sys.exit(2)
    if cmd == 'validate': sys.exit(cmd_validate(root, report, opt.get('baseline'), opt.get('mapping')))
    if cmd == 'reverse': sys.exit(cmd_reverse(root, report, opt['source']))
    sys.exit(cmd_inventory(root, report))


if __name__ == '__main__':
    main()
