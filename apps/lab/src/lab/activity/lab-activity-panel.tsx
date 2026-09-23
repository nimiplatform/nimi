import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, LoadingSkeleton, SegmentedControl, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  createNimiAppActivityView,
  NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
} from '@nimiplatform/sdk/app';

import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import {
  labActivityBusinessDetail,
  labActivityFilter,
  type LabActivityScope,
} from './lab-activity-model.js';

type Notice = Readonly<{ tone: 'info' | 'warning'; text: string }>;

const INITIAL: NimiAppActivityViewSnapshot = Object.freeze({
  status: 'loading',
  records: Object.freeze([]),
  complete: false,
  hasMore: false,
  error: null,
});

function sourceLabel(record: NimiAppActivityRecord): string {
  if (record.source.kind === 'runtime-agent') return record.agent?.displayName ?? 'Nimi';
  return record.source.displayName ?? record.source.appId ?? record.source.sourceRef;
}

/**
 * Lab reads published App activity as an ordinary App through the public
 * client. Viewing never marks anything read; only the explicit action records
 * the revision the user saw.
 */
export function LabActivityPanel() {
  const host = useLabRendererHost();
  const client = host.sdk.localAppClient;
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<LabActivityScope>('open-todos');
  const [snapshot, setSnapshot] = useState<NimiAppActivityViewSnapshot>(INITIAL);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Readonly<Record<string, Notice>>>({});
  const viewRef = useRef<NimiAppActivityView | null>(null);

  useEffect(() => {
    const view = createNimiAppActivityView({ activity: client.activity, filter: labActivityFilter(scope), onUpdate: setSnapshot });
    viewRef.current = view;
    setSnapshot(INITIAL);
    view.start();
    return () => {
      viewRef.current = null;
      void view.stop();
    };
  }, [client, scope]);

  const notify = (activityId: string, notice: Notice | null) => setNotices((current) => {
    const next = { ...current };
    if (notice) next[activityId] = notice;
    else delete next[activityId];
    return next;
  });

  const open = async (record: NimiAppActivityRecord) => {
    setBusy(record.activityId);
    notify(record.activityId, null);
    try {
      const result = await client.activity.open({ activityId: record.activityId });
      notify(record.activityId, {
        tone: result.outcome === 'opened' ? 'info' : 'warning',
        text: t(`Activity.result.${result.reason}`, { source: sourceLabel(record) }),
      });
    } catch {
      notify(record.activityId, { tone: 'warning', text: t('Activity.result.error') });
    } finally {
      setBusy(null);
    }
  };

  const markRead = async (record: NimiAppActivityRecord) => {
    setBusy(record.activityId);
    notify(record.activityId, null);
    try {
      await client.activity.markRead({ activityId: record.activityId, displayedRevision: record.revision });
    } catch {
      notify(record.activityId, { tone: 'warning', text: t('Activity.readFailed') });
    } finally {
      setBusy(null);
    }
  };

  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return (
    <div className="h-full overflow-y-auto p-5" data-testid="lab-activity">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t('Activity.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--nimi-text-secondary)]">{t('Activity.blurb')}</p>
          </div>
          <SegmentedControl
            size="sm"
            ariaLabel={t('Activity.scopeLabel')}
            value={scope}
            onValueChange={(value) => setScope(value as LabActivityScope)}
            items={[
              { value: 'open-todos', label: t('Activity.scope.openTodos') },
              { value: 'all', label: t('Activity.scope.all') },
            ]}
          />
        </header>

        {snapshot.status === 'unavailable' ? (
          <InlineAlert
            tone="warning"
            data-testid="lab-activity-unavailable"
            action={<Button size="sm" tone="ghost" onClick={() => viewRef.current?.relist()}>{t('Activity.retry')}</Button>}
          >
            {t('Activity.unavailable')}
          </InlineAlert>
        ) : null}

        {snapshot.status === 'loading' && !snapshot.records.length ? <LoadingSkeleton lines={3} /> : null}

        {snapshot.status === 'ready' && snapshot.complete && !snapshot.records.length ? (
          <p className="text-sm text-[var(--nimi-text-secondary)]" data-testid="lab-activity-empty">
            {t(scope === 'open-todos' ? 'Activity.emptyOpen' : 'Activity.emptyAll')}
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {snapshot.records.map((record) => {
            const detail = labActivityBusinessDetail(record);
            const notice = notices[record.activityId];
            const openable = record.source.kind === 'app' && record.objectRef !== null;
            return (
              <li key={record.activityId}>
                <Surface
                  as="div"
                  tone="panel"
                  padding="md"
                  className="flex flex-col gap-2"
                  data-testid={`lab-activity-item:${record.activityId}`}
                  data-unread={record.userView.unread ? 'true' : 'false'}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`flex items-center gap-2 text-sm ${record.userView.unread ? 'font-semibold' : 'font-medium'}`}>
                        {record.userView.unread ? <span className="size-2 shrink-0 rounded-full bg-[var(--nimi-status-info)]" aria-label={t('Activity.unread')} /> : null}
                        <span className="truncate">
                          {record.source.kind === 'runtime-agent' && record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE
                            ? t('Activity.runtimeTurnTitle')
                            : record.title}
                        </span>
                      </p>
                      {record.summary ? <p className="mt-0.5 text-xs text-[var(--nimi-text-secondary)]">{record.summary}</p> : null}
                      <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
                        {[sourceLabel(record), time(record.occurredAt)].join(' · ')}
                      </p>
                      {detail ? (
                        <p className="mt-1 text-xs text-[var(--nimi-text-primary)]" data-testid="lab-activity-business-detail">
                          {[
                            detail.worldName,
                            t(`Activity.worldStudio.task.${detail.task}`),
                            t('Activity.worldStudio.suggestions', { count: detail.suggestions }),
                            t('Activity.worldStudio.notes', { count: detail.notes }),
                            detail.adopted === null ? '' : t('Activity.worldStudio.adopted', { count: detail.adopted }),
                          ].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {record.userView.needsAttention ? <StatusBadge tone="warning" shape="dot">{t('Activity.needsAttention')}</StatusBadge> : null}
                      {record.kind === 'todo' && record.todoState ? (
                        <StatusBadge tone={record.todoState === 'completed' ? 'success' : record.todoState === 'open' ? 'info' : 'neutral'}>
                          {t(`Activity.state.${record.todoState}`)}
                        </StatusBadge>
                      ) : null}
                      {record.userView.unread ? (
                        <Button size="sm" tone="ghost" disabled={busy === record.activityId} onClick={() => void markRead(record)}>
                          {t('Activity.markRead')}
                        </Button>
                      ) : null}
                      {openable ? (
                        <Button size="sm" tone="secondary" disabled={busy === record.activityId} onClick={() => void open(record)}>
                          {t('Activity.open', { source: sourceLabel(record) })}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {notice ? (
                    <p role="status" className={`text-xs ${notice.tone === 'warning' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                      {notice.text}
                    </p>
                  ) : null}
                  <details className="text-xs text-[var(--nimi-text-muted)]">
                    <summary>{t('Activity.technicalDetails')}</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify({
                      activityId: record.activityId,
                      type: record.type,
                      revision: record.revision,
                      changeSeq: record.changeSeq,
                      readThroughRevision: record.userView.readThroughRevision,
                      data: record.data,
                    }, null, 2)}</pre>
                  </details>
                </Surface>
              </li>
            );
          })}
        </ul>

        {snapshot.hasMore ? (
          <div className="flex justify-center" data-testid="lab-activity-more">
            <Button size="sm" tone="ghost" onClick={() => viewRef.current?.loadMore()}>{t('Activity.loadMore')}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
