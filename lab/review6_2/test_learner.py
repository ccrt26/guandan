"""Breaks caught: losing optimizer/RNG on resume, accepting evaluation data,
or taking a step from an incomplete match. These use the real CPU learner."""
import sys, pathlib, tempfile, unittest, hashlib
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from learner import Learner
import torch

PARENT=pathlib.Path(__file__).parents[1]/'review6_1/data/H-features-001/clean-parent.f32'

class LearnerRecoveryTests(unittest.TestCase):
    def make(self):
        return Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,
                       [{'features399':[[0.0]*399]}],[],'test-config')
    def batch(self):
        x=torch.zeros((1024,399));x[:,0]=1
        rows=[{'decisionId':'m:d'+str(i),'bucket':('self' if i<512 else 'frozen_opponent' if i<768 else 'other_partner'),
               'g':1,'W':1,'y':2,'complete':True,'split':'train'} for i in range(1024)]
        return x,rows
    def test_restore_preserves_optimizer_rng_and_next_update(self):
        x,rows=self.batch();full=self.make()
        for n in range(1,5):full.step(x,rows,n,[])
        split=self.make();split.step(x,rows,1,[]);split.step(x,rows,2,[])
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'state.pt';split.save(str(p))
            restored=self.make();restored.restore(str(p))
            self.assertEqual(restored.update,2)
            for n in [3,4]:restored.step(x,rows,n,[])
            self.assertTrue(torch.equal(full.model.flat(),restored.model.flat()))
            for a,b in zip(full.optimizer.state.values(),restored.optimizer.state.values()):
                self.assertEqual(a['step'].item(),b['step'].item())
                self.assertTrue(torch.equal(a['square_avg'],b['square_avg']))
    def test_rejects_dev_samples_before_parameter_change(self):
        x,rows=self.batch();rows[0]['split']='dev';learner=self.make();before=learner.model.flat().clone()
        with self.assertRaisesRegex(ValueError,'split'):learner.step(x,rows,1,[])
        self.assertTrue(torch.equal(before,learner.model.flat()))
    def test_rejects_incomplete_and_repeated_updates(self):
        x,rows=self.batch();learner=self.make();rows[0]['complete']=False
        with self.assertRaisesRegex(ValueError,'complete'):learner.step(x,rows,1,[])
        rows[0]['complete']=True;learner.step(x,rows,1,[])
        with self.assertRaisesRegex(ValueError,'update'):learner.step(x,rows,1,[])
    def test_restore_rejects_changed_anchor_content(self):
        first=self.make()
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'state.pt';first.save(str(p))
            changed=[0.0]*399;changed[0]=1.0
            other=Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,
                          [{'features399':[changed]}],[],'test-config')
            with self.assertRaisesRegex(ValueError,'anchor'):other.restore(str(p))
    def test_new_runtime_identity_continues_full_state_without_resetting_updates(self):
        x,rows=self.batch();full=self.make()
        for i in range(1,5):full.step(x,rows,i,[])
        old=self.make();old.step(x,rows,1,[]);old.step(x,rows,2,[])
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'old.pt';old.save(str(p))
            new=Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,[{'features399':[[0.0]*399]}],[],'new-runtime')
            new.restore(str(p),expected_identity='test-config')
            self.assertEqual(new.identity,'new-runtime');self.assertEqual(new.update,2)
            for i in [3,4]:new.step(x,rows,i,[])
            self.assertTrue(torch.equal(new.model.flat(),full.model.flat()))
            self.assertEqual([s['step'].item()for s in new.optimizer.state.values()],[4.]*6)
    def test_configured_learning_rate_is_used_and_cannot_change_on_restore(self):
        low=Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,[{'features399':[[0.0]*399]}],[],'test-config',learning_rate=.0001)
        self.assertEqual(low.optimizer.param_groups[0]['lr'],.0001)
        with tempfile.TemporaryDirectory()as directory:
            p=pathlib.Path(directory)/'low.pt';low.save(str(p))
            with self.assertRaisesRegex(ValueError,'learning rate'):self.make().restore(str(p))
    def test_preference_mode_cannot_change_on_restore(self):
        margin=Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,[{'features399':[[0.0]*399]}],[],'test-config',preference_mode='squared_hinge')
        with tempfile.TemporaryDirectory()as directory:
            p=pathlib.Path(directory)/'margin.pt';margin.save(str(p))
            with self.assertRaisesRegex(ValueError,'preference'):self.make().restore(str(p))
            restored=Learner(str(PARENT),hashlib.sha256(PARENT.read_bytes()).hexdigest(),'A',23,[{'features399':[[0.0]*399]}],[],'test-config',preference_mode='squared_hinge')
            restored.restore(str(p));self.assertEqual(restored.preference_mode,'squared_hinge')

if __name__=='__main__':
    torch.set_num_threads(2);unittest.main()
