#!/usr/bin/env python3
# vault_check.py — 掼蛋经验库机械结构检查器后端 v3（标准 YAML / PyYAML SafeLoader）
# 合同来源：repair3-execution-kit-v1.0 §3（逐步执行方案 v3.0）。校验器只读，不修值、不建索引、不自动降级。
# 退出码：0=通过；1=知识内容/结构不符合；2=参数/解析器/I-O 工具失败。报告写入 --report（拒绝覆盖已有文件）。
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
from collections import Counter
from urllib.parse import unquote, urlsplit

TOOL_VERSION = 'vault-check/3.1.0 (python-backend)'
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
        if not isinstance(k, str):
            raise yaml.constructor.ConstructorError(None, None, 'frontmatter keys must be strings', node.start_mark)
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
        text = Path(path).read_text(encoding='utf-8')
    except UnicodeError as e:
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


EXP_ID = r'GD-(?:[A-Z]+-\d+|K\d{6,})'
FRAG_ID = r'E\d{2,}'
SOURCE_REF = r'SRC-\d{6}:' + FRAG_ID
HISTORY = '修订记录（历史，不作当前依据）'
LOCATOR_MATCHES = {None, 'exact-normalized', 'fuzzy-lcs', 'fuzzy-lcs(≥0.72)'}


def valid_time(value):
    if not isinstance(value, str) or not ISO_RE.fullmatch(value):
        return False
    try:
        datetime.datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def valid_url(value):
    try:
        parts = urlsplit(value)
        return parts.scheme in ('http', 'https') and bool(parts.hostname) and not re.search(r'\s', value)
    except (TypeError, ValueError):
        return False


def current_body(text):
    return re.split(r'^## ' + re.escape(HISTORY) + r'\s*$', text, maxsplit=1, flags=re.M)[0]


def prose(text):
    text = re.sub(r'^ {0,3}(?:```|~~~)[^\n]*\n.*?^ {0,3}(?:```|~~~)[^\n]*$', '', text, flags=re.S | re.M)
    return re.sub(r'`[^`\n]*`', '', text)


def document_links(text):
    pattern = r'\[\[([^\]\n]+)\]\]|\[([^\]\n]*)\]\((<[^>\n]+>|[^)\n]+)\)'
    for m in re.finditer(pattern, prose(current_body(text))):
        wiki, label, target = m.groups()
        if wiki is not None:
            target, _, label = wiki.replace(r'\|', '|').partition('|')
        yield wiki is not None, label.strip(), target.strip().removeprefix('<').removesuffix('>')


def link_anchor(text, anchor):
    for heading in re.findall(r'^ {0,3}#{1,6} +(.+?) *#* *$', prose(text), re.M):
        slug = re.sub(r'[^\w -]', '', heading.lower()).replace(' ', '-')
        if anchor in (heading, slug):
            return True
    return False


class Checker:
    def __init__(self, root, project_root=None):
        self.root = root
        self.project_root = Path(project_root).resolve() if project_root else None
        self.errors = []
        self.warnings = []
        self.checks_run = []
        self.checked_files = []

    def err(self, code, path=None, field=None, actual=None, expected=None, id=None):
        e = {'code': code, 'path': path, 'field': field or id}
        if actual is not None: e['actual'] = actual if isinstance(actual, (str, int, float)) else json.dumps(actual, ensure_ascii=False, default=str)[:120]
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
                if Path(p).is_symlink():
                    self.err('record_symlink', rel)
                    continue
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
                self.maint.append((prefix, Path(p).read_text(encoding='utf-8')))
            elif os.path.isdir(p):
                for sub in walk_md(p):
                    rel = os.path.join(prefix, sub)
                    if rel.startswith(os.path.join('90-知识库维护', '模板')):
                        continue
                    if rel.startswith(os.path.join('99-历史存档', '迁移前原件')):
                        continue
                    self.maint.append((rel, (Path(self.root) / rel).read_text(encoding='utf-8')))

    def require_strings(self, meta, rel, keys, code):
        for key in keys:
            value = meta.get(key)
            if key in meta and (not isinstance(value, str) or not value.strip()):
                self.err(code, rel, field=key, actual=value, expected='nonempty string')

    def check_record(self, record, kind, required):
        meta, rel = record['meta'], record['rel']
        for key in required:
            if key not in meta:
                self.err({'experience': 'exp', 'source': 'source', 'tombstone': 'tomb'}[kind] + '_field_missing', rel, field=key)
        if meta.get('record_type') != kind:
            self.err('record_type', rel, field='record_type', actual=meta.get('record_type'), expected=kind)
        if meta.get('schema_version') != '1.0':
            self.err('schema_version', rel, field='schema_version', actual=meta.get('schema_version'), expected='1.0')
        for key in ('created', 'updated'):
            if key in meta and not valid_time(meta[key]):
                self.err('iso_time', rel, field=key, actual=meta[key])
        for key in ('related_ids', 'tags', 'limitations', 'source_refs', 'legacy_refs', 'material_refs', 'experience_ids'):
            if key in meta and not is_strarr(meta[key]):
                code = 'array_item_type' if isinstance(meta[key], list) else 'array_type'
                self.err(code, rel, field=key, actual=meta[key], expected='unique nonempty strings')
        for key in ('merged_into', 'review_ref'):
            if key in meta and meta[key] is not None and (not isinstance(meta[key], str) or not meta[key].strip()):
                self.err('field_type', rel, field=key, actual=meta[key], expected='null or nonempty string')

    def check_enums(self, meta, rel, keys, code):
        for key in keys:
            value = meta.get(key)
            if key in meta and (not isinstance(value, str) or value not in ENUM[key]):
                self.err(code, rel, field=key, actual=value, expected='/'.join(sorted(ENUM[key])))

    def check_experience(self, r):
        m, rel = r['meta'], r['rel']
        self.check_record(r, 'experience', EXP_REQ)
        self.require_strings(m, rel, ('id', 'title', 'category', 'rule_ref'), 'exp_type')
        self.check_enums(m, rel, ('kind', 'status', 'extraction_status', 'source_class', 'adoption_basis'), 'exp_enum')
        if not isinstance(m.get('id'), str) or not re.fullmatch(EXP_ID, m['id']):
            self.err('experience_id_invalid', rel, field='id', actual=m.get('id'))
        ref = m.get('review_ref')
        if m.get('adoption_basis') == 'documented_review':
            if not ref:
                self.err('review_ref_missing', rel, field='review_ref')
            elif isinstance(ref, str):
                target = (Path(self.root) / ref).resolve()
                if not target.is_relative_to(Path(self.root).resolve()) or not target.is_file():
                    self.err('review_ref_unresolved', rel, field='review_ref', actual=ref)
                elif target.suffix.lower() != '.md' or m.get('id') not in re.findall(EXP_ID, target.read_text(encoding='utf-8')):
                    self.err('review_ref_unbound', rel, field='review_ref', actual=ref)
        elif ref is not None:
            self.err('review_ref_unexpected', rel, field='review_ref', actual=ref)

        if m.get('status') == 'adopted' and m.get('extraction_status') == 'issue':
            self.err('adopted_with_issue', rel, field='extraction_status')
        if m.get('status') == 'adopted' and m.get('adoption_basis') == 'none':
            self.err('adopted_with_none_basis', rel, field='adoption_basis')
        if m.get('source_class') == 'web' and m.get('adoption_basis') == 'user_dai_policy':
            self.err('web_borrows_dai_policy', rel, field='adoption_basis')

    def check_source(self, s):
        m, rel = s['meta'], s['rel']
        self.check_record(s, 'source', SRC_REQ)
        self.require_strings(m, rel, ('id', 'author', 'title'), 'source_field_empty')
        self.check_enums(m, rel, ('source_kind', 'source_class', 'material_level'), 'source_enum')
        if not isinstance(m.get('id'), str) or not re.fullmatch(r'SRC-\d{6}', m['id']):
            self.err('source_id_invalid', rel, field='id', actual=m.get('id'))
        url, reason = m.get('url'), m.get('url_missing_reason')
        if url is None:
            if not isinstance(reason, str) or not reason.strip():
                self.err('url_reason_missing', rel, field='url_missing_reason')
        elif not isinstance(url, str) or not valid_url(url) or reason is not None:
            self.err('source_url_invalid', rel, field='url', actual=url)
        if m.get('source_kind') == 'web':
            for key in ('platform_id', 'episode'):
                if m.get(key) is not None:
                    self.err('source_web_video_field', rel, field=key, actual=m[key])
        if self.project_root is not None and is_strarr(m.get('material_refs')):
            for material in m['material_refs']:
                path = (self.project_root / material).resolve()
                if not path.is_relative_to(self.project_root) or not path.is_file():
                    self.err('material_ref_unresolved', rel, field='material_refs', actual=material)
        if not isinstance(m.get('fragments'), list):
            self.err('array_type', rel, field='fragments', actual=m.get('fragments'), expected='array')
            return
        seen = set()
        for f in m['fragments']:
            if not isinstance(f, dict):
                self.err('fragment_type', rel, field='fragments', actual=f)
                continue
            fid = f.get('id')
            if not isinstance(fid, str) or not re.fullmatch(FRAG_ID, fid):
                self.err('fragment_id_missing' if fid is None else 'fragment_id_invalid', rel, field='fragments.id', actual=fid)
                continue
            if fid in seen:
                self.err('fragment_id_duplicate', rel, field=fid)
            seen.add(fid)
            self.check_enums(f, rel, ('location_status',), 'fragment_enum')
            ls = f.get('location_status')
            if 'location_status' not in f:
                self.err('fragment_enum', rel, field=f'{fid}.location_status')
            if 'withdrawn' in f and type(f['withdrawn']) is not bool:
                self.err('withdrawn_type', rel, field=f'{fid}.withdrawn', actual=f['withdrawn'])
            ub = f.get('usedBy')
            if f.get('withdrawn') is True and ub:
                self.err('withdrawn_fragment_in_use', rel, field=f'{fid}.usedBy', actual=ub)
            if not isinstance(ub, list) or not all(isinstance(x, str) and x.strip() for x in ub):
                self.err('usedBy_type', rel, field=f'{fid}.usedBy', actual=ub, expected='string array')
            elif len(set(ub)) != len(ub):
                self.err('usedBy_duplicate', rel, field=f'{fid}.usedBy', actual=ub)
            if ls == 'timed':
                start, end = f.get('start_seconds'), f.get('end_seconds')
                if not (all(type(x) in (float, int) and math.isfinite(x) for x in (start, end)) and 0 <= start < end):
                    self.err('timed_range', rel, field=f'{fid}.start/end', actual=f'{start}/{end}')
            locator = f.get('text_locator')
            if locator is not None and not isinstance(locator, dict):
                self.err('text_locator_type', rel, field=fid, actual=locator)
            locator = locator if isinstance(locator, dict) else {}
            match = locator.get('match')
            if match is not None and (not isinstance(match, str) or match not in LOCATOR_MATCHES):
                self.err('unknown_match_method', rel, field=f'{fid}.text_locator.match', actual=match)
            if ls == 'missing':
                missing_reason = f.get('missing_reason') or locator.get('reason')
                if not isinstance(missing_reason, str) or not missing_reason.strip():
                    self.err('missing_reason_absent', rel, field=fid)
            if not re.search(r'^## ' + re.escape(fid) + r'(?:$|[ \t（(])', s['body'], re.M):
                self.err('fragment_body_heading_missing', rel, field=fid)

    def check_tombstone(self, t):
        self.check_record(t, 'tombstone', ('id', 'record_type', 'schema_version', 'status', 'reason', 'legacy_refs', 'merged_into', 'updated'))
        self.require_strings(t['meta'], t['rel'], ('id', 'reason'), 'tomb_type')
        if t['meta'].get('status') != 'retired':
            self.err('tomb_status', t['rel'], field='status', expected='retired')

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
                elif frag and fragIndex[(sid, frag)].get('withdrawn') is True: self.err('source_ref_withdrawn', rel, field=rf)
                elif not re.fullmatch(SOURCE_REF, rf): self.err('source_ref_fragmentless', rel, field='source_refs', actual=rf)
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
        cats = self.load_categories()
        for r in self.exps:
            category = r['meta']['category']
            entry = cats.get(category)
            if entry is None:
                self.err('category_unregistered', r['rel'], field=category)
            elif not Path(r['rel']).is_relative_to(entry['path']) or (not entry['active'] and category != 'CAT-PENDING'):
                self.err('category_path_mismatch', r['rel'], field=category, expected=entry['path'])
        self.check_registry(byId, srcById)
        self.eligible = sorted(
            r['meta']['id'] for r in self.exps
            if r['meta']['status'] == 'adopted' and r['meta']['adoption_basis'] in ('user_dai_policy', 'documented_review')
            and r['meta']['extraction_status'] != 'issue'
            and r['meta']['category'] != 'CAT-PENDING'
            and cats.get(r['meta']['category'], {}).get('active')
            and not any(e['path'] == r['rel'] for e in self.errors)
        )
        # 索引/手册（eligible 子集；reference/hold/retired 不得混入）
        idx_rel = os.path.join('04-实战手册', '可用经验索引.md')
        idx_text = dict(self.maint).get(idx_rel)
        if idx_text is None:
            self.err('index_missing', idx_rel)
        else:
            # Resolve one displayed ID per row, ignoring the duplicated ID in a link's file path.
            rows = []
            for line in idx_text.splitlines():
                link_ids = [label for _, label, _ in document_links(line) if re.fullmatch(EXP_ID, label)]
                rows.extend(link_ids or re.findall(EXP_ID, line))
            ids_in_idx = set(rows)
            for rid, count in Counter(rows).items():
                if count > 1:
                    self.err('index_duplicate', idx_rel, id=rid, actual=count)
            for rid in self.eligible:
                if rid not in ids_in_idx: self.err('index_missing_eligible', idx_rel, id=rid)
            for rid in ids_in_idx:
                if rid not in self.eligible: self.err('index_contains_non_eligible', idx_rel, id=rid)
        for rel, text in self.maint:
            if rel.startswith(os.path.join('04-实战手册', '可用经验索引')) or rel.startswith('04-实战手册/可用经验索引'):
                continue
            if rel.startswith('04-实战手册'):
                for rid in set(re.findall(EXP_ID, prose(current_body(text)))):
                    if rid not in self.eligible: self.err('manual_non_eligible', rel, id=rid)
        frag_set = {f'{sid}:{fid}' for sid, fid in fragIndex}
        for r in self.exps:
            body = current_body(r['body'])
            for rf in set(re.findall(SOURCE_REF, body)):
                if rf not in frag_set:
                    self.err('body_source_ref_unresolved', r['rel'], field=rf, id=r['meta']['id'])
            sections = re.findall(r'^## 来源依据[ \t]*\n(.*?)(?=^## |\Z)', body, re.M | re.S)
            if len(sections) != 1:
                self.err('body_source_section_missing' if not sections else 'body_source_section_duplicate', r['rel'], field='来源依据')
            elif set(re.findall(SOURCE_REF, sections[0])) != set(r['meta']['source_refs']):
                self.err('body_source_section_mismatch', r['rel'], field='来源依据', expected=r['meta']['source_refs'])
        # 孤立来源（警告：无任何经验引用——尚未提炼或迁移漏接）
        for sid, s0 in srcById.items():
            used_any = any(x.partition(':')[0] == sid for x in [r for ss in fwd.values() for r in ss])
            if not used_any:
                self.warn('orphan_source', s0['rel'], id=sid, detail='来源无任何经验引用——尚未提炼或迁移漏接，请人工分辨')
        # 链接检查（活动区）
        self.check_links(byId)
        # baseline/mapping
        if baseline and mapping:
            bl = json.loads(Path(baseline).read_text()) if isinstance(baseline, str) else baseline
            mp = json.loads(Path(mapping).read_text()) if isinstance(mapping, str) else mapping
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
        rel = '90-知识库维护/分类登记表.md'
        p = Path(self.root) / rel
        if not p.is_file():
            self.err('category_registry_missing', rel)
            return {}
        categories = {}
        paths = set()
        for line in p.read_text(encoding='utf-8').splitlines():
            if not re.match(r'^\|\s*CAT-', line):
                continue
            parts = [item.strip() for item in line.strip('|').split('|')]
            if len(parts) != 8:
                self.err('category_row_invalid', rel, actual=line)
                continue
            cid, path, name, _, _, state, successors, _ = parts
            if (not re.fullmatch(r'CAT-(?:\d+|PENDING)', cid) or not path.startswith('02-经验/')
                    or '..' in Path(path).parts or state not in ('active', 'retired')):
                self.err('category_row_invalid', rel, field=cid, actual=line)
                continue
            if cid in categories or path in paths:
                self.err('category_duplicate', rel, field=cid, actual=path)
            categories[cid] = {'path': path, 'name': name, 'active': state == 'active', 'successors': re.findall(r'CAT-(?:\d+|PENDING)', successors)}
            paths.add(path)
        for cid, category in categories.items():
            for successor in category['successors']:
                if successor == cid or successor not in categories:
                    self.err('category_successor_invalid', rel, field=cid, actual=successor)
        return categories

    def check_registry(self, experiences, sources):
        rel = '90-知识库维护/编号登记表.json'
        p = Path(self.root) / rel
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
        except (FileNotFoundError, ValueError) as exc:
            self.err('registry_missing' if not p.exists() else 'registry_parse', rel, actual=str(exc))
            return
        if not isinstance(data, dict):
            self.err('registry_parse', rel, expected='object')
            return
        paths = set()
        for group, records in [('experiences', experiences), ('sources', sources)]:
            entries = data.get(group)
            if not isinstance(entries, list):
                self.err('registry_type', rel, field=group, expected='array')
                continue
            seen = set()
            for entry in entries:
                if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) and entry[k] for k in ('id', 'path')):
                    self.err('registry_entry_invalid', rel, field=group, actual=entry)
                    continue
                rid, path = entry['id'], entry['path']
                if rid in seen or path in paths:
                    self.err('registry_duplicate', rel, field=rid, actual=path)
                seen.add(rid)
                paths.add(path)
                record = records.get(rid)
                if not record:
                    self.err('registry_stale_entry', rel, field=rid, actual=path)
                    continue
                if path != record['rel']:
                    self.err('registry_path_mismatch', record['rel'], field='registry.path', actual=path)
                if group == 'experiences':
                    for key in ('status', 'merged_into'):
                        actual, expected = entry.get(key), record['meta'].get(key)
                        if key not in entry or actual != expected:
                            self.err(f'registry_{key}_mismatch', record['rel'], field=rid, actual=actual, expected=expected)
            for rid in sorted(set(records) - seen):
                self.err('registry_missing_entry', records[rid]['rel'], field=rid)

    def check_links(self, by_id):
        root = Path(self.root).resolve()
        paths = [p for p in root.rglob('*.md') if p.is_file() and not p.is_symlink()
                 and not p.is_relative_to(root / '99-历史存档' / '迁移前原件')]
        named = {}
        for p in paths:
            named.setdefault(p.name, []).append(p)
            named.setdefault(p.stem, []).append(p)
        docs = [(r['rel'], r['body']) for r in self.active] + self.maint
        for rel, text in docs:
            for wiki, label, target in document_links(text):
                if re.match(r'^[a-z][a-z0-9+.-]*://', target, re.I):
                    if not valid_url(target):
                        self.err('url_invalid', rel, field=target)
                    continue
                path, _, anchor = unquote(target).partition('#')
                base = (root / rel).parent
                if not path:
                    candidates = [root / rel]
                elif not wiki:
                    candidates = [(base / path).resolve()]
                elif '/' not in path:
                    candidates = named.get(path, [])
                else:
                    candidates = list(dict.fromkeys((root / path, root.parent / path)))
                    if not Path(path).suffix:
                        candidates += [p.with_suffix('.md') for p in candidates]
                hits = [p for p in candidates if p.is_file() and (
                    p.resolve().is_relative_to(root.parent) or (
                        self.project_root is not None and p.resolve().is_relative_to(self.project_root)))]
                if len(hits) != 1 or (anchor and not link_anchor(hits[0].read_text(encoding='utf-8'), anchor)):
                    self.err('wiki_link_broken' if wiki else 'md_link_broken', rel, field=target, actual=len(hits))
                    continue
                if re.fullmatch(EXP_ID, label):
                    record = by_id.get(label)
                    if record is None or hits[0].resolve() != (root / record['rel']).resolve():
                        self.err('link_label_target_mismatch', rel, field=label, actual=target)
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


def cmd_validate(root, report_path, baseline, mapping, project_root):
    c = Checker(root, project_root)
    c.load_all()
    c.checks_run.append('parse')
    for r in c.exps: c.check_experience(r)
    for s in c.srcs: c.check_source(s)
    for t in c.tombs: c.check_tombstone(t)
    c.checks_run.append('types')
    if not c.errors:
        c.check_relations(baseline, mapping)
        c.checks_run.append('relations')
    st = c.stats() if 'relations' in c.checks_run else {'counts': {}, 'positioning': {}}
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
    c.check_source(s)
    if sum(x['meta'].get('id') == src for x in c.srcs) != 1:
        c.err('source_id_duplicate', s['rel'], field='id', actual=src)
    if c.errors:
        write_report(report_path, {'tool_version': TOOL_VERSION, 'command': 'reverse', 'root': root,
                                   'query': source, 'errors': c.errors, 'warnings': [], 'results': []})
        return 1
    frags = s['meta']['fragments']
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
            refs = e['meta'].get('source_refs') if e is not None else None
            if not is_strarr(refs) or f'{src}:{f["id"]}' not in refs:
                c.err('reverse_ref_mismatch', s['rel'], field=f'{f["id"]}.usedBy', actual=uid)
                continue
            results.append({'experience_id': uid, 'status': e['meta'].get('status'), 'extraction_status': e['meta'].get('extraction_status'), 'path': e['rel'], 'title': e['meta'].get('title')})
    rep = {'tool_version': TOOL_VERSION, 'command': 'reverse', 'root': root, 'query': source, 'errors': c.errors, 'fragment': [{'id': f.get('id'), 'location_status': f.get('location_status'), 'usedBy': f.get('usedBy')} for f in frags], 'results': results}
    write_report(report_path, rep)
    print(json.dumps({'command': 'reverse', 'query': source, 'results': len(results), 'report': report_path}, ensure_ascii=False))
    return 1 if c.errors else 0


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
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open('x', encoding='utf-8') as out:
        json.dump(rep, out, ensure_ascii=False, indent=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['validate', 'reverse', 'inventory'])
    parser.add_argument('--root', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--source')
    parser.add_argument('--baseline')
    parser.add_argument('--mapping')
    parser.add_argument('--project-root')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    report = Path(args.report).resolve()
    if report.is_relative_to(root):
        print('report must be outside the checked vault', file=sys.stderr)
        return 2
    try:
        if not root.is_dir():
            raise ValueError('root not found')
        if bool(args.baseline) != bool(args.mapping):
            raise ValueError('--baseline and --mapping must be supplied together')
        if report.exists():
            raise FileExistsError(f'report exists: {report}')
        if args.command == 'validate':
            return cmd_validate(str(root), str(report), args.baseline, args.mapping, args.project_root)
        if args.command == 'reverse':
            if not args.source:
                raise ValueError('--source is required for reverse')
            return cmd_reverse(str(root), str(report), args.source)
        return cmd_inventory(str(root), str(report))
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        if not report.exists():
            try:
                write_report(report, {'tool_version': TOOL_VERSION, 'command': args.command, 'root': str(root),
                                      'errors': [{'code': 'tool_error', 'detail': str(exc)}], 'warnings': []})
            except OSError as report_error:
                print(str(report_error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
