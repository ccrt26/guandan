import unittest,json,pathlib,sys,tempfile,os
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'lab/review6_2'))
from curriculum_learner import AppendLearner,base
base.torch.set_num_threads(2)

class AppendRestoreTest(unittest.TestCase):
    def setUp(self):
        self.run=ROOT/'lab/review6_2/runs/r62-p6-natural'
        self.m=json.loads((self.run/'manifest.json').read_text());self.cp=self.run/json.loads((self.run/'latest.json').read_text())['path']
        self.labels=json.loads(pathlib.Path(self.m['config']['teacherSetRef']).read_text())
        self.state=base.torch.load(self.cp/'learner.pt',map_location='cpu',weights_only=True)
        self.extra={**self.labels[-1],'labelId':'append-test-only-extra'}
    def learner(self,cls=AppendLearner):
        return cls(self.m['parent']['weightsPath'],self.m['parent']['weightsSHA256'],'B',self.m['seed'],json.loads((self.run/'anchors.json').read_text()),self.labels+[self.extra],'isolated-append-test',.0001,'squared_hinge')
    def equal(self,a,b):
        if isinstance(a,base.torch.Tensor):self.assertTrue(base.torch.equal(a,b))
        elif isinstance(a,dict):
            self.assertEqual(set(a),set(b))
            for k in a:self.equal(a[k],b[k])
        elif isinstance(a,(tuple,list)):
            self.assertEqual(len(a),len(b))
            for x,y in zip(a,b):self.equal(x,y)
        else:self.assertEqual(a,b)
    def manifest(self,p,allowed):
        p.write_text(json.dumps({'kind':'append-public-midgame-v1','fromIdentity':self.m['identity'],'fromCheckpoint':str(self.cp),'oldLabelIds':[l['labelId'] for l in self.labels],'allowedAddedLabelIds':allowed}))
        return {'R62_CURRICULUM_UPGRADE_REF':str(p),'R62_CURRICULUM_UPGRADE_SHA256':base.sha(p)}
    def test_exact_real_optimizer_rng_history_and_new_zero(self):
        with tempfile.TemporaryDirectory() as d:
            env=self.manifest(pathlib.Path(d)/'append.json',[self.extra['labelId']])
            with patch.dict(os.environ,env):
                learner=self.learner();learner.restore(self.cp/'learner.pt',self.m['identity'])
            self.equal(learner.model.state_dict(),self.state['model']);self.equal(learner.optimizer.state_dict(),self.state['optimizer'])
            self.equal(base.torch.get_rng_state(),self.state['torchRNG']);self.equal(base.random.getstate(),self.state['pythonRNG'])
            self.assertEqual(learner.update,400);self.assertEqual(learner.exposures,{**self.state['teacherExposures'],self.extra['labelId']:0})
            self.assertEqual(set(learner.book),set(learner.exposures));self.assertIs(AppendLearner.step,base.Learner.step)
    def test_unapproved_added_id_and_original_strictness(self):
        with tempfile.TemporaryDirectory() as d:
            env=self.manifest(pathlib.Path(d)/'append.json',['different-extra'])
            with patch.dict(os.environ,env),self.assertRaisesRegex(ValueError,'exact reviewed'):self.learner().restore(self.cp/'learner.pt',self.m['identity'])
        with self.assertRaisesRegex(ValueError,'teacher set changed'):self.learner(base.Learner).restore(self.cp/'learner.pt',self.m['identity'])

if __name__=='__main__':unittest.main()
