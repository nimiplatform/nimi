import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, SegmentedControl, Surface, Tooltip, cn } from '@nimiplatform/kit/ui';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { buildAuditDiagnosticsText } from './runtime-config-audit-view-model.js';
import { Button } from './runtime-config-primitives.js';
import { useAuditPageData } from './runtime-config-use-audit-page-data.js';
import {
  AuditTableRow,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  EventTypePill,
  FacetPill,
  IconButton,
  RefreshIcon,
  SearchIcon,
  auditEventTypeColor,
} from './runtime-config-local-debug-controls.js';
import {
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
} from './runtime-config-runtime-page-ui.js';

type QuickRangeKey = 'all' | '15m' | '1h' | '24h' | 'custom';

const QUICK_RANGE_MS: Record<Exclude<QuickRangeKey, 'all' | 'custom'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

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
  const i18n = useDesktopI18nResource();
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
            <Tooltip content={i18n.formatDateTime(latestEvent.occurredAt)} placement="top">
              <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.runtime.auditLatestShort', {
                  value: i18n.formatRelativeTime(latestEvent.occurredAt),
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
  const i18n = useDesktopI18nResource();
  const bindings = useDesktopRendererBindings();
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
  const clearCopiedCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    clearCopiedCancelRef.current?.();
    clearCopiedCancelRef.current = null;
  }, []);

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
    const from = new Date(bindings.clock.now() - durationMs);
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
    const text = buildAuditDiagnosticsText(filteredAudits, t);
    void bindings.app.commands.writeClipboardText(text).then(() => {
      setCopiedAll(true);
      clearCopiedCancelRef.current?.();
      clearCopiedCancelRef.current = bindings.clock.schedule(1_500, () => {
        clearCopiedCancelRef.current = null;
        setCopiedAll(false);
      });
    }).catch(() => undefined);
  };

  const onExport = () => {
    bindings.app.commands.exportRuntimeAuditJson({
      filename: `local-ai-audits-${new Date(bindings.clock.now()).toISOString()}.json`,
      content: JSON.stringify(filteredAudits, null, 2),
    });
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
              <Tooltip content={i18n.formatDateTime(latestEvent.occurredAt)} placement="top">
                <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.runtime.auditLatestShort', {
                    value: i18n.formatRelativeTime(latestEvent.occurredAt),
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

        <SegmentedControl
          size="sm"
          ariaLabel={t('runtimeConfig.runtime.auditEventsTitle', { defaultValue: 'Debug audit' })}
          items={filterTabs.map((tab) => ({ value: tab.key, label: tab.label }))}
          value={quickRange}
          onValueChange={(value) => applyQuickRange(value as QuickRangeKey)}
        />

        <div className="flex items-center gap-0.5">
          <IconButton
            size="md"
            icon={<RefreshIcon className={loadingAudits ? 'animate-spin' : ''} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loadingAudits}
            onClick={() => void loadAudits()}
          />
          <IconButton
            size="md"
            icon={copiedAll ? <CheckIcon /> : <CopyIcon />}
            title={copiedAll
              ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
              : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
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
          <span className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
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
              'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[length:var(--nimi-type-caption-size)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
              TOKEN_TEXT_PRIMARY,
            )}
          />
          <span className={cn('text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>→</span>
          <input
            type="datetime-local"
            value={auditTimeTo}
            onChange={(event) => {
              const next = event.target.value;
              setAuditTimeTo(next);
              void loadAudits({ timeTo: next });
            }}
            className={cn(
              'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 text-[length:var(--nimi-type-caption-size)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
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
            className={cn('ml-auto text-[length:var(--nimi-type-caption-size)] font-medium transition-colors hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_MUTED)}
          >
            {t('runtimeConfig.runtime.auditRangeClear', { defaultValue: 'Clear' })}
          </button>
        </div>
      ) : (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setShowCustomRange(true)}
            className={cn('text-[length:var(--nimi-type-caption-size)] font-medium transition-colors hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_MUTED)}
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
        <span className={cn('mr-1 text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
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
          <span className={cn('mr-1 text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
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
              'grid grid-cols-[72px_minmax(220px,1.6fr)_minmax(130px,0.9fr)_minmax(170px,1.3fr)_minmax(140px,1.2fr)_24px] items-center gap-x-3 gap-y-0 border-b border-[var(--nimi-border-subtle)] px-3 pb-2 text-left text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]',
              TOKEN_TEXT_MUTED,
            )}>
              <span>{t('runtimeConfig.runtime.auditColTime', { defaultValue: 'Time' })}</span>
              <span>{t('runtimeConfig.runtime.auditColType', { defaultValue: 'Type' })}</span>
              <span>{t('runtimeConfig.runtime.auditColSource', { defaultValue: 'Source' })}</span>
              <span>{t('runtimeConfig.runtime.auditColTarget', { defaultValue: 'Target' })}</span>
              <span>{t('runtimeConfig.runtime.auditColReason', { defaultValue: 'Reason' })}</span>
              <span />
            </div>
            <ScrollArea className="max-h-[calc(100cqh-30rem)]" viewportClassName="max-h-[calc(100cqh-30rem)]">
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
