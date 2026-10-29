import importlib.util
import math
import unittest
from pathlib import Path
import torch
from paired_stats import cluster_bootstrap, paired_bootstrap, teacher_evidence, linear_quantiles, pilot_root_evidence

class PairedStatsTests(unittest.TestCase):
    def test_type7_and_invalid_units(self):
        self.assertEqual(linear_quantiles(torch.tensor([0.,10.,20.,30.],dtype=torch.float64),[.25,.5,.75]),[7.5,15.,22.5])
        for ids,values in [(['a','a'],[0.,1.]),(['a'],[0.]),(['a','b'],[0.,math.nan])]:
            with self.assertRaises(ValueError):paired_bootstrap(ids,{'x':values},61,[.0125,.9875])
    def test_shared_indices_preserve_exact_anticorrelation(self):
        result=paired_bootstrap(['e','a','b','c','d'],{'x':[-1.,-.5,0.,.5,1.],'neg':[1.,.5,0.,-.5,-1.],'macro':[0.]*5},61,[.0125,.9875])
        self.assertEqual(result['columns']['macro']['quantiles'],[0.,0.])
        x=result['columns']['x']['quantiles'];neg=result['columns']['neg']['quantiles']
        self.assertAlmostEqual(x[0],-neg[1]);self.assertAlmostEqual(x[1],-neg[0])
    def test_frozen_H_primitive_reproduced_on_synthetic_cluster_fixture_only(self):
        path=Path(__file__).resolve().parents[1]/'review6_1/data/H-fit-source-002/human_proxy.py'
        spec=importlib.util.spec_from_file_location('historical_bootstrap_reference',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        rows=[{'sourceMatchId':str(i%7),'nll':float((i*3)%11),'baseline':float(i%3)} for i in range(43)]
        old=module.match_bootstrap(rows,'baseline',20000,.975,61)
        ids=sorted(set(r['sourceMatchId']for r in rows));sums=[sum(r['nll']-r['baseline']for r in rows if r['sourceMatchId']==i)for i in ids];counts=[sum(r['sourceMatchId']==i for r in rows)for i in ids]
        new=cluster_bootstrap(ids,{'difference':sums},counts,61,[(1-.975)/2,1-(1-.975)/2])['columns']['difference']
        for a,b in zip([old['point'],old['low'],old['high']],[new['point'],*new['quantiles']]):self.assertAlmostEqual(a,b,places=12)
    def test_row_order_does_not_change_paired_result(self):
        first=paired_bootstrap(['a','b','c'],{'x':[.1,.2,.4]},3,[.0125,.9875]);second=paired_bootstrap(['c','a','b'],{'x':[.4,.1,.2]},3,[.0125,.9875]);self.assertEqual(first,second)
    def test_incomplete_or_missing_secondary_never_produces_label(self):
        good=[{'worldId':'p'+str(i),'A':{'complete':True,'y':4,'g':3,'W':1},'B':{'complete':True,'y':0,'g':1,'W':-1}}for i in range(256)];secondary=[{**row,'worldId':'s'+str(i)}for i,row in enumerate(good[:128])]
        self.assertTrue(teacher_evidence(good,secondary,61,62)['supported'])
        bad=[*good];bad[0]={'worldId':'0','A':{'complete':False,'y':None},'B':{'complete':True,'y':0}}
        self.assertFalse(teacher_evidence(bad,secondary,61,62)['supported'])
        self.assertFalse(teacher_evidence(good,[],61,62)['supported'])
    def test_small_or_reused_world_batch_cannot_satisfy_production_teacher_gate(self):
        rows=[{'worldId':str(i),'A':{'complete':True,'y':4,'g':3,'W':1},'B':{'complete':True,'y':0,'g':1,'W':-1}}for i in range(256)]
        self.assertFalse(teacher_evidence(rows[:4],rows[4:8],61,62)['supported'])
        with self.assertRaises(ValueError):teacher_evidence(rows,rows[:128],61,62)
    def test_all_four_primary_branches_must_complete_and_gW_are_typed_integers(self):
        rows=[{'worldId':'p'+str(i),'A':{'complete':True,'y':4,'g':3,'W':1},'B':{'complete':True,'y':0,'g':1,'W':-1},'Plan':{'complete':True,'y':4,'g':3,'W':1},'Original':{'complete':True,'y':0,'g':1,'W':-1}}for i in range(256)]
        secondary=[{**r,'worldId':'s'+str(i)}for i,r in enumerate(rows[:128])]
        self.assertTrue(pilot_root_evidence(rows,secondary,61,62)['supported'])
        wrong=[{**r}for r in rows];wrong[0]={**wrong[0],'A':{**wrong[0]['A'],'complete':'false'}}
        self.assertFalse(pilot_root_evidence(wrong,secondary,61,62)['supported'])
        rows[0]={**rows[0],'Plan':{'complete':False,'y':None,'g':None,'W':None}}
        self.assertFalse(pilot_root_evidence(rows,secondary,61,62)['supported'])
        rows[0]={**rows[1],'worldId':'p0','A':{'complete':True,'y':2,'g':True,'W':1}}
        with self.assertRaises(ValueError):pilot_root_evidence(rows,secondary,61,62)
    def test_zero_difference_is_ambiguous_not_a_negative_label(self):
        rows=[{'worldId':'p'+str(i),'A':{'complete':True,'y':0,'g':1,'W':-1},'B':{'complete':True,'y':0,'g':1,'W':-1}}for i in range(256)]
        result=teacher_evidence(rows,[{**r,'worldId':'s'+str(i)}for i,r in enumerate(rows[:128])],61,62);self.assertFalse(result['supported']);self.assertEqual(result['resultCode'],'ambiguous')

if __name__=='__main__':torch.set_num_threads(2);unittest.main()
