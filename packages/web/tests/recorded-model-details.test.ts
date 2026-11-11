import {afterEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
// Public descriptors only. Do not load a network, model weights, saved records,
// or the live Vite directory while rendering the actual replay component.
vi.mock('../src/game/policy',async()=>{
 const {readFileSync}=await import('node:fs');
 return {webPolicyDescriptors:JSON.parse(readFileSync(new URL('../../../lab/model-index.json',import.meta.url),'utf8')).policies};
});
import {RecordedSeats} from '../src/ui/RecordedSeats';
import {RELEASES} from '../../ai/src/policy/seats';
import {selectionPolicyIdentity} from '../src/game/ai-selection';
const policies=JSON.parse(readFileSync(new URL('../../../lab/model-index.json',import.meta.url),'utf8')).policies;
function seat(releaseRef:string){
 const release=RELEASES.find(r=>r.releaseRef===releaseRef)!;
 const policy=policies.find((p:any)=>p.policyId===release.proposalPolicyRef);
 return {controller:'ai',mode:'local',releaseRef,release,policyIdentity:selectionPolicyIdentity(policy)};
}
function render(ai:any){
 const record:any={humanSeat:0,seatConfig:{schemaVersion:2,seats:[{controller:'human'},ai,ai,ai]}};
 const before=JSON.stringify(record);
 vi.stubGlobal('fetch',()=>{throw Error('replay display must not fetch');});
 const html=renderToStaticMarkup(RecordedSeats({record}));
 expect(JSON.stringify(record)).toBe(before);return html;
}
afterEach(()=>vi.unstubAllGlobals());
it('R06 replay identity exposes full version and effective date from the frozen product projection',()=>{
 const html=render(seat('ohuo-1030-b-v1'));
 for(const text of ['ohuo-v1-1031','版本：1.0.0','正式生效：2026-10-31','实际策略：标准'])expect(html).toContain(text);
 expect(html).toContain('内部发布引用：ohuo-1030-b-v1');
});
it('R06 historical or mismatched replay identity cannot inherit current product version and date',()=>{
 const current=seat('ohuo-1030-b-v1');
 for(const ai of [seat('product-o-hard-v1'),{...current,policyIdentity:{...current.policyIdentity,weightsSHA256:'f'.repeat(64)}}]){
  const html=render(ai);
  expect(html).not.toContain('版本：1.0.0');expect(html).not.toContain('正式生效：2026-10-31');
  expect(html).not.toContain('实际策略：标准');expect(html).toContain(ai.policyIdentity.policyId);
 }
});
