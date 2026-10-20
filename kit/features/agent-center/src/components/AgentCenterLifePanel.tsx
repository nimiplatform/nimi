import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentLifeFrame } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentCenterSession, AgentCenterSnapshot, AgentCenterI18n } from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterMessage } from '../locales/index.js';

export function AgentCenterLifePanel({ session, snapshot, i18n }: { session: AgentCenterSession; snapshot: AgentCenterSnapshot; i18n?: AgentCenterI18n }) {
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useRef<AgentCenterSession | null>(session);
  current.current = session;
  useEffect(() => {
    setFailed(false); setRefreshing(false);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void session.refresh().catch(() => {}); }, 30_000);
    return () => { clearInterval(timer); current.current = null; };
  }, [session]);
  const text = (key: string) => { const id = `AgentCenter.life.${key}`; return translateAgentCenter(i18n, id, getAgentCenterMessage('en', id) ?? ''); };
  const refresh = async () => {
    setRefreshing(true); setFailed(false);
    try { await session.refresh(); } catch { if (current.current === session) setFailed(true); }
    finally { if (current.current === session) setRefreshing(false); }
  };
  const life = snapshot.state.life;
  const formatTime = (seconds: string, timezone?: string) => new Date(Number(seconds) * 1000).toLocaleString(undefined, timezone ? {timeZone:timezone} : undefined);
  const frameRow = (frame: NimiLocalAppAgentLifeFrame) => <li key={frame.frameId} className="grid min-w-0 gap-1 border-b border-[var(--nimi-border-subtle)] py-3 last:border-0">
    <span className="break-words text-sm font-medium">{frame.title}</span><span className="text-xs text-[var(--nimi-text-secondary)]">{text(`phase.${frame.phase}`)} · {formatTime(frame.startsAt.seconds)} — {frame.endsAt ? formatTime(frame.endsAt.seconds) : text('interacting')}</span>
  </li>;
  return <div className="grid min-w-0 gap-5">
    <section aria-label={text('title')} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{text('title')}</h3><Button tone="ghost" size="sm" disabled={refreshing} onClick={() => { void refresh(); }}>{text('refresh')}</Button></div>
      <p className="text-sm text-[var(--nimi-text-secondary)]">{text('timelineHelp')}</p>
      {!life ? <InlineAlert tone="warning">{text('unavailable')}</InlineAlert> : <>
        {life.current ? <div className="grid gap-1 py-2"><p className="text-sm text-[var(--nimi-text-secondary)]">{text('now')}</p><p className="break-words font-medium">{life.current.title}</p><p className="text-xs tabular-nums">{life.current.interaction ? text('interacting') : <>{life.current.progress}% · {text('until')} {life.current.endsAt ? formatTime(life.current.endsAt.seconds) : ''}</>}</p></div> : <p className="text-sm">{life.waitReason ? text(`wait.${life.waitReason}`) : text('empty')}</p>}
        {life.future.length ? <details><summary className="cursor-pointer py-2 text-sm font-medium">{text('future')} · {life.future.length}</summary><ul>{life.future.map(frameRow)}</ul></details> : null}
        {life.activities.length ? <details open><summary className="cursor-pointer py-2 text-sm font-medium">{text('retained')} · {life.activities.length}</summary><ul>{life.activities.map(activity => <li key={activity.activityRef} className="grid gap-1 border-b border-[var(--nimi-border-subtle)] py-2 last:border-0"><span className="break-words text-sm font-medium">{activity.title}</span><span className="text-xs text-[var(--nimi-text-secondary)]">{text(`phase.${activity.phase}`)} · {activity.progress}%</span></li>)}</ul></details> : null}
        {life.recent.length ? <details><summary className="cursor-pointer py-2 text-sm font-medium">{text('recent')} · {life.recent.length}</summary><ul>{life.recent.slice().reverse().map(frameRow)}</ul></details> : null}
      </>}
    </section>
    {failed ? <InlineAlert tone="danger">{text('failed')}</InlineAlert> : null}
  </div>;
}
