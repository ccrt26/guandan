import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsModal} from '../../../packages/web/src/ui/SettingsModal';
import {VerifiedReportTab} from '../../../packages/web/src/ui/VerifiedReportTab';
import type {GameRecord} from '@gd/engine';
import type {DecisionReview} from '@gd/review';
import fixture from './fixture.json';
// @ts-expect-error test-only JS fixture adapter has no product declaration.
import {createFixtureTransport} from './transport.mjs';
import '../../../packages/web/src/styles.css';
import './helper.css';

const root=document.getElementById('root')!;
if(location.origin!==fixture.origin||location.pathname!=='/'||location.search||location.hash){
  root.textContent='拒绝：仅供固定 http://127.0.0.1:15183/ 人工假夹具；未挂载产品控件。';
}else{
  const fake=createFixtureTransport(fixture);
  // Replace, never read, the browser's real origin storage. No native fetch is retained.
  Object.defineProperty(globalThis,'localStorage',{value:fake.storage,configurable:false,writable:false});
  Object.defineProperty(globalThis,'fetch',{value:fake.fetchImpl,configurable:false,writable:false});
  const record=fixture.record as unknown as GameRecord,evidence=fixture.evidence as unknown as DecisionReview[];
  const otherRecord={...record,id:'m-public-fixture-other'};
  function Helper(){
    const [settings,setSettings]=useState(false),[coach,setCoach]=useState(true),[other,setOther]=useState(false),[,redraw]=useState(0);
    useEffect(()=>fake.subscribe(()=>redraw(n=>n+1)),[]);
    const facts=fake.snapshot();
    return <>
      <aside className="m-tools">
        <strong>M / E09 隔离假控件检查 — 不是日常入口，不读 Key，不联网，不开局</strong>
        <div className="m-controls">
          <label>假传输 <select aria-label="假响应模式" value={facts.mode} onChange={e=>fake.setMode(e.target.value)}><option value="completed">完整 completed</option><option value="failed">失败 failed</option><option value="hold">挂起 hold（直到显式释放）</option></select></label>
          <button onClick={()=>setSettings(true)}>打开真实设置</button>
          <button onClick={()=>setOther(value=>!value)}>切换公开记录 scope</button>
          <button onClick={()=>setCoach(value=>!value)}>{coach?'关闭真实讲解页':'打开真实讲解页'}</button>
          <button onClick={()=>fake.releaseLate()}>释放已挂起的迟到假响应</button>
        </div>
        <output aria-label="假夹具观测">{JSON.stringify(facts)}</output>
      </aside>
      <main className="m-main"><p>当前公开记录：{other?otherRecord.id:record.id}。所有资料均为人工公开事实；没有完整手牌、模型或真实用户存档。</p>
        {coach&&<VerifiedReportTab record={other?otherRecord:record} evidence={evidence} onJump={()=>{}}/>}
      </main>
      {settings&&<SettingsModal onClose={()=>setSettings(false)}/>}
    </>;
  }
  createRoot(root).render(<Helper/>);
}
