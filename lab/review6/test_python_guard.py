import unittest,pathlib,importlib.util,json,hashlib,tempfile
spec=importlib.util.spec_from_file_location('mature_service',pathlib.Path(__file__).with_name('mature-service.py'));service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
class Guard(unittest.TestCase):
 def raw(self,events):
  first=pathlib.Path('/Users/ccrt/game/guandan/lab/review6/budget-ledger.jsonl').read_text().splitlines()[0];out=[first];prev=json.loads(first)['entryHash']
  for e in events:
   body={**e,'cycleId':'review6-humanlike-20261028','previousHash':prev};raw=json.dumps(body,separators=(',',':'));prev=hashlib.sha256(raw.encode()).hexdigest();out.append(raw[:-1]+',"entryHash":"'+prev+'"}')
  return '\n'.join(out)+'\n'
 def test_fullrealgenesis_chain_and_onlyactive_original7200(self):
  task='C3-mature-pilot-execution-001';events=[{'kind':'reserve','taskId':task,'seconds':7200}];good=self.raw(events);self.assertEqual(service.verify_original_budget(good,task)['reservations'],{task:7200})
  bad=[good.replace('7200','5999'),self.raw(events+[{'kind':'reserve','taskId':task,'seconds':7200}]),self.raw(events+[{'kind':'reserve','taskId':'other','seconds':1}]),self.raw(events+[{'kind':'settle','taskId':task,'actualSeconds':1}]),self.raw([{'kind':'reserve','taskId':task,'seconds':True}])]
  for x in bad:
   with self.assertRaises(ValueError):service.verify_original_budget(x,task)
 def test_python_snapshot_rejects_unlisted_import_file_and_parent_symlink_before_any_library_import(self):
  with tempfile.TemporaryDirectory(prefix='r6-py-tree-')as d:
   root=pathlib.Path(d).resolve();entry=root/'mature-service.py';entry.write_text('#mechanical only\n');m={'schemaVersion':'r6-executable-snapshot-v1','snapshotRoot':str(root),'sourceRoot':'/Users/ccrt/game/guandan','entryPath':str(entry),'files':[{'path':str(entry),'sha256':hashlib.sha256(entry.read_bytes()).hexdigest()}],'aliases':[]};p=root/'snapshot-manifest.json';p.write_text(json.dumps(m));sha=hashlib.sha256(p.read_bytes()).hexdigest();self.assertEqual(service.verify_python_snapshot(p,sha,entry)['snapshotRoot'],str(root));shadow=root/'torch.py';shadow.write_text('raise RuntimeError("mustneverimport")')
   with self.assertRaises(ValueError):service.verify_python_snapshot(p,sha,entry)
   shadow.unlink();entry.write_text('tampered')
   with self.assertRaises(ValueError):service.verify_python_snapshot(p,sha,entry)
if __name__=='__main__':unittest.main()
