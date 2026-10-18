import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type {
  NimiLocalAppAgentPendingHooks,
  NimiLocalAppAgentPendingHook,
  NimiLocalAppScheduledTaskEdit,
} from '@nimiplatform/kit/core/sdk-contract';
import type { AgentCenterSession, AgentCenterI18n } from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import { getAgentCenterMessage } from '../locales/index.js';
import { Card, agentCenterInputClassName } from './AgentCenterPrimitives.js';

export function AgentCenterPendingHooks({
  session,
  i18n,
}: {
  session: AgentCenterSession;
  i18n?: AgentCenterI18n;
}) {
  const [result, setResult] = useState<NimiLocalAppAgentPendingHooks | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const text = (key: string) => {
    const messageKey = `AgentCenter.pendingHooks.${key}`;
    return translateAgentCenter(i18n, messageKey, getAgentCenterMessage('en', messageKey) ?? '');
  };
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    // An explicit refresh updates the usage shown beside these activities too.
    // The initial mount reuses the already-loaded Manager snapshot.
    void Promise.all([
      session.listPendingHooks(),
      attempt > 0 ? session.refresh() : Promise.resolve(),
    ]).then(([value]) => {
        if (current) setResult(value);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [session, attempt]);
  const groups = {
    adjustable: [] as NimiLocalAppAgentPendingHook[],
    started: [] as NimiLocalAppAgentPendingHook[],
    managed: [] as NimiLocalAppAgentPendingHook[],
    other: [] as NimiLocalAppAgentPendingHook[],
  };
  for (const task of result?.hooks ?? []) {
    const group = task.systemCadence ? 'managed'
      : task.status === 'running' ? 'started'
        : task.canModify ? 'adjustable' : 'other';
    groups[group].push(task);
  }
  const rows = (tasks: readonly NimiLocalAppAgentPendingHook[]) => tasks.map((task) => (
    <PendingHookRow key={`${task.taskId}:${task.revision}`} task={task} session={session}
      text={text} changed={() => setAttempt((value) => value + 1)} />
  ));
  return (
    <Card>
      <div className="grid gap-3 p-4">
        <h3 className="font-medium">{text('title')}</h3>
        <p className="text-sm text-[var(--nimi-text-secondary)]">{text('description')}</p>
        <Button
          tone="ghost"
          size="sm"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {text('refresh')}
        </Button>
        {error ? <InlineAlert tone="warning">{text('unavailable')}</InlineAlert> : null}
        {loading ? <p role="status">{text('loading')}</p> : null}
        {result?.hooks.length === 0 && !loading ? <p>{text('empty')}</p> : null}
        {result && result.hooks.length > 0 && groups.adjustable.length === 0 && !loading ? <p>{text('noAdjustable')}</p> : null}
        {groups.adjustable.length > 0 ? <section aria-label={text('adjustable')}>
          <h4 className="font-medium">{text('adjustable')} · {groups.adjustable.length}</h4>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{text('adjustableHelp')}</p>
          {rows(groups.adjustable)}
        </section> : null}
        {groups.started.length > 0 ? <section aria-label={text('started')}>
          <h4 className="font-medium">{text('started')} · {groups.started.length}</h4>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{text('startedHelp')}</p>
          {rows(groups.started)}
        </section> : null}
        {groups.other.length > 0 ? <details aria-label={text('other')}>
          <summary className="cursor-pointer font-medium">{text('other')} · {groups.other.length}</summary>
          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{text('otherHelp')}</p>
          {rows(groups.other)}
        </details> : null}
        {groups.managed.length > 0 ? <details>
          <summary className="cursor-pointer font-medium">{text('managed')} · {groups.managed.length}</summary>
          <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{text('cadenceHelp')}</p>
          {rows(groups.managed)}
        </details> : null}
        {result?.truncated ? <p>{text('truncated')}</p> : null}
      </div>
    </Card>
  );
}
function PendingHookRow({
  task,
  session,
  text,
  changed,
}: {
  task: NimiLocalAppAgentPendingHook;
  session: AgentCenterSession;
  text: (key: string) => string;
  changed: () => void;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [session]);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const act = async (edit: NimiLocalAppScheduledTaskEdit) => {
    setBusy(true);
    setError(false);
    try {
      await session.updatePendingHook(edit);
      if (alive.current) changed();
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const millis = Date.parse(due);
  const base = { taskId: task.taskId, expectedRevision: task.revision };
  return (
    <div className="grid gap-2 border-t border-[var(--nimi-border-default)] pt-3 text-sm">
      <p>
        {task.systemCadence ? text('cadence') : text('activity')} ·{' '}
        {task.status === 'running' ? text('running') : text('pending')}
      </p>
      {task.scheduledFor ? (
        <time>{new Date(Number(task.scheduledFor.seconds) * 1000).toLocaleString()}</time>
      ) : null}
      {task.canModify ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            tone="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void act({ ...base, action: 'cancel' });
            }}
          >
            {text('cancel')}
          </Button>
          <input
            className={agentCenterInputClassName}
            type="datetime-local"
            aria-label={text('newTime')}
            disabled={busy}
            value={due}
            onChange={(event) => setDue(event.currentTarget.value)}
          />
          <Button
            tone="ghost"
            size="sm"
            disabled={busy || !Number.isFinite(millis) || millis <= Date.now()}
            onClick={() => {
              void act({
                ...base,
                action: 'reschedule',
                scheduledFor: { seconds: String(Math.floor(millis / 1000)), nanos: 0 },
              });
            }}
          >
            {text('reschedule')}
          </Button>
        </div>
      ) : null}
      {error ? <InlineAlert tone="warning">{text('changed')}</InlineAlert> : null}
    </div>
  );
}
