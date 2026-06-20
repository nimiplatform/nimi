import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from '@nimiplatform/kit/ui';
import { Check, ChevronRight, Funnel, RefreshCw, Sparkles } from 'lucide-react';
import { testerCapabilities, type TesterCapabilityId } from '../tester-capabilities.js';
import {
  flattenTesterRunHistory,
  formatTesterRunHistoryTimestamp,
  getTesterRunMetricSummary,
  getTesterRunModelLabel,
  getTesterRunModelSource,
  getTesterRunPromptSummary,
  getTesterRunResultSummary,
  getTesterRunStatusTone,
  type TesterFlatRunRecord,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from '../tester-history.js';
import { capabilityIcons } from './capability-icons.js';

type HistoryStatusFilter = 'all' | 'active' | 'blocked' | 'local-fixture';
type HistoryEnvironmentFilter = 'all' | 'local' | 'cloud' | 'remote-control';
type HistoryActivityFilter = 'all' | 'today' | '7d' | '30d';
type HistoryGroupBy = 'none' | 'date' | 'capability';
type HistorySortBy = 'recency' | 'oldest';
type HistoryFilterMenuId = 'status' | 'capability' | 'environment' | 'activity' | 'group' | 'sort';

const runtimeHistoryCapabilities = testerCapabilities.filter((item) => item.execution === 'runtime-sdk' || item.execution === 'standalone-tauri');
const runtimeHistoryCapabilityIds = new Set(runtimeHistoryCapabilities.map((capability) => capability.id));
const historyDateGroupFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const historyDateGroupWithYearFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const HISTORY_STATUS_OPTIONS: ReadonlyArray<{ id: HistoryStatusFilter; label: string }> = [
  { id: 'all', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'local-fixture', label: 'Local fixture' },
];

const HISTORY_ENVIRONMENT_OPTIONS: ReadonlyArray<{ id: HistoryEnvironmentFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'local', label: 'Local' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'remote-control', label: 'Remote Control' },
];

const HISTORY_ACTIVITY_OPTIONS: ReadonlyArray<{ id: HistoryActivityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

const HISTORY_GROUP_OPTIONS: ReadonlyArray<{ id: HistoryGroupBy; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'date', label: 'Date' },
  { id: 'capability', label: 'Capability' },
];

const HISTORY_SORT_OPTIONS: ReadonlyArray<{ id: HistorySortBy; label: string }> = [
  { id: 'recency', label: 'Recency' },
  { id: 'oldest', label: 'Oldest' },
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

function historyModelTitleForRun(record: TesterRunHistoryRecord): string {
  return getTesterRunModelLabel(record);
}

function historySourceLabelForRun(record: TesterRunHistoryRecord): string {
  const source = getTesterRunModelSource(record);
  if (source === 'local') return 'Local';
  if (source === 'cloud') return 'Cloud';
  return 'Unknown';
}

function historyFailureReasonForRun(record: TesterRunHistoryRecord): string {
  const result = record.result;
  if (result && result.ok === false) {
    return result.reason || result.summary || record.message;
  }
  return getTesterRunResultSummary(record);
}

function historySubtitleForRun(record: TesterRunHistoryRecord): string {
  const source = historySourceLabelForRun(record);
  if (record.status === 'failed' || record.status === 'unavailable') {
    return ['Failed', source, historyFailureReasonForRun(record)].filter(Boolean).join(' / ');
  }
  return source;
}

function historyLabelForRun(record: TesterFlatRunRecord): string {
  const prompt = historyTitleForRun(record);
  const model = getTesterRunModelLabel(record);
  const source = getTesterRunModelSource(record);
  const metrics = getTesterRunMetricSummary(record);
  return [source === 'unknown' ? model : `${source} model: ${model}`, record.capabilityLabel, formatTesterRunHistoryTimestamp(record.createdAt), metrics, prompt ? `Prompt: ${prompt}` : ''].filter(Boolean).join(' / ');
}

function optionLabel<T extends string>(options: ReadonlyArray<{ id: T; label: string }>, id: T): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

function historyCapabilityLabel(id: TesterCapabilityId | 'all'): string {
  if (id === 'all') return 'All';
  return runtimeHistoryCapabilities.find((capability) => capability.id === id)?.label ?? id;
}

function isSameHistoryDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function historyDateGroupLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Unknown date';
  if (isSameHistoryDate(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameHistoryDate(date, yesterday)) return 'Yesterday';
  if (date.getFullYear() === now.getFullYear()) return historyDateGroupFormatter.format(date);
  return historyDateGroupWithYearFormatter.format(date);
}

function matchesHistoryStatus(record: TesterRunHistoryRecord, status: HistoryStatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'active') return record.status === 'ready';
  if (status === 'blocked') return record.status === 'failed' || record.status === 'unavailable';
  return record.status === 'local-fixture';
}

function matchesHistoryEnvironment(record: TesterRunHistoryRecord, environment: HistoryEnvironmentFilter): boolean {
  if (environment === 'all') return true;
  const source = getTesterRunModelSource(record);
  if (environment === 'local' || environment === 'cloud') return source === environment;
  const targetSource = String(record.runConfig?.target.source || '').toLowerCase();
  const routeDecision = record.result?.ok && 'routeDecision' in record.result ? String(record.result.routeDecision || '').toLowerCase() : '';
  return targetSource.includes('remote') || routeDecision.includes('remote');
}

function matchesHistoryActivity(record: TesterRunHistoryRecord, activity: HistoryActivityFilter, now = new Date()): boolean {
  if (activity === 'all') return true;
  const createdAt = new Date(record.createdAt);
  if (Number.isNaN(createdAt.valueOf())) return false;
  if (activity === 'today') return isSameHistoryDate(createdAt, now);
  const days = activity === '7d' ? 7 : 30;
  return now.valueOf() - createdAt.valueOf() <= days * 24 * 60 * 60 * 1000;
}

function groupedHistoryRecords(records: TesterFlatRunRecord[], groupBy: HistoryGroupBy): Array<{ id: string; label: string; records: TesterFlatRunRecord[] }> {
  if (groupBy === 'none') return [{ id: 'all', label: '', records }];
  const groups = new Map<string, { id: string; label: string; records: TesterFlatRunRecord[] }>();
  for (const record of records) {
    const label = groupBy === 'date' ? historyDateGroupLabel(record.createdAt) : record.capabilityLabel;
    const id = groupBy === 'date' ? `date:${label}` : `capability:${record.capabilityId}`;
    const existing = groups.get(id);
    if (existing) {
      existing.records.push(record);
    } else {
      groups.set(id, { id, label, records: [record] });
    }
  }
  return [...groups.values()];
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
    <button
      type="button"
      className={selected ? 'studio-history-filter__option studio-history-filter__option--selected' : 'studio-history-filter__option'}
      onClick={onSelect}
    >
      <span>{label}</span>
      {selected ? <Check size={17} strokeWidth={2} aria-hidden="true" /> : null}
    </button>
  );
}

export function CapabilityRunHistory({
  history,
  activeRunId,
  onSelectRun,
  collapsed,
  filterResetNonce,
}: {
  history: TesterRunHistory | null;
  activeRunId: string | null;
  onSelectRun: (record: TesterRunHistoryRecord) => void;
  collapsed: boolean;
  filterResetNonce: number;
}) {
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<HistoryFilterMenuId | null>(null);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<TesterCapabilityId | 'all'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState<HistoryEnvironmentFilter>('all');
  const [activityFilter, setActivityFilter] = useState<HistoryActivityFilter>('all');
  const [groupBy, setGroupBy] = useState<HistoryGroupBy>('none');
  const [sortBy, setSortBy] = useState<HistorySortBy>('recency');
  const now = useMemo(() => new Date(), [history]);
  const records = useMemo(() => flattenTesterRunHistory(history)
    .filter((record) => runtimeHistoryCapabilityIds.has(record.capabilityId as TesterCapabilityId))
    .filter((record) => capabilityFilter === 'all' || record.capabilityId === capabilityFilter)
    .filter((record) => matchesHistoryStatus(record, statusFilter))
    .filter((record) => matchesHistoryEnvironment(record, environmentFilter))
    .filter((record) => matchesHistoryActivity(record, activityFilter, now))
    .sort((left, right) => sortBy === 'recency'
      ? right.createdAt.localeCompare(left.createdAt)
      : left.createdAt.localeCompare(right.createdAt)), [activityFilter, capabilityFilter, environmentFilter, history, now, sortBy, statusFilter]);
  const groups = useMemo(() => groupedHistoryRecords(records, groupBy), [groupBy, records]);
  const activeMenuLabel = {
    status: optionLabel(HISTORY_STATUS_OPTIONS, statusFilter),
    capability: historyCapabilityLabel(capabilityFilter),
    environment: optionLabel(HISTORY_ENVIRONMENT_OPTIONS, environmentFilter),
    activity: optionLabel(HISTORY_ACTIVITY_OPTIONS, activityFilter),
    group: optionLabel(HISTORY_GROUP_OPTIONS, groupBy),
    sort: optionLabel(HISTORY_SORT_OPTIONS, sortBy),
  } satisfies Record<HistoryFilterMenuId, string>;
  const hasActiveHistoryFilters = statusFilter !== 'all'
    || capabilityFilter !== 'all'
    || environmentFilter !== 'all'
    || activityFilter !== 'all'
    || groupBy !== 'none'
    || sortBy !== 'recency';
  const hasRecords = records.length > 0;

  useEffect(() => {
    if (!filterOpen) return;
    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (filterButtonRef.current?.contains(target) || filterPanelRef.current?.contains(target)) {
        return;
      }
      setFilterOpen(false);
      setActiveMenu(null);
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [filterOpen]);

  useEffect(() => {
    setFilterOpen(false);
    setActiveMenu(null);
  }, [filterResetNonce]);

  function renderSubmenu() {
    if (!activeMenu) {
      return null;
    }
    if (activeMenu === 'status') {
      return HISTORY_STATUS_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={option.label} selected={statusFilter === option.id} onSelect={() => setStatusFilter(option.id)} />
      ));
    }
    if (activeMenu === 'capability') {
      return [
        <HistoryFilterOption key="all" label="All capabilities" selected={capabilityFilter === 'all'} onSelect={() => setCapabilityFilter('all')} />,
        ...runtimeHistoryCapabilities.map((capability) => (
          <HistoryFilterOption key={capability.id} label={capability.label} selected={capabilityFilter === capability.id} onSelect={() => setCapabilityFilter(capability.id)} />
        )),
      ];
    }
    if (activeMenu === 'environment') {
      return HISTORY_ENVIRONMENT_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={option.label} selected={environmentFilter === option.id} onSelect={() => setEnvironmentFilter(option.id)} />
      ));
    }
    if (activeMenu === 'activity') {
      return HISTORY_ACTIVITY_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={option.label} selected={activityFilter === option.id} onSelect={() => setActivityFilter(option.id)} />
      ));
    }
    if (activeMenu === 'group') {
      return HISTORY_GROUP_OPTIONS.map((option) => (
        <HistoryFilterOption key={option.id} label={option.label} selected={groupBy === option.id} onSelect={() => setGroupBy(option.id)} />
      ));
    }
    return HISTORY_SORT_OPTIONS.map((option) => (
      <HistoryFilterOption key={option.id} label={option.label} selected={sortBy === option.id} onSelect={() => setSortBy(option.id)} />
    ));
  }

  function handleFilterToggle() {
    setFilterOpen((value) => {
      if (value) {
        setActiveMenu(null);
      }
      return !value;
    });
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
      <aside className={collapsed ? 'studio-history studio-history--collapsed' : 'studio-history'} aria-label="Runtime test History">
        <div className="studio-recent__head">
          <div className="studio-history__title">
            <strong>History</strong>
          </div>
          <div className="studio-history__actions">
            <button
              ref={filterButtonRef}
              type="button"
              className={filterOpen ? 'studio-history__filter-trigger studio-history__filter-trigger--active' : 'studio-history__filter-trigger'}
              aria-label="Filter history"
              aria-expanded={filterOpen}
              onClick={handleFilterToggle}
            >
              <Funnel size={18} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
        </div>
        {!collapsed && filterOpen ? (
          <div ref={filterPanelRef} className="studio-history-filter" role="dialog" aria-label="History filters">
            <div
              className="studio-history-filter__menu nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
              data-nimi-material="glass-regular"
              data-nimi-tone="overlay"
            >
              {([
                ['status', 'Status'],
                ['capability', 'Capability'],
                ['environment', 'Environment'],
                ['activity', 'Last activity'],
                ['group', 'Group by'],
                ['sort', 'Sort by'],
              ] as const).map(([id, label], index) => (
                <button
                  key={id}
                  type="button"
                  className={activeMenu === id ? 'studio-history-filter__row studio-history-filter__row--active' : 'studio-history-filter__row'}
                  aria-expanded={activeMenu === id}
                  data-divider={index === 4 ? '' : undefined}
                  onClick={() => setActiveMenu((value) => value === id ? null : id)}
                >
                  <span>{label}</span>
                  <strong>{activeMenuLabel[id]}</strong>
                  <ChevronRight size={17} strokeWidth={1.9} aria-hidden="true" />
                </button>
              ))}
              {hasActiveHistoryFilters ? (
                <button
                  type="button"
                  className="studio-history-filter__clear"
                  onClick={clearHistoryFilters}
                >
                  <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
                  <span>Clear all filters</span>
                </button>
              ) : null}
            </div>
            {activeMenu ? (
              <div
                className="studio-history-filter__submenu nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
                data-nimi-material="glass-regular"
                data-nimi-tone="overlay"
              >
                {renderSubmenu()}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="studio-history__runs">
          {hasRecords ? (
            groups.map((group) => (
              <section key={group.id} className="studio-history__group" aria-label={group.label ? `${group.label} runs` : 'Recent runs'}>
                {group.label ? <h2 className="studio-history__group-title">{group.label}</h2> : null}
                <ul className="studio-recent__rows">
                  {group.records.map((record) => {
                    const capability = runtimeHistoryCapabilities.find((item) => item.id === record.capabilityId);
                    const Icon = capability ? capabilityIcons[capability.id] : Sparkles;
                    return (
                      <li key={record.id}>
                        <button
                          type="button"
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
                                <Tooltip content={historyModelTitleForRun(record)} placement="top" className="studio-recent__model-tooltip">
                                  <span className="studio-recent__model-name">{historyModelTitleForRun(record)}</span>
                                </Tooltip>
                                <time dateTime={record.createdAt}>{formatTesterRunHistoryTimestamp(record.createdAt)}</time>
                              </span>
                            </span>
                            <Tooltip content={historySubtitleForRun(record)} placement="top" className="studio-recent__detail-tooltip">
                              <span className={record.status === 'failed' || record.status === 'unavailable' ? 'studio-recent__detail studio-recent__detail--failed' : 'studio-recent__detail'}>
                                {historySubtitleForRun(record)}
                              </span>
                            </Tooltip>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <p className="studio-history__empty">{history ? 'No runs match these filters' : 'No runs yet'}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
