import unittest
import torch
from training_core import preference_root_mean, anchor_root_mean, combined_loss, make_optimizer
class TrainingCoreTests(unittest.TestCase):
 def test_teacher_gradient_direction_and_no_hard_margin_stop(self):
  model=torch.nn.Linear(2,1,bias=False)
  with torch.no_grad():model.weight.zero_()
  pairs=[(torch.tensor([[1.,0.]]),torch.tensor([[0.,1.]]))]
  loss=preference_root_mean(model,pairs);g=torch.autograd.grad(loss,model.parameters())[0]
  self.assertLess(g[0,0].item(),0);self.assertGreater(g[0,1].item(),0)
  with torch.no_grad():model.weight[0,0]=2
  self.assertGreater(torch.autograd.grad(preference_root_mean(model,pairs),model.parameters())[0].norm().item(),0)
  with self.assertRaisesRegex(ValueError,'teacher'):preference_root_mean(model,[])
 def test_anchor_weights_roots_instead_of_candidate_count(self):
  model=torch.nn.Linear(1,1,bias=False)
  with torch.no_grad():model.weight.fill_(2)
  roots=[torch.tensor([[1.]]),torch.tensor([[2.],[2.],[2.]])]
  targets=[torch.zeros(1),torch.zeros(3)]
  self.assertEqual(anchor_root_mean(model,roots,targets).item(),10)
 def test_one_combined_step_contract_and_fixed_optimizer(self):
  model=torch.nn.Linear(2,1,bias=False)
  with torch.no_grad():model.weight.zero_()
  x=torch.tensor([[1.,0.],[0.,1.]])
  anchors=[x];targets=[torch.zeros(2)];pairs=[(x[:1],x[1:])]
  a=combined_loss(model,x,torch.ones(2),anchors,targets,[],arm='A')
  b=combined_loss(model,x,torch.ones(2),anchors,targets,pairs,arm='B')
  self.assertAlmostEqual((b['total']-a['total']).item(),.1*b['preference'].item(),places=6)
  opt=make_optimizer(model);p=opt.param_groups[0]
  for k,v in {'lr':.001,'alpha':.9,'eps':1e-5,'momentum':0,'centered':False,'weight_decay':0}.items():self.assertEqual(p[k],v)
  calls=[];original=opt.step
  def step(*a,**kw):calls.append(1);return original(*a,**kw)
  opt.step=step;opt.zero_grad();b['total'].backward();opt.step();self.assertEqual(len(calls),1)
  with self.assertRaisesRegex(ValueError,'arm'):combined_loss(model,x,torch.ones(2),anchors,targets,pairs,arm='unknown')
if __name__=='__main__':torch.set_num_threads(2);unittest.main()
