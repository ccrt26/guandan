"""Compare all non-anchor state and independently validate the intended new data."""
import pathlib,json,hashlib,torch
from learner import Learner
from training_core import Net
HOME=pathlib.Path(__file__).resolve().parent
def read(p):return json.loads(pathlib.Path(p).read_text())
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def canonical(p):return hashlib.sha256(json.dumps(read(p),sort_keys=True,separators=(',',':')).encode()).hexdigest()
def equal(a,b):
    if torch.is_tensor(a):return torch.is_tensor(b) and a.dtype==b.dtype and a.shape==b.shape and torch.equal(a,b)
    if isinstance(a,dict):return isinstance(b,dict) and a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
    if isinstance(a,(tuple,list)):return type(a)is type(b) and len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a==b
torch.set_num_threads(2);torch.set_num_interop_threads(1)
run=HOME/'runs/r62-p13-anchor';m=read(run/'manifest.json');c=m['config'];upgrade=read(c['anchorUpgradeRef']);old=pathlib.Path(upgrade['fromCheckpoint']);new=run/read(run/'latest.json')['path']
a=torch.load(old/'learner.pt',map_location='cpu',weights_only=True);b=torch.load(new/'learner.pt',map_location='cpu',weights_only=True)
assert a.keys()==b.keys() and a['absoluteUpdate']==b['absoluteUpdate']==1400
added=set(read(c['curriculumUpgradeRef'])['allowedAddedLabelIds']);assert len(added)==10 and set(b['teacherExposures'])==set(a['teacherExposures'])|added
for k in a:
    if k=='identity':continue
    if k=='teacherExposures':assert {id:b[k][id] for id in a[k]}==a[k] and all(b[k][id]==0 for id in added)
    elif k=='anchorsSHA256':assert a[k]==canonical(upgrade['oldRef']) and b[k]==canonical(upgrade['newRef']) and a[k]!=b[k]
    else:assert equal(a[k],b[k]),'learner non-anchor state differs: '+k
x,y=read(old/'state.json'),read(new/'state.json');assert x.keys()==y.keys()
for k in x:
    if k=='identity':continue
    if k=='current':assert {p:v for p,v in x[k].items() if p!='weightsPath'}=={p:v for p,v in y[k].items() if p!='weightsPath'}
    elif k=='teacherSetSHA256':assert y[k]==sha(c['teacherSetRef'])
    elif k=='anchorsSHA256':assert x[k]==upgrade['oldSHA256']==sha(upgrade['oldRef']) and y[k]==upgrade['newSHA256']==sha(run/'anchors.json')==sha(upgrade['newRef'])
    else:assert equal(x[k],y[k]),'node non-anchor state differs: '+k
assert (old/'weights.f32').read_bytes()==(new/'weights.f32').read_bytes()
anchors=read(run/'anchors.json');learner=Learner(m['parent']['weightsPath'],m['parent']['weightsSHA256'],'B',m['seed'],anchors,read(c['teacherSetRef']),m['identity'],c['learningRate'],c['preferenceMode']);learner.restore(new/'learner.pt')
parent=Net();parent.load_flat(torch.frombuffer(bytearray(pathlib.Path(m['parent']['weightsPath']).read_bytes()),dtype=torch.float32).clone())
with torch.no_grad():assert all(torch.equal(target,parent(matrix).reshape(-1)) for target,matrix in zip(learner.parent_scores,learner.anchors))
assert len(anchors)==64 and m['parent']['weightsSHA256']=='d5ff100135d969591f92435d02f3af0ef3554fb99b3ac959c23d8ee26894ca01'
row={'parent':'r62-p8c-control','parentCheckpoint':str(old),'runId':'r62-p13-anchor','checkpoint':str(new),'update':1400,'newUpdates':0,'newSources':0,'addedExposuresZero':sorted(added),'modelOptimizerRNGAndOldExposuresExact':True,'nodeQueuesCursorsSourceExact':True,'weightsSHA256':sha(new/'weights.f32'),'intendedAnchorReplacement':{'oldRoots':64,'newRoots':64,'oldSHA256':upgrade['oldSHA256'],'newSHA256':upgrade['newSHA256'],'targetParentSHA256':m['parent']['weightsSHA256'],'newTargetsExactlyOriginalU0':True,'freshCheckpointRestored':True}}
report={'nonAnchorStateEquivalent':True,'rows':[row]};out=HOME/'receipts/T4-P13-actual-bootstrap-equivalence.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report))
