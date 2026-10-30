"""Read existing artifacts and assemble the review archive; never run an experiment."""
from pathlib import Path
import collections, csv, hashlib, json, re, subprocess, sys, zipfile
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'packages').is_dir() and (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'scripts'))
from project_paths import delivery_output
OUT = delivery_output()
OUT.mkdir(parents=True, exist_ok=True)
LAB = ROOT / 'lab/review6_2'
ARCHIVE = OUT / 'guandan-review62-through-p13-evidence-20261030.zip'

def load(p): return json.loads(Path(p).read_text())
def sha(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda: f.read(1048576), b''): h.update(b)
    return h.hexdigest()
def rel(p): return str(Path(p).relative_to(ROOT))
def write_json(p, v): Path(p).write_text(json.dumps(v, ensure_ascii=False, indent=2)+'\n')

def index():
    runs = []
    for p in sorted((LAB/'runs').glob('*/manifest.json')):
        m=load(p); d=p.parent; up=m.get('upstream') or {}
        if not (d/'summary.json').exists():
            runs.append(dict(runId=m['runId'],scope='incomplete_smoke_or_setup',manifest=rel(p),manifestSHA256=sha(p),
                             summary=None,status='No saved summary; do not count as completed main training'))
            continue
        summary=load(d/'summary.json')
        ev=[json.loads(s) for s in (d/'events.jsonl').read_text().splitlines() if s.strip()]
        stepped=[e for e in ev if e['kind']=='stepped']
        source_before=load(Path(up['checkpoint'])/'state.json')['sourceMatches'] if up.get('checkpoint') else 0
        latest=load(d/'latest.json'); cp=d/latest['path']
        runs.append(dict(runId=m['runId'],scope='smoke' if m['config'].get('smoke') else 'main',
            fromUpdate=up.get('absoluteUpdate',0),absoluteUpdate=summary['update'],newUpdates=len(stepped),
            sourceMatchesBefore=source_before,sourceMatchesAfter=summary['sourceMatches'],
            newCompleteRLSources=summary['sourceMatches']-source_before,upstream=up or None,
            checkpoint=rel(cp),weightsSHA256=sha(cp/'weights.f32'),manifest=rel(p),manifestSHA256=sha(p),
            events=rel(d/'events.jsonl'),summary=rel(d/'summary.json'),
            lastInvocationMetrics=summary.get('metrics'),metricsScope='last invocation, not necessarily entire run',
            codeIdentity=m.get('codeIdentity'),teacherSetRef=m['config'].get('teacherSetRef'),
            learningRate=m['config'].get('learningRate',.001),preferenceMode=m['config'].get('preferenceMode','softplus'),
            teacherSchedule=m['config'].get('teacherSchedule')))
    evaluations=[]
    for kind, folder in [('main','development'),('J','development-J')]:
        for p in sorted((LAB/folder).glob('*/report.json')):
            d=load(p); name=p.parent.name
            scope='fixture' if name.endswith('-4blocks') else 'development'
            overlap=512 if name=='r62-p7-control-u800-greedy-32blocks' else 0
            evaluations.append(dict(name=name,kind=kind,scope=scope,path=rel(p),sha256=sha(p),
                reportStatus=d.get('status'),physicalCompleteMatches=d['physicalCompleteMatches'],
                countedNewMainMatches=0 if kind=='J' or scope=='fixture' else d['physicalCompleteMatches']-overlap,
                overlapNote='First 32 blocks reused by fixed 128-block expansion' if overlap else None,
                cooperation=d.get('cooperation'),M1=d.get('M1'),M2=d.get('M2'),S=d.get('S'),J=d.get('J'),
                counts=d.get('counts'),independentBlocks=d.get('independentBlocks'),candidate=d.get('candidate'),
                wallSeconds=d.get('wallSeconds'),resource=d.get('resource'),scopeNote=d.get('scope')))
    main=[r for r in runs if r['scope']=='main']
    totals=dict(newMainUpdates=sum(r['newUpdates'] for r in main),newCompleteRLSources=sum(r['newCompleteRLSources']for r in main),
                mainDevelopmentMatches=sum(e['countedNewMainMatches']for e in evaluations),
                JMatches=sum(e['physicalCompleteMatches']for e in evaluations if e['kind']=='J'),formalAttempts=0)
    assert totals==dict(newMainUpdates=5800,newCompleteRLSources=23564,mainDevelopmentMatches=16896,JMatches=640,formalAttempts=0),totals
    plans=sorted((ROOT/'docs/superpowers/plans').glob('*guandan-review6-2*.md'))
    design=ROOT/'docs/superpowers/specs/2026-10-29-guandan-review6-2-design.md'
    result=dict(preparedDate='2026-10-30',timeZone='Asia/Shanghai',state='stopped_after_p13',
                totals=totals,trainingRuns=runs,evaluations=evaluations,
                plans=[dict(path=rel(p),sha256=sha(p))for p in [design]+plans],
                formal='not run; tool fixtures are not formal attempts',
                warnings=['Do not sum inherited counters or last-window metrics as total cost',
                          'Repeated development sources and one training seed; not confirmation',
                          'Historical commands are not execution authorization',
                          'Archive includes partial sealed questions/answers; do not feed back as blind-test success'])
    write_json(OUT/'训练与评测索引.json',result)
    cols=['runId','scope','fromUpdate','absoluteUpdate','newUpdates','sourceMatchesBefore','sourceMatchesAfter','newCompleteRLSources','checkpoint','weightsSHA256','manifest','summary']
    with (OUT/'training-runs.csv').open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,cols,extrasaction='ignore');w.writeheader();w.writerows(runs)
    cols=['name','kind','scope','physicalCompleteMatches','countedNewMainMatches','macro','M1','M2','S','J','path']
    with (OUT/'development-evaluations.csv').open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,cols);w.writeheader()
        for e in evaluations:
            row={k:e.get(k)for k in cols};row['macro']=(e.get('cooperation')or{}).get('macro',{}).get('point')
            for k in ['M1','M2','J']:
                v=row[k];row[k]=v.get('point')if isinstance(v,dict)else v
            w.writerow(row)
    original=ROOT/'deliverables/review6-2-audit-20261029'
    sources=[OUT/'综合复查报告.md',original/'独立复核报告.md',ROOT/'AGENTS.md',original/'execution-policy.json',
             original/'审核闭环.md',design]+plans+[LAB/'progress.md',original/'P13结果与停止记录_20261030.md',LAB/'stop-after-p13.json']
    for name in ['T4-P8-results-review.txt','T4-P8C-results-review.txt','T4-P9C-results-review.txt','T4-P10-results-review.txt',
                 'T4-P11-results-science-review.txt','T4-P12-results-review.txt','T4-P12-M1-results-review.txt',
                 'T4-P13-results-review.txt','T5-sealed-condition-results-review.txt']:
        sources.append(LAB/'receipts'/name)
    old=ROOT/'deliverables/research/review6-2/chatgpt-review-20261029-001/掼蛋AI执行复查与优化资料_20261029.txt'
    if old.exists():sources.append(old)
    text=['掼蛋AI方案与执行原文合集 2026年10月30日\n当前P13已完成并停止，formal attempt=0、未部署。\n原计划中的命令和阶段状态仅为历史，严禁当作现在的执行授权。\n本合集保留原文，关键结果请先看综合报告；全量回执与原始数据见证据ZIP。\n']
    for i,p in enumerate(sources,1):
        text.append('\n'+'='*72+'\n'+f'原文 {i} {rel(p)}\nSHA256 {sha(p)}\n'+'='*72+'\n'+p.read_text()+'\n')
    (OUT/'方案与执行原文合集.txt').write_text(''.join(text))
    write_json(OUT/'原文合集来源清单.json',[dict(path=rel(p),sha256=sha(p),bytes=p.stat().st_size)for p in sources])
    print(json.dumps(dict(totals=totals,runs=len(runs),evaluations=len(evaluations),plans=len(plans)+1,originalSections=len(sources)),ensure_ascii=False))

def selections():
    files=set(); omitted=[]
    last_weights=set()
    for p in (LAB/'runs').glob('*/latest.json'):
        last_weights.add((p.parent/load(p)['path']/'weights.f32').resolve())
    final=(LAB/'runs/r62-p13-anchor/checkpoints/u001800-b3f2a16e').resolve()
    for p in LAB.rglob('*'):
        if not p.is_file():continue
        if '__pycache__'in p.parts or p.suffix=='.pyc' or p.name=='.DS_Store':continue
        if 'runs'in p.relative_to(LAB).parts and p.suffix in ['.pt','.f32']and p.parent.resolve()!=final and p.resolve()not in last_weights:
            omitted.append(dict(path=rel(p),bytes=p.stat().st_size,sha256=sha(p),reason='Redundant intermediate binary; text/state/manifest retained, original remains local'))
        else:files.add(p)
    for base in ['lab/review6','lab/review6_1']:
        for p in (ROOT/base).iterdir():
            if p.is_file() and p.suffix in ['.ts','.mts','.mjs','.py','.json','.md']:files.add(p)
    for base in ['packages/ai','packages/engine','packages/review','lab/tests']:
        for p in (ROOT/base).rglob('*'):
            if p.is_file() and not any(x in p.parts for x in ['node_modules','dist','__pycache__'])and p.suffix in ['.ts','.tsx','.mjs','.js','.py','.json','.md']:files.add(p)
    for p in (ROOT/'docs/superpowers').rglob('*.md'):
        if 'guandan-review6-2'in p.name:files.add(p)
    for name in ['AGENTS.md','package.json','package-lock.json','tsconfig.json','tsconfig.base.json','vitest.config.ts','.gitignore']:
        p=ROOT/name
        if p.is_file():files.add(p)
    for p in (ROOT/'deliverables/review6-2-audit-20261029').iterdir():
        if p.is_file()and p.suffix!='.zip':files.add(p)
    old=ROOT/'deliverables/research/review6-2/chatgpt-review-20261029-001/掼蛋AI执行复查与优化资料_20261029.txt'
    if old.exists():files.add(old)
    registry=ROOT/'lab/review6_1/data/no-H-policy-registry-001.json';files.add(registry)
    for policy in load(registry)['policies']:
        if policy.get('weightsPath'):files.add(Path(policy['weightsPath']))
    for p in (ROOT/'packages/web/public/ai').glob('*.json'):files.add(p)
    for p in OUT.rglob('*'):
        if p.is_file()and p.suffix not in ['.zip']and p.name not in ['evidence-manifest.json','归档核验.json','GitHub同步结果.json','SHA256SUMS.txt']:files.add(p)
    return sorted(files),omitted

def bundle():
    files,omitted=selections()
    bad=[]
    pattern=re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{40,})')
    for p in files:
        assert p.exists()and not p.is_symlink(),str(p)
        assert not any(x in p.parts for x in ['.git','.venv','node_modules','.aws','.ssh','.codex']),str(p)
        if p.suffix not in ['.pt','.f32','.docx']:
            # The assembly script contains the detection pattern, not a credential.
            if p.name!='assemble_review.py'and pattern.search(p.read_bytes()):bad.append(rel(p))
    assert not bad,{'sensitivePatternFiles':bad}
    proto=(LAB/'protocol.ts').read_text();arr=re.search(r'codeIdentity\(\)\s*\{\s*const paths=(\[.*?\]);',proto,re.S).group(1)
    paths=json.loads(arr.replace("'",'"'));identity=hashlib.sha256(json.dumps([[p,sha(ROOT/p)]for p in paths],separators=(',',':')).encode()).hexdigest()
    stop=load(LAB/'stop-after-p13.json');assert identity==stop['completion']['codeIdentity']
    assert stop['status']=='stopped_after_p13'
    manifest=dict(format='analysis archive, not standalone runtime',preparedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
                  codeIdentity=identity,files=[dict(path=rel(p),bytes=p.stat().st_size,sha256=sha(p))for p in files],
                  omittedFiles=omitted,notCollected=['.venv','node_modules','screenshots','unrelated UI working changes','all historical REVIEW6.1 datasets and external dependencies'],
                  sensitiveScan=dict(fileCount=len(files),highConfidenceCredentialPatterns=0,scope='Selected source/text and known private paths; not a guarantee about all personal data'),
                  warnings=['Contains partial sealed construction answers; formal candidate scores were not opened',
                            'Absolute original paths preserved; no portable resume claim',
                            'Some historical checkpoint manifests reference omitted intermediate binaries'])
    write_json(OUT/'evidence-manifest.json',manifest)
    with zipfile.ZipFile(ARCHIVE,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
        for p in files:z.write(p,rel(p))
        z.write(OUT/'evidence-manifest.json','evidence-manifest.json')
    with zipfile.ZipFile(ARCHIVE)as z:
        assert z.testzip()is None
        for entry in manifest['files']:
            h=hashlib.sha256(z.read(entry['path'])).hexdigest();assert h==entry['sha256'],entry['path']
    verification=dict(status='verified',archive=ARCHIVE.name,archiveBytes=ARCHIVE.stat().st_size,archiveSHA256=sha(ARCHIVE),
                      archivedFiles=len(files)+1,sourceBytes=sum(p.stat().st_size for p in files),omittedIntermediateBinaries=len(omitted),
                      originalStopRecordSHA256=sha(LAB/'stop-after-p13.json'),codeIdentity=identity,
                      originalSourceFilesUnchanged=True,zipCRC='passed',allArchivedFileHashes='passed',
                      trainingOrEvaluationStarted=False,deployed=False)
    write_json(OUT/'归档核验.json',verification)
    (OUT/'SHA256SUMS.txt').write_text(''.join(f'{sha(p)}  {p.name}\n'for p in sorted(OUT.iterdir())if p.is_file()and p.name not in ['SHA256SUMS.txt','GitHub同步结果.json']))
    print(json.dumps(verification,ensure_ascii=False))

if __name__=='__main__':
    {'index':index,'bundle':bundle}[sys.argv[1]]()
