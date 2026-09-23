import { Button, InlineAlert, LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';
import {
  createNimiAppActivityView,
  NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE,
  type NimiAppActivityOpenResult,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
  type NimiLocalAppActivityClient,
} from '@nimiplatform/sdk/app';
import { ArrowUpRight, Bot, CheckCircle2, Inbox } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  activityFacets,
  activitySourceLabel,
  applyActivityFacet,
  groupByOccurredDay,
  isOpenable,
  isPendingTodo,
} from './home-app-activity-model.js';

const PENDING_PREVIEW = 5;
const RECENT_PREVIEW = 12;

export type HomeActivityNotice = Readonly<{ tone: 'info' | 'warning'; text: string }>;

type Translate = ReturnType<typeof useTranslation>['t'];

const INITIAL_SNAPSHOT: NimiAppActivityViewSnapshot = Object.freeze({
  status: 'loading',
  records: Object.freeze([]),
  complete: false,
  hasMore: false,
  error: null,
});

type HomeActivityViewKey = 'pending' | 'recent';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r035
/**
 * Home consumes App activity through Desktop's formal App client with the same
 * list, subscribe, mark-read, and open operations every covered App uses.
 * Reading is recorded only by the explicit mark-read action for the displayed
 * revision; list and change delivery never mark anything read.
 */
export function HomeAppActivity() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  // Resolved per call so a session that is not ready yet surfaces as a
  // retried view failure instead of breaking Home.
  const activity = useMemo<Pick<NimiLocalAppActivityClient, 'list' | 'subscribe'>>(() => ({
    list: (input) => sdk.appProduct().activity.list(input),
    subscribe: (input) => sdk.appProduct().activity.subscribe(input),
  }), [sdk]);
  const [pending, setPending] = useState<NimiAppActivityViewSnapshot>(INITIAL_SNAPSHOT);
  const [recent, setRecent] = useState<NimiAppActivityViewSnapshot>(INITIAL_SNAPSHOT);
  const [facetKey, setFacetKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Readonly<Record<string, 'open' | 'read'>>>({});
  const [notices, setNotices] = useState<Readonly<Record<string, HomeActivityNotice>>>({});
  const views = useRef<Partial<Record<HomeActivityViewKey, NimiAppActivityView>>>({});

  useEffect(() => {
    const pendingView = createNimiAppActivityView({
      activity,
      filter: { kind: 'todo', todoStates: ['open'] },
      onUpdate: setPending,
    });
    const recentView = createNimiAppActivityView({ activity, maxRecords: 300, onUpdate: setRecent });
    views.current = { pending: pendingView, recent: recentView };
    pendingView.start();
    recentView.start();
    return () => {
      views.current = {};
      void pendingView.stop();
      void recentView.stop();
    };
  }, [activity]);

  const setBusyFor = (activityId: string, value: 'open' | 'read' | null) => {
    setBusy((current) => {
      const next = { ...current };
      if (value) next[activityId] = value;
      else delete next[activityId];
      return next;
    });
  };
  const setNotice = (activityId: string, notice: HomeActivityNotice | null) => {
    setNotices((current) => {
      const next = { ...current };
      if (notice) next[activityId] = notice;
      else delete next[activityId];
      return next;
    });
  };

  const open = async (record: NimiAppActivityRecord) => {
    setBusyFor(record.activityId, 'open');
    setNotice(record.activityId, null);
    try {
      const result = await sdk.appProduct().activity.open({ activityId: record.activityId });
      setNotice(record.activityId, openNotice(t, record, result));
    } catch {
      setNotice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.result.error') });
    } finally {
      setBusyFor(record.activityId, null);
    }
  };

  const markRead = async (record: NimiAppActivityRecord) => {
    setBusyFor(record.activityId, 'read');
    setNotice(record.activityId, null);
    try {
      await sdk.appProduct().activity.markRead({ activityId: record.activityId, displayedRevision: record.revision });
    } catch {
      setNotice(record.activityId, { tone: 'warning', text: t('runtimeConfig.overview.appActivity.readFailed') });
    } finally {
      setBusyFor(record.activityId, null);
    }
  };

  return (
    <HomeAppActivityView
      pending={pending}
      recent={recent}
      facetKey={facetKey}
      now={new Date()}
      busy={busy}
      notices={notices}
      onFacet={setFacetKey}
      onOpen={(record) => void open(record)}
      onMarkRead={(record) => void markRead(record)}
      onRetry={() => {
        views.current.pending?.relist();
        views.current.recent?.relist();
      }}
      onLoadMore={(key) => views.current[key]?.loadMore()}
    />
  );
}

function openNotice(t: Translate, record: NimiAppActivityRecord, result: NimiAppActivityOpenResult): HomeActivityNotice {
  const source = activitySourceLabel(record) ?? t('runtimeConfig.overview.appActivity.unknownSource');
  return {
    tone: result.outcome === 'opened' ? 'info' : 'warning',
    text: t(`runtimeConfig.overview.appActivity.result.${result.reason}`, { source }),
  };
}

export type HomeAppActivityViewProps = Readonly<{
  pending: NimiAppActivityViewSnapshot;
  recent: NimiAppActivityViewSnapshot;
  facetKey: string | null;
  now: Date;
  busy: Readonly<Record<string, 'open' | 'read'>>;
  notices: Readonly<Record<string, HomeActivityNotice>>;
  onFacet: (facetKey: string | null) => void;
  onOpen: (record: NimiAppActivityRecord) => void;
  onMarkRead: (record: NimiAppActivityRecord) => void;
  onRetry: () => void;
  /** Continues a listing that paused at its record bound. */
  onLoadMore: (view: HomeActivityViewKey) => void;
}>;

export function HomeAppActivityView(props: HomeAppActivityViewProps) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const [showAllPending, setShowAllPending] = useState(false);
  const [recentLimit, setRecentLimit] = useState(RECENT_PREVIEW);
  const unavailable = props.pending.status === 'unavailable' || props.recent.status === 'unavailable';
  const pendingRecords = props.pending.records;
  const recentRecords = props.recent.records.filter((record) => !isPendingTodo(record));
  const facets = activityFacets(recentRecords);
  const facetKey = props.facetKey && facets.some((facet) => facet.key === props.facetKey) ? props.facetKey : null;
  const filtered = applyActivityFacet(recentRecords, facetKey);
  const groups = groupByOccurredDay(filtered.slice(0, recentLimit), props.now);
  const itemProps = { busy: props.busy, notices: props.notices, onOpen: props.onOpen, onMarkRead: props.onMarkRead };
  return (
    <section className="space-y-5" data-testid="home-app-activity">
      {unavailable ? (
        <InlineAlert
          tone="warning"
          data-testid="home-app-activity-unavailable"
          action={(
            <Button tone="ghost" size="sm" onClick={props.onRetry}>
              {t('runtimeConfig.overview.appActivity.retry')}
            </Button>
          )}
        >
          {t('runtimeConfig.overview.appActivity.unavailable')}
        </InlineAlert>
      ) : null}

      <div className="space-y-2" data-testid="home-app-activity-pending">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">{t('runtimeConfig.overview.appActivity.pendingTitle')}</h2>
          {pendingRecords.length ? (
            <span className="text-xs tabular-nums text-[var(--nimi-text-secondary)]">
              {t(props.pending.hasMore ? 'runtimeConfig.overview.appActivity.pendingCountMore' : 'runtimeConfig.overview.appActivity.pendingCount', { count: pendingRecords.length })}
            </span>
          ) : null}
        </div>
        {props.pending.status === 'loading' && !pendingRecords.length ? (
          <LoadingSkeleton lines={2} label={t('Common.loading')} />
        ) : pendingRecords.length ? (
          <>
            <ul className="divide-y divide-[var(--nimi-border-subtle)] rounded-2xl border border-[var(--nimi-border-subtle)]">
              {(showAllPending ? pendingRecords : pendingRecords.slice(0, PENDING_PREVIEW)).map((record) => (
                <ActivityItem key={record.activityId} record={record} showState={false} time="relative" {...itemProps} />
              ))}
            </ul>
            <div className="flex gap-1">
              {(pendingRecords.length > PENDING_PREVIEW && !showAllPending) || props.pending.hasMore ? (
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => {
                    // Expanding shows every loaded item; when nothing loaded
                    // is hidden, more items of a paused listing are loaded.
                    if (showAllPending || pendingRecords.length <= PENDING_PREVIEW) props.onLoadMore('pending');
                    setShowAllPending(true);
                  }}
                >
                  {t('runtimeConfig.overview.appActivity.showMore')}
                </Button>
              ) : null}
              {showAllPending ? (
                <Button tone="ghost" size="sm" onClick={() => setShowAllPending(false)}>
                  {t('runtimeConfig.overview.appActivity.showLess')}
                </Button>
              ) : null}
            </div>
          </>
        ) : props.pending.hasMore ? (
          <Button tone="ghost" size="sm" onClick={() => props.onLoadMore('pending')}>
            {t('runtimeConfig.overview.appActivity.showMore')}
          </Button>
        ) : props.pending.status === 'ready' && props.pending.complete ? (
          <p className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
            <CheckCircle2 size={15} className="text-[var(--nimi-status-success)]" />
            {t('runtimeConfig.overview.appActivity.pendingEmpty')}
          </p>
        ) : null}
      </div>

      <div className="space-y-2" data-testid="home-app-activity-recent">
        <h2 className="text-base font-semibold">{t('runtimeConfig.overview.appActivity.recentTitle')}</h2>
        {facets.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('runtimeConfig.overview.appActivity.filterLabel')}>
            {[{ key: null, label: t('runtimeConfig.overview.appActivity.filterAll'), kind: 'all' as const }, ...facets].map((facet) => (
              <button
                key={facet.key ?? 'all'}
                type="button"
                aria-pressed={facetKey === facet.key}
                onClick={() => props.onFacet(facet.key)}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${facetKey === facet.key ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-active)]'}`}
              >
                {facet.kind === 'agent' ? <Bot size={12} aria-hidden="true" /> : null}
                {facet.label}
              </button>
            ))}
          </div>
        ) : null}
        {props.recent.status === 'loading' && !recentRecords.length ? (
          <LoadingSkeleton lines={2} label={t('Common.loading')} />
        ) : groups.length ? (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.dayKey} className="space-y-1.5">
                <h3 className="text-xs font-medium text-[var(--nimi-text-muted)]">
                  {group.relative
                    ? t(`runtimeConfig.overview.appActivity.${group.relative}`)
                    : i18n.formatDate(group.day, { weekday: 'short', month: 'short', day: 'numeric' })}
                </h3>
                <ul className="divide-y divide-[var(--nimi-border-subtle)] rounded-2xl border border-[var(--nimi-border-subtle)]">
                  {group.records.map((record) => (
                    <ActivityItem key={record.activityId} record={record} showState time="clock" {...itemProps} />
                  ))}
                </ul>
              </div>
            ))}
            {filtered.length > recentLimit || props.recent.hasMore ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => {
                  const limit = recentLimit + RECENT_PREVIEW;
                  setRecentLimit(limit);
                  if (filtered.length <= limit && props.recent.hasMore) props.onLoadMore('recent');
                }}
              >
                {t('runtimeConfig.overview.appActivity.showMore')}
              </Button>
            ) : null}
          </div>
        ) : props.recent.hasMore ? (
          <Button tone="ghost" size="sm" onClick={() => props.onLoadMore('recent')}>
            {t('runtimeConfig.overview.appActivity.showMore')}
          </Button>
        ) : props.recent.status === 'ready' && props.recent.complete ? (
          <p className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
            <Inbox size={15} />
            {t('runtimeConfig.overview.appActivity.recentEmpty')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ActivityItem(props: Readonly<{
  record: NimiAppActivityRecord;
  showState: boolean;
  time: 'relative' | 'clock';
  busy: Readonly<Record<string, 'open' | 'read'>>;
  notices: Readonly<Record<string, HomeActivityNotice>>;
  onOpen: (record: NimiAppActivityRecord) => void;
  onMarkRead: (record: NimiAppActivityRecord) => void;
}>) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const { record } = props;
  const busy = props.busy[record.activityId];
  const notice = props.notices[record.activityId];
  const source = activitySourceLabel(record) ?? t('runtimeConfig.overview.appActivity.unknownSource');
  const runtimeTurn = record.source.kind === 'runtime-agent' && record.type === NIMI_APP_ACTIVITY_RUNTIME_TURN_TYPE;
  const title = runtimeTurn ? t('runtimeConfig.overview.appActivity.runtimeTurnTitle') : record.title;
  const time = props.time === 'relative'
    ? i18n.formatRelativeTime(record.occurredAt)
    : i18n.formatDate(record.occurredAt, { hour: '2-digit', minute: '2-digit' });
  const meta = [
    source,
    record.source.kind === 'app' && record.agent ? t('runtimeConfig.overview.appActivity.withAgent', { agent: record.agent.displayName }) : '',
    time,
  ].filter(Boolean).join(' · ');
  return (
    <li
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`home-app-activity-item:${record.activityId}`}
      data-unread={record.userView.unread ? 'true' : 'false'}
    >
      <span className="mt-1.5 flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
        {record.userView.unread ? <span className="size-2 rounded-full bg-[var(--nimi-status-info)]" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${record.userView.unread ? 'font-semibold' : 'font-medium'}`}>
          {record.userView.unread ? <span className="sr-only">{t('runtimeConfig.overview.appActivity.unread')} </span> : null}
          {title}
        </p>
        {record.summary ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--nimi-text-secondary)]">{record.summary}</p>
        ) : null}
        <p className="mt-0.5 truncate text-xs text-[var(--nimi-text-muted)]">
          {runtimeTurn ? <Bot size={11} className="mr-1 inline" aria-hidden="true" /> : null}
          {meta}
        </p>
        {record.source.kind === 'app' && !record.source.available ? (
          <p className="mt-0.5 text-xs text-[var(--nimi-status-warning)]">
            {t('runtimeConfig.overview.appActivity.sourceUnavailable', { source })}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className={`mt-1 text-xs ${notice.tone === 'warning' ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-text-secondary)]'}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {record.userView.needsAttention ? (
          <StatusBadge tone="warning" shape="dot">{t('runtimeConfig.overview.appActivity.needsAttention')}</StatusBadge>
        ) : null}
        {props.showState && record.kind === 'todo' && record.todoState ? (
          <StatusBadge tone={record.todoState === 'completed' ? 'success' : record.todoState === 'open' ? 'info' : 'neutral'}>
            {t(`runtimeConfig.overview.appActivity.state.${record.todoState}`)}
          </StatusBadge>
        ) : null}
        {record.userView.unread ? (
          <Button tone="ghost" size="sm" disabled={Boolean(busy)} onClick={() => props.onMarkRead(record)}>
            {t('runtimeConfig.overview.appActivity.markRead')}
          </Button>
        ) : null}
        {isOpenable(record) ? (
          <Button tone="secondary" size="sm" disabled={Boolean(busy)} onClick={() => props.onOpen(record)}>
            {t(busy === 'open' ? 'runtimeConfig.overview.appActivity.opening' : 'runtimeConfig.overview.appActivity.open')}
            <ArrowUpRight size={14} />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
