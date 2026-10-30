"""Frozen post-checkpoint direction probe. Writes a report, never a model."""
import sys,json,pathlib,hashlib,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from learner import Learner,torch,combined_loss,validate_batch

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(pathlib.Path(p).read_text())
def norm(gs):return float(torch.sqrt(sum(g.double().square().sum() for g in gs)))
def dot(a,b):return float(sum((x.double()*y.double()).sum() for x,y in zip(a,b)))

def main(directory,output):
    begin=time.monotonic();torch.set_num_threads(2);torch.set_num_interop_threads(1)
    run=pathlib.Path(directory).resolve();m=read(run/'manifest.json');c=m['config']
    cp=run/read(run/'latest.json')['path'];state=read(cp/'state.json')
    assert state['absoluteUpdate']==400 and m['runId']=='r62-p6-natural'
    paths=[run/'manifest.json',cp/'learner.pt',cp/'state.json',cp/'weights.f32',run/'batch.f32',run/'batch.json',run/'anchors.json',pathlib.Path(c['teacherSetRef']),pathlib.Path(m['parent']['weightsPath'])]
    before={str(p):sha(p) for p in paths}
    assert sha(c['teacherSetRef'])==state['teacherSetSHA256']
    assert sha(run/'anchors.json')==state['anchorsSHA256']
    for f in read(cp/'manifest.json')['files']:assert sha(cp/f['name'])==f['sha256']
    labels=read(c['teacherSetRef']);events=[json.loads(s) for s in (run/'events.jsonl').read_text().splitlines()]
    last=next(e for e in reversed(events) if e.get('kind')=='stepped')
    assert last['update']==400 and last['weightsSHA256']==sha(cp/'weights.f32')
    used=[next(l for l in labels if l['labelId']==k) for k in last['labelIds']]
    learner=Learner(m['parent']['weightsPath'],m['parent']['weightsSHA256'],'B',m['seed'],read(run/'anchors.json'),labels,m['identity'],c['learningRate'],c['preferenceMode'])
    learner.restore(cp/'learner.pt');assert learner.update==400
    rows=read(run/'batch.json');validate_batch(rows)
    assert len(rows)==1024 and all(r.get('split')=='train' and r.get('complete') is True for r in rows)
    x=torch.frombuffer(bytearray((run/'batch.f32').read_bytes()),dtype=torch.float32).clone().view(1024,399)
    y=torch.tensor([r['y'] for r in rows],dtype=torch.float32)
    losses=combined_loss(learner.model,x,y,learner.anchors,learner.parent_scores,[learner.book[l['labelId']] for l in used],'B',[l['weight'] for l in used],preference_mode=c['preferenceMode'])
    params=list(learner.model.parameters())
    gradients={name:list(torch.autograd.grad(scale*losses[name],params,retain_graph=True)) for name,scale in [('team',1.),('anchor',.01),('preference',.1)]}
    full=list(torch.autograd.grad(losses['total'],params))
    residual=[g-sum(parts) for g,parts in zip(full,zip(*gradients.values()))]
    projections=[];gap_grads=[]
    for label in used:
        p,minus=learner.book[label['labelId']]
        gaps=(learner.model(p)-learner.model(minus)).reshape(-1)
        for i,pair in enumerate(label['pairs']):
            if label['evidenceTier']!='strong' or not(float(gaps[i].detach())<0 or pathlib.Path(label['rootRef']).stem.endswith('1017')):continue
            gap_grads.append(list(torch.autograd.grad(gaps[i],params,retain_graph=True)))
            projections.append({'rootRef':label['rootRef'],'pair':pair,'gapBefore':float(gaps[i].detach()),'labelId':label['labelId'],'pairIndex':i})
    old=[p.detach().clone() for p in params]
    for group in learner.optimizer.param_groups:
        assert group['momentum']==0 and not group['centered'] and group['weight_decay']==0 and not group.get('maximize',False)
    for p,g in zip(params,full):p.grad=g.detach().clone()
    learner.optimizer.step() # isolated RAM copy only; no checkpoint/export/update counter
    denominators=[learner.optimizer.state[p]['square_avg'].sqrt().add(learner.optimizer.param_groups[0]['eps']) for p in params]
    lr=learner.optimizer.param_groups[0]['lr']
    components={k:[-lr*g/d for g,d in zip(gs,denominators)] for k,gs in gradients.items()}
    actual_delta=[p.detach()-prior for p,prior in zip(params,old)]
    for row,gg in zip(projections,gap_grads):
        p,minus=learner.book[row['labelId']]
        with torch.no_grad():after=float((learner.model(p)-learner.model(minus)).reshape(-1)[row['pairIndex']])
        row.update({'projectedGapContributions':{k:dot(gg,ds) for k,ds in components.items()},'actualStepLinearizedGapChange':dot(gg,actual_delta),'virtualStepActualGapChange':after-row['gapBefore'],'gapAfterVirtualStep':after})
    assert before=={str(p):sha(p) for p in paths},'main inputs mutated'
    report={'scope':'post-400 frozen last-batch local probe; not reconstruction of step400, not global causality','mainNewUpdates':0,'persistedModels':0,'inputSHA256':before,'mainInputsUnchanged':True,'batchSlots':1024,'teacherRoots':len(used),'lossesAtPost400':{k:float(v.detach()) for k,v in losses.items()},'coefficientIncludedGradientNorms':{k:norm(v) for k,v in gradients.items()},'gradientSumResidualNorm':norm(residual),'fullGradientNorm':norm(full),'actualVirtualRMSpropDeltaNorm':norm(actual_delta),'pairs':projections,'wallSeconds':time.monotonic()-begin,'measuredCPUSeconds':None,'externalPaidCost':0}
    pathlib.Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:report[k] for k in ['mainNewUpdates','mainInputsUnchanged','wallSeconds','pairs']},ensure_ascii=False))

if __name__=='__main__':main(sys.argv[1],sys.argv[2])
