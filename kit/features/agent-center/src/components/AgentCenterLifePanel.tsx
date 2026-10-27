import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentLifeFrame } from '@nimiplatform/kit/core/sdk-contract';
import type { AgentCenterSession, AgentCenterSnapshot, AgentCenterI18n } from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterMessage } from '../locales/index.js';
import { Card, StatusPill } from './AgentCenterPrimitives.js';

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
  const formatTime = (seconds: string, timezone?: string) => new Date(Number(seconds) * 1000).toLocaleString(i18n?.language ?? undefined, timezone ? { timeZone: timezone } : undefined);
  const frameRow = (frame: NimiLocalAppAgentLifeFrame) => <li key={frame.frameId} className="grid min-w-0 gap-1 border-b border-[var(--nimi-border-subtle)] py-3 last:border-0">
    <span className="break-words text-[length:var(--nimi-type-body-sm-size)] font-medium">{frame.interaction ? text('interacting') : frame.title}</span>
    <span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{text(`phase.${frame.phase}`)} · {formatTime(frame.startsAt.seconds)} — {frame.endsAt ? formatTime(frame.endsAt.seconds) : text('interacting')}</span>
  </li>;
  const currentTitle = life?.current
    ? life.current.interaction ? text('interacting') : life.current.title
    : snapshot.state.autonomy.enabled === false ? text('wait.disabled') : life?.waitReason ? text(`wait.${life.waitReason}`) : text('empty');
  const currentStatus = life?.current
    ? text(`phase.${life.current.phase}`)
    : snapshot.state.autonomy.enabled === false || ['world_paused', 'suspended'].includes(life?.waitReason ?? '')
      ? text('status.paused')
      : life?.waitReason ? text('status.waiting') : text('status.idle');
  return <Card className="p-4">
    <section aria-label={text('title')} aria-busy={refreshing} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[length:var(--nimi-type-body-size)] font-semibold">{text('title')}</h3>
        <Button tone="ghost" size="sm" disabled={refreshing} onClick={() => { void refresh(); }}>{refreshing ? text('refreshing') : text('refresh')}</Button>
      </div>
      {failed ? <InlineAlert tone="danger">{text('failed')}</InlineAlert> : null}
      {!life ? <InlineAlert tone="warning">{text('unavailable')}</InlineAlert> : <>
        <div className="grid gap-2 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{text('now')}</span>
            <StatusPill tone={life.current ? 'ready' : 'muted'} label={currentStatus} />
          </div>
          <p className="m-0 break-words text-[length:var(--nimi-type-body-sm-size)] font-medium">{currentTitle}</p>
          {life.current && !life.current.interaction && life.current.endsAt ? <p className="m-0 text-[length:var(--nimi-type-caption-size)] tabular-nums text-[var(--nimi-text-secondary)]">{text('until')} {formatTime(life.current.endsAt.seconds)}</p> : null}
        </div>
        {life.future.length ? <details className="border-t border-[var(--nimi-border-subtle)] pt-2">
          <summary className="cursor-pointer py-1.5 text-[length:var(--nimi-type-body-sm-size)] font-medium">{text('future')} · {life.future.length}</summary>
          <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-[1.55] text-[var(--nimi-text-secondary)]">{text('timelineHelp')}</p>
          <ul className="m-0 list-none p-0">{life.future.map(frameRow)}</ul>
        </details> : null}
        {life.activities.length ? <details className="border-t border-[var(--nimi-border-subtle)] pt-2">
          <summary className="cursor-pointer py-1.5 text-[length:var(--nimi-type-body-sm-size)] font-medium">{text('retained')} · {life.activities.length}</summary>
          <ul className="m-0 list-none p-0">{life.activities.slice().reverse().map(activity => <li key={activity.activityRef} className="grid gap-1 border-b border-[var(--nimi-border-subtle)] py-2 last:border-0"><span className="break-words text-[length:var(--nimi-type-body-sm-size)] font-medium">{activity.title}</span><span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{text(`phase.${activity.phase}`)}</span></li>)}</ul>
        </details> : null}
        {life.recent.length ? <details className="border-t border-[var(--nimi-border-subtle)] pt-2">
          <summary className="cursor-pointer py-1.5 text-[length:var(--nimi-type-body-sm-size)] font-medium">{text('recent')} · {life.recent.length}</summary>
          <ul className="m-0 list-none p-0">{life.recent.slice().reverse().map(frameRow)}</ul>
        </details> : null}
      </>}
    </section>
  </Card>;
}
