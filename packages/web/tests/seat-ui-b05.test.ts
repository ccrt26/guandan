import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
// Current 1/2/3/4 selection and exact unavailable options are covered by
// ai-selection-ui.test.ts. This older file retains only its distinct replay
// fallback case; it does not load the live Vite policy directory.
vi.mock('../src/game/policy',()=>({webPolicyDescriptors:[]}));
import {RecordedSeats} from '../src/ui/RecordedSeats';
it('unverified replay keeps saved policy and profile facts without connection lookup',()=>{
 const record:any={seatConfig:{schemaVersion:2,seats:[{controller:'human'},...Array.from({length:3},(_,i)=>({controller:'ai',releaseRef:'release-frozen',mode:'hybrid',release:{label:'冻结牌手'},policyIdentity:{policyId:'B-frozen',weightsSHA256:'a'.repeat(64)},profileRevisionRef:{profileId:'saved-api',revision:3,snapshotHash:'b'.repeat(64)},profileSnapshot:{nickname:'当时昵称',requestedModel:'当时模型'}}))]}};
 const html=renderToStaticMarkup(RecordedSeats({record}));expect(html).toContain('B-frozen');expect(html).toContain('当时模型');expect(html).toContain('r3');expect(html).toContain('纯回放');
});
