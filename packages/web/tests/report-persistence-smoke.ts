import assert from 'node:assert/strict';
import {saveReport,loadReport} from '../src/game/storage.ts';
const values=new Map<string,string>([
  ['gd_report_v2_other','other legacy'],['gd_report_v3_other__v1','other scoped'],
  ['gd_report_v3_current__v0','current prior'],['gd_records_index','untouched index'],
]);
let writes=0,removes=0,fail=false;
const memory={
  get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,
  getItem:(k:string)=>values.get(k)??null,
  setItem:(k:string,v:string)=>{writes++;if(fail){const e=new Error('fixture quota');e.name='QuotaExceededError';throw e;}values.set(k,v);},
  removeItem:(k:string)=>{removes++;values.delete(k);},clear:()=>{throw Error('clear forbidden');},
};
Object.defineProperty(globalThis,'localStorage',{value:memory,configurable:true});
assert.equal(saveReport('current','verified report',0),true);
assert.equal(loadReport('current',0),'verified report');
assert.equal(writes,1);assert.equal(removes,0);
const before=[...values];writes=0;fail=true;
assert.equal(saveReport('current','verified newer report',0),false);
assert.equal(writes,1);assert.equal(removes,0);assert.deepEqual([...values],before);
assert.equal(loadReport('current',0),'verified report');
console.log(JSON.stringify({case:'report-persistence-smoke',passed:true,quotaWrites:writes,quotaRemoves:removes,oldValuesPreserved:true,scope:'pure in-memory storage; no browser/API/migration/UI rendering'}));
