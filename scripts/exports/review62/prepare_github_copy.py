"""Copy review documents and browsable evidence to an isolated publication clone."""
from pathlib import Path
import importlib.util, shutil, json, sys, os

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'packages').is_dir() and (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'scripts'))
from project_paths import delivery_output
OUT = delivery_output()
OUT.mkdir(parents=True, exist_ok=True)
spec=importlib.util.spec_from_file_location('archive',Path(__file__).with_name('assemble_review.py'))
archive=importlib.util.module_from_spec(spec);spec.loader.exec_module(archive)
from project_paths import checked_output
if not os.environ.get('GD_PUBLICATION_OUTPUT_ROOT'): raise ValueError('Set GD_PUBLICATION_OUTPUT_ROOT=lab/out/<new-publication-task>; this command only stages local files')
clone=checked_output(os.environ['GD_PUBLICATION_OUTPUT_ROOT'])
dest=clone/'review62-p13'
if dest.exists(): raise FileExistsError('Refusing to overwrite publication staging directory: '+str(dest))
dest.mkdir(parents=True)
files,_=archive.selections();copied=[]
for p in files:
    r=p.relative_to(archive.ROOT);parts=r.parts
    if p.is_relative_to(OUT):
        target=dest/p.relative_to(OUT)
    elif p.suffix in ['.pt','.f32']:
        continue
    elif str(r).startswith('lab/review6_2/'):
        tail=p.relative_to(archive.LAB)
        if tail.parts[0] in ['development','development-J','receipts']:
            target=dest/'evidence'/r
        elif tail.parts[0]=='runs':
            if len(tail.parts)!=3:continue
            target=dest/'evidence'/r
        elif tail.parts[0]=='data':
            if p.name not in ['summary.json','partial-skills-manifest.json']:continue
            target=dest/'evidence'/r
        elif tail.parts[0] in ['versions','backups']or len(tail.parts)==1:
            target=dest/'source-snapshot'/r
        else:continue
    elif str(r).startswith('deliverables/'):
        target=dest/'evidence'/r
    else:
        target=dest/'source-snapshot'/r
    target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    assert archive.sha(p)==archive.sha(target)
    copied.append({'path':str(target.relative_to(clone)),'source':str(r),'sha256':archive.sha(p),'bytes':p.stat().st_size})
for name in ['evidence-manifest.json','归档核验.json','SHA256SUMS.txt']:
    p=OUT/name;shutil.copy2(p,dest/name)
(dest/'GitHub文件清单.json').write_text(json.dumps({'files':copied,'fullEvidence':'Release ZIP, not all binary/intermediate data tracked in git'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'destination':str(dest),'files':len(copied)+4,'bytes':sum(p['bytes']for p in copied)},ensure_ascii=False))
