import {it,expect,vi} from 'vitest';
import {saveRecord,listRecords,loadStats,updateStats} from '../src/game/storage';
import {buildStatsVM} from '../src/ui/sp/viewmodel';
it('AI-only record stays replayable but is excluded from personal wins and ranks',()=>{
 const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)});
 try{
 const record:any={id:'B05-synthetic-result-projection',matchId:'m',createdAt:1,humanSeat:null,difficulties:[1,1,1,1],levelsBefore:[2,2],moves:[],result:{winnerTeam:0,doubleUp:false,finishOrder:[0,1,2,3]},seatConfig:{schemaVersion:2,seats:[]}};
 saveRecord(record);updateStats(record);const [meta]=listRecords();expect(meta.spectatorOnly).toBe(true);expect(buildStatsVM([meta]).games).toBe(0);expect(buildStatsVM([{...meta,spectatorOnly:undefined}]).games).toBe(1);expect(loadStats().games).toBe(0);expect(map.has('gd_record_'+record.id)).toBe(true);
 }finally{vi.unstubAllGlobals();}
});
