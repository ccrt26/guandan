import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SeatPicker} from '../src/ui/SeatPicker';
import {defaultSeatAssignments,RELEASES} from '../../ai/src/policy/seats';
it('four-seat UI exposes human only at zero and keeps C visibly unavailable',()=>{
 const html=renderToStaticMarkup(SeatPicker({value:defaultSeatAssignments('standard'),onChange:()=>{},choices:RELEASES.map(release=>({release,available:release.status==='adopted'})),profiles:[],profileError:null}));
 expect(html.match(/真人（0号）/g)).toHaveLength(1);expect(html.match(/aria-label="[0-3]号席牌手"/g)).toHaveLength(4);expect(html).toContain('浏览器资源未准备');expect(html).toContain('disabled');
});
import {RecordedSeats} from '../src/ui/RecordedSeats';
it('replay labels come from saved four-seat policy/profile snapshot, without connection lookup',()=>{
 const record:any={seatConfig:{schemaVersion:2,seats:[{controller:'human'},...Array.from({length:3},(_,i)=>({controller:'ai',releaseRef:'release-frozen',mode:'hybrid',release:{label:'冻结牌手'},policyIdentity:{policyId:'B-frozen',weightsSHA256:'a'.repeat(64)},profileRevisionRef:{profileId:'saved-api',revision:3,snapshotHash:'b'.repeat(64)},profileSnapshot:{nickname:'当时昵称',requestedModel:'当时模型'}}))]}};
 const html=renderToStaticMarkup(RecordedSeats({record}));expect(html).toContain('B-frozen');expect(html).toContain('当时模型');expect(html).toContain('r3');expect(html).toContain('纯回放');
});
