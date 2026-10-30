"""Frozen train-only geometry and one bounded RAM fit; no policy export."""
import hashlib,json,pathlib,random,time
from learner import Learner,torch
from training_core import preference_root_mean

HOME=pathlib.Path(__file__).resolve().parent
def read(p):return json.loads(pathlib.Path(p).read_text())
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def norm(x):return float(torch.linalg.vector_norm(x.double()))
def geometry(a,b):
    na,nb=norm(a),norm(b)
    return {'normA':na,'normB':nb,'cosine':float(torch.dot(a.double(),b.double())/(na*nb)) if na*nb else None,
            'commonFourBiasGradientNorm':norm((a-b)/2),'conditionSeparationGradientNorm':norm(a+b)}

def main():
    started,cpu=time.monotonic(),time.process_time()
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    run=HOME/'runs/r62-p10-coverage';m=read(run/'manifest.json');c=m['config'];cp=run/read(run/'latest.json')['path'];state=read(cp/'state.json')
    assert state['absoluteUpdate']==1800 and sha(cp/'weights.f32')=='902453869d7972657dff726f59add68fcd6e624783508949c635f08cf81d35c6'
    labels=read(c['teacherSetRef']);by_id={l['labelId']:l for l in labels};pool=c['teacherSchedule']['familyPool']
    assert len(pool)==5
    ids=[k for f in pool for k in f['labelIds']];assert len(ids)==len(set(ids))==10
    selected=[by_id[k] for k in ids];roots={l['labelId']:read(l['rootRef']) for l in selected}
    assert all(l['split']=='train' and l['evidenceTier']=='strong' and l['weight']==1 and len(l['pairs'])==1 for l in selected)
    paths=[run/'manifest.json',run/'latest.json',cp/'manifest.json',cp/'learner.pt',cp/'weights.f32',cp/'state.json',run/'anchors.json',pathlib.Path(c['teacherSetRef']),pathlib.Path(m['parent']['weightsPath']),HOME/'learner.py',HOME.parent/'review6/training_core.py',HOME/'receipts/T4-P10-coverage-resource-choices-1800.json']+[pathlib.Path(l['rootRef']) for l in selected]
    before={str(p):sha(p) for p in paths}
    for f in read(cp/'manifest.json')['files']:assert sha(cp/f['name'])==f['sha256']
    assert before[c['teacherSetRef']]==state['teacherSetSHA256'] and sha(run/'anchors.json')==state['anchorsSHA256']
    learner=Learner(m['parent']['weightsPath'],m['parent']['weightsSHA256'],'B',m['seed'],read(run/'anchors.json'),labels,m['identity'],c['learningRate'],c['preferenceMode']);learner.restore(cp/'learner.pt')
    assert learner.update==1800 and c['learningRate']==.0001 and c['preferenceMode']=='squared_hinge'
    model=learner.model;params=list(model.parameters());reference=read(HOME/'receipts/T4-P10-coverage-resource-choices-1800.json')
    reference_by_key={r['rootKey']:r for r in reference['rows']}
    def snapshot(step):
        rows=[]
        with torch.no_grad():
            for l in selected:
                p,n=learner.book[l['labelId']];gap=float((model(p)-model(n)).reshape(-1)[0]);root=roots[l['labelId']]
                candidates=root['allCandidates'];x=torch.tensor([[*root['observedBefore']['modelState331'],*a['features68']] for a in candidates],dtype=torch.float32)
                assert x.shape==(len(candidates),399) and torch.isfinite(x).all()
                scores=model(x).reshape(-1);idx=int(torch.argmax(scores));choice=candidates[idx]['actionId'];pair=l['pairs'][0]
                status='supported' if choice==pair['preferredActionId'] else 'contradicted' if choice==pair['otherActionId'] else 'unverified'
                if step==0:
                    old=reference_by_key[l['rootKey']];assert abs(gap-old['pairGap'])<1e-5 and choice==old['actual']
                rows.append({'labelId':l['labelId'],'rootKey':l['rootKey'],'gap':gap,'actualActionId':choice,'status':status,'ranking':[{'actionId':a['actionId'],'score':float(s)} for a,s in zip(candidates,scores)]})
        return {'virtualStep':step,'positiveGaps':sum(r['gap']>0 for r in rows),'marginSatisfied':sum(r['gap']>=.16 for r in rows),
                'choiceCounts':{s:sum(r['status']==s for r in rows) for s in ['supported','contradicted','unverified']},'rows':rows}
    snapshots=[snapshot(0)];jac={};denominators=[]
    for group in learner.optimizer.param_groups:
        assert group['alpha']==.9 and group['eps']==1e-5 and group['momentum']==0 and group['weight_decay']==0 and not group['centered']
        for p in group['params']:denominators.append(learner.optimizer.state[p]['square_avg'].detach().sqrt().add(group['eps']).reshape(-1))
    denominator=torch.cat(denominators).double();assert denominator.numel()==sum(p.numel() for p in params)
    saturation=[]
    for l in selected:
        p,n=learner.book[l['labelId']];gap=(model(p)-model(n)).reshape(-1)[0]
        jac[l['labelId']]=torch.cat([g.reshape(-1).detach().clone() for g in torch.autograd.grad(gap,params)])
        with torch.no_grad():
            x=torch.cat((p,n));h1=model.f[1](model.f[0](x));h2=model.f[3](model.f[2](h1))
            saturation.append({'labelId':l['labelId'],'hidden1AbsAtLeast099Fraction':float((h1.abs()>=.99).float().mean()),'hidden2AbsAtLeast099Fraction':float((h2.abs()>=.99).float().mean())})
    constraints={};conflicts=[];static=[]
    for l in selected:
        p,n=learner.book[l['labelId']];pk,nk=tuple(p.reshape(-1).tolist()),tuple(n.reshape(-1).tolist())
        if (nk,pk) in constraints:conflicts.append([constraints[(nk,pk)],l['labelId']])
        if pk==nk:conflicts.append([l['labelId'],'identical_plus_minus'])
        constraints[(pk,nk)]=l['labelId']
    for f in pool:
        a,b=f['labelIds'];ap,an=learner.book[a];bp,bn=learner.book[b]
        ja,jb=jac[a],jac[b];wa,wb=ja.double()/denominator.sqrt(),jb.double()/denominator.sqrt()
        static.append({'familyId':f['sourceFamilyId'],'labelIds':[a,b],
                       'state331Different':not torch.equal(ap[:,:331],bp[:,:331]),
                       'four399Different':not torch.equal(ap,bn),'five399Different':not torch.equal(an,bp),
                       'fourMinusFiveAction68DifferenceNorm':norm((ap-an)[0,331:]-(bn-bp)[0,331:]),
                       'raw':geometry(ja,jb),'frozenRMSMetric':geometry(wa,wb)})
    virtual_exposures={k:0 for k in ids};failure=None;actual_steps=0
    for step in range(1,201):
        used=[f['labelIds'][(step-1)%2] for f in pool]
        loss=.1*preference_root_mean(model,[learner.book[k] for k in used],[1.]*5,mode='squared_hinge')
        if not torch.isfinite(loss):failure='nonfinite preference loss';break
        learner.optimizer.zero_grad();loss.backward()
        if any(p.grad is None or not torch.isfinite(p.grad).all() for p in params):failure='nonfinite gradient';break
        learner.optimizer.step();actual_steps=step
        for k in used:virtual_exposures[k]+=1
        if any(not torch.isfinite(p).all() for p in params):failure='nonfinite RAM parameters';break
        if step in [50,100,200]:snapshots.append(snapshot(step))
    assert before=={str(p):sha(p) for p in paths},'main input changed'
    assert learner.update==1800 and learner.exposures==torch.load(cp/'learner.pt',map_location='cpu',weights_only=True)['teacherExposures']
    if failure is None:assert actual_steps==200 and set(virtual_exposures.values())=={100}
    report={'scope':'one finite train-only RAM fit and local geometry; not production loss or causal ablation, no generalization claim',
            'status':'completed' if failure is None else 'diagnostic_failed','failure':failure,'mainNewUpdates':0,'persistedModels':0,'virtualRAMSteps':actual_steps,
            'checkpoint':str(cp),'inputSHA256':before,'mainInputsUnchanged':True,'exactReversedInputConstraints':conflicts,
            'frozenRMSDefinition':'J transformed by 1/sqrt(sqrt(saved square_avg)+eps), cosine in frozen current RMS inverse metric; not next-step denominator',
            'nominalPerRootCoefficient':2,'originalP10PerRootCoefficient':4/11,'nominalRatio':5.5,'virtualExposures':virtual_exposures,
            'families':static,'tanhSaturationDescription':saturation,'snapshots':snapshots,
            'wallSeconds':time.monotonic()-started,'measuredProcessCPUSeconds':time.process_time()-cpu,'externalPaidCalls':0,
            'limits':'No team/anchor/old10; root denominator5 rather than11 and each root100 rather than40. Cannot assign causality to any removed component or dose. Failure is not impossibility; finite training fit is not unseen skill.'}
    output=HOME/'receipts/T4-P11-separation-diagnosis.json';assert not output.exists(),'preserve original diagnostic'
    output.write_text(json.dumps(report,ensure_ascii=False,allow_nan=False,indent=2)+'\n')
    print(json.dumps({'output':str(output),'status':report['status'],'wallSeconds':report['wallSeconds'],'measuredProcessCPUSeconds':report['measuredProcessCPUSeconds'],'exactReversedInputConstraints':conflicts,'snapshots':[{k:v for k,v in s.items() if k!='rows'} for s in snapshots]},ensure_ascii=False))

if __name__=='__main__':main()
