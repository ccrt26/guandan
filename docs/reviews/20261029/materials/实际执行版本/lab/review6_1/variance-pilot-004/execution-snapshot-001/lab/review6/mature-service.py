"""Persistent CPU pilot learner. Exactly one combined RMSprop step per request.
This is a bounded measurement service, not an automatic production run/resumer.
"""
import sys,json,hashlib,pathlib,array,os,time,resource

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def finite_x(value):
    x=torch.tensor(value,dtype=torch.float32)
    if x.ndim!=2 or x.shape[1]!=399 or not torch.isfinite(x).all():raise ValueError('finite399 feature rows required')
    return x

def main():
    contract_path,contract_sha,launch_path,launch_sha,parent_pid=sys.argv[1:]
    if sha(contract_path)!=contract_sha or os.getppid()!=int(parent_pid):raise ValueError('frozen learner parent/contract changed')
    c=json.loads(pathlib.Path(contract_path).read_text());repo=pathlib.Path('/Users/ccrt/game/guandan');task='C3-mature-pilot-execution-001'
    if sha(launch_path)!=launch_sha or pathlib.Path(launch_path)!=repo/'lab/review6_1/receipts/c3-mature-pilot-execution-001.json':raise ValueError('canonical learner launch receipt required')
    launch=json.loads(pathlib.Path(launch_path).read_text());lease=json.loads((repo/'lab/review6/active-compute-lease.json').read_text());anchor=json.loads((repo/'lab/review6/cycle-anchor.json').read_text())
    if launch['taskId']!=task or launch['reservationSeconds']!=6000 or launch['contractSHA256']!=contract_sha or launch['contractPath']!=contract_path or launch['snapshotManifestSHA256']!=c['snapshotManifestSHA256'] or lease['taskId']!=task or lease['launchPath']!=launch_path or lease['launchSHA256']!=launch_sha or lease['parentPID']!=launch['parentPID'] or anchor['initialEntryHash']!='66d45addaf0531a072e76b807e19a7e8bb7a681aa7dd3e809cf25fef8b72b337' or c['originalRepo']!=str(repo) or c['cycleId']!='review6-humanlike-20261028':raise ValueError('original cycle/lease/contract binding required')
    root=pathlib.Path(c['snapshotManifestPath']).parent.resolve()
    if c['mode']!='mature' or pathlib.Path(__file__).resolve()!=root/'lab/review6/mature-service.py':raise ValueError('frozen Python entry required')
    manifest=json.loads(pathlib.Path(c['snapshotManifestPath']).read_text())
    if sha(c['snapshotManifestPath'])!=c['snapshotManifestSHA256'] or any(sha(f['path'])!=f['sha256'] for f in manifest['files']):raise ValueError('Python frozen tree file identity changed')
    with (pathlib.Path(c['outputDirectory'])/'python-service-opened.json').open('x')as f:json.dump({'pid':os.getpid(),'parentNodePID':os.getppid(),'launchSHA256':launch_sha,'contractSHA256':contract_sha},f)
    global torch,Net,make_optimizer,combined_loss,validate_batch,select_label_ids
    import torch
    from training_core import Net,make_optimizer,combined_loss
    from mature_protocol import validate_batch,select_label_ids
    balance=0
    for line in (repo/'lab/review6/budget-ledger.jsonl').read_text().splitlines():
        row=json.loads(line)
        if row.get('cycleId')=='review6-humanlike-20261028' and row.get('taskId')==task:
            if row['kind']=='reserve':balance+=row['seconds']
            elif row['kind']=='settle':balance=0
    if balance!=6000:raise ValueError('original6000 active reservation required')
    torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(2026102822)
    started=time.monotonic();deadline=started+c['maxActiveSeconds'];out=pathlib.Path(c['outputDirectory']).resolve();models={};opts={};steps={};anchors=None;parents=None;book={};exposures={}
    def allowed(p):
        x=pathlib.Path(p).resolve()
        if out not in x.parents:raise ValueError('pilot output data path escaped')
        return x
    def reply(v):print(json.dumps(v,separators=(',',':'),allow_nan=False),flush=True)
    reply({'kind':'ready','pid':os.getpid(),'torchThreads':2,'torchVersion':torch.__version__,'maxRSSBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
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
