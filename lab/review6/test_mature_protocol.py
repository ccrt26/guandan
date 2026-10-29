import unittest
from mature_protocol import validate_batch, select_label_ids
class Tests(unittest.TestCase):
 def batch(self):
  rows=[{'decisionId':'m:'+str(i),'bucket':'self'if i<512 else 'frozen_opponent'if i<768 else'other_partner','g':2,'W':-1,'y':1}for i in range(1024)]
  return rows
 def test_quota_identity_and_original_targets(self):
  rows=self.batch();self.assertEqual(validate_batch(rows),{'self':512,'frozen_opponent':256,'other_partner':256})
  for alter in ['sign','quota','duplicate','bool']:
   bad=self.batch()
   if alter=='sign':bad[0]['y']=-1
   if alter=='bool':bad[0]['y']=True
   if alter=='quota':bad[0]['bucket']='other_partner'
   if alter=='duplicate':bad[1]['decisionId']=bad[0]['decisionId']
   with self.assertRaises(ValueError):validate_batch(bad)
 def test_teacher_book_cannot_reverse_inject_duplicate_or_empty_labels(self):
  book={'known':(1,2),'other':(3,4)}
  self.assertEqual(select_label_ids(['other','known'],book,'B'),[(3,4),(1,2)])
  self.assertEqual(select_label_ids([],book,'A'),[])
  for ids,arm in [([], 'B'),(['known','known'],'B'),(['new'],'B'),(['known'],'A')]:
   with self.assertRaises(ValueError):select_label_ids(ids,book,arm)
if __name__=='__main__':unittest.main()
