import { useContext, useMemo, useState } from 'react';
import { Button, IconButton, InlineAlert, nimiToast, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@nimiplatform/kit/ui';
import { Check, ChevronRight, Funnel, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from '../../shell/i18n/index.js';
import { testerCapabilities, type TesterCapabilityId } from '../tester-capabilities.js';
import type { TesterImageHistoryRecord } from '../tester-image-history.js';
import type { TesterHistoryPanelScope } from '../tester-preferences.js';
import {
  flattenTesterRunHistory,
  formatTesterRunHistoryTimestamp,
  getTesterRunMetricSummary,
  getTesterRunIntentLabel,
  getTesterRunIntentSource,
  getTesterRunPromptSummary,
  getTesterRunResultSummary,
  getTesterRunStatusTone,
  type TesterFlatRunRecord,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from '../tester-history.js';
import { capabilityIcons } from './capability-icons.js';
import { TesterHistoryActionsContext, TesterHistoryLoadContext, TesterHistoryPanelContext } from './workbench-context.js';
import { useTesterRendererHost } from '../../renderer/context.js';

type HistoryStatusFilter = 'all' | TesterRunHistoryRecord['status'];
type HistoryEnvironmentFilter = 'all' | 'local' | 'cloud' | 'remote-control';
type HistoryActivityFilter = 'all' | 'today' | '7d' | '30d';
type HistoryGroupBy = 'none' | 'date' | 'capability';
type HistorySortBy = 'recency' | 'oldest';
type HistoryFilterMenuId = 'status' | 'capability' | 'environment' | 'activity' | 'group' | 'sort';

const runtimeHistoryCapabilities = Object.freeze(
  testerCapabilities.filter((item) => item.execution === 'runtime-sdk' || item.execution === 'standalone-tauri'),
);

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
  { id: 'simulated', labelKey: 'History.filters.status.simulated' },
  { id: 'failed', labelKey: 'History.filters.status.failed' },
  { id: 'unavailable', labelKey: 'History.filters.status.unavailable' },
  { id: 'local-fixture', labelKey: 'History.filters.status.localFixture' },
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

// Local run history recovered from the desktop tester history panel. Reads only
// the app-owned history store; it does not claim Runtime or Realm truth.
function historyToneForRun(record: TesterRunHistoryRecord): 'success' | 'warning' | 'info' | 'neutral' {
  const tone = getTesterRunStatusTone(record.status);
  if (tone === 'success') return 'success';
  if (tone === 'info') return 'info';
  if (tone === 'danger' || tone === 'warning') return 'warning';
  return 'neutral';
}

function historyTitleForRun(record: TesterRunHistoryRecord): string {
  const prompt = getTesterRunPromptSummary(record).trim();
  return prompt || getTesterRunResultSummary(record);
}

function historyFailureReasonForRun(record: TesterRunHistoryRecord): string {
  const result = record.result;
  if (result && result.ok === false) {
    return result.reason || result.summary || record.message;
  }
  return getTesterRunResultSummary(record);
}

function isSameHistoryDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function matchesHistoryStatus(record: TesterRunHistoryRecord, status: HistoryStatusFilter): boolean {
  if (status === 'all') return true;
  return record.status === status;
}

function isFailureHistoryStatus(record: TesterRunHistoryRecord): boolean {
  return record.status === 'failed' || record.status === 'unavailable';
}

function matchesHistorySearch(record: TesterRunHistoryRecord, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    record.prompt,
    record.message,
    record.result?.summary ?? '',
    getTesterRunIntentLabel(record),
  ];
  return haystacks.some((value) => value.toLowerCase().includes(query));
}

function matchesMediaSearch(record: TesterImageHistoryRecord, query: string): boolean {
  if (!query) return true;
  return [record.title, record.capabilityLabel ?? '', record.artifactLabel ?? '', record.message ?? '']
    .some((value) => value.toLowerCase().includes(query));
}

function matchesHistoryEnvironment(record: TesterRunHistoryRecord, environment: HistoryEnvironmentFilter): boolean {
  if (environment === 'all') return true;
  const source = getTesterRunIntentSource(record);
  if (environment === 'local' || environment === 'cloud') return source === environment;
  const targetSource = String(record.runConfig?.target.source || '').toLowerCase();
  return targetSource.includes('remote');
}

function matchesHistoryActivity(record: Pick<TesterRunHistoryRecord, 'createdAt'>, activity: HistoryActivityFilter, now: Date): boolean {
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
  collapsed,
  currentCapabilityId,
}: {
  history: TesterRunHistory | null;
  activeRunId: string | null;
  onSelectRun: (record: TesterRunHistoryRecord) => void;
  collapsed: boolean;
  currentCapabilityId: TesterCapabilityId;
}) {
  const rendererHost = useTesterRendererHost();
  const { t, i18n } = useTranslation();
  const historyLoad = useContext(TesterHistoryLoadContext);
  const historyActions = useContext(TesterHistoryActionsContext);
  const historyPanel = useContext(TesterHistoryPanelContext);
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<HistoryFilterMenuId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const scope: TesterHistoryPanelScope = historyPanel?.scope ?? 'capability';
  const hideFailures = historyPanel?.hideFailures ?? false;
  const setScope = (next: TesterHistoryPanelScope) => {
    setClearArmed(false);
    historyPanel?.setScope(next);
  };
  const setHideFailures = (next: boolean) => historyPanel?.setHideFailures(next);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<TesterCapabilityId | 'all'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState<HistoryEnvironmentFilter>('all');
  const [activityFilter, setActivityFilter] = useState<HistoryActivityFilter>('all');
  const [groupBy, setGroupBy] = useState<HistoryGroupBy>('none');
  const [sortBy, setSortBy] = useState<HistorySortBy>('recency');
  const now = useMemo(() => new Date(rendererHost.clock.now()), [history, rendererHost]);
  const query = searchQuery.trim().toLowerCase();
  const records = useMemo(() => flattenTesterRunHistory(history)
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
      : left.createdAt.localeCompare(right.createdAt)), [activityFilter, capabilityFilter, currentCapabilityId, environmentFilter, hideFailures, history, now, query, scope, sortBy, statusFilter]);
  const mediaRecords = useMemo(() => (historyPanel?.imageRecords ?? [])
    .filter((record) => !hideFailures || record.status === 'ready')
    .filter((record) => matchesMediaSearch(record, query))
    .filter((record) => matchesHistoryActivity(record, activityFilter, now)), [activityFilter, hideFailures, historyPanel?.imageRecords, now, query]);

  function handleSelectMediaRecord(record: TesterImageHistoryRecord) {
    const linkageId = record.runId || record.id;
    const runRecord = flattenTesterRunHistory(history).find((entry) => entry.id === linkageId);
    if (!runRecord) {
      nimiToast.warning(t('History.linkedRunMissing'));
      return;
    }
    onSelectRun(runRecord);
  }

  function handleRemoveRecord(record: TesterRunHistoryRecord) {
    void historyActions?.removeRecord(record.id);
  }

  function handleClearScope() {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    void historyActions?.clearScope(scope === 'capability' ? currentCapabilityId : null);
  }

  function historySourceLabelForRun(record: TesterRunHistoryRecord): string {
    const source = getTesterRunIntentSource(record);
    if (source === 'local') return t('History.source.local');
    if (source === 'cloud') return t('History.source.cloud');
    return t('History.source.unknown');
  }

  function historySubtitleForRun(record: TesterRunHistoryRecord): string {
    const intent = getTesterRunIntentLabel(record);
    const source = historySourceLabelForRun(record);
    if (isFailureHistoryStatus(record)) {
      return [t('History.failed'), intent, source, historyFailureReasonForRun(record)].filter(Boolean).join(' / ');
    }
    return [intent, source].filter(Boolean).join(' / ');
  }

  function historyLabelForRun(record: TesterFlatRunRecord): string {
    const prompt = historyTitleForRun(record);
    const intent = getTesterRunIntentLabel(record);
    const source = getTesterRunIntentSource(record);
    const metrics = getTesterRunMetricSummary(record);
    return [
      prompt ? t('History.runAriaPrompt', { prompt }) : '',
      source === 'unknown' ? intent : t('History.runAriaIntent', { source: historySourceLabelForRun(record), intent }),
      historyCapabilityLabel(record.capabilityId as TesterCapabilityId),
      formatTesterRunHistoryTimestamp(record.createdAt, now),
      metrics,
    ].filter(Boolean).join(' / ');
  }

  function optionLabel<T extends string>(options: ReadonlyArray<{ id: T; labelKey: string }>, id: T): string {
    const option = options.find((entry) => entry.id === id);
    return option ? t(option.labelKey) : id;
  }

  function historyCapabilityLabel(id: TesterCapabilityId | 'all'): string {
    if (id === 'all') return t('History.filters.capability.all');
    const capability = runtimeHistoryCapabilities.find((entry) => entry.id === id);
    return capability ? t(capability.labelKey) : id;
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
    if (groupBy === 'none') return [{ id: 'all', label: '', records }];
    const grouped = new Map<string, { id: string; label: string; records: TesterFlatRunRecord[] }>();
    for (const record of records) {
      const label = groupBy === 'date' ? historyDateGroupLabel(record.createdAt) : historyCapabilityLabel(record.capabilityId as TesterCapabilityId);
      const id = groupBy === 'date' ? `date:${label}` : `capability:${record.capabilityId}`;
      const existing = grouped.get(id);
      if (existing) {
        existing.records.push(record);
      } else {
        grouped.set(id, { id, label, records: [record] });
      }
    }
    return [...grouped.values()];
  }, [groupBy, now, records, locale, t]);
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
          <HistoryFilterOption key={capability.id} label={t(capability.labelKey)} selected={capabilityFilter === capability.id} onSelect={() => setCapabilityFilter(capability.id)} />
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

  return (
    <div className={collapsed ? 'studio-history-shell studio-history-shell--collapsed' : 'studio-history-shell'}>
      <aside className={collapsed ? 'studio-history studio-history--collapsed' : 'studio-history'} aria-label={t('History.panelAriaLabel')}>
        <div className="studio-recent__head">
          <div className="studio-history__title">
            <strong>{t('History.title')}</strong>
          </div>
          <div className="studio-history__actions">
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
          {scope !== 'media' && historyActions ? (
            <Button
              type="button"
              tone="ghost"
              size="sm"
              className={clearArmed ? 'studio-history__scope-option studio-history__scope-option--danger' : 'studio-history__scope-option'}
              onClick={handleClearScope}
              onBlur={() => setClearArmed(false)}
            >
              {clearArmed ? t('History.clearScopeConfirm') : t('History.clearScope')}
            </Button>
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
                {mediaRecords.map((record) => (
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
                        {record.url ? <img src={record.url} alt="" loading="lazy" /> : <Sparkles size={16} strokeWidth={1.9} />}
                      </span>
                      <span className="studio-recent__copy">
                        <span className="studio-recent__summary">
                          <span className="studio-recent__title">
                            <Tooltip content={record.title} placement="top" className="studio-recent__intent-tooltip">
                              <span className="studio-recent__intent-name">{record.title}</span>
                            </Tooltip>
                            <time dateTime={record.createdAt}>{formatTesterRunHistoryTimestamp(record.createdAt, now)}</time>
                          </span>
                        </span>
                        <span className="studio-recent__detail">
                          {[record.capabilityLabel, record.artifactLabel].filter(Boolean).join(' / ')}
                        </span>
                      </span>
                    </Button>
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
                    const capability = runtimeHistoryCapabilities.find((item) => item.id === record.capabilityId);
                    const Icon = capability ? capabilityIcons[capability.id] : Sparkles;
                    return (
                      <li key={record.id}>
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
                                <Tooltip content={historyTitleForRun(record)} placement="top" className="studio-recent__intent-tooltip">
                                  <span className="studio-recent__intent-name">{historyTitleForRun(record)}</span>
                                </Tooltip>
                                <time dateTime={record.createdAt}>{formatTesterRunHistoryTimestamp(record.createdAt, now)}</time>
                              </span>
                            </span>
                            <Tooltip content={historySubtitleForRun(record)} placement="top" className="studio-recent__detail-tooltip">
                              <span className={isFailureHistoryStatus(record) ? 'studio-recent__detail studio-recent__detail--failed' : 'studio-recent__detail'}>
                                {historySubtitleForRun(record)}
                              </span>
                            </Tooltip>
                          </span>
                        </Button>
                        {historyActions ? (
                          <Tooltip content={t('History.deleteRun')} placement="left">
                            <IconButton
                              type="button"
                              tone="ghost"
                              size="sm"
                              className="studio-recent__row-delete"
                              aria-label={t('History.deleteRun')}
                              onClick={() => handleRemoveRecord(record)}
                              icon={<Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />}
                            />
                          </Tooltip>
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
        </div>
      </aside>
    </div>
  );
}
