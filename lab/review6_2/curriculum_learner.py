"""Strict appended-ID restore adapter; all training math stays in learner.py."""
import os,json,pathlib,hashlib
import learner as base

class AppendLearner(base.Learner):
    def restore_with_anchors(self,path,expected_identity,state):
        fresh_digest=self.anchors_sha
        if state.get('anchorsSHA256')!=fresh_digest:
            ref=os.environ.get('R62_ANCHOR_UPGRADE_REF')
            if not ref or base.sha(ref)!=os.environ.get('R62_ANCHOR_UPGRADE_SHA256'):raise ValueError('bound anchor replacement required')
            m=json.loads(pathlib.Path(ref).read_text())
            canonical=lambda p:hashlib.sha256(json.dumps(json.loads(pathlib.Path(p).read_text()),sort_keys=True,separators=(',',':')).encode()).hexdigest()
            if m['kind']!='replace-anchor-inputs-v1' or expected_identity!=m['fromIdentity'] or pathlib.Path(path).resolve()!=pathlib.Path(m['fromCheckpoint'],'learner.pt').resolve() or state['absoluteUpdate']!=m['fromUpdate']:raise ValueError('anchor replacement checkpoint/identity changed')
            if base.sha(m['oldRef'])!=m['oldSHA256'] or base.sha(m['newRef'])!=m['newSHA256'] or canonical(m['oldRef'])!=state['anchorsSHA256'] or canonical(m['newRef'])!=fresh_digest or m['targetParentSHA256']!=self.parent_sha or state['parentSHA256']!=self.parent_sha:raise ValueError('anchor replacement content/parent target changed')
            self.anchors_sha=state['anchorsSHA256']
        try:return super().restore(path,expected_identity)
        finally:self.anchors_sha=fresh_digest

    def restore(self,path,expected_identity=None):
        state=base.torch.load(path,map_location='cpu',weights_only=True)
        old=set(state['teacherExposures'])
        if old==set(self.book):return self.restore_with_anchors(path,expected_identity,state)
        ref=os.environ.get('R62_CURRICULUM_UPGRADE_REF')
        if not ref or base.sha(ref)!=os.environ.get('R62_CURRICULUM_UPGRADE_SHA256'):raise ValueError('bound append manifest required')
        m=json.loads(pathlib.Path(ref).read_text());added=m['allowedAddedLabelIds']
        if m['kind'] not in ('append-public-midgame-v1','append-declared-conditional-family-v1','append-declared-family-pool-v1') or expected_identity!=m['fromIdentity'] or pathlib.Path(path).resolve()!=pathlib.Path(m['fromCheckpoint'],'learner.pt').resolve():raise ValueError('append parent identity/checkpoint changed')
        if m['kind']=='append-declared-conditional-family-v1' and (len(added)!=2 or len(old)!=10):raise ValueError('exact declared two-root append required')
        if m['kind']=='append-declared-family-pool-v1' and (len(old)!=10 or not 2<=len(m['familyPool'])<=5 or len(added)!=2*len(m['familyPool'])):raise ValueError('exact reviewed complete-family append required')
        if len(set(added))!=len(added) or old!=set(m['oldLabelIds']) or old&set(added) or set(self.book)!=old|set(added):raise ValueError('only exact reviewed added teacher IDs allowed')
        full=self.book
        self.book={k:v for k,v in full.items() if k in old}
        try:self.restore_with_anchors(path,expected_identity,state)
        finally:self.book=full
        self.exposures.update({k:0 for k in added})

if __name__=='__main__':
    base.Learner=AppendLearner
    base.main()
