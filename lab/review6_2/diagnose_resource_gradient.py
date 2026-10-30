"""Frozen1800 local probe: actual last B batch and a same-batch A teacher swap."""
import json,pathlib,hashlib,time
from learner import Learner,torch,combined_loss,validate_batch
from training_core import preference_root_mean

HOME=pathlib.Path(__file__).resolve().parent
def read(p):return json.loads(pathlib.Path(p).read_text())
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def norm(gs):return float(torch.sqrt(sum(g.double().square().sum() for g in gs)))
def dot(a,b):return float(sum((x.double()*y.double()).sum() for x,y in zip(a,b)))

def main():
    begin=time.monotonic();torch.set_num_threads(2);torch.set_num_interop_threads(1)
    run=HOME/'runs/r62-p9c-resource';m=read(run/'manifest.json');c=m['config'];cp=run/read(run/'latest.json')['path'];state=read(cp/'state.json')
    assert state['absoluteUpdate']==1800 and m['runId']=='r62-p9c-resource'
    paths=[run/'manifest.json',cp/'manifest.json',cp/'learner.pt',cp/'weights.f32',cp/'state.json',run/'batch.f32',run/'batch.json',run/'events.jsonl',run/'anchors.json',pathlib.Path(c['teacherSetRef']),pathlib.Path(m['parent']['weightsPath'])]
    before={str(p):sha(p) for p in paths}
    for f in read(cp/'manifest.json')['files']:assert sha(cp/f['name'])==f['sha256']
    assert sha(c['teacherSetRef'])==state['teacherSetSHA256'] and sha(run/'anchors.json')==state['anchorsSHA256']
    labels=read(c['teacherSetRef']);extra=read(c['curriculumUpgradeRef'])['allowedAddedLabelIds'];assert len(extra)==2
    events=[json.loads(s) for s in (run/'events.jsonl').read_text().splitlines()];last=next(e for e in reversed(events) if e.get('kind')=='stepped')
    assert last['update']==1800 and last['weightsSHA256']==sha(cp/'weights.f32') and set(last['labelIds'])&set(extra)=={extra[1]}
    old_ids=[k for k in last['labelIds'] if k not in extra];assert len(old_ids)==10
    metadata=read(run/'batch.json');validate_batch(metadata);assert len(metadata)==1024 and all(r.get('split')=='train' and r.get('complete') is True for r in metadata)
    x=torch.frombuffer(bytearray((run/'batch.f32').read_bytes()),dtype=torch.float32).clone().view(1024,399);y=torch.tensor([r['y'] for r in metadata],dtype=torch.float32)
    reports=[]
    for selected in extra:
        learner=Learner(m['parent']['weightsPath'],m['parent']['weightsSHA256'],'B',m['seed'],read(run/'anchors.json'),labels,m['identity'],c['learningRate'],c['preferenceMode'])
        learner.restore(cp/'learner.pt');assert learner.update==1800
        used=old_ids+[selected];weights=[learner.root_weights[k] for k in used]
        losses=combined_loss(learner.model,x,y,learner.anchors,learner.parent_scores,[learner.book[k] for k in used],'B',weights,preference_mode=c['preferenceMode'])
        existing=.1*(10/11)*preference_root_mean(learner.model,[learner.book[k] for k in old_ids],[learner.root_weights[k] for k in old_ids],mode=c['preferenceMode'])
        new=.1*(1/11)*preference_root_mean(learner.model,[learner.book[selected]],[learner.root_weights[selected]],mode=c['preferenceMode'])
        params=list(learner.model.parameters());terms={'team':losses['team'],'anchor':.01*losses['anchor'],'existingPreference':existing,'newFamilyPreference':new}
        gradients={k:list(torch.autograd.grad(v,params,retain_graph=True)) for k,v in terms.items()};full=list(torch.autograd.grad(losses['total'],params,retain_graph=True))
        residual=[g-sum(parts) for g,parts in zip(full,zip(*gradients.values()))];assert norm(residual)<1e-5*(1+norm(full))
        gap_gradients=[];pairs=[]
        for label_id in extra:
            p,n=learner.book[label_id];gap=(learner.model(p)-learner.model(n)).reshape(-1)[0]
            gap_gradients.append(list(torch.autograd.grad(gap,params,retain_graph=True)));pairs.append({'labelId':label_id,'gapBefore':float(gap.detach())})
        for group in learner.optimizer.param_groups:
            assert group['lr']==.0001 and group['alpha']==.9 and group['eps']==1e-5 and group['momentum']==0 and group['weight_decay']==0 and not group['centered'] and not group.get('maximize',False)
        old=[p.detach().clone() for p in params]
        for p,g in zip(params,full):p.grad=g.detach().clone()
        learner.optimizer.step() # isolated RAM only; no counter/checkpoint/export
        group=learner.optimizer.param_groups[0];denominators=[learner.optimizer.state[p]['square_avg'].sqrt().add(group['eps']) for p in params]
        components={k:[-group['lr']*g/d for g,d in zip(gs,denominators)] for k,gs in gradients.items()};delta=[p.detach()-prior for p,prior in zip(params,old)]
        for row,gg in zip(pairs,gap_gradients):
            p,n=learner.book[row['labelId']]
            with torch.no_grad():after=float((learner.model(p)-learner.model(n)).reshape(-1)[0])
            row.update(projectedGapContributions={k:dot(gg,v) for k,v in components.items()},linearizedFullGapChange=dot(gg,delta),virtualActualGapChange=after-row['gapBefore'],gapAfterVirtualStep=after,nonlinearAndRoundingDifference=after-row['gapBefore']-dot(gg,delta))
        reports.append({'selectedNewFamilyLabel':selected,'scope':'actual final B selection at frozen post1800' if selected==extra[1] else 'hypothetical A teacher swap on the same actual final team batch; not a historical A step','rootDenominator':11,'coefficientIncludedGradientNorms':{k:norm(v) for k,v in gradients.items()},'gradientSumResidualNorm':norm(residual),'fullGradientNorm':norm(full),'pairs':pairs})
    assert before=={str(p):sha(p) for p in paths},'main inputs mutated'
    result={'scope':'two frozen post1800 one-batch local probes, not reconstruction of step1800 or global causality','mainNewUpdates':0,'persistedModels':0,'virtualRAMSteps':2,'mainInputsUnchanged':True,'inputSHA256':before,'reports':reports,'wallSeconds':time.monotonic()-begin,'measuredCPUSeconds':None,'externalPaidCalls':0}
    output=HOME/'receipts/T4-P9C-gradient-direction.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n');print(json.dumps({'output':str(output),**{k:v for k,v in result.items() if k!='inputSHA256'}},ensure_ascii=False))

if __name__=='__main__':main()
