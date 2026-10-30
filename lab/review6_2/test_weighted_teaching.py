"""Catches normalizing away weak-label weights and counting pairs as roots."""
import sys,pathlib,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'review6'))
import torch
from training_core import preference_root_mean

class WeightedTeachingTests(unittest.TestCase):
    def test_weak_root_keeps_quarter_gradient_even_when_all_roots_weak(self):
        net=torch.nn.Linear(2,1,bias=False)
        with torch.no_grad():net.weight.zero_()
        roots=[(torch.tensor([[1.,0.]]),torch.tensor([[0.,1.]]))]
        strong=preference_root_mean(net,roots,weights=[1.])
        weak=preference_root_mean(net,roots,weights=[.25])
        self.assertAlmostEqual(weak.item(),strong.item()*.25,places=6)
        a=torch.autograd.grad(strong,net.parameters(),retain_graph=True)[0]
        b=torch.autograd.grad(weak,net.parameters())[0]
        self.assertTrue(torch.equal(a*.25,b))
    def test_duplicate_pairs_within_one_root_do_not_multiply_its_weight(self):
        net=torch.nn.Linear(2,1,bias=False)
        with torch.no_grad():net.weight.zero_()
        a=torch.tensor([[1.,0.]]);b=torch.tensor([[0.,1.]])
        one=preference_root_mean(net,[(a,b)],weights=[.25])
        many=preference_root_mean(net,[(a.repeat(5,1),b.repeat(5,1))],weights=[.25])
        self.assertAlmostEqual(one.item(),many.item(),places=6)

if __name__=='__main__':torch.set_num_threads(2);unittest.main()
