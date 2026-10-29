/** DEV-only, user-operated audit entry. Uses genuine engine-produced save files,
 * not the visual fixture. Kept out of production by App's DEV-only lazy import. */
import { useEffect, useState } from 'react';
import { MatchController } from '../../game/controller';
import { clearCurrentMatch, loadCurrentMatch, saveCurrentMatch, type MatchSave } from '../../game/storage';
import { TablePage } from '../TablePage';
import single from '../../../../../lab/layout-fix-20261028/fixtures/single-pending.json';
import double from '../../../../../lab/layout-fix-20261028/fixtures/double-pending.json';

export default function DevTableAudit() {
  const [controller,setController]=useState<MatchController|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>()=>controller?.destroy(),[controller]);
  const open=(save:MatchSave|null)=>{
    if (!save) {setError('没有可恢复的测试存档');return;}
    controller?.destroy();
    const next=new MatchController({difficulty:save.difficulty,rules:save.ruleOpts,resumeMatch:save,aiDelayMs:1200});
    next.startGame();setController(next);setError('');
  };
  const load=(raw:unknown)=>{
    controller?.destroy();clearCurrentMatch();
    const save=raw as MatchSave;
    if (!saveCurrentMatch(save)) {setError('测试存档写入失败');return;}
    open(save);
  };
  if (controller) return <TablePage controller={controller}
    onExit={()=>{controller.destroy();setController(null);}}
    onReview={()=>{}} onNavStats={()=>{}} onNavReview={()=>{}} onOpenSettings={()=>{}} />;
  return <main className="gt-recovery">
    <h1>本地牌桌验收</h1>
    <p>仅开发模式。下面的单贡、双贡存档均由真实引擎完成上一局后生成，测试会替换当前测试站点的存档。</p>
    <p>请在独立测试地址使用；此入口不会出现在正式构建中。</p>
    <button onClick={()=>load(single)}>载入真实单贡测试局</button>{' '}
    <button onClick={()=>load(double)}>载入真实双贡测试局</button>{' '}
    <button onClick={()=>open(loadCurrentMatch())}>恢复测试存档</button>
    {error && <p role="alert">{error}</p>}
  </main>;
}
