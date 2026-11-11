#!/usr/bin/env python3
# test_vault_check.py — V01–V15 固定回归矩阵（方案 §4）。通过真实 CLI 入口运行，不复制内部函数。
# 运行：python3 -B test_vault_check.py   （全部通过退出 0）
import os, sys, json, shutil, subprocess, tempfile, hashlib, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PY = '/Library/Developer/CommandLineTools/usr/bin/python3'
BACKEND = os.path.join(HERE, 'vault_check.py')


def run_cli(args):
    r = subprocess.run([PY, '-B', BACKEND] + args, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def exp_yaml(o=None):
    d = {'id': 'GD-PR-001', 'title': '测试卡', 'category': 'CAT-002', 'kind': 'action', 'source_class': 'dai',
         'adoption_basis': 'user_dai_policy', 'status': 'adopted', 'extraction_status': 'unreviewed',
         'source_refs': '["SRC-000001:E01"]', 'review_ref': 'null', 'schema_version': '"1.0"',
         'tags': '[]', 'limitations': '[]', 'related_ids': '[]', 'rule_ref': '"r"',
         'created': '"2026-11-12T10:00:00+08:00"', 'updated': '"2026-11-12T10:00:00+08:00"', 'record_type': 'experience'}
    d.update(o or {})
    fm = [f'id: "{d["id"]}"' if isinstance(d["id"], str) else f'id: {d["id"]}',
          f'record_type: {d["record_type"]}', 'schema_version: "1.0"', f'title: {d["title"]}', f'category: {d["category"]}',
          f'tags: {d["tags"]}', f'kind: {d["kind"]}', f'source_class: {d["source_class"]}',
          f'adoption_basis: {d["adoption_basis"]}', f'review_ref: {d["review_ref"]}', f'status: {d["status"]}',
          f'extraction_status: {d["extraction_status"]}', f'source_refs: {d["source_refs"]}',
          f'rule_ref: {d["rule_ref"]}', f'limitations: {d["limitations"]}', f'related_ids: {d["related_ids"]}',
          f'created: {d["created"]}', f'updated: {d["updated"]}']
    refs = json.loads(d['source_refs']) if isinstance(d.get('source_refs'), str) else (d.get('source_refs') or [])
    body = '## 摘要\n\n完整句子摘要。\n\n## 主体\n\n**原则**：完整主张。\n\n## 来源依据\n\n' + '\n'.join(f'- {r}' for r in refs) + '\n\n## 限制\n\n- 无\n\n## 相关经验\n\n- 无\n'
    return '---\n' + '\n'.join(fm) + '\n---\n\n' + body


def src_yaml(sid='SRC-000001', frags=None, kind='video', **over):
    frags = frags if frags is not None else [{'id': 'E01', 'usedBy': ['GD-PR-001'], 'location_status': 'missing',
                                               'text_locator': {'status': 'missing', 'reason': '测试'}, 'start_seconds': None, 'end_seconds': None, 'quote': 'q', 'material_path': None}]
    def fs(f):
        tl = 'null' if f.get('text_locator') is None else f.get('text_locator')
        return (f"  - id: {f['id']}\n    location_status: {f.get('location_status','missing')}\n"
                f"    start_seconds: {f.get('start_seconds','null')}\n    end_seconds: {f.get('end_seconds','null')}\n"
                f"    text_locator: {json.dumps(tl, ensure_ascii=False)}\n    usedBy: {json.dumps(f.get('usedBy', []))}\n    quote: \"{f.get('quote','')}\"")
    base = {'id': sid, 'source_kind': kind, 'author': '"作者"', 'title': '"来源标题"', 'source_class': ('web' if kind == 'web' else 'dai'),
            'url': '"https://example.com/a"', 'url_missing_reason': 'null', 'platform_id': 'null', 'episode': 'null' if kind == 'web' else '1',
            'captured_at': '"2026-11-12T10:00:00+08:00"', 'material_level': '"fulltext"' if kind == 'web' else 'transcript_only'}
    base.update(over)
    expids = sorted({u for f in frags for u in f.get('usedBy', [])})
    fm = f"""---
id: "{base['id']}"
record_type: source
schema_version: "1.0"
source_kind: {base['source_kind']}
author: {base['author']}
title: {base['title']}
source_class: {base['source_class']}
url: {base['url']}
url_missing_reason: {base['url_missing_reason']}
platform_id: {base['platform_id']}
episode: {base['episode']}
captured_at: {base['captured_at']}
material_level: {base['material_level']}
material_refs: []
experience_ids: {json.dumps(expids)}
fragments:
""" + '\n'.join(fs(f) for f in frags) + '\n---\n\n# 来源标题\n\n' + '\n'.join(f'## {f["id"]}\n\n- 摘录\n' for f in frags)
    return fm + '\n'


class VaultFixture:
    def __init__(self):
        self.root = tempfile.mkdtemp(prefix='vcheck-')
        for d in ['02-经验/02-牌权与让接', '03-来源资料/戴长胜视频', '03-来源资料/WEB文章', '04-实战手册', '90-知识库维护', '99-历史存档/停用内容']:
            os.makedirs(os.path.join(self.root, d), exist_ok=True)
        self.w('90-知识库维护/分类登记表.md', '| category_id | path | name | scope | boundary | status | successor_ids | created |\n|---|---|---|---|---|---|---|---|\n| CAT-002 | 02-经验/02-牌权与让接 | 牌权 | s | b | active | | 2026-11-12 |\n')
        self.rep_i = 0

    def w(self, rel, content):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write(content)

    def reg(self, exps=None, srcs=None):
        self.w('90-知识库维护/编号登记表.json', json.dumps({'schema_version': '1.0',
            'experiences': exps if exps is not None else [{'id': 'GD-PR-001', 'path': '02-经验/02-牌权与让接/GD-PR-001-a.md', 'status': 'adopted', 'merged_into': None}],
            'sources': srcs if srcs is not None else [{'id': 'SRC-000001', 'path': '03-来源资料/戴长胜视频/SRC-000001-a.md'}],
            'reserved_experience_ids': [], 'reserved_source_ids': []}, ensure_ascii=False))

    def validate(self):
        self.rep_i += 1
        rep = os.path.join(self.root, f'.rep-{self.rep_i}.json')
        if os.path.exists(rep): os.remove(rep)
        code, out = run_cli(['validate', '--root', self.root, '--report', rep])
        data = json.load(open(rep)) if os.path.exists(rep) else {'errors': [], 'warnings': []}
        return code, data

    def reverse(self, source):
        self.rep_i += 1
        rep = os.path.join(self.root, f'.rep-{self.rep_i}.json')
        if os.path.exists(rep): os.remove(rep)
        code, out = run_cli(['reverse', '--root', self.root, '--source', source, '--report', rep])
        data = json.load(open(rep)) if os.path.exists(rep) else {}
        return code, data

    def clean(self):
        shutil.rmtree(self.root, ignore_errors=True)


def full_vault(**kw):
    v = VaultFixture()
    v.w('02-经验/02-牌权与让接/GD-PR-001-a.md', exp_yaml(kw.get('exp_over')))
    v.w('03-来源资料/戴长胜视频/SRC-000001-a.md', src_yaml(frags=kw.get('frags')))
    v.w('04-实战手册/可用经验索引.md', '# 索引\n\n| ID |\n|---|\n| GD-PR-001 |\n')
    v.reg(kw.get('reg_exps'), kw.get('reg_srcs'))
    return v


class V01_MinimalValid(unittest.TestCase):
    def runTest(self):
        v = full_vault()
        code, d = v.validate()
        self.assertEqual((code, d['errors']), (0, []), d['errors'][:3])
        self.assertIn('GD-PR-001', d['eligible_ids'])
        v.clean()


class V02_LegalQuotes(unittest.TestCase):
    def runTest(self):
        v = full_vault(exp_over={'limitations': '["保留＂可能＂限定"]', 'title': '"保留\\"可能\\"限定"'})
        code, d = v.validate()
        self.assertEqual(code, 0, d['errors'][:3])
        v.clean()


class V03_IllegalQuotesAndDupKeys(unittest.TestCase):
    def runTest(self):
        v1 = full_vault(exp_over={'title': '"未转义"引号"标题"'})
        c1, d1 = v1.validate(); self.assertEqual(c1, 1); self.assertTrue(any(e['code'] == 'parse_error' for e in d1['errors']), d1['errors'][:2]); v1.clean()
        v2 = full_vault()
        p = os.path.join(v2.root, '02-经验/02-牌权与让接/GD-PR-001-a.md')
        t = open(p).read().replace('kind: action', 'kind: action\nkind: action')
        open(p, 'w').write(t)
        c2, d2 = v2.validate(); self.assertEqual(c2, 1); self.assertTrue(any(e['code'] == 'parse_error' for e in d2['errors'])); v2.clean()


class V04_UsedByStringAndNullFragments(unittest.TestCase):
    def runTest(self):
        v = full_vault(frags=[{'id': 'E01', 'usedBy': 'GD-PR-001', 'location_status': 'missing', 'text_locator': {'status': 'missing', 'reason': 'r'}, 'quote': 'q'}])
        c, d = v.validate(); self.assertEqual(c, 1); self.assertTrue(any(e['code'] == 'usedBy_type' for e in d['errors'])); v.clean()
        v2 = full_vault()
        p = os.path.join(v2.root, '03-来源资料/戴长胜视频/SRC-000001-a.md')
        t = open(p).read()
        t = t[:t.index('fragments:\n')] + 'fragments: null\n---\n\n# 来源标题\n'
        open(p, 'w').write(t)
        c2, d2 = v2.validate(); self.assertTrue(any(e['code'] == 'array_type' and e.get('field') == 'fragments' for e in d2['errors']), [e['code'] for e in d2['errors']][:5]); v2.clean()


class V05_RegistryStatusMismatch(unittest.TestCase):
    def runTest(self):
        v = full_vault(reg_exps=[{'id': 'GD-PR-001', 'path': '02-经验/02-牌权与让接/GD-PR-001-a.md', 'status': 'hold', 'merged_into': None}])
        c, d = v.validate(); self.assertEqual(c, 1); self.assertTrue(any(e['code'] == 'registry_status_mismatch' for e in d['errors'])); v.clean()


class V06_SourceDupAndMissingFields(unittest.TestCase):
    def runTest(self):
        v = full_vault()
        v.w('03-来源资料/WEB文章/SRC-000001-b.md', src_yaml().replace('author: "作者"', 'author: "作者"'))
        c, d = v.validate(); self.assertTrue(any(e['code'] == 'source_id_duplicate' for e in d['errors'])); v.clean()
        v2 = full_vault()
        p = os.path.join(v2.root, '03-来源资料/戴长胜视频/SRC-000001-a.md')
        _t = open(p).read().replace('author: "作者"\n', '')
        open(p, 'w').write(_t)
        c2, d2 = v2.validate(); self.assertTrue(any(e['code'] == 'source_field_missing' for e in d2['errors'])); v2.clean()


class V07_Links(unittest.TestCase):
    def runTest(self):
        v = full_vault()
        v.w('04-实战手册/核心手册.md', '见 [断链](02-经验/02-牌权与让接/ghost.md) 与 [[幽灵目标]]，合法 [卡](../02-经验/02-牌权与让接/GD-PR-001-a.md)。')
        c, d = v.validate(); self.assertEqual(c, 1)
        codes = [e['code'] for e in d['errors']]
        self.assertIn('md_link_broken', codes); self.assertIn('wiki_link_broken', codes); v.clean()
        v2 = full_vault()
        v2.w('04-实战手册/核心手册.md', '合法锚点 [索引](可用经验索引.md#索引) 与角括号 <可用经验索引.md>。')
        c2, d2 = v2.validate(); self.assertEqual(c2, 0, [e for e in d2['errors'][:3]]); v2.clean()


class V08_BodyRefs(unittest.TestCase):
    def runTest(self):
        v = full_vault(exp_over={'source_refs': '["SRC-000001:E02"]', 'limitations': '[]'})
        # 重写正文引用 E00（不存在），属性 E02 存在与否另测
        p = os.path.join(v.root, '02-经验/02-牌权与让接/GD-PR-001-a.md')
        open(p, 'w').write(exp_yaml({'source_refs': '["SRC-000001:E02"]'}).replace('- SRC-000001:E02', '- SRC-000001:E00').replace('["SRC-000001:E02"]', '["SRC-000001:E01"]'))
        c, d = v.validate(); codes = [e['code'] for e in d['errors']]
        self.assertTrue('body_source_section_mismatch' in codes or 'body_source_ref_unresolved' in codes, codes[:5]); self.assertEqual(c, 1); v.clean()


class V09_AdoptionCombos(unittest.TestCase):
    def runTest(self):
        # web adopted 无 review
        v = full_vault(exp_over={'source_class': 'web', 'adoption_basis': 'none', 'status': 'reference'},
                        reg_exps=[{'id': 'GD-PR-001', 'path': '02-经验/02-牌权与让接/GD-PR-001-a.md', 'status': 'reference', 'merged_into': None}])
        v.w('04-实战手册/可用经验索引.md', '# 索引\n\n（无可用）\n')
        c, d = v.validate(); self.assertEqual(c, 0, d['errors'][:2]); self.assertNotIn('GD-PR-001', d['eligible_ids']); v.clean()
        v2 = full_vault(exp_over={'adoption_basis': 'anything'})
        c2, d2 = v2.validate(); self.assertEqual(c2, 1); self.assertNotIn('GD-PR-001', d2.get('eligible_ids', [])); v2.clean()
        v3 = full_vault(exp_over={'extraction_status': 'issue'})
        c3, d3 = v3.validate(); self.assertEqual(c3, 1); v3.clean()
        # WEB 正例：documented_review + review_ref
        v4 = full_vault(exp_over={'source_class': 'web', 'adoption_basis': 'documented_review', 'review_ref': '"90-知识库维护/论证.md"'})
        v4.w('90-知识库维护/论证.md', '---\n类型: 论证\n---\n# 论证\n绑定 GD-PR-001。')
        c4, d4 = v4.validate(); self.assertEqual(c4, 0, d4['errors'][:2]); self.assertIn('GD-PR-001', d4['eligible_ids']); v4.clean()


class V10_Tombstones(unittest.TestCase):
    def runTest(self):
        def tomb(a, into):
            return f'---\nid: {a}\nrecord_type: tombstone\nschema_version: "1.0"\nstatus: retired\nreason: "r"\nlegacy_refs: []\nmerged_into: {into}\nupdated: "2026-11-12T10:00:00+08:00"\n---\n'
        for into, code_want in [('GD-T1', 'tomb_target_missing')]:
            v = full_vault(); v.w(f'99-历史存档/停用内容/A-停用说明.md', tomb('GD-A', into)); v.reg()
            c, d = v.validate(); self.assertTrue(any(e['code'] == code_want for e in d['errors'])); v.clean()
        v = full_vault()
        v.w('99-历史存档/停用内容/A-停用说明.md', tomb('GD-A', 'GD-B'))
        v.w('99-历史存档/停用内容/B-停用说明.md', tomb('GD-B', 'GD-A'))
        c, d = v.validate(); self.assertTrue(any(e['code'] in ('tomb_cycle', 'tomb_target_missing') for e in d['errors'])); v.clean()
        v3 = full_vault(); v3.w('99-历史存档/停用内容/C-停用说明.md', tomb('GD-C', 'null')); v3.reg()
        c3, d3 = v3.validate(); self.assertEqual(c3, 0, d3['errors'][:2]); v3.clean()


class V11_IndexAndManual(unittest.TestCase):
    def runTest(self):
        v = full_vault(); v.w('04-实战手册/可用经验索引.md', '# 索引（空）\n')
        c, d = v.validate(); self.assertEqual(c, 1); self.assertTrue(any(e['code'] == 'index_missing_eligible' for e in d['errors'])); v.clean()
        v2 = full_vault(exp_over={'status': 'reference', 'adoption_basis': 'none'})
        v2.w('04-实战手册/核心手册.md', '采用 [GD-PR-001] 建议以及索引含 GD-PR-001。')
        v2.w('04-实战手册/可用经验索引.md', '# 索引\n\n| ID |\n|---|\n| GD-PR-001 |\n')
        c2, d2 = v2.validate(); codes = [e['code'] for e in d2['errors']]
        self.assertIn('manual_non_eligible', codes); self.assertIn('index_contains_non_eligible', codes); v2.clean()


class V12_CategoryExtension(unittest.TestCase):
    def runTest(self):
        v = full_vault()
        v.w('90-知识库维护/分类登记表.md', open(os.path.join(v.root, '90-知识库维护/分类登记表.md')).read() + '| CAT-008 | 02-经验/100-新主题目录 | 新主题 | s | b | active | | 2026-11-12 |\n')
        os.makedirs(os.path.join(v.root, '02-经验/100-新主题目录'), exist_ok=True)
        v.w('02-经验/100-新主题目录/GD-K000001-b.md', exp_yaml({'id': 'GD-K000001', 'category': 'CAT-008'}))
        p0 = os.path.join(v.root, '03-来源资料/戴长胜视频/SRC-000001-a.md')
        open(p0, 'w').write(src_yaml(frags=[{'id': 'E01', 'usedBy': ['GD-PR-001', 'GD-K000001'], 'location_status': 'missing', 'text_locator': {'status': 'missing', 'reason': 'r'}, 'quote': 'q'}]))
        v.reg(exps=[{'id': 'GD-PR-001', 'path': '02-经验/02-牌权与让接/GD-PR-001-a.md', 'status': 'adopted', 'merged_into': None},
                    {'id': 'GD-K000001', 'path': '02-经验/100-新主题目录/GD-K000001-b.md', 'status': 'adopted', 'merged_into': None}])
        v.w('04-实战手册/可用经验索引.md', '# 索引\n\n| ID |\n|---|\n| GD-PR-001 |\n| GD-K000001 |\n')
        c, d = v.validate(); self.assertEqual(c, 0, d['errors'][:3]); self.assertIn('GD-K000001', d['eligible_ids']); v.clean()


class V13_Reverse(unittest.TestCase):
    def runTest(self):
        v = full_vault(frags=[{'id': 'E01', 'usedBy': ['GD-PR-001'], 'location_status': 'missing', 'text_locator': {'status': 'missing', 'reason': 'r'}, 'quote': 'q'},
                              {'id': 'E02', 'usedBy': ['GD-PR-001'], 'location_status': 'missing', 'text_locator': {'status': 'missing', 'reason': 'r'}, 'quote': 'q2'}],
                       exp_over={'source_refs': '["SRC-000001:E01","SRC-000001:E02"]'})
        c, d = v.validate(); self.assertEqual(c, 0, d['errors'][:2])
        code, rep = v.reverse('SRC-000001:E02')
        self.assertEqual(code, 0); self.assertEqual(rep['results'][0]['experience_id'], 'GD-PR-001')
        code2, rep2 = v.reverse('SRC-000001:E99')
        self.assertEqual(code2, 1); self.assertEqual(rep2['errors'][0]['code'], 'fragment_unknown')
        v.clean()


class V14_PositioningStats(unittest.TestCase):
    def runTest(self):
        frags = [{'id': 'E01', 'usedBy': ['GD-PR-001'], 'location_status': 'text_only', 'text_locator': {'status': 'text_only', 'match': 'exact-normalized'}, 'quote': 'a'},
                 {'id': 'E02', 'usedBy': ['GD-PR-001'], 'location_status': 'text_only', 'text_locator': {'status': 'text_only', 'match': 'fuzzy-lcs'}, 'quote': 'b'},
                 {'id': 'E03', 'usedBy': ['GD-PR-001'], 'location_status': 'text_only', 'text_locator': {}, 'quote': 'c'}]
        v = full_vault(frags=frags, exp_over={'source_refs': '["SRC-000001:E01","SRC-000001:E02","SRC-000001:E03"]'})
        p = os.path.join(v.root, '02-经验/02-牌权与让接/GD-PR-001-a.md')
        open(p, 'w').write(exp_yaml({'source_refs': '["SRC-000001:E01","SRC-000001:E02","SRC-000001:E03"]'}))
        c, d = v.validate(); self.assertEqual(c, 0, d['errors'][:2])
        pos = d['positioning']
        self.assertEqual((pos['video_exact'], pos['video_fuzzy_candidate'], pos['video_copy_note']), (1, 1, 1))
        self.assertEqual(sum(pos.values()), 3)
        v.clean()


class V15_SummaryNoRegression(unittest.TestCase):
    def runTest(self):
        v = full_vault(exp_over={'limitations': '["L1"]'})
        c, d = v.validate(); self.assertEqual(c, 0, d['errors'][:2])
        # 摘要不含维护日志、无半句
        p = os.path.join(v.root, '02-经验/02-牌权与让接/GD-PR-001-a.md')
        text = open(p).read()
        self.assertNotIn('2026-11-08', text.split('## 主体')[0])
        v.clean()


if __name__ == '__main__':
    unittest.main(verbosity=1)
