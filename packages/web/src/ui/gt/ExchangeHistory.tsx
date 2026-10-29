import { useEffect, useRef } from 'react';
import type { ExchangeHistoryEntry } from '../../game/exchange';
import { toCode } from '../gp/viewmodel';
import { SEAT_DISPLAY } from './viewmodel';

/** Read-only public exchange details; opening this never arms or acknowledges a gate. */
export function ExchangeHistory({entries,onClose}:{entries:readonly ExchangeHistoryEntry[];onClose:()=>void}) {
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    closeRef.current?.focus();
    return ()=>previous?.focus();
  },[]);
  return <section className="gt-history" role="dialog" aria-label="贡还历史（只读）">
    <header><h2>贡还历史 <small>只读</small></h2><button ref={closeRef} onClick={onClose} aria-label="关闭贡还历史">关闭</button></header>
    <p>查看历史不改变当前牌局，也不代替当前结果的确认。</p>
    {[...entries].reverse().map(entry=><article key={entry.version}>
      <h3>第{entry.gameNo}局 · {entry.confirmedAt===null?'待确认':'已确认'}</h3>
      {entry.pairs.map((pair,i)=><div className="gt-history-pair" key={i}>
        {([{label:'贡牌',transfer:pair.tribute},{label:'还牌',transfer:pair.ret}]).map(({label,transfer})=>{
          const code=toCode(transfer.card);
          return <div key={label}><span>{SEAT_DISPLAY[transfer.from]} → {SEAT_DISPLAY[transfer.to]}<b>{label}</b></span>
            <img src={`/cards54/${code}.png`} alt={`${label} ${code}`} /></div>;
        })}
      </div>)}
    </article>)}
  </section>;
}
