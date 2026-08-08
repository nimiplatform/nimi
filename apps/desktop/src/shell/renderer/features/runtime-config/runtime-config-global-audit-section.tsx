import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesktopAuditEventProjection } from '@nimiplatform/sdk/runtime/wire-types';
import { CallerKind } from '@nimiplatform/sdk/runtime/wire-types';
import { Popover, PopoverContent, PopoverTrigger, ScrollArea, Surface, Tooltip, cn } from '@nimiplatform/kit/ui';
import { Button, RuntimeSelect } from './runtime-config-primitives.js';
import { IconButton, RefreshIcon, TOKEN_PANEL_CARD, TOKEN_TEXT_MUTED, TOKEN_TEXT_PRIMARY, TOKEN_TEXT_SECONDARY } from './runtime-config-runtime-page-ui.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  callerKindLabel,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';

const FILTER_INPUT_CLASS =
  'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-transparent px-2.5 text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]';

const DATE_TIME_TRIGGER_CLASS =
  'group flex h-8 min-w-[12rem] max-w-full items-center justify-between gap-2 rounded-lg border border-[var(--nimi-field-border)] bg-[color-mix(in_srgb,var(--nimi-field-bg)_84%,transparent)] px-2.5 text-left text-xs text-[var(--nimi-field-text)] outline-none transition-all hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_34%,var(--nimi-border-subtle))] hover:bg-[var(--nimi-field-bg)] focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] data-[state=open]:border-[var(--nimi-field-focus)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--nimi-focus-ring-color)]';

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' });
const DATE_TIME_DISPLAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type ReasonTone = 'success' | 'warning' | 'danger' | 'neutral';

const REASON_BADGE_CLASS: Record<ReasonTone, string> = {
  success: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  warning: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[var(--nimi-text-secondary)]',
};

function reasonTone(reasonCode: unknown): ReasonTone {
  const code = String(reasonCode || '').toLowerCase().trim();
  if (!code) return 'neutral';
  if (code === 'allowed' || code === 'ok' || code === 'success' || code === '0' || code === 'action_executed') return 'success';
  if (code.includes('denied') || code.includes('error') || code.includes('failed') || code.includes('timeout') || code.includes('refused') || code.includes('invalid') || code.includes('conflict')) {
    return 'danger';
  }
  if (code.includes('warn') || code.includes('stale') || code.includes('degraded') || code.includes('retry') || code.includes('not_registered') || code.includes('expired')) {
    return 'warning';
  }
  return 'neutral';
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M8 2v4M16 2v4M3 9h18" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  const path = direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6';
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

type DateTimeDraft = {
  date: Date;
  hour: number;
  minute: number;
};

type CalendarCell = {
  date: Date;
  outside: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateAtNoon(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function currentDateTimeDraft(nowMs: number): DateTimeDraft {
  const now = new Date(nowMs);
  return {
    date: localDateAtNoon(now.getFullYear(), now.getMonth(), now.getDate()),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

function parseDateTimeValue(value: string): DateTimeDraft | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = localDateAtNoon(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, hour, minute };
}

function formatDateTimeValue(draft: DateTimeDraft): string {
  return `${draft.date.getFullYear()}-${pad2(draft.date.getMonth() + 1)}-${pad2(draft.date.getDate())}T${pad2(draft.hour)}:${pad2(draft.minute)}`;
}

function formatDateTimeDisplay(value: string): string {
  const draft = parseDateTimeValue(value);
  if (!draft) return '';
  return DATE_TIME_DISPLAY_FORMATTER.format(new Date(
    draft.date.getFullYear(),
    draft.date.getMonth(),
    draft.date.getDate(),
    draft.hour,
    draft.minute,
  ));
}

function addMonths(date: Date, delta: number): Date {
  return localDateAtNoon(date.getFullYear(), date.getMonth() + delta, 1);
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildCalendarCells(monthDate: Date): CalendarCell[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = localDateAtNoon(year, month, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = localDateAtNoon(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = localDateAtNoon(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { date, outside: date.getMonth() !== month };
  });
}

function TimeColumn({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: readonly number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="min-w-0">
      <p className={cn('mb-1.5 text-center text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
        {label}
      </p>
      <ScrollArea
        className="h-[17.25rem] rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]/70"
        viewportClassName="h-[17.25rem]"
        contentClassName="p-1"
      >
        <div className="space-y-1">
          {values.map((value) => {
            const active = value === selected;
            return (
              <button
                ref={active ? selectedRef : undefined}
                key={value}
                type="button"
                onClick={() => onSelect(value)}
                className={cn(
                  'flex h-8 w-full items-center justify-center rounded-lg font-mono text-xs tabular-nums transition-all',
                  active
                    ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                    : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]',
                )}
                aria-pressed={active}
              >
                {pad2(value)}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function AuditDateTimeField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateTimeDraft>(
    () => parseDateTimeValue(value) ?? currentDateTimeDraft(bindings.clock.now()),
  );
  const [visibleMonth, setVisibleMonth] = useState(() => draft.date);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const displayValue = formatDateTimeDisplay(value);

  useEffect(() => {
    if (!open) return;
    const nextDraft = parseDateTimeValue(value) ?? currentDateTimeDraft(bindings.clock.now());
    setDraft(nextDraft);
    setVisibleMonth(localDateAtNoon(nextDraft.date.getFullYear(), nextDraft.date.getMonth(), 1));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    return bindings.app.events.subscribeDocumentPointerDown(handlePointerDown, true);
  }, [bindings.app.events, open]);

  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, index) => WEEKDAY_FORMATTER.format(localDateAtNoon(2024, 0, index + 1))),
    [],
  );
  const calendarCells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth]);
  const today = currentDateTimeDraft(bindings.clock.now()).date;
  const committedValue = formatDateTimeValue(draft);

  const selectToday = () => {
    const nextDraft = currentDateTimeDraft(bindings.clock.now());
    setDraft(nextDraft);
    setVisibleMonth(localDateAtNoon(nextDraft.date.getFullYear(), nextDraft.date.getMonth(), 1));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          className={cn(DATE_TIME_TRIGGER_CLASS, 'w-52')}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[var(--nimi-action-primary-bg)]">
              <CalendarGlyph />
            </span>
            <span className={cn('min-w-0 truncate font-medium', displayValue ? TOKEN_TEXT_PRIMARY : 'text-[var(--nimi-field-placeholder)]')}>
              {displayValue || placeholder}
            </span>
          </span>
          <span className="shrink-0 text-[var(--nimi-text-muted)] transition-colors group-data-[state=open]:text-[var(--nimi-action-primary-bg)]">
            <ClockGlyph />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(29rem,calc(100cqw-2rem))] overflow-hidden rounded-2xl p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div ref={contentRef}>
          <div className="border-b border-[var(--nimi-border-subtle)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-overlay)),var(--nimi-surface-overlay))] px-4 py-3">
            <p className={cn('text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
              {ariaLabel}
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-[var(--nimi-text-primary)]">
              {formatDateTimeDisplay(committedValue)}
            </p>
          </div>

          <div className="grid sm:grid-cols-[1fr_8rem]">
            <div className="min-w-0 p-3.5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
                  aria-label={t('runtimeConfig.runtime.previousMonth', { defaultValue: 'Previous month' })}
                >
                  <ChevronGlyph direction="left" />
                </button>
                <p className="min-w-0 truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {MONTH_FORMATTER.format(visibleMonth)}
                </p>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
                  aria-label={t('runtimeConfig.runtime.nextMonth', { defaultValue: 'Next month' })}
                >
                  <ChevronGlyph direction="right" />
                </button>
              </div>

            <div className={cn('grid grid-cols-7 gap-1 text-center text-[length:var(--nimi-type-caption-size)] font-semibold', TOKEN_TEXT_MUTED)}>
              {weekdayLabels.map((label) => (
                <span key={label} className="py-1">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map((cell) => {
                const selected = sameDay(cell.date, draft.date);
                const isToday = sameDay(cell.date, today);
                return (
                  <button
                    key={dateKey(cell.date)}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, date: cell.date }))}
                    className={cn(
                      'relative flex aspect-square min-h-8 items-center justify-center rounded-xl text-xs font-semibold tabular-nums transition-all',
                      selected
                        ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                        : cell.outside
                          ? 'text-[color-mix(in_srgb,var(--nimi-text-muted)_58%,transparent)] hover:bg-[var(--nimi-action-ghost-hover)]'
                          : 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)]',
                      isToday && !selected && 'ring-1 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_42%,transparent)]',
                    )}
                    aria-pressed={selected}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_58%,transparent)] px-3 py-3.5 sm:border-t-0 sm:border-l">
            <div className="mb-3 flex h-8 items-center justify-center gap-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)]">
              <ClockGlyph />
              {t('runtimeConfig.runtime.time', { defaultValue: 'Time' })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <TimeColumn
                label={t('runtimeConfig.runtime.hour', { defaultValue: 'Hour' })}
                values={HOURS}
                selected={draft.hour}
                onSelect={(hour) => setDraft((prev) => ({ ...prev, hour }))}
              />
              <TimeColumn
                label={t('runtimeConfig.runtime.minute', { defaultValue: 'Min' })}
                values={MINUTES}
                selected={draft.minute}
                onSelect={(minute) => setDraft((prev) => ({ ...prev, minute }))}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] px-3.5 py-3">
          <button
            type="button"
            onClick={selectToday}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
          >
            {t('runtimeConfig.runtime.today', { defaultValue: 'Today' })}
          </button>
          <div className="flex items-center gap-1.5">
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]"
              >
                {clearLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                onChange(formatDateTimeValue(draft));
                setOpen(false);
              }}
              className="rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] transition-all hover:bg-[var(--nimi-action-primary-bg-hover)] hover:-translate-y-px"
            >
              {t('runtimeConfig.runtime.apply', { defaultValue: 'Apply' })}
            </button>
          </div>
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type GlobalAuditSectionProps = {
  events: DesktopAuditEventProjection[];
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  filters: {
    domain: string;
    callerKind: number;
    timeFrom: string;
    timeTo: string;
  };
  onUpdateFilters: (patch: Partial<{ domain: string; callerKind: number; timeFrom: string; timeTo: string }>) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
};

export function GlobalAuditSection({
  events,
  loading,
  error,
  hasNextPage,
  filters,
  onUpdateFilters,
  onRefresh,
  onLoadMore,
}: GlobalAuditSectionProps) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'min-w-0 max-w-full overflow-hidden p-5')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
          {t('runtimeConfig.runtime.globalAuditTitle', { defaultValue: 'Runtime Audit Activity' })}
        </h3>
        <div className="flex items-center gap-1">
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loading}
            onClick={onRefresh}
          />
          <IconButton
            icon={<ExportIcon />}
            title={t('runtimeConfig.runtime.auditExportUnavailable', {
              defaultValue: 'Audit export is not available on Desktop',
            })}
            disabled
            onClick={() => undefined}
          />
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-2 text-xs text-[var(--nimi-status-danger)]">
          <p>
            {t('runtimeConfig.runtime.auditReadFailed', {
              defaultValue: 'Audit activity is unavailable. Check or update the local Runtime, then try again.',
            })}
          </p>
          <p className="mt-1 break-all font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{error}</p>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
        <input
          value={filters.domain}
          onChange={(e) => onUpdateFilters({ domain: e.target.value })}
          placeholder={t('runtimeConfig.runtime.filterDomain', { defaultValue: 'Filter domain…' })}
          aria-label={t('runtimeConfig.runtime.filterDomain', { defaultValue: 'Filter domain…' })}
          className={cn(FILTER_INPUT_CLASS, 'w-44 max-w-full')}
        />
        <RuntimeSelect
          value={String(filters.callerKind)}
          onChange={(next) => onUpdateFilters({ callerKind: Number(next) })}
          ariaLabel={t('runtimeConfig.runtime.filterCallerKind', { defaultValue: 'Filter caller kind' })}
          size="sm"
          className="w-44"
          options={[
            { value: String(0), label: t('runtimeConfig.runtime.allCallers', { defaultValue: 'All callers' }) },
            { value: String(CallerKind.DESKTOP_CORE), label: t('runtimeConfig.runtime.desktopCore', { defaultValue: 'Desktop Core' }) },
            { value: String(CallerKind.THIRD_PARTY_APP), label: t('runtimeConfig.runtime.thirdPartyApp', { defaultValue: 'Third-Party App' }) },
            { value: String(CallerKind.THIRD_PARTY_SERVICE), label: t('runtimeConfig.runtime.thirdPartyService', { defaultValue: 'Third-Party Service' }) },
          ]}
        />
        <AuditDateTimeField
          value={filters.timeFrom}
          onChange={(timeFrom) => onUpdateFilters({ timeFrom })}
          ariaLabel={t('runtimeConfig.runtime.fromTime', { defaultValue: 'From' })}
          placeholder={t('runtimeConfig.runtime.fromTime', { defaultValue: 'From' })}
          clearLabel={t('runtimeConfig.runtime.clearFromTime', { defaultValue: 'Clear from time' })}
        />
        <AuditDateTimeField
          value={filters.timeTo}
          onChange={(timeTo) => onUpdateFilters({ timeTo })}
          ariaLabel={t('runtimeConfig.runtime.toTime', { defaultValue: 'To' })}
          placeholder={t('runtimeConfig.runtime.toTime', { defaultValue: 'To' })}
          clearLabel={t('runtimeConfig.runtime.clearToTime', { defaultValue: 'Clear to time' })}
        />
      </div>

      {/* Event List */}
      <div className="mt-4 min-w-0 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40">
        <ScrollArea
          className="min-w-0 max-h-[calc(100cqh-34rem)]"
          viewportClassName="min-w-0 max-h-[calc(100cqh-34rem)]"
        >
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <p className={cn('text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                {loading
                  ? t('runtimeConfig.runtime.loadingAuditEvents', { defaultValue: 'Loading audit events…' })
                  : t('runtimeConfig.runtime.noAuditEvents', { defaultValue: 'No audit events match the current filters.' })}
              </p>
              {!loading ? (
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.runtime.noAuditEventsHint', {
                    defaultValue: 'Events appear here as connected apps make authorized runtime calls.',
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            events.map((event) => (
              <AuditEventRow
                key={event.auditId}
                event={event}
                formatRelativeTime={i18n.formatRelativeTime}
              />
            ))
          )}
        </ScrollArea>
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading…' })
              : t('runtimeConfig.runtime.loadMore', { defaultValue: 'Load more' })}
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

function AuditEventRow({
  event,
  formatRelativeTime,
}: {
  event: DesktopAuditEventProjection;
  formatRelativeTime: (value: unknown) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const ts = timestampToIso(event.timestamp);
  const reasonCodeText = event.reasonCode !== undefined && event.reasonCode !== null ? String(event.reasonCode) : '';
  const hasReason = reasonCodeText.length > 0 && reasonCodeText !== '0';
  const tone = reasonTone(reasonCodeText);

  return (
    <div className="border-b border-[var(--nimi-border-subtle)]/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
      >
        <span className={cn('shrink-0 text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className={cn('hidden w-16 shrink-0 truncate font-mono text-[length:var(--nimi-type-caption-size)] sm:block', TOKEN_TEXT_MUTED)}>
          {event.auditId ? `${event.auditId.slice(0, 8)}…` : '—'}
        </span>
        <span
          className="inline-flex max-w-24 shrink-0 items-center truncate rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium text-[var(--nimi-action-primary-bg)] sm:max-w-36"
          title={event.domain || undefined}
        >
          {event.domain || '—'}
        </span>
        <span
          className={cn('min-w-0 flex-[1_1_12rem] truncate font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_SECONDARY)}
          title={event.operation || undefined}
        >
          {event.operation || '—'}
        </span>
        <span className={cn('hidden shrink-0 text-[length:var(--nimi-type-caption-size)] md:inline', TOKEN_TEXT_MUTED)}>
          {callerKindLabel(event.callerKind)}
        </span>
        {hasReason ? (
          <span
            className={cn('hidden shrink-0 max-w-[180px] truncate rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium lg:inline-flex', REASON_BADGE_CLASS[tone])}
            title={reasonCodeText}
          >
            {reasonCodeText}
          </span>
        ) : null}
        <span className="ml-auto shrink-0">
          <Tooltip content={ts} placement="top">
            <span className={cn('text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
              {ts !== '-' ? relativeTimeShort(ts, formatRelativeTime) : '—'}
            </span>
          </Tooltip>
        </span>
      </button>
      {expanded ? <ExpandedDetails event={event} timestampIso={ts} reasonCodeText={reasonCodeText} /> : null}
    </div>
  );
}

function ExpandedDetails({ event, timestampIso, reasonCodeText }: { event: DesktopAuditEventProjection; timestampIso: string; reasonCodeText: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 border-t border-[var(--nimi-border-subtle)]/50 bg-[var(--nimi-surface-card)]/70 px-5 py-4">
      <FieldGroup
        title={t('runtimeConfig.runtime.groupWhatHappened', { defaultValue: 'What happened' })}
        items={[
          { label: t('runtimeConfig.runtime.domain', { defaultValue: 'Domain' }), value: event.domain, mono: true },
          { label: t('runtimeConfig.runtime.operation', { defaultValue: 'Operation' }), value: event.operation, mono: true },
          { label: t('runtimeConfig.runtime.reasonCode', { defaultValue: 'Reason Code' }), value: reasonCodeText, mono: true },
        ]}
      />
      <FieldGroup
        title={t('runtimeConfig.runtime.groupWho', { defaultValue: 'Who called' })}
        items={[
          { label: t('runtimeConfig.runtime.callerKind', { defaultValue: 'Caller Kind' }), value: callerKindLabel(event.callerKind) },
          { label: t('runtimeConfig.runtime.appId', { defaultValue: 'App ID' }), value: event.appId, mono: true },
        ]}
      />
      <FieldGroup
        title={t('runtimeConfig.runtime.groupTracing', { defaultValue: 'Tracing' })}
        items={[
          { label: t('runtimeConfig.runtime.auditId', { defaultValue: 'Audit ID' }), value: event.auditId, mono: true },
          { label: t('runtimeConfig.runtime.requestId', { defaultValue: 'Request ID' }), value: event.requestId, mono: true },
          { label: t('runtimeConfig.runtime.traceId', { defaultValue: 'Trace ID' }), value: event.traceId, mono: true },
          { label: t('runtimeConfig.runtime.timestamp', { defaultValue: 'Timestamp' }), value: timestampIso },
        ]}
      />
    </div>
  );
}

function FieldGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; mono?: boolean }[];
}) {
  const visible = items.filter((item) => item.value && String(item.value).trim() && item.value !== 'null' && item.value !== 'undefined' && item.value !== '0');
  if (visible.length === 0) return null;
  return (
    <div>
      <p className={cn('mb-1.5 text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
        {title}
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        {visible.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2">
            <span className={cn('shrink-0 text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>{item.label}</span>
            <span
              className={cn(
                'min-w-0 select-text break-all text-[length:var(--nimi-type-caption-size)]',
                item.mono ? 'font-mono' : '',
                TOKEN_TEXT_PRIMARY,
              )}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
