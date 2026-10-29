"""Persistent bounded pilot learner. Standard-library admission precedes Torch."""
import sys,json,hashlib,pathlib,array,os,time,resource,math,re
REPO=pathlib.Path('/Users/ccrt/game/guandan')
CYCLE='review6-humanlike-20261028'
GENESIS='66d45addaf0531a072e76b807e19a7e8bb7a681aa7dd3e809cf25fef8b72b337'
TASK='C3-mature-pilot-execution-001'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def verify_original_budget(raw,task):
    previous=None;spent=0.;limit=None;reservations={};settled=set()
    def seconds(x):
        if type(x)not in(int,float)or not math.isfinite(x)or x<0:raise ValueError('finite nonnegative original seconds required')
        return x
    for i,line in enumerate(raw.rstrip('\n').split('\n')):
        match=re.search(r',"entryHash":"([0-9a-f]{64})"}$',line)
        if not match:raise ValueError('original canonical ledger encoding required')
        body=line[:match.start()]+'}';r=json.loads(body);digest=match.group(1)
        if hashlib.sha256(body.encode()).hexdigest()!=digest or r.get('previousHash')!=previous or r.get('cycleId')!=CYCLE:raise ValueError('original full ledger hashchain changed')
        if i==0:
            if digest!=GENESIS or r.get('kind')!='initialize' or r.get('limitSeconds')!=259200:raise ValueError('original pinned genesis required')
            limit=seconds(r['limitSeconds']);spent=seconds(r['actualSeconds'])
        elif r.get('kind')=='reserve':
            t=r.get('taskId')
            if not isinstance(t,str)or not t or t in reservations or t in settled:raise ValueError('duplicate or invalid original reservation')
            reservations[t]=seconds(r['seconds'])
        elif r.get('kind')=='settle'and r.get('taskId')in reservations:
            t=r['taskId'];actual=seconds(r['actualSeconds'])
            if actual>reservations[t]:raise ValueError('original reservation exceeded')
            spent+=actual;del reservations[t];settled.add(t)
        else:raise ValueError('invalid original budget event')
        if spent+sum(reservations.values())>limit:raise ValueError('original cumulative budget exceeded')
        previous=digest
    if reservations!={task:7200}or task in settled:raise ValueError('sole original active7200 task reservation required')
    return{'headHash':previous,'spentSeconds':spent,'reservations':reservations}

def verify_python_snapshot(path,expected,python_entry):
    p=pathlib.Path(path);m=json.loads(p.read_text());root=pathlib.Path(m['snapshotRoot'])
    if sha(p)!=expected or m.get('schemaVersion')!='r6-executable-snapshot-v1' or root.resolve()!=root or p.resolve()!=root/'snapshot-manifest.json' or p!=p.resolve():raise ValueError('canonical Python snapshot manifest required')
    files={root/'snapshot-manifest.json'};links=set();dirs={root}
    for f in m['files']:
        q=pathlib.Path(f['path'])
        if q in files or root not in q.parents or q.resolve()!=q or q.is_symlink()or not q.is_file()or sha(q)!=f['sha256']:raise ValueError('Python frozen file identity/realpath changed')
        files.add(q)
    for a in m['aliases']:
        q=pathlib.Path(a['path']);target=pathlib.Path(a['realTarget'])
        if q in links or root not in q.parents or q.parent.resolve()!=q.parent or not q.is_symlink()or q.resolve()!=target or root not in target.parents:raise ValueError('Python frozen alias escaped')
        links.add(q)
    for q in files|links:
        for parent in q.parents:
            if parent==root:break
            if root not in parent.parents:raise ValueError('Python snapshot parent escaped')
            dirs.add(parent)
    def walk(d):
        with os.scandir(d)as entries:
            for e in entries:
                q=pathlib.Path(e.path)
                if e.is_symlink():
                    if q not in links:raise ValueError('unlisted Python snapshot symlink')
                elif e.is_dir():
                    if q not in dirs:raise ValueError('unlisted Python snapshot directory')
                    walk(q)
                elif not e.is_file()or q not in files:raise ValueError('unlisted Python snapshot file/import')
    walk(root)
    entry=pathlib.Path(python_entry)
    if entry.resolve()!=entry or entry not in files:raise ValueError('actual Python entry not frozen')
    return m

def verify_python_launch(contract_path,contract_sha,launch_path,launch_sha,parent_pid,node_opened_sha):
    if sha(contract_path)!=contract_sha or os.getppid()!=int(parent_pid):raise ValueError('frozen Python actual parent/contract changed')
    c=json.loads(pathlib.Path(contract_path).read_text());lp=REPO/'lab/review6_1/receipts/c3-mature-pilot-execution-001.json';ledger=REPO/'lab/review6/budget-ledger.jsonl';out=REPO/'lab/review6_1/teacher-pilot-001/mature-results-001'
    if pathlib.Path(launch_path)!=lp or lp.resolve()!=lp or sha(lp)!=launch_sha or c['originalRepo']!=str(REPO)or c['cycleId']!=CYCLE or c['mode']!='mature'or c['executionOrdinal']!=1 or c['workers']!=4 or c['outputDirectory']!=str(out):raise ValueError('canonical mature authority required')
    launch=json.loads(lp.read_text());lease=json.loads((REPO/'lab/review6/active-compute-lease.json').read_text());ap=REPO/'lab/review6/cycle-anchor.json';anchor=json.loads(ap.read_text())
    if launch['taskId']!=TASK or launch['cycleId']!=CYCLE or launch['canonicalBudgetLedger']!=str(ledger)or launch['reservationSeconds']!=7200 or launch['maxWorkers']!=6 or launch['parentHardTimeoutSeconds']!=1080 or launch['contractSHA256']!=contract_sha or launch['contractPath']!=contract_path or launch['snapshotManifestSHA256']!=c['snapshotManifestSHA256']or lease['taskId']!=TASK or lease['launchPath']!=launch_path or lease['launchSHA256']!=launch_sha or lease['parentPID']!=launch['parentPID']or lease['contractSHA256']!=contract_sha or lease['snapshotManifestSHA256']!=c['snapshotManifestSHA256']or lease['cycleAnchorSHA256']!=sha(ap)or anchor['cycleId']!=CYCLE or anchor['ledgerPath']!=str(ledger)or anchor['initialEntryHash']!=GENESIS:raise ValueError('official parent/lease/genesis/contract binding required')
    if pathlib.Path(sys.executable).resolve()!=pathlib.Path(c['pythonAbsolutePath']).resolve()or sha(sys.executable)!=c['pythonExecutableSHA256']:raise ValueError('actual Python interpreter identity changed')
    verify_original_budget(ledger.read_text(),TASK)
    m=verify_python_snapshot(c['snapshotManifestPath'],c['snapshotManifestSHA256'],pathlib.Path(__file__).resolve());root=pathlib.Path(m['snapshotRoot'])
    if pathlib.Path(__file__).resolve()!=root/'lab/review6/mature-service.py'or m['sourceRoot']!=str(REPO):raise ValueError('actual Python executable/source root mismatch')
    opened=out/'opened.json';node=json.loads(opened.read_text())
    if sha(opened)!=node_opened_sha or node['nodePID']!=os.getppid()or node['parentPID']!=launch['parentPID']or node['launchPath']!=launch_path or node['launchSHA256']!=launch_sha or node['contractPath']!=contract_path or node['contractSHA256']!=contract_sha or node['snapshotManifestSHA256']!=c['snapshotManifestSHA256']or node['actualEntry']!=pathlib.Path(m['entryPath']).as_uri():raise ValueError('official actual Node controller identity required')
    runtime=json.loads(pathlib.Path(c['torchRuntimeLockPath']).read_text())
    if sha(c['torchRuntimeLockPath'])!=c['torchRuntimeLockSHA256']:raise ValueError('pinned installed Torch runtime lock changed')
    for f in runtime['files']:
        q=pathlib.Path(f['path'])
        if q.resolve()!=q or sha(q)!=f['sha256']:raise ValueError('pinned installed Torch runtime file changed')
    return c,root,runtime

def finite_x(value):
    x=torch.tensor(value,dtype=torch.float32)
    if x.ndim!=2 or x.shape[1]!=399 or not torch.isfinite(x).all():raise ValueError('finite399 feature rows required')
    return x

def main():
    contract_path,contract_sha,launch_path,launch_sha,parent_pid,node_opened_sha=sys.argv[1:]
    c,root,runtime=verify_python_launch(contract_path,contract_sha,launch_path,launch_sha,parent_pid,node_opened_sha)
    with (pathlib.Path(c['outputDirectory'])/'python-service-opened.json').open('x')as f:json.dump({'pid':os.getpid(),'parentNodePID':os.getppid(),'launchSHA256':launch_sha,'contractSHA256':contract_sha,'runtimeLockSHA256':c['torchRuntimeLockSHA256']},f)
    global torch,Net,make_optimizer,combined_loss,validate_batch,select_label_ids
    import torch
    from training_core import Net,make_optimizer,combined_loss
    from mature_protocol import validate_batch,select_label_ids
    if str(torch.__version__)!=runtime['torchVersion']or torch.version.git_version!=runtime['torchGitVersion']or str(pathlib.Path(torch.__file__).resolve())!=runtime['packageInitPath']:raise ValueError('actual installed Torch identity differs from lock')
    torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(2026102822)
    started=time.monotonic();deadline=started+c['maxActiveSeconds'];out=pathlib.Path(c['outputDirectory']).resolve();models={};opts={};steps={};anchors=None;parents=None;book={};exposures={}
    def allowed(p):
        x=pathlib.Path(p).resolve()
        if out not in x.parents:raise ValueError('pilot output data path escaped')
        return x
    def reply(v):print(json.dumps(v,separators=(',',':'),allow_nan=False),flush=True)
    reply({'kind':'ready','pid':os.getpid(),'torchThreads':torch.get_num_threads(),'torchInteropThreads':torch.get_num_interop_threads(),'torchVersion':torch.__version__,'torchRuntimeLockSHA256':c['torchRuntimeLockSHA256'],'torchGitVersion':torch.version.git_version,'torchPackageInitPath':str(pathlib.Path(torch.__file__).resolve()),'maxRSSBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    for line in sys.stdin:
        if time.monotonic()>deadline:raise ValueError('learner bounded deadline expired')
        q=json.loads(line);begin=time.monotonic()
        if q['kind']=='init':
            if models:raise ValueError('learner initialization cannot reset')
            if sha(c['parentWeightsPath'])!=c['parentWeightsSHA256']:raise ValueError('clean parent changed')
            flat=torch.frombuffer(bytearray(pathlib.Path(c['parentWeightsPath']).read_bytes()),dtype=torch.float32).clone()
            for arm in ('A','B'):
                models[arm]=Net();models[arm].load_flat(flat);opts[arm]=make_optimizer(models[arm]);steps[arm]=0
            anchor_path=allowed(q['anchorPath'])
            if sha(anchor_path)!=q['anchorSHA256']:raise ValueError('anchor pool changed')
            raw=json.loads(anchor_path.read_text())
            if len(raw)!=64 or len({r['rootId']for r in raw})!=64:raise ValueError('64 different training anchor roots required')
            anchors=[finite_x(r['features399'])for r in raw]
            parent=Net();parent.load_flat(flat)
            with torch.no_grad():parents=[parent(x).reshape(-1).detach().clone()for x in anchors]
            lock=json.loads(pathlib.Path(c['teacherInputLockPath']).read_text())
            if sha(c['teacherInputLockPath'])!=c['teacherInputLockSHA256'] or len(lock['labels'])!=4:raise ValueError('actual4 qualifiedpilot labels required')
            for ref in lock['labels']:
                if sha(ref['copiedLabelPath'])!=ref['sha256'] or sha(ref['copiedStatsPath'])!=ref['statsSHA256']:raise ValueError('teacher label/statistics identity changed')
                label=json.loads(pathlib.Path(ref['copiedLabelPath']).read_text());stats=json.loads(pathlib.Path(ref['copiedStatsPath']).read_text())
                if label['rootId']!=ref['rootId'] or label['targetScope']!='root_action_only' or label['planLearned']is not False or stats['supported']is not True or ref['labelId']in book:raise ValueError('qualified fixed root-action-only teacher scope required')
                book[ref['labelId']]=(finite_x([label['inputPlus399']]),finite_x([label['inputMinus399']]));exposures[ref['labelId']]=0
            reply({'kind':'initialized','anchorRoots':64,'teacherRoots':len(book),'steps':steps,'seconds':time.monotonic()-begin,'maxRSSBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss});continue
        if q['kind']=='close':reply({'kind':'closed','steps':steps,'exposures':exposures});return
        if q['kind']!='step' or not models:raise ValueError('initialized step request required')
        arm=q['arm'];model=models[arm];optimizer=opts[arm]
        if q['update']!=steps[arm]+1 or q['update']>20:raise ValueError('fixed20 mature updates/arm, no repeat or extra')
        meta_path=allowed(q['metaPath']);x_path=allowed(q['featuresPath'])
        if sha(meta_path)!=q['metaSHA256'] or sha(x_path)!=q['featuresSHA256']:raise ValueError('actual mature gradient batch changed')
        rows=json.loads(meta_path.read_text());quota=validate_batch(rows)
        x=torch.frombuffer(bytearray(x_path.read_bytes()),dtype=torch.float32).clone()
        if x.numel()!=1024*399 or not torch.isfinite(x).all():raise ValueError('actual1024x399 features required')
        x=x.view(1024,399);y=torch.tensor([r['y']for r in rows],dtype=torch.float32);ids=q['labelIds'];teachers=select_label_ids(ids,book,arm)
        if arm=='B' and set(ids)!=set(book):raise ValueError('less64 actualteacherroots mustallbeused withoutduplication')
        losses=combined_loss(model,x,y,anchors,parents,teachers,arm);params=list(model.parameters())
        norm=lambda gs:float(torch.sqrt(sum(g.detach().square().sum()for g in gs)))
        teamnorm=norm(torch.autograd.grad(losses['team'],params,retain_graph=True))
        prefnorm=norm(torch.autograd.grad(.1*losses['preference'],params,retain_graph=True))if arm=='B'else 0.
        if arm=='B' and not prefnorm>0:raise ValueError('teacher singleterm gradient mustbenonzero')
        with torch.no_grad():before=[float((model(p)-model(m)).mean())for p,m in teachers]
        optimizer.zero_grad();losses['total'].backward()
        if any(p.grad is None or not torch.isfinite(p.grad).all()for p in params):raise ValueError('finite combined gradient required')
        optimizer.step();steps[arm]+=1
        with torch.no_grad():after=[float((model(p)-model(m)).mean())for p,m in teachers]
        for label_id in ids:exposures[label_id]+=1
        weight_path=allowed(q['weightPath']);raw=array.array('f',model.flat().tolist()).tobytes()
        if sys.byteorder!='little':raise ValueError('explicitlittleendianruntime required')
        with weight_path.open('xb')as f:f.write(raw)
        cp=allowed(q['optimizerCheckpointPath'])
        if cp.exists():raise ValueError('pilot checkpoint immutable')
        torch.save({'arm':arm,'absoluteUpdate':steps[arm],'model':model.state_dict(),'optimizer':optimizer.state_dict(),'torchRNG':torch.get_rng_state(),'teacherExposureCounts':dict(exposures),'identity':{'contractSHA256':contract_sha,'parentSHA256':c['parentWeightsSHA256']}},cp)
        reply({'kind':'stepped','arm':arm,'update':steps[arm],'optimizerStepsThisRequest':1,'matureGradientSlots':quota,'anchorRoots':64,'anchorCandidates':sum(x.shape[0]for x in anchors),'labelIds':ids,'teacherExposureCounts':dict(exposures),'losses':{k:float(v.detach())for k,v in losses.items()},'teamGradientNorm':teamnorm,'weightedTeacherGradientNorm':prefnorm,'weightedTeacherToTeamGradientNormRatio':prefnorm/teamnorm if teamnorm else None,'teacherGapBefore':before,'teacherGapAfter':after,'weightsPath':str(weight_path),'weightsSHA256':sha(weight_path),'optimizerCheckpointPath':str(cp),'optimizerCheckpointSHA256':sha(cp),'seconds':time.monotonic()-begin,'maxRSSBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    raise ValueError('controller disconnected before explicit close; no automaticresume')
if __name__=='__main__':main()
