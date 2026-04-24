import { useMemo, useState } from 'react';
import type { LocalRuntimeAuditEvent } from '@runtime/local-runtime';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { formatLocaleDateTime, formatRelativeLocaleTime } from '@renderer/i18n';
import {
  buildAuditDiagnosticsText,
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
} from './runtime-config-audit-view-model.js';
import { Button } from './runtime-config-primitives.js';
import { useAuditPageData } from './runtime-config-use-audit-page-data.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

type QuickRangeKey = 'all' | '15m' | '1h' | '24h' | 'custom';

const QUICK_RANGE_MS: Record<Exclude<QuickRangeKey, 'all' | 'custom'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

function auditEventTypeColor(eventType: string): string {
  if (eventType.endsWith('_failed')) return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)] border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)]';
  if (eventType.endsWith('_completed') || eventType.endsWith('_ready') || eventType.endsWith('_after_install'))
    return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)] border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)]';
  if (eventType.endsWith('_started') || eventType.endsWith('_invoked') || eventType.endsWith('_listed'))
    return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  if (eventType.startsWith('fallback_')) return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)] border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)] border-[var(--nimi-border-subtle)]';
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'animate-spin' : ''}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon({ expanded, size = 14 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform duration-200', expanded ? 'rotate-180' : 'rotate-0')}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconButton({
  icon,
  title,
  disabled,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'success';
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          tone === 'success'
            ? 'text-[var(--nimi-status-success)] hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)]'
            : 'text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

type LocalDebugSectionProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function LocalDebugSection({ collapsed, onToggle }: LocalDebugSectionProps) {
  return (
    <section className="mt-6">
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'overflow-hidden')}>
        {collapsed ? (
          <CollapsedHeader onExpand={onToggle} />
        ) : (
          <LocalDebugContent onCollapse={onToggle} />
        )}
      </Surface>
    </section>
  );
}

function CollapsedHeader({ onExpand }: { onExpand: () => void }) {
  const { t } = useTranslation();
  const data = useAuditPageData(true);
  const latestEvent = data.filteredAudits.length > 0 ? data.filteredAudits[0] : null;

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-[var(--nimi-surface-panel)]/30"
    >
      <div className="min-w-0">
        <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
          {t('runtimeConfig.runtime.auditEventsTitle', { defaultValue: 'Debug audit' })}
        </h3>
        <p className={cn('mt-0.5 text-xs', TOKEN_TEXT_MUTED)}>
          {t('runtimeConfig.runtime.auditEventsSubtitle', { defaultValue: 'Local-only event stream · 5k buffer' })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={cn('text-xs', TOKEN_TEXT_SECONDARY)}>
          <span className={cn('font-semibold', TOKEN_TEXT_PRIMARY)}>{data.filteredAudits.length}</span>{' '}
          {t('runtimeConfig.runtime.auditEventsCount', { defaultValue: 'events' })}
        </span>
        {latestEvent ? (
          <>
            <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>·</span>
            <Tooltip content={formatLocaleDateTime(latestEvent.occurredAt)} placement="top">
              <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.runtime.auditLatestShort', {
                  value: formatRelativeLocaleTime(latestEvent.occurredAt),
                  defaultValue: 'latest {{value}}',
                })}
              </span>
            </Tooltip>
          </>
        ) : null}
        <span className={cn('transition-colors', TOKEN_TEXT_MUTED)}>
          <ChevronIcon expanded={false} size={16} />
        </span>
      </div>
    </button>
  );
}

function LocalDebugContent({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useTranslation();
  const data = useAuditPageData(true);
  const {
    filteredAudits,
    loadingAudits,
    auditEventType,
    setAuditEventType,
    auditSource,
    setAuditSource,
    auditModality,
    setAuditModality,
    auditReasonCodeQuery,
    setAuditReasonCodeQuery,
    auditTimeFrom,
    setAuditTimeFrom,
    auditTimeTo,
    setAuditTimeTo,
    loadAudits,
    eventTypeCounts,
    sourceCounts,
    modalityCounts,
  } = data;

  const [quickRange, setQuickRange] = useState<QuickRangeKey>('all');
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const latestEvent = filteredAudits.length > 0 ? filteredAudits[0] : null;

  const applyQuickRange = (key: QuickRangeKey) => {
    setQuickRange(key);
    if (key === 'all') {
      setAuditTimeFrom('');
      setAuditTimeTo('');
      setShowCustomRange(false);
      void loadAudits({ timeFrom: '', timeTo: '' });
      return;
    }
    if (key === 'custom') {
      setShowCustomRange(true);
      return;
    }
    const durationMs = QUICK_RANGE_MS[key];
    const from = new Date(Date.now() - durationMs);
    const yyyy = from.getFullYear();
    const mm = String(from.getMonth() + 1).padStart(2, '0');
    const dd = String(from.getDate()).padStart(2, '0');
    const hh = String(from.getHours()).padStart(2, '0');
    const mi = String(from.getMinutes()).padStart(2, '0');
    const localValue = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    setAuditTimeFrom(localValue);
    setAuditTimeTo('');
    setShowCustomRange(false);
    void loadAudits({ timeFrom: localValue, timeTo: '' });
  };

  const onCopyAll = () => {
    const text = buildAuditDiagnosticsText(filteredAudits);
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1500);
    }).catch(() => undefined);
  };

  const onExport = () => {
    if (typeof document === 'undefined') return;
    const text = JSON.stringify(filteredAudits, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `local-ai-audits-${new Date().toISOString()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const filterTabs: Array<{ key: QuickRangeKey; label: string }> = [
    { key: '15m', label: t('runtimeConfig.runtime.auditRange15m', { defaultValue: '15m' }) },
    { key: '1h', label: t('runtimeConfig.runtime.auditRange1h', { defaultValue: '1h' }) },
    { key: '24h', label: t('runtimeConfig.runtime.auditRange24h', { defaultValue: '24h' }) },
    { key: 'all', label: t('runtimeConfig.runtime.auditRangeAll', { defaultValue: 'All' }) },
  ];

  const totalEventCount = filteredAudits.length;

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
            {t('runtimeConfig.runtime.auditEventsTitle', { defaultValue: 'Debug audit' })}
          </h3>
          <p className={cn('mt-0.5 text-xs', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.auditEventsSubtitle', { defaultValue: 'Local-only event stream · 5k buffer' })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn('text-xs', TOKEN_TEXT_SECONDARY)}>
            <span className={cn('font-semibold', TOKEN_TEXT_PRIMARY)}>{totalEventCount}</span>{' '}
            {t('runtimeConfig.runtime.auditEventsCount', { defaultValue: 'events' })}
          </span>
          {latestEvent ? (
            <>
              <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>·</span>
              <Tooltip content={formatLocaleDateTime(latestEvent.occurredAt)} placement="top">
                <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.runtime.auditLatestShort', {
                    value: formatRelativeLocaleTime(latestEvent.occurredAt),
                    defaultValue: 'latest {{value}}',
                  })}
                </span>
              </Tooltip>
            </>
          ) : null}
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('runtimeConfig.runtime.clickToCollapse', { defaultValue: 'Collapse' })}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]',
              TOKEN_TEXT_MUTED,
            )}
          >
            <ChevronIcon expanded size={16} />
          </button>
        </div>
      </div>

      {/* Toolbar: search + quick range + actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className={cn('pointer-events-none absolute left-3 top-1/2 -translate-y-1/2', TOKEN_TEXT_MUTED)}>
            <SearchIcon />
          </span>
          <input
            value={auditReasonCodeQuery}
            onChange={(event) => {
              const next = event.target.value;
              setAuditReasonCodeQuery(next);
              void loadAudits({ reasonCode: next });
            }}
            placeholder={t('runtimeConfig.runtime.auditSearchPlaceholder', {
              defaultValue: 'Filter by modelKey, modelId, reason…',
            })}
            className={cn(
              'h-9 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] pl-9 pr-3 text-xs outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
              TOKEN_TEXT_PRIMARY,
            )}
          />
        </div>

        <div className="inline-flex items-center rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-0.5">
          {filterTabs.map((tab) => {
            const isActive = tab.key === quickRange;
            return (
              <button
                key={`quick-range-${tab.key}`}
                type="button"
                onClick={() => applyQuickRange(tab.key)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                    : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton
            icon={<RefreshIcon spinning={loadingAudits} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loadingAudits}
            onClick={() => void loadAudits()}
          />
          <IconButton
            icon={copiedAll ? <CheckIcon /> : <CopyIcon />}
            title={copiedAll
              ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
              : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
            tone={copiedAll ? 'success' : undefined}
            onClick={onCopyAll}
          />
        </div>

        <Button variant="secondary" size="sm" onClick={onExport}>
          {t('runtimeConfig.runtime.export', { defaultValue: 'Export' })}
        </Button>
      </div>

      {/* Optional custom datetime range */}
      {showCustomRange ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3">
          <span className={cn('text-[11px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.auditCustomRange', { defaultValue: 'Custom range' })}
          </span>
          <input
            type="datetime-local"
            value={auditTimeFrom}
            onChange={(event) => {
              const next = event.target.value;
              setAuditTimeFrom(next);
              void loadAudits({ timeFrom: next });
            }}
            className={cn(
              'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[11px] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
              TOKEN_TEXT_PRIMARY,
            )}
          />
          <span className={cn('text-[11px]', TOKEN_TEXT_MUTED)}>→</span>
          <input
            type="datetime-local"
            value={auditTimeTo}
            onChange={(event) => {
              const next = event.target.value;
              setAuditTimeTo(next);
              void loadAudits({ timeTo: next });
            }}
            className={cn(
              'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[11px] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
              TOKEN_TEXT_PRIMARY,
            )}
          />
          <button
            type="button"
            onClick={() => {
              setShowCustomRange(false);
              setAuditTimeFrom('');
              setAuditTimeTo('');
              setQuickRange('all');
              void loadAudits({ timeFrom: '', timeTo: '' });
            }}
            className={cn('ml-auto text-[11px] font-medium transition-colors hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_MUTED)}
          >
            {t('runtimeConfig.runtime.auditRangeClear', { defaultValue: 'Clear' })}
          </button>
        </div>
      ) : (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setShowCustomRange(true)}
            className={cn('text-[11px] font-medium transition-colors hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_MUTED)}
          >
            {t('runtimeConfig.runtime.auditCustomRangeShow', { defaultValue: 'Custom range…' })}
          </button>
        </div>
      )}

      {/* Event type pills */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <EventTypePill
          label={t('runtimeConfig.runtime.allEventTypesShort', { defaultValue: 'All' })}
          count={totalEventCount}
          active={auditEventType === 'all'}
          onClick={() => {
            setAuditEventType('all');
            void loadAudits({ eventType: 'all' });
          }}
          dark
        />
        {eventTypeCounts.map((item) => (
          <EventTypePill
            key={`event-type-${item.eventType}`}
            label={item.eventType}
            count={item.count}
            active={auditEventType === item.eventType}
            onClick={() => {
              const next = auditEventType === item.eventType ? 'all' : item.eventType;
              setAuditEventType(next);
              void loadAudits({ eventType: next });
            }}
            className={auditEventTypeColor(item.eventType)}
          />
        ))}
      </div>

      {/* Source row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={cn('mr-1 text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
          {t('runtimeConfig.runtime.auditSourceLabel', { defaultValue: 'Source' })}
        </span>
        <FacetPill
          label={t('runtimeConfig.runtime.allSourcesShort', { defaultValue: 'all' })}
          active={auditSource === 'all'}
          onClick={() => {
            setAuditSource('all');
            void loadAudits({ source: 'all' });
          }}
        />
        {sourceCounts.map((item) => (
          <FacetPill
            key={`source-${item.source}`}
            label={item.source}
            count={item.count}
            active={auditSource === item.source}
            onClick={() => {
              const next = auditSource === item.source ? 'all' : item.source;
              setAuditSource(next);
              void loadAudits({ source: next });
            }}
          />
        ))}
      </div>

      {/* Modality row */}
      {modalityCounts.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={cn('mr-1 text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.auditModalityLabel', { defaultValue: 'Modality' })}
          </span>
          <FacetPill
            label={t('runtimeConfig.runtime.allModalitiesShort', { defaultValue: 'all' })}
            active={auditModality === 'all'}
            onClick={() => {
              setAuditModality('all');
              void loadAudits({ modality: 'all' });
            }}
          />
          {modalityCounts.map((item) => (
            <FacetPill
              key={`modality-${item.modality}`}
              label={item.modality}
              count={item.count}
              active={auditModality === item.modality}
              onClick={() => {
                const next = auditModality === item.modality ? 'all' : item.modality;
                setAuditModality(next);
                void loadAudits({ modality: next });
              }}
            />
          ))}
        </div>
      ) : null}

      {/* Table */}
      <div className="mt-5">
        {filteredAudits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] py-10 text-center">
            <p className={cn('text-sm', TOKEN_TEXT_SECONDARY)}>
              {t('runtimeConfig.runtime.noLocalAuditEvents', {
                defaultValue: 'No local audit events matching current filters.',
              })}
            </p>
          </div>
        ) : (
          <>
            <div className={cn(
              'grid grid-cols-[72px_minmax(220px,1.6fr)_minmax(130px,0.9fr)_minmax(170px,1.3fr)_minmax(140px,1.2fr)_24px] items-center gap-x-3 gap-y-0 border-b border-[var(--nimi-border-subtle)] px-3 pb-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em]',
              TOKEN_TEXT_MUTED,
            )}>
              <span>{t('runtimeConfig.runtime.auditColTime', { defaultValue: 'Time' })}</span>
              <span>{t('runtimeConfig.runtime.auditColType', { defaultValue: 'Type' })}</span>
              <span>{t('runtimeConfig.runtime.auditColSource', { defaultValue: 'Source' })}</span>
              <span>{t('runtimeConfig.runtime.auditColTarget', { defaultValue: 'Target' })}</span>
              <span>{t('runtimeConfig.runtime.auditColReason', { defaultValue: 'Reason' })}</span>
              <span />
            </div>
            <ScrollArea className="max-h-[calc(100vh-30rem)]" viewportClassName="max-h-[calc(100vh-30rem)]">
              <div className="divide-y divide-[var(--nimi-border-subtle)]/50">
                {filteredAudits.map((event) => (
                  <AuditTableRow key={event.id} event={event} />
                ))}
              </div>
            </ScrollArea>
            <p className={cn('mt-3 text-center text-xs', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.runtime.auditShowingSummary', {
                count: filteredAudits.length,
                defaultValue: 'Showing {{count}} matches',
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function EventTypePill({
  label,
  count,
  active,
  onClick,
  className,
  dark,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  className?: string;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
        active
          ? dark
            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
            : 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
          : cn(
            'hover:-translate-y-[0.5px]',
            className || 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]',
          ),
      )}
    >
      <span className="font-mono">{label}</span>
      <span className={cn(
        'rounded-full px-1.5 text-[10px] font-semibold',
        active
          ? 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_22%,transparent)]'
          : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)]',
      )}>
        {count}
      </span>
    </button>
  );
}

function FacetPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
          : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span className={cn(
          'rounded-full px-1.5 text-[10px] font-semibold',
          active
            ? 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_22%,transparent)]'
            : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)]',
        )}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function AuditTableRow({ event }: { event: LocalRuntimeAuditEvent }) {
  const [expanded, setExpanded] = useState(false);

  const source = resolveAuditSource(event);
  const modality = resolveAuditModality(event);
  const reasonCode = resolveAuditReasonCode(event);
  const detail = resolveAuditDetail(event);
  const policyGate = resolveAuditPolicyGate(event);
  const target = event.modelId || event.localModelId || (detail !== '-' ? detail : '—');
  const reasonDisplay = reasonCode !== '-' ? reasonCode : detail !== '-' ? detail : '—';

  const colorClass = auditEventTypeColor(event.eventType);

  const extraMeta = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (event.modelId) rows.push({ label: 'modelId', value: event.modelId });
    if (event.localModelId) rows.push({ label: 'localModelId', value: event.localModelId });
    if (detail !== '-' && detail !== event.modelId && detail !== event.localModelId) {
      rows.push({ label: 'detail', value: detail });
    }
    if (reasonCode !== '-') rows.push({ label: 'reasonCode', value: reasonCode });
    if (policyGate !== '-') rows.push({ label: 'policyGate', value: policyGate });
    rows.push({ label: 'occurredAt', value: event.occurredAt });
    rows.push({ label: 'modality', value: modality });
    return rows;
  }, [event, detail, reasonCode, policyGate, modality]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="grid w-full grid-cols-[72px_minmax(220px,1.6fr)_minmax(130px,0.9fr)_minmax(170px,1.3fr)_minmax(140px,1.2fr)_24px] items-center gap-x-3 gap-y-0 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[var(--nimi-surface-panel)]/40"
      >
        <span
          title={event.occurredAt}
          className={cn('block truncate text-left text-xs', TOKEN_TEXT_SECONDARY)}
        >
          {formatRelativeLocaleTime(event.occurredAt)}
        </span>
        <span className={cn('inline-flex max-w-full items-center gap-1 justify-self-start self-center truncate rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium', colorClass)}>
          <span className="truncate">{event.eventType}</span>
        </span>
        <span className={cn('block truncate text-left font-mono text-[11px]', TOKEN_TEXT_SECONDARY)} title={source}>
          {source}
        </span>
        <span className={cn('block truncate text-left font-mono text-[11px]', TOKEN_TEXT_SECONDARY)} title={target}>
          {target}
        </span>
        <span className={cn('block truncate text-left text-[11px]', TOKEN_TEXT_SECONDARY)} title={reasonDisplay}>
          {reasonDisplay}
        </span>
        <span className={cn('text-[var(--nimi-text-muted)]')}>
          <ChevronIcon expanded={expanded} />
        </span>
      </button>
      {expanded ? (
        <div className="mx-3 mb-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
            {extraMeta.map((row) => (
              <div key={`${event.id}-${row.label}`} className="min-w-0">
                <dt className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
                  {row.label}
                </dt>
                <dd className={cn('mt-0.5 truncate font-mono', TOKEN_TEXT_PRIMARY)} title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {event.payload && Object.keys(event.payload).length > 0 ? (
            <div className="mt-3">
              <p className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>payload</p>
              <pre className={cn('mt-1 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-2.5 py-2 font-mono text-[11px] leading-relaxed', TOKEN_TEXT_SECONDARY)}>
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
