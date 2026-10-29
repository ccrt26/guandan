import {expect,it,vi,afterEach} from 'vitest';
import * as storage from '../src/game/storage';
afterEach(()=>vi.unstubAllGlobals());
it('scoped viewer cache survives real orphan pruning and preserves the legacy report',()=>{
 const data=new Map<string,string>();
 vi.stubGlobal('localStorage',{get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
 data.set('gd_records_index',JSON.stringify([{id:'record-1'}]));
 storage.saveReport('record-1','legacy report retained');
 (storage.saveReport as Function)('record-1','viewer three verified payload',3);
 expect(storage.loadReport('record-1')).toBe('legacy report retained');
 expect((storage.loadReport as Function)('record-1',3)).toBe('viewer three verified payload');
 storage.pruneOrphanReports();
 expect((storage.loadReport as Function)('record-1',3)).toBe('viewer three verified payload');
 storage.removeReport('record-1');expect((storage.loadReport as Function)('record-1',3)).toBeNull();
});
