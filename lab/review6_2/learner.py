"""Configuration-driven persistent CPU learner; original simulation/loss retained."""
import sys,json,pathlib,hashlib,random,array,os,math
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'review6'))
import torch
from training_core import Net,make_optimizer,combined_loss
from mature_protocol import validate_batch

def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def matrix(rows):
    x=torch.as_tensor(rows,dtype=torch.float32)
    if x.ndim!=2 or x.shape[0]<1 or x.shape[1]!=399 or not torch.isfinite(x).all():
        raise ValueError('finite nonempty 399-dimensional matrix required')
    return x

class Learner:
    def __init__(self,parent_path,parent_sha,arm,seed,anchors,labels,identity,learning_rate=.001,preference_mode='softplus'):
        if arm not in ('A','B') or sha(parent_path)!=parent_sha:raise ValueError('parent/arm identity mismatch')
        torch.manual_seed(seed);random.seed(seed)
        self.arm=arm;self.identity=identity;self.parent_sha=parent_sha;self.update=0
        if preference_mode not in ('softplus','squared_hinge'):raise ValueError('unknown preference mode')
        self.preference_mode=preference_mode
        flat=torch.frombuffer(bytearray(pathlib.Path(parent_path).read_bytes()),dtype=torch.float32).clone()
        self.model=Net();self.model.load_flat(flat);self.optimizer=make_optimizer(self.model)
        if not math.isfinite(learning_rate)or learning_rate<=0:raise ValueError('positive finite learning rate required')
        self.learning_rate=learning_rate
        for group in self.optimizer.param_groups:group['lr']=learning_rate
        parent=Net();parent.load_flat(flat)
        self.anchors=[matrix(r['features399']) for r in anchors]
        self.anchors_sha=hashlib.sha256(json.dumps(anchors,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        if not self.anchors:raise ValueError('training anchors required')
        with torch.no_grad():self.parent_scores=[parent(x).reshape(-1).detach().clone() for x in self.anchors]
        self.book={};self.exposures={};self.root_weights={}
        for label in labels:
            if label.get('split')!='train':raise ValueError('teacher split must be train')
            if label['labelId'] in self.book:raise ValueError('duplicate teacher label')
            self.book[label['labelId']]=(matrix(label['plus']),matrix(label['minus']))
            weight=label.get('weight',1.)
            if type(weight)not in(int,float) or weight not in (.25,1.):raise ValueError('strong/weak weight invalid')
            self.root_weights[label['labelId']]=weight
            self.exposures[label['labelId']]=0
        if arm=='B' and not self.book:raise ValueError('nonempty actual teacher signal required')
    def step(self,x,rows,update,label_ids):
        if update!=self.update+1:raise ValueError('absolute update must advance exactly once')
        if any(r.get('split')!='train' for r in rows):raise ValueError('gradient split must be train')
        if any(r.get('complete') is not True for r in rows):raise ValueError('complete match required')
        validate_batch(rows)
        if tuple(x.shape)!=(1024,399) or not torch.isfinite(x).all():raise ValueError('finite1024x399 team batch required')
        if len(label_ids)!=len(set(label_ids)) or any(k not in self.book for k in label_ids):raise ValueError('teacher IDs invalid')
        if self.arm=='A' and label_ids or self.arm=='B' and not label_ids:raise ValueError('arm teacher mismatch')
        teachers=[self.book[k] for k in label_ids]
        y=torch.tensor([r['y'] for r in rows],dtype=torch.float32)
        losses=combined_loss(self.model,x,y,self.anchors,self.parent_scores,teachers,self.arm,[self.root_weights[k] for k in label_ids],preference_mode=self.preference_mode)
        if any(not torch.isfinite(v) for v in losses.values()):raise ValueError('nonfinite loss')
        with torch.no_grad():
            before_pairs=[(self.model(p)-self.model(m)).reshape(-1).tolist()for p,m in teachers]
            before=[sum(row)/len(row)for row in before_pairs]
        teacher_norm=0.
        if self.arm=='B':
            gs=torch.autograd.grad(.1*losses['preference'],list(self.model.parameters()),retain_graph=True)
            teacher_norm=float(torch.sqrt(sum(g.square().sum()for g in gs)))
        self.optimizer.zero_grad();losses['total'].backward()
        if any(p.grad is None or not torch.isfinite(p.grad).all()for p in self.model.parameters()):raise ValueError('nonfinite gradient')
        self.optimizer.step();self.update=update
        for key in label_ids:self.exposures[key]+=1
        with torch.no_grad():
            after_pairs=[(self.model(p)-self.model(m)).reshape(-1).tolist()for p,m in teachers]
            after=[sum(row)/len(row)for row in after_pairs]
        return {'update':self.update,'losses':{k:float(v.detach())for k,v in losses.items()},'teacherGradientNorm':teacher_norm,
                'labelIds':label_ids,'gapsBefore':before,'gapsAfter':after,'pairGapsBefore':before_pairs,'pairGapsAfter':after_pairs,
                'pairsBelowMarginBefore':sum(g<.16 for row in before_pairs for g in row),'preferenceMode':self.preference_mode,'teacherExposures':dict(self.exposures)}
    def save(self,path):
        torch.save({'model':self.model.state_dict(),'optimizer':self.optimizer.state_dict(),'torchRNG':torch.get_rng_state(),
                    'pythonRNG':random.getstate(),'absoluteUpdate':self.update,'teacherExposures':self.exposures,
                    'arm':self.arm,'identity':self.identity,'parentSHA256':self.parent_sha,'anchorsSHA256':self.anchors_sha,'preferenceMode':self.preference_mode},path)
    def restore(self,path,expected_identity=None):
        state=torch.load(path,map_location='cpu',weights_only=True)
        if state['identity']!=(self.identity if expected_identity is None else expected_identity) or state['parentSHA256']!=self.parent_sha or state['arm']!=self.arm:
            raise ValueError('checkpoint configuration identity mismatch')
        if state.get('anchorsSHA256')!=self.anchors_sha:raise ValueError('checkpoint anchor content changed')
        if state.get('preferenceMode','softplus')!=self.preference_mode:raise ValueError('checkpoint preference mode changed')
        if any(g['lr']!=self.learning_rate for g in state['optimizer']['param_groups']):raise ValueError('checkpoint optimizer learning rate changed')
        if set(state['teacherExposures'])!=set(self.book):raise ValueError('checkpoint teacher set changed')
        self.model.load_state_dict(state['model']);self.optimizer.load_state_dict(state['optimizer'])
        torch.set_rng_state(state['torchRNG']);random.setstate(state['pythonRNG'])
        self.update=state['absoluteUpdate'];self.exposures=state['teacherExposures']
    def weights(self,path):
        if sys.byteorder!='little':raise ValueError('little-endian runtime required')
        pathlib.Path(path).write_bytes(array.array('f',self.model.flat().tolist()).tobytes())

def main():
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    learner=None
    def reply(v):print(json.dumps(v,allow_nan=False,separators=(',',':')),flush=True)
    reply({'kind':'ready','threads':torch.get_num_threads(),'interop':torch.get_num_interop_threads()})
    for line in sys.stdin:
        q=json.loads(line);kind=q['kind']
        if kind=='init':
            if learner is not None:raise ValueError('already initialized')
            learner=Learner(q['parentPath'],q['parentSHA256'],q['arm'],q['seed'],json.loads(pathlib.Path(q['anchorsPath']).read_text()),json.loads(pathlib.Path(q['labelsPath']).read_text()),q['identity'],q.get('learningRate',.001),q.get('preferenceMode','softplus'))
            reply({'kind':'initialized','update':0});continue
        if learner is None:raise ValueError('initialize first')
        if kind=='restore':learner.restore(q['path'],q.get('expectedIdentity'));reply({'kind':'restored','update':learner.update})
        elif kind=='step':
            x=torch.frombuffer(bytearray(pathlib.Path(q['featuresPath']).read_bytes()),dtype=torch.float32).clone().view(1024,399)
            rows=json.loads(pathlib.Path(q['metadataPath']).read_text())
            v=learner.step(x,rows,q['update'],q['labelIds']);learner.weights(q['weightsPath']);reply({'kind':'stepped',**v,'weightsSHA256':sha(q['weightsPath'])})
        elif kind=='save':learner.save(q['path']);learner.weights(q['weightsPath']);reply({'kind':'saved','update':learner.update,'weightsSHA256':sha(q['weightsPath'])})
        elif kind=='close':reply({'kind':'closed','update':learner.update});return
        else:raise ValueError('unknown learner command')
    raise ValueError('controller disconnected')

if __name__=='__main__':main()
