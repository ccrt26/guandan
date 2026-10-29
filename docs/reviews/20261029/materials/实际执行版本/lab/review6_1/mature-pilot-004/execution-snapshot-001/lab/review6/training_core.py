"""Fixed REVIEW6 no-H loss primitives. Unit arithmetic is not a mature pilot."""
import torch
from torch import nn
from torch.nn import functional as F

class Net(nn.Module):
    def __init__(self, d=399):
        super().__init__()
        self.d_in=d
        self.f=nn.Sequential(nn.Linear(d,256),nn.Tanh(),nn.Linear(256,256),nn.Tanh(),nn.Linear(256,1))
    def forward(self,x): return self.f(x)
    def load_flat(self,flat):
        expected=256*self.d_in+256+256*256+256+256+1
        if flat.numel()!=expected or not torch.isfinite(flat).all(): raise ValueError('finite parent flat identity required')
        offset=0
        with torch.no_grad():
            for lin in [self.f[0],self.f[2],self.f[4]]:
                n=lin.weight.numel();lin.weight.copy_(flat[offset:offset+n].view_as(lin.weight));offset+=n
                n=lin.bias.numel();lin.bias.copy_(flat[offset:offset+n]);offset+=n
    def flat(self): return torch.cat([p.detach().reshape(-1) for lin in [self.f[0],self.f[2],self.f[4]] for p in [lin.weight,lin.bias]])

def make_optimizer(model):
    return torch.optim.RMSprop(model.parameters(),lr=.001,alpha=.9,eps=1e-5,momentum=0,centered=False,weight_decay=0)

def preference_root_mean(model,roots):
    if not roots: raise ValueError('actual nonempty teacher roots required for B')
    losses=[]
    for plus,minus in roots:
        if plus.ndim!=2 or plus.shape!=minus.shape or plus.shape[0]<1 or not torch.isfinite(plus).all() or not torch.isfinite(minus).all(): raise ValueError('teacher pair features invalid')
        losses.append(F.softplus(.16-(model(plus).reshape(-1)-model(minus).reshape(-1))).mean())
    return torch.stack(losses).mean()

def anchor_root_mean(model,roots,parent_scores):
    if not roots or len(roots)!=len(parent_scores): raise ValueError('training anchor root pool required')
    losses=[]
    for x,target in zip(roots,parent_scores):
        if x.ndim!=2 or x.shape[0]<1 or target.numel()!=x.shape[0] or not torch.isfinite(x).all() or not torch.isfinite(target).all(): raise ValueError('anchor features/parent scores invalid')
        losses.append((model(x).reshape(-1)-target.detach().reshape(-1)).square().mean())
    return torch.stack(losses).mean()

def combined_loss(model,x,y,anchor_roots,parent_scores,teacher_roots,arm):
    if arm not in ('A','B'): raise ValueError('unknown arm')
    if x.ndim!=2 or x.shape[0]<1 or y.numel()!=x.shape[0] or not torch.isfinite(x).all() or not torch.isfinite(y).all(): raise ValueError('finite mature team batch required')
    team=(model(x).reshape(-1)-y.reshape(-1)).square().mean()
    anchor=anchor_root_mean(model,anchor_roots,parent_scores)
    preference=preference_root_mean(model,teacher_roots) if arm=='B' else team.new_zeros(())
    return {'team':team,'anchor':anchor,'preference':preference,'total':team+.01*anchor+( .1*preference if arm=='B' else 0)}
