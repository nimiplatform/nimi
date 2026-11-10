import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineAlert, LoadingSkeleton, SegmentedControl, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { ArrowUpRight, Check, Inbox } from 'lucide-react';
import {
  createNimiAppActivityView,
  NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
} from '@nimiplatform/sdk/app';

import { useLabRendererHost } from '../../renderer/context.js';
import { requireLabNativeClient } from '../../shell/local-app-runtime-platform.js';
import { useTranslation } from '../../shell/i18n/index.js';
import {
  labActivityBusinessDetail,
  labActivityFilter,
  type LabActivityScope,
} from './lab-activity-model.js';

type Notice = Readonly<{ tone: 'info' | 'warning'; text: string }>;
type ActivityAction = 'open' | 'read';
const ACTIVITY_PAGE_SIZE = 24;

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

function ActivityTechnicalDetails({ record }: { readonly record: NimiAppActivityRecord }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="lab-activity__details" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{t('Activity.technicalDetails')}</summary>
      {expanded ? <pre>{JSON.stringify({
        activityId: record.activityId,
        type: record.type,
        revision: record.revision,
        changeSeq: record.changeSeq,
        readThroughRevision: record.userView.readThroughRevision,
        data: record.data,
      }, null, 2)}</pre> : null}
    </details>
  );
}

/**
 * Lab reads published App activity as an ordinary App through the public
 * client. Viewing never marks anything read; only the explicit action records
 * the revision the user saw.
 */
export function LabActivityPanel() {
  const host = useLabRendererHost();
  const client = requireLabNativeClient(host.sdk.localAppClient);
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<LabActivityScope>('open-todos');
  const [snapshot, setSnapshot] = useState<NimiAppActivityViewSnapshot>(INITIAL);
  const [busy, setBusy] = useState<Readonly<Record<string, ActivityAction>>>({});
  const [notices, setNotices] = useState<Readonly<Record<string, Notice>>>({});
  const viewRef = useRef<NimiAppActivityView | null>(null);
  const formatTime = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language]);

  useEffect(() => {
    const view = createNimiAppActivityView({
      activity: client.activity,
      filter: labActivityFilter(scope),
      pageSize: ACTIVITY_PAGE_SIZE,
      maxRecords: ACTIVITY_PAGE_SIZE,
      onUpdate: setSnapshot,
    });
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

  const runAction = async (record: NimiAppActivityRecord, action: ActivityAction) => {
    const { activityId } = record;
    setBusy((current) => ({ ...current, [activityId]: action }));
    notify(activityId, null);
    try {
      if (action === 'read') {
        await client.activity.markRead({ activityId, displayedRevision: record.revision });
      } else {
        const result = await client.activity.open({ activityId });
        notify(activityId, {
          tone: result.outcome === 'opened' ? 'info' : 'warning',
          text: t(`Activity.result.${result.reason}`, { source: sourceLabel(record) }),
        });
      }
    } catch {
      notify(activityId, { tone: 'warning', text: t(action === 'read' ? 'Activity.readFailed' : 'Activity.result.error') });
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[activityId];
        return next;
      });
    }
  };
  const emptyScope = scope === 'open-todos' ? 'Activity.emptyOpen' : scope === 'updates' ? 'Activity.emptyUpdates' : 'Activity.emptyAll';

  return (
    <div className="lab-workspace-route" data-testid="lab-activity">
      <div className="lab-activity">
        <header className="lab-workspace-heading">
          <span className="lab-workspace-heading__icon" aria-hidden="true"><Inbox size={22} /></span>
          <div>
            <h1>{t('Activity.title')}</h1>
            <p>{t('Activity.blurb')}</p>
          </div>
        </header>
        <div className="lab-activity__toolbar">
          <SegmentedControl
            size="sm"
            className="max-w-full flex-wrap"
            ariaLabel={t('Activity.scopeLabel')}
            value={scope}
            onValueChange={(value) => {
              if (value === scope) return;
              setSnapshot(INITIAL);
              setScope(value as LabActivityScope);
            }}
            items={[
              { value: 'open-todos', label: t('Activity.scope.openTodos') },
              { value: 'updates', label: t('Activity.scope.updates') },
              { value: 'all', label: t('Activity.scope.all') },
            ]}
          />
          <p>{t('Activity.readHint')}</p>
        </div>

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
          <Surface tone="panel" className="lab-activity__empty" data-testid="lab-activity-empty">
            <Inbox size={24} aria-hidden="true" />
            <p>{t(emptyScope)}</p>
            {scope !== 'all' ? <Button size="sm" tone="secondary" onClick={() => { setSnapshot(INITIAL); setScope('all'); }}>{t('Activity.scope.all')}</Button> : null}
          </Surface>
        ) : null}

        {snapshot.records.length > 0 ? <ul className="lab-activity__list">
          {snapshot.records.map((record) => {
            const detail = labActivityBusinessDetail(record);
            const notice = notices[record.activityId];
            const source = sourceLabel(record);
            const title = record.source.kind === 'runtime-agent' && record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE
              ? t('Activity.runtimeTurnTitle') : record.title;
            const openable = record.source.kind === 'app' && record.objectRef !== null;
            const pending = busy[record.activityId];
            return (
              <li key={record.activityId}>
                <Surface
                  as="div"
                  tone="panel"
                  padding="md"
                  className="lab-activity__item"
                  data-testid={`lab-activity-item:${record.activityId}`}
                  data-unread={record.userView.unread ? 'true' : 'false'}
                >
                  <div className="lab-activity__meta">
                    <strong>{source}</strong>
                    <time dateTime={record.occurredAt}>{formatTime.format(new Date(record.occurredAt))}</time>
                  </div>
                  <div className="lab-activity__content">
                    <div className="lab-activity__story">
                      <h2>{title}</h2>
                      {detail ? (
                        <p data-testid="lab-activity-business-detail">
                          {[
                            detail.worldName,
                            t(`Activity.worldStudio.task.${detail.task}`),
                            t('Activity.worldStudio.suggestions', { count: detail.suggestions }),
                            t('Activity.worldStudio.notes', { count: detail.notes }),
                            detail.adopted === null ? '' : t('Activity.worldStudio.adopted', { count: detail.adopted }),
                          ].filter(Boolean).join(' · ')}
                        </p>
                      ) : record.summary ? <p>{record.summary}</p> : null}
                    </div>
                    <div className="lab-activity__status">
                      {record.userView.needsAttention ? <StatusBadge tone="warning" shape="dot">{t('Activity.needsAttention')}</StatusBadge>
                        : record.userView.unread ? <StatusBadge tone="info" shape="dot">{t('Activity.unread')}</StatusBadge> : null}
                      {scope !== 'open-todos' && record.kind === 'todo' && record.todoState ? (
                        <StatusBadge tone={record.todoState === 'completed' ? 'success' : record.todoState === 'open' ? 'info' : 'neutral'}>
                          {t(`Activity.state.${record.todoState}`)}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  {notice ? (
                    <p role="status" className={`text-xs ${notice.tone === 'warning' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                      {notice.text}
                    </p>
                  ) : null}
                  <footer className="lab-activity__item-foot">
                    <ActivityTechnicalDetails record={record} />
                    <div className="lab-activity__actions">
                      {record.userView.unread ? (
                        <Button size="sm" tone="ghost" loading={pending === 'read'} disabled={!!pending} leadingIcon={<Check size={14} aria-hidden="true" />} onClick={() => void runAction(record, 'read')}>
                          {t('Activity.markRead')}
                        </Button>
                      ) : null}
                      {openable ? (
                        <Button size="sm" tone="secondary" aria-label={t('Activity.open', { source })} loading={pending === 'open'} disabled={!!pending} trailingIcon={<ArrowUpRight size={14} aria-hidden="true" />} onClick={() => void runAction(record, 'open')}>
                          {t('Activity.openSource')}
                        </Button>
                      ) : null}
                    </div>
                  </footer>
                </Surface>
              </li>
            );
          })}
        </ul> : null}

        {snapshot.hasMore ? (
          <div className="grid justify-items-center gap-2" data-testid="lab-activity-more">
            {snapshot.error ? <InlineAlert tone="warning">{t('Activity.loadMoreFailed')}</InlineAlert> : null}
            <Button size="sm" tone="secondary" onClick={() => viewRef.current?.loadMore()}>{t(snapshot.error ? 'Activity.retry' : 'Activity.loadMore')}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
