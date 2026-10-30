import pathlib,sys,unittest,torch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'review6'))
from training_core import preference_root_mean

class MarginPreferenceTests(unittest.TestCase):
 def test_fixed_all_root_and_pair_denominators(self):
  model=lambda x:x[:,0]
  teachers=[(torch.tensor([[.2],[0.]]),torch.zeros(2,1)),(torch.zeros(1,1),torch.zeros(1,1))]
  value=preference_root_mean(model,teachers,[1.,.25],mode='squared_hinge')
  self.assertAlmostEqual(float(value),.0096,places=7)
  duplicated=[(teachers[0][0].repeat(2,1),teachers[0][1].repeat(2,1)),teachers[1]]
  self.assertTrue(torch.equal(value,preference_root_mean(model,duplicated,[1.,.25],mode='squared_hinge')))
 def test_satisfied_pairs_have_graph_zero_and_dynamic_reactivation(self):
  w=torch.nn.Parameter(torch.tensor(1.));model=lambda x:x[:,0]*w
  teachers=[(torch.tensor([[.3]]),torch.zeros(1,1)),(torch.tensor([[.4]]),torch.zeros(1,1))]
  loss=preference_root_mean(model,teachers,mode='squared_hinge');self.assertTrue(loss.requires_grad);loss.backward();self.assertEqual(float(w.grad),0.)
  w.grad=None
  with torch.no_grad():w.fill_(.1)
  loss=preference_root_mean(model,teachers,mode='squared_hinge');loss.backward();self.assertGreater(float(loss),0.);self.assertLess(float(w.grad),0.)
 def test_only_unsatisfied_pair_produces_gradient_without_changing_denominator(self):
  w=torch.nn.Parameter(torch.tensor(1.));model=lambda x:x[:,0]*w
  teachers=[(torch.tensor([[.3]]),torch.zeros(1,1)),(torch.zeros(1,1),torch.tensor([[.1]]))]
  loss=preference_root_mean(model,teachers,mode='squared_hinge');loss.backward();self.assertAlmostEqual(float(w.grad),.026,places=6)

if __name__=='__main__':unittest.main()
