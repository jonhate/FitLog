import { useRef, useState } from 'react';
export function localDateKey(value: string | Date) {
 const d = typeof value === 'string' ? new Date(value) : value;
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function HistoryCalendar({sessions,selected,onSelect}:{sessions:{started_at:string}[];selected:string|null;onSelect:(date:string|null)=>void}) {
 const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const start=useRef<{x:number;y:number}|null>(null);
 const change=(delta:number)=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()+delta,1));
 const dates=new Set(sessions.map(s=>localDateKey(s.started_at)));
 const first=(month.getDay()+6)%7, count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
 const currentYear=new Date().getFullYear();
 const years=sessions.map(s=>new Date(s.started_at).getFullYear());
 const min=Math.min(currentYear-10,month.getFullYear(),...years),max=Math.max(currentYear+10,month.getFullYear(),...years);
 return <section className="calendar" aria-label="训练历史月历" onTouchStart={e=>{const t=e.touches[0];start.current={x:t.clientX,y:t.clientY}}} onTouchEnd={e=>{if(!start.current)return;const t=e.changedTouches[0],dx=t.clientX-start.current.x,dy=t.clientY-start.current.y;start.current=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)change(dx<0?1:-1)}}>
  <div className="row"><button aria-label="上个月" onClick={()=>change(-1)}>‹</button><label className="calendar-year">年份<select aria-label="选择年份" value={month.getFullYear()} onChange={e=>setMonth(new Date(Number(e.target.value),month.getMonth(),1))}>{Array.from({length:max-min+1},(_,i)=>min+i).map(y=><option key={y} value={y}>{y}年</option>)}</select></label><strong aria-live="polite">{month.getMonth()+1}月</strong><button aria-label="下个月" onClick={()=>change(1)}>›</button></div>
  <div className="calendar-grid">{['一','二','三','四','五','六','日'].map(d=><span className="labels" key={d}>{d}</span>)}{Array.from({length:first},(_,i)=><span key={`empty${i}`}/>)}{Array.from({length:count},(_,i)=>{const d=i+1,key=localDateKey(new Date(month.getFullYear(),month.getMonth(),d));return <button key={key} aria-label={`${key}${dates.has(key)?' 有训练':''}`} aria-pressed={selected===key} className={`${selected===key?'calendar-selected':''} ${dates.has(key)?'has-training':''}`} onClick={()=>onSelect(selected===key?null:key)}>{d}{dates.has(key)&&<span className="calendar-dot"/>}</button>})}</div>
  <div className="row"><small>{selected?`${selected} 的记录`:'全部训练记录 · 圆点表示有训练'}</small><button onClick={()=>onSelect(null)} className="subtle">全部记录</button></div>
 </section>;
}
