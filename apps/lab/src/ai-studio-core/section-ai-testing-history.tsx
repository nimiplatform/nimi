import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, InlineAlert, nimiToast, OverlayShell, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { Check, ChevronRight, Ellipsis, FileX, Funnel, GitCompareArrows, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import {
  flattenStudioRunHistory,
  formatStudioRunHistoryTimestamp,
  getStudioRunConfigParamRows,
  getStudioRunMetricSummary,
  getStudioRunIntentLabel,
  getStudioRunIntentSource,
  getStudioRunPromptSummary,
  getStudioRunResultSummary,
  getStudioRunStatusTone,
  type StudioFlatRunRecord,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
} from './history.js';
import { studioConfiguredTargetLabel } from './section-ai-testing-run.js';
import {
  StudioHistoryActionsContext,
  StudioHistoryLoadContext,
  StudioHistoryPanelContext,
  type StudioHistoryPanelScope,
  type StudioMediaHistoryRecord,
} from './contexts.js';
import { studioHistoryDocumentPaths } from './history-policy.js';
import { isStoppedDirectCall } from './non-success-presentation.js';

type HistoryStatusFilter = 'all' | StudioRunHistoryRecord['status'];
const HISTORY_PAGE_SIZE = 24;
type HistoryEnvironmentFilter = 'all' | 'local' | 'cloud' | 'remote-control';
type HistoryActivityFilter = 'all' | 'today' | '7d' | '30d';
type HistoryGroupBy = 'none' | 'date' | 'capability';
type HistorySortBy = 'recency' | 'oldest';
type HistoryFilterMenuId = 'status' | 'capability' | 'environment' | 'activity' | 'group' | 'sort';

// Date group formatters follow the active UI locale. Frozen literal with the
// conformance-whitelisted Intl.DateTimeFormat constructor — module-scope
// Map/Set caches are forbidden in the canonical local closure.
const historyDateGroupFormatters = Object.freeze({
  'zh-CN:year': new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }),
  'zh-CN:plain': new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }),
  'en-US:year': new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  'en-US:plain': new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
} as Record<string, Intl.DateTimeFormat>);
function historyDateGroupFormatter(locale: string, withYear: boolean): Intl.DateTimeFormat {
  const suffix = withYear ? 'year' : 'plain';
  return historyDateGroupFormatters[`${locale}:${suffix}`] ?? historyDateGroupFormatters[`en-US:${suffix}`];
}

const HISTORY_STATUS_OPTIONS: ReadonlyArray<{ id: HistoryStatusFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'History.filters.status.all' },
  { id: 'ready', labelKey: 'History.filters.status.ready' },
  { id: 'failed', labelKey: 'History.filters.status.failed' },
  { id: 'canceled', labelKey: 'History.filters.status.canceled' },
  { id: 'timed-out', labelKey: 'History.filters.status.timedOut' },
  { id: 'unavailable', labelKey: 'History.filters.status.unavailable' },
];

const HISTORY_ENVIRONMENT_OPTIONS: ReadonlyArray<{ id: HistoryEnvironmentFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'History.filters.environment.all' },
  { id: 'local', labelKey: 'History.filters.environment.local' },
  { id: 'cloud', labelKey: 'History.filters.environment.cloud' },
  { id: 'remote-control', labelKey: 'History.filters.environment.remoteControl' },
];

const HISTORY_ACTIVITY_OPTIONS: ReadonlyArray<{ id: HistoryActivityFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'History.filters.activity.all' },
  { id: 'today', labelKey: 'History.filters.activity.today' },
  { id: '7d', labelKey: 'History.filters.activity.last7Days' },
  { id: '30d', labelKey: 'History.filters.activity.last30Days' },
];

const HISTORY_GROUP_OPTIONS: ReadonlyArray<{ id: HistoryGroupBy; labelKey: string }> = [
  { id: 'none', labelKey: 'History.filters.group.none' },
  { id: 'date', labelKey: 'History.filters.group.date' },
  { id: 'capability', labelKey: 'History.filters.group.capability' },
];

const HISTORY_SORT_OPTIONS: ReadonlyArray<{ id: HistorySortBy; labelKey: string }> = [
  { id: 'recency', labelKey: 'History.filters.sort.recency' },
  { id: 'oldest', labelKey: 'History.filters.sort.oldest' },
];

// Local run history recovered from the host-owned history panel. Reads only
// the app-owned history store; it does not claim Runtime or Realm truth.
function historyToneForRun(record: StudioRunHistoryRecord): 'success' | 'warning' | 'info' | 'neutral' {
  const tone = getStudioRunStatusTone(record.status);
  if (tone === 'success') return 'success';
  if (tone === 'info') return 'info';
  if (tone === 'danger' || tone === 'warning') return 'warning';
  return 'neutral';
}

function historyTitleForRun(record: StudioRunHistoryRecord): string {
  const prompt = getStudioRunPromptSummary(record).trim();
  return prompt || getStudioRunResultSummary(record);
}

function historyFailureReasonForRun(record: StudioRunHistoryRecord): string {
  const result = record.result;
  if (result && result.ok === false) {
    return result.reason || result.summary || record.message;
  }
  return getStudioRunResultSummary(record);
}

function isSameHistoryDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function matchesHistoryStatus(record: StudioRunHistoryRecord, status: HistoryStatusFilter): boolean {
  if (status === 'all') return true;
  return record.status === status;
}

function isFailureHistoryStatus(record: StudioRunHistoryRecord): boolean {
  return record.status === 'failed' || record.status === 'unavailable';
}

function matchesHistorySearch(record: StudioRunHistoryRecord, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    record.prompt,
    record.message,
    record.result?.summary ?? '',
    getStudioRunIntentLabel(record),
    record.runConfig?.target.targetLabel ?? '',
    record.runConfig?.target.targetRef ?? '',
  ];
  return haystacks.some((value) => value.toLowerCase().includes(query));
}

function matchesMediaSearch(record: StudioMediaHistoryRecord, query: string): boolean {
  if (!query) return true;
  return [record.title, record.capabilityLabel ?? '', record.artifactLabel ?? '', record.message ?? '']
    .some((value) => value.toLowerCase().includes(query));
}

function matchesHistoryEnvironment(record: StudioRunHistoryRecord, environment: HistoryEnvironmentFilter): boolean {
  if (environment === 'all') return true;
  const source = getStudioRunIntentSource(record);
  if (environment === 'local' || environment === 'cloud') return source === environment;
  const targetSource = String(record.runConfig?.target.source || '').toLowerCase();
  return targetSource.includes('remote');
}

function matchesHistoryActivity(record: Pick<StudioRunHistoryRecord, 'createdAt'>, activity: HistoryActivityFilter, now: Date): boolean {
  if (activity === 'all') return true;
  const createdAt = new Date(record.createdAt);
  if (Number.isNaN(createdAt.valueOf())) return false;
  if (activity === 'today') return isSameHistoryDate(createdAt, now);
  const days = activity === '7d' ? 7 : 30;
  return now.valueOf() - createdAt.valueOf() <= days * 24 * 60 * 60 * 1000;
}

function HistoryFilterOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      tone="ghost"
      size="sm"
      className={selected ? 'studio-history-filter__option studio-history-filter__option--selected' : 'studio-history-filter__option'}
      onClick={onSelect}
    >
      <span>{label}</span>
      {selected ? <Check size={17} strokeWidth={2} aria-hidden="true" /> : null}
    </Button>
  );
}

export function CapabilityRunHistory({
  history,
  activeRunId,
  onSelectRun,
  onClose,
  collapsed,
  currentCapabilityId,
  registrations,
}: {
  history: StudioRunHistory | null;
  activeRunId: string | null;
  onSelectRun: (record: StudioRunHistoryRecord) => void;
  onClose?: () => void;
  collapsed: boolean;
  currentCapabilityId: string;
  registrations: readonly StudioCapabilityRegistration[];
}) {
  const rendererHost = useAIStudioHost();
  const { translate: t } = rendererHost;
  const historyLoad = useContext(StudioHistoryLoadContext);
  const historyActions = useContext(StudioHistoryActionsContext);
  const historyPanel = useContext(StudioHistoryPanelContext);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!collapsed) closeButton.current?.focus();
  }, [collapsed]);
  const locale = rendererHost.locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  const runtimeHistoryCapabilities = useMemo(() => registrations.filter((item) => (
    item.descriptor.execution === 'runtime-sdk' || item.descriptor.execution === 'standalone-electron'
  )), [registrations]);
  const resolveCapabilityLabel = (id: string) => (
    registrations.find((item) => item.descriptor.id === id)?.descriptor.label ?? null
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<HistoryFilterMenuId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(HISTORY_PAGE_SIZE);
  const [clearArmed, setClearArmed] = useState(false);
  const [historyActionsOpen, setHistoryActionsOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparisonIds, setComparisonIds] = useState<readonly string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const scope: StudioHistoryPanelScope = historyPanel?.scope ?? 'capability';
  const hideFailures = historyPanel?.hideFailures ?? false;
  const setScope = (next: StudioHistoryPanelScope) => {
    setClearArmed(false);
    setComparing(false);
    setComparisonIds([]);
    historyPanel?.setScope(next);
  };
  const setHideFailures = (next: boolean) => historyPanel?.setHideFailures(next);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string | 'all'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState<HistoryEnvironmentFilter>('all');
  const [activityFilter, setActivityFilter] = useState<HistoryActivityFilter>('all');
  const [groupBy, setGroupBy] = useState<HistoryGroupBy>('none');
  const [sortBy, setSortBy] = useState<HistorySortBy>('recency');
  const now = useMemo(() => new Date(rendererHost.clock.now()), [history, rendererHost]);
  const query = searchQuery.trim().toLowerCase();
  useEffect(() => {
    setVisibleLimit(HISTORY_PAGE_SIZE);
  }, [collapsed, currentCapabilityId, scope, query, hideFailures, statusFilter, capabilityFilter, environmentFilter, activityFilter, groupBy, sortBy]);
  const allRecords = useMemo(() => flattenStudioRunHistory(history, resolveCapabilityLabel), [history, registrations]);
  const comparisonRecords = comparisonIds.flatMap((id) => {
    const record = allRecords.find((item) => item.id === id);
    return record ? [record] : [];
  });
  const records = useMemo(() => allRecords
    .filter((record) => (scope === 'capability'
      ? record.capabilityId === currentCapabilityId
      : capabilityFilter === 'all' || record.capabilityId === capabilityFilter))
    .filter((record) => !hideFailures || !isFailureHistoryStatus(record))
    .filter((record) => matchesHistorySearch(record, query))
    .filter((record) => matchesHistoryStatus(record, statusFilter))
    .filter((record) => matchesHistoryEnvironment(record, environmentFilter))
    .filter((record) => matchesHistoryActivity(record, activityFilter, now))
    .sort((left, right) => sortBy === 'recency'
      ? right.createdAt.localeCompare(left.createdAt)
       : left.createdAt.localeCompare(right.createdAt)), [activityFilter, allRecords, capabilityFilter, currentCapabilityId, environmentFilter, hideFailures, now, query, scope, sortBy, statusFilter]);
  const mediaRecords = useMemo(() => (historyPanel?.imageRecords ?? [])
    .filter((record) => !hideFailures || record.status === 'ready')
    .filter((record) => matchesMediaSearch(record, query))
    .filter((record) => matchesHistoryActivity(record, activityFilter, now)), [activityFilter, hideFailures, historyPanel?.imageRecords, now, query]);

  function handleSelectMediaRecord(record: StudioMediaHistoryRecord) {
    const linkageId = record.runId || record.id;
    const runRecord = allRecords.find((entry) => entry.id === linkageId);
    if (!runRecord) {
      nimiToast.warning(t('History.linkedRunMissing'));
      return;
    }
    onSelectRun(runRecord);
  }

  function handleRemoveRecord(record: StudioRunHistoryRecord, deleteDocument = false) {
    void historyActions?.removeRecord(record.id, deleteDocument);
  }

  function handleRemoveMediaRecord(record: StudioMediaHistoryRecord) {
    void historyActions?.removeRecord(record.runId || record.id, true);
  }

  function handleClearScope(deleteAssets: boolean) {
    setClearArmed(false);
    setHistoryActionsOpen(false);
    void historyActions?.clearScope(scope === 'capability' ? currentCapabilityId : null, deleteAssets);
  }

  function historySourceLabelForRun(record: StudioRunHistoryRecord): string {
    const source = getStudioRunIntentSource(record);
    if (source === 'local') return t('History.source.local');
    if (source === 'cloud') return t('History.source.cloud');
    return t('History.source.unknown');
  }

  function historySubtitleForRun(record: StudioRunHistoryRecord): string {
    const target = studioConfiguredTargetLabel(record.runConfig?.target, t);
    const capability = scope === 'all' ? historyCapabilityLabel(record.capabilityId) : '';
    if (record.status === 'canceled') {
      const reason = historyFailureReasonForRun(record);
      const stoppedLabel = reason !== 'operation-aborted' ? 'History.canceled' : isStoppedDirectCall(reason, record.capabilityId) ? 'History.stopped' : 'History.stoppedWaiting';
      return [t(stoppedLabel), capability, target, reason].filter(Boolean).join(' / ');
    }
    if (record.status === 'timed-out') {
      return [t('History.timedOut'), capability, target, historyFailureReasonForRun(record)].filter(Boolean).join(' / ');
    }
    if (isFailureHistoryStatus(record)) {
      return [t('History.failed'), capability, target, historyFailureReasonForRun(record)].filter(Boolean).join(' / ');
    }
    const state = record.status === 'ready' ? t('Studio.result.status.runtimeResult') : rendererHost.app.projection.runStatusLabel(record.status);
    return [state, target, capability].filter(Boolean).join(' / ');
  }

  function historyLabelForRun(record: StudioFlatRunRecord): string {
    const prompt = historyTitleForRun(record);
    const intent = getStudioRunIntentLabel(record);
    const source = getStudioRunIntentSource(record);
    const metrics = getStudioRunMetricSummary(record);
    return [
      prompt ? t('History.runAriaPrompt', { prompt }) : '',
      source === 'unknown' ? intent : t('History.runAriaIntent', { source: historySourceLabelForRun(record), intent }),
      historyCapabilityLabel(record.capabilityId as string),
      formatStudioRunHistoryTimestamp(record.createdAt, now),
      metrics,
    ].filter(Boolean).join(' / ');
  }

  function optionLabel<T extends string>(options: ReadonlyArray<{ id: T; labelKey: string }>, id: T): string {
    const option = options.find((entry) => entry.id === id);
    return option ? t(option.labelKey) : id;
  }

  function historyCapabilityLabel(id: string | 'all'): string {
    if (id === 'all') return t('History.filters.capability.all');
    const capability = runtimeHistoryCapabilities.find((entry) => entry.descriptor.id === id);
    return capability ? t(capability.descriptor.labelKey) : id;
  }

  function historyDateGroupLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return t('History.unknownDate');
    if (isSameHistoryDate(date, now)) return t('History.today');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameHistoryDate(date, yesterday)) return t('History.yesterday');
    if (date.getFullYear() === now.getFullYear()) return historyDateGroupFormatter(locale, false).format(date);
    return historyDateGroupFormatter(locale, true).format(date);
  }

  const groups = useMemo(() => {
    const visibleRecords = records.slice(0, visibleLimit);
    if (groupBy === 'none') return [{ id: 'all', label: '', records: visibleRecords }];
    const grouped = new Map<string, { id: string; label: string; records: StudioFlatRunRecord[] }>();
    for (const record of visibleRecords) {
      const label = groupBy === 'date' ? historyDateGroupLabel(record.createdAt) : historyCapabilityLabel(record.capabilityId as string);
      const id = groupBy === 'date' ? `date:${label}` : `capability:${record.capabilityId}`;
      const existing = grouped.get(id);
      if (existing) {
        existing.records.push(record);
      } else {
        grouped.set(id, { id, label, records: [record] });
      }
    }
    return [...grouped.values()];
  }, [groupBy, now, records, locale, t, visibleLimit]);
  const activeMenuLabel = {
    status: optionLabel(HISTORY_STATUS_OPTIONS, statusFilter),
    capability: historyCapabilityLabel(capabilityFilter),
    environment: optionLabel(HISTORY_ENVIRONMENT_OPTIONS, environmentFilter),
    activity: optionLabel(HISTORY_ACTIVITY_OPTIONS, activityFilter),
    group: optionLabel(HISTORY_GROUP_OPTIONS, groupBy),
    sort: optionLabel(HISTORY_SORT_OPTIONS, sortBy),
  } satisfies Record<HistoryFilterMenuId, string>;
  const hasActiveHistoryFilters = statusFilter !== 'all'
    || (scope === 'all' && capabilityFilter !== 'all')
    || environmentFilter !== 'all'
    || activityFilter !== 'all'
    || groupBy !== 'none'
    || sortBy !== 'recency';
  const hasRecords = records.length > 0;

  function renderSubmenu() {
    if (!activeMenu) {
      return null;
    }
    if (activeMenu === 'status') {
      return HISTORY_STATUS_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={t(option.labelKey)} selected={statusFilter === option.id} onSelect={() => setStatusFilter(option.id)} />
      ));
    }
    if (activeMenu === 'capability') {
      return [
        <HistoryFilterOption key="all" label={t('History.filters.capability.allCapabilities')} selected={capabilityFilter === 'all'} onSelect={() => setCapabilityFilter('all')} />,
        ...runtimeHistoryCapabilities.map((capability) => (
          <HistoryFilterOption key={capability.descriptor.id} label={t(capability.descriptor.labelKey)} selected={capabilityFilter === capability.descriptor.id} onSelect={() => setCapabilityFilter(capability.descriptor.id)} />
        )),
      ];
    }
    if (activeMenu === 'environment') {
      return HISTORY_ENVIRONMENT_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={t(option.labelKey)} selected={environmentFilter === option.id} onSelect={() => setEnvironmentFilter(option.id)} />
      ));
    }
    if (activeMenu === 'activity') {
      return HISTORY_ACTIVITY_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={t(option.labelKey)} selected={activityFilter === option.id} onSelect={() => setActivityFilter(option.id)} />
      ));
    }
    if (activeMenu === 'group') {
      return HISTORY_GROUP_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={t(option.labelKey)} selected={groupBy === option.id} onSelect={() => setGroupBy(option.id)} />
      ));
    }
    return HISTORY_SORT_OPTIONS.map((option) => (
      <HistoryFilterOption key={option.id} label={t(option.labelKey)} selected={sortBy === option.id} onSelect={() => setSortBy(option.id)} />
    ));
  }

  function clearHistoryFilters() {
    setStatusFilter('all');
    setCapabilityFilter('all');
    setEnvironmentFilter('all');
    setActivityFilter('all');
    setGroupBy('none');
    setSortBy('recency');
    setActiveMenu(null);
  }

  if (collapsed) return <div className="studio-history-shell studio-history-shell--collapsed" inert />;

  return (
    <div className={collapsed ? 'studio-history-shell studio-history-shell--collapsed' : 'studio-history-shell'} inert={collapsed}>
      <aside
        className={collapsed ? 'studio-history studio-history--collapsed' : 'studio-history'}
        aria-label={t('History.panelAriaLabel')}
        onKeyDown={onClose ? (event) => { if (event.key === 'Escape' && !filterOpen && !historyActionsOpen) onClose(); } : undefined}
      >
        <div className="studio-recent__head">
          <div className="studio-history__title">
            <strong>{t('History.title')}</strong>
          </div>
          <div className="studio-history__actions">
            {scope !== 'media' && !comparing && records.length > 1 ? (
              <Button
                type="button"
                size="sm"
                tone="ghost"
                className="studio-history__compare-trigger"
                leadingIcon={<GitCompareArrows size={14} aria-hidden="true" />}
                onClick={() => setComparing(true)}
              >
                {t('History.compareRuns')}
              </Button>
            ) : null}
            {scope !== 'media' ? (
            <Popover
              open={filterOpen && !collapsed}
              onOpenChange={(open) => {
                setFilterOpen(open);
                if (!open) setActiveMenu(null);
              }}
            >
              <PopoverTrigger asChild>
                <IconButton
                  type="button"
                  tone="ghost"
                  size="sm"
                  className={filterOpen ? 'studio-history__filter-trigger studio-history__filter-trigger--active' : 'studio-history__filter-trigger'}
                  aria-label={t('History.filterAriaLabel')}
                  aria-expanded={filterOpen}
                  icon={<Funnel size={18} strokeWidth={1.9} aria-hidden="true" />}
                />
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" sideOffset={8} className="studio-history-filter-popover p-2" aria-label={t('History.filtersAriaLabel')}>
                <div className="studio-history-filter">
                  <div className="studio-history-filter__menu">
                    {([
                      ['status', t('History.menus.status')],
                      ...(scope === 'all' ? [['capability', t('History.menus.capability')] as const] : []),
                      ['environment', t('History.menus.environment')],
                      ['activity', t('History.menus.activity')],
                      ['group', t('History.menus.group')],
                      ['sort', t('History.menus.sort')],
                    ] as const).map(([id, label]) => (
                      <Button
                        key={id}
                        type="button"
                        tone="ghost"
                        size="sm"
                        className={activeMenu === id ? 'studio-history-filter__row studio-history-filter__row--active' : 'studio-history-filter__row'}
                        aria-expanded={activeMenu === id}
                        data-divider={id === 'group' ? '' : undefined}
                        onClick={() => setActiveMenu((value) => value === id ? null : id)}
                      >
                        <span>{label}</span>
                        <strong>{activeMenuLabel[id]}</strong>
                        <ChevronRight size={17} strokeWidth={1.9} aria-hidden="true" />
                      </Button>
                    ))}
                    {hasActiveHistoryFilters ? (
                      <Button
                        type="button"
                        tone="ghost"
                        size="sm"
                        className="studio-history-filter__clear"
                        onClick={clearHistoryFilters}
                      >
                        <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
                        <span>{t('History.clearFilters')}</span>
                      </Button>
                    ) : null}
                  </div>
                  {activeMenu ? (
                    <div className="studio-history-filter__submenu">
                      {renderSubmenu()}
                    </div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
            ) : null}
            {scope !== 'media' && historyActions ? (
              <Popover open={historyActionsOpen && !collapsed} onOpenChange={(open) => {
                setHistoryActionsOpen(open);
                if (!open) setClearArmed(false);
              }}>
                <PopoverTrigger asChild>
                  <IconButton
                    type="button"
                    size="sm"
                    tone="ghost"
                    aria-label={t('History.moreActions')}
                    icon={<Ellipsis size={17} aria-hidden="true" />}
                  />
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={8} className="grid gap-2 p-2" aria-label={t('History.moreActions')}>
                  {clearArmed ? (
                    <div className="grid justify-items-start gap-2 p-1" role="group" aria-label={t('History.clearChoiceAriaLabel')}>
                      <Button type="button" tone="ghost" size="sm" onClick={() => handleClearScope(false)}>
                        {t('History.clearRecordsOnly')}
                      </Button>
                      <Button type="button" tone="danger" size="sm" onClick={() => handleClearScope(true)}>
                        {t('History.clearRecordsAndAssets')}
                      </Button>
                      <Button type="button" tone="ghost" size="sm" onClick={() => setClearArmed(false)}>
                        {t('Common.close')}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" tone="ghost" size="sm" onClick={() => setClearArmed(true)}>
                      {t('History.clearScope')}
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            ) : null}
            {onClose ? (
              <IconButton
                ref={closeButton}
                type="button"
                tone="ghost"
                size="sm"
                aria-label={t('History.closePanel')}
                icon={<X size={17} aria-hidden="true" />}
                onClick={onClose}
              />
            ) : null}
          </div>
        </div>
        <div className="studio-history__search">
          <Search size={14} strokeWidth={1.9} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder={t('History.searchPlaceholder')}
            aria-label={t('History.searchPlaceholder')}
          />
        </div>
        <div className="studio-history__toolbar">
          <div className="studio-history__scope" role="group" aria-label={t('History.scopeAriaLabel')}>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              className={scope === 'capability' ? 'studio-history__scope-option studio-history__scope-option--active' : 'studio-history__scope-option'}
              aria-pressed={scope === 'capability'}
              onClick={() => setScope('capability')}
            >
              {t('History.scope.capability')}
            </Button>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              className={scope === 'all' ? 'studio-history__scope-option studio-history__scope-option--active' : 'studio-history__scope-option'}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {t('History.scope.all')}
            </Button>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              className={scope === 'media' ? 'studio-history__scope-option studio-history__scope-option--active' : 'studio-history__scope-option'}
              aria-pressed={scope === 'media'}
              onClick={() => setScope('media')}
            >
              {t('History.scope.media')}
            </Button>
          </div>
          <Button
            type="button"
            tone="ghost"
            size="sm"
            className={hideFailures ? 'studio-history__scope-option studio-history__scope-option--active' : 'studio-history__scope-option'}
            aria-pressed={hideFailures}
            onClick={() => setHideFailures(!hideFailures)}
          >
            {hideFailures ? t('History.showFailures') : t('History.hideFailures')}
          </Button>
          {scope !== 'media' && comparing ? (
            <div className="studio-history__comparison">
              <span role="status">{t('History.compareCount', { count: comparisonRecords.length })}</span>
              <Button type="button" size="sm" tone="secondary" disabled={comparisonRecords.length !== 2}
                onClick={() => setComparisonOpen(true)}>{t('History.openComparison')}</Button>
              <Button type="button" size="sm" tone="ghost" onClick={() => {
                setComparing(false);
                setComparisonIds([]);
              }}>{t('Common.close')}</Button>
            </div>
          ) : null}
        </div>
        <div className="studio-history__runs">
          {historyLoad?.error && scope !== 'media' ? (
            <InlineAlert
              tone="danger"
              className="studio-history__load-error"
              action={(
                <Button type="button" tone="secondary" size="sm" onClick={historyLoad.retry}>
                  {t('Common.retry')}
                </Button>
              )}
            >
              <div className="studio-history__load-error-copy">
                <strong>{historyLoad.title}</strong>
                <span>{historyLoad.error}</span>
              </div>
            </InlineAlert>
          ) : scope === 'media' ? (
            mediaRecords.length > 0 ? (
              <ul className="studio-recent__rows">
                {mediaRecords.slice(0, visibleLimit).map((record) => (
                  <li key={record.id}>
                    <Button
                      type="button"
                      tone="ghost"
                      size="sm"
                      className="studio-recent__row"
                      onClick={() => handleSelectMediaRecord(record)}
                      aria-label={record.title}
                    >
                      <span className={`studio-recent__dot studio-recent__dot--${record.status === 'ready' ? 'success' : 'warning'}`} aria-hidden="true" />
                      <span className="studio-recent__icon studio-recent__icon--media" aria-hidden="true">
                        <Sparkles size={16} strokeWidth={1.9} />
                      </span>
                      <span className="studio-recent__copy">
                        <span className="studio-recent__summary">
                          <span className="studio-recent__title">
                            <span title={record.title} className="studio-recent__intent-tooltip">
                              <span className="studio-recent__intent-name">{record.title}</span>
                            </span>
                            <time dateTime={record.createdAt}>{formatStudioRunHistoryTimestamp(record.createdAt, now)}</time>
                          </span>
                        </span>
                        <span className="studio-recent__detail">
                          {[record.capabilityLabel, record.artifactLabel].filter(Boolean).join(' / ')}
                        </span>
                      </span>
                    </Button>
                    {historyActions ? (
                        <IconButton
                          type="button"
                          tone="ghost"
                          size="sm"
                          className="studio-recent__row-delete"
                          aria-label={t('History.deleteRecordAndAsset')}
                          title={t('History.deleteRecordAndAsset')}
                          onClick={() => handleRemoveMediaRecord(record)}
                          icon={<Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />}
                        />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="studio-history__empty">{t('History.emptyMedia')}</p>
            )
          ) : hasRecords ? (
            groups.map((group) => (
              <section key={group.id} className="studio-history__group" aria-label={group.label ? t('History.groupRunsAriaLabel', { group: group.label }) : t('History.recentRuns')}>
                {group.label ? <h2 className="studio-history__group-title">{group.label}</h2> : null}
                <ul className="studio-recent__rows">
                  {group.records.map((record) => {
                    const capability = runtimeHistoryCapabilities.find((item) => item.descriptor.id === record.capabilityId);
                    const Icon = capability?.icon ?? Sparkles;
                    const selected = comparisonRecords.some(item => item.id === record.id);
                    const selectable = comparisonRecords.length < 2 && comparisonRecords.every(item => item.capabilityId === record.capabilityId);
                    const title = historyTitleForRun(record);
                    const subtitle = historySubtitleForRun(record);
                    return (
                      <li key={record.id} className={comparing ? 'studio-recent__compare-row' : undefined}>
                        {comparing ? (
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!selected && !selectable}
                            aria-label={t('History.selectComparisonRun', { run: historyLabelForRun(record) })}
                            onChange={() => setComparisonIds(selected
                              ? comparisonRecords.filter(item => item.id !== record.id).map(item => item.id)
                              : [...comparisonRecords.map(item => item.id), record.id])}
                          />
                        ) : null}
                        <Button
                          type="button"
                          tone="ghost"
                          size="sm"
                          className={record.id === activeRunId ? 'studio-recent__row studio-recent__row--active' : 'studio-recent__row'}
                          onClick={() => onSelectRun(record)}
                          aria-current={record.id === activeRunId ? 'true' : undefined}
                          aria-label={historyLabelForRun(record)}
                        >
                          <span className={`studio-recent__dot studio-recent__dot--${historyToneForRun(record)}`} aria-hidden="true" />
                          <span className="studio-recent__icon" aria-hidden="true">
                            <Icon size={16} strokeWidth={1.9} />
                          </span>
                          <span className="studio-recent__copy">
                            <span className="studio-recent__summary">
                              <span className="studio-recent__title">
                                <span title={title} className="studio-recent__intent-tooltip">
                                  <span className="studio-recent__intent-name">{title}</span>
                                </span>
                                <time dateTime={record.createdAt}>{formatStudioRunHistoryTimestamp(record.createdAt, now)}</time>
                              </span>
                            </span>
                            <span title={subtitle} className="studio-recent__detail-tooltip">
                              <span className={isFailureHistoryStatus(record) ? 'studio-recent__detail studio-recent__detail--failed' : 'studio-recent__detail'}>
                                {subtitle}
                              </span>
                            </span>
                          </span>
                        </Button>
                        {historyActions ? (
                            <IconButton
                              type="button"
                              tone="ghost"
                              size="sm"
                              className="studio-recent__row-delete"
                              aria-label={t('History.deleteRecordOnly')}
                              title={t('History.deleteRecordOnly')}
                              onClick={() => handleRemoveRecord(record)}
                              icon={<Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />}
                            />
                        ) : null}
                        {historyActions && studioHistoryDocumentPaths(record).length > 0 ? (
                            <IconButton
                              type="button"
                              tone="ghost"
                              size="sm"
                              className="studio-recent__row-delete studio-recent__row-delete--document"
                              aria-label={t('History.deleteRecordAndDocument')}
                              title={t('History.deleteRecordAndDocument')}
                              onClick={() => handleRemoveRecord(record, true)}
                              icon={<FileX size={13} strokeWidth={1.9} aria-hidden="true" />}
                            />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <p className="studio-history__empty">{history ? t('History.emptyFiltered') : t('History.emptyNone')}</p>
          )}
          {(scope === 'media' ? mediaRecords.length : records.length) > visibleLimit && (scope === 'media' || !historyLoad?.error) ? (
            <Button type="button" tone="ghost" size="sm" onClick={() => setVisibleLimit(limit => limit + HISTORY_PAGE_SIZE)}>
              {t('History.showMoreRuns')}
            </Button>
          ) : null}
        </div>
      </aside>
      <OverlayShell
        open={comparisonOpen && comparisonRecords.length === 2}
        kind="dialog"
        size="L"
        title={t('History.compareRuns')}
        description={t('History.comparisonDescription')}
        footer={<Button type="button" tone="secondary" onClick={() => setComparisonOpen(false)}>{t('Common.close')}</Button>}
        onClose={() => setComparisonOpen(false)}
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {comparisonRecords.map(record => {
            const snapshot = record.result;
            const params = record.runConfig ? getStudioRunConfigParamRows(record.runConfig) : [];
            const defaults = record.runConfig?.target.configuredDefaults
              ? getStudioRunConfigParamRows(record.runConfig, record.runConfig.target.configuredDefaults) : [];
            const jobId = snapshot && 'jobId' in snapshot ? snapshot.jobId : undefined;
            const traceId = record.runConfig?.traceId ?? (snapshot?.ok ? snapshot.traceId : snapshot?.diagnostics?.traceId);
            const output = snapshot?.ok && (snapshot.kind === 'text' || snapshot.kind === 'transcript')
              ? snapshot.body : getStudioRunResultSummary(record);
            return (
              <section key={record.id} className="grid min-w-0 content-start gap-2 rounded-lg border border-[var(--nimi-border-subtle)] p-3">
                <h3 className="m-0 text-sm font-semibold">{historyCapabilityLabel(record.capabilityId)} · {formatStudioRunHistoryTimestamp(record.createdAt, now)}</h3>
                <p className="m-0 text-sm">{historySubtitleForRun(record)}</p>
                <strong className="text-sm">{t('History.compareInput')}</strong>
                <p className="m-0 whitespace-pre-wrap break-words text-sm">{record.prompt || t('History.compareUnknown')}</p>
                {record.inputTruncated ? <p className="m-0 text-xs">{t('StudioShell.historyInputTruncated')}</p> : null}
                {record.runConfig?.promptControls.context ? <p className="m-0 whitespace-pre-wrap break-words text-sm">
                  {t('StudioShell.contextLabel')} · {record.runConfig.promptControls.context}
                </p> : null}
                <strong className="text-sm">{t('StudioShell.requestSettings')}</strong>
                {params.length ? <dl className="m-0 space-y-1 break-words text-sm">{params.map(row => (
                  <div key={row.key}><dt className="inline">{row.label} · </dt><dd className="m-0 inline">{row.value}</dd></div>
                ))}</dl> : <p className="m-0 text-sm">{t(record.runConfig ? 'History.compareNoParameters' : 'History.compareUnknown')}</p>}
                {defaults.length ? <>
                  <strong className="text-sm">{t('StudioShell.configuredDefaults')}</strong>
                  <dl className="m-0 space-y-1 break-words text-sm">{defaults.map(row => (
                    <div key={row.key}><dt className="inline">{row.label} · </dt><dd className="m-0 inline">{row.value}</dd></div>
                  ))}</dl>
                </> : null}
                <strong className="text-sm">{t('History.compareOutput')}</strong>
                <p className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm">{output || t('History.compareUnknown')}</p>
                {jobId ? <p className="m-0 break-all text-xs">{t('Studio.result.jobLabel')} · <code>{jobId}</code></p> : null}
                {traceId ? <p className="m-0 break-all text-xs">{t('Studio.result.traceLabel')} · <code>{traceId}</code></p> : null}
                <Button type="button" size="sm" tone="secondary" onClick={() => {
                  setComparisonOpen(false);
                  onSelectRun(record);
                }}>{t('History.openRun')}</Button>
              </section>
            );
          })}
        </div>
      </OverlayShell>
    </div>
  );
}
