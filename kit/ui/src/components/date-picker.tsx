/**
 * DatePicker - shared civil-date field.
 *
 * The panel is a three-column wheel selector (year / month / day), designed
 * for exact date entry where jumping across many years is more important than
 * browsing a monthly calendar grid.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Calendar } from 'lucide-react';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

const DEFAULT_MIN_YEAR = 1900;
const ITEM_H = 28;
const VISIBLE_ROWS = 5;
const WHEEL_STEP_THRESHOLD_PX = 72;
const PANEL_HEIGHT = 292;

interface DateSelection {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface PanelPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export function parseDateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function formatDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(value: string): string {
  const parsed = parseStrictDateValue(value);
  return parsed ? `${parsed.year}/${pad2(parsed.month)}/${pad2(parsed.day)}` : '';
}

function parseStrictDateValue(value: string): DateSelection | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

function todayAtNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function isAfterDay(a: Date, b: Date): boolean {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() > b.getFullYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() > b.getMonth();
  return a.getDate() > b.getDate();
}

export function clampToMax(date: Date, maxDate: Date | null): Date {
  if (!maxDate) return date;
  return isAfterDay(date, maxDate) ? maxDate : date;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  const s = String(n);
  return s.length >= 4 ? s : '0'.repeat(4 - s.length) + s;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0, 12, 0, 0, 0).getDate();
}

function years(minYear: number, maxYear: number): number[] {
  const start = Math.min(minYear, maxYear);
  return Array.from({ length: maxYear - start + 1 }, (_, i) => start + i);
}

function selectionToValue(selection: DateSelection): string {
  return `${pad4(selection.year)}-${pad2(selection.month)}-${pad2(selection.day)}`;
}

function normalizeSelection(selection: DateSelection, minYear: number, maxDate: Date): DateSelection {
  const maxYear = maxDate.getFullYear();
  const year = Math.max(minYear, Math.min(selection.year, maxYear));
  const maxMonth = year === maxYear ? maxDate.getMonth() + 1 : 12;
  const month = Math.max(1, Math.min(selection.month, maxMonth));
  const maxDay =
    year === maxYear && month === maxDate.getMonth() + 1
      ? maxDate.getDate()
      : daysInMonth(year, month);
  const day = Math.max(1, Math.min(selection.day, maxDay));
  return { year, month, day };
}

function selectionFromValue(value: string, minYear: number, maxDate: Date): DateSelection {
  const parsed = parseStrictDateValue(value);
  if (parsed) return normalizeSelection(parsed, minYear, maxDate);
  return normalizeSelection(
    { year: maxDate.getFullYear(), month: maxDate.getMonth() + 1, day: maxDate.getDate() },
    minYear,
    maxDate,
  );
}

function getPanelPosition(
  anchorRef: RefObject<HTMLDivElement | null>,
  minimumWidth: number,
  panelHeight: number,
): PanelPosition | null {
  const el = anchorRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const width = Math.max(rect.width, minimumWidth);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const top =
    below + panelHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - panelHeight - 6);
  return { left, top, width };
}

function DrumColumn({
  items,
  selected,
  onSelect,
  label,
  itemHeight = ITEM_H,
  visibleRows = VISIBLE_ROWS,
  renderValue = (v: number) => String(v),
}: {
  readonly items: readonly number[];
  readonly selected: number;
  readonly onSelect: (value: number) => void;
  readonly label: string;
  readonly itemHeight?: number;
  readonly visibleRows?: number;
  readonly renderValue?: (value: number) => string;
}) {
  const panelHeight = itemHeight * visibleRows;
  const padRows = Math.floor(visibleRows / 2);
  const colRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCarry = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollToIndex = useCallback(
    (idx: number, smooth = false) => {
      const nextTop = idx * itemHeight;
      const column = colRef.current;
      if (typeof column?.scrollTo === 'function') {
        column.scrollTo({ top: nextTop, behavior: smooth ? 'smooth' : 'auto' });
      } else if (column) {
        column.scrollTop = nextTop;
      }
      setScrollTop(nextTop);
    },
    [itemHeight],
  );

  useEffect(() => {
    const idx = items.indexOf(selected);
    if (idx >= 0) scrollToIndex(idx, false);
  }, [items, scrollToIndex, selected]);

  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  const settleSelection = useCallback(() => {
    const el = colRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const value = items[clamped];
    if (value !== undefined && value !== selected) onSelect(value);
    scrollToIndex(clamped, true);
  }, [itemHeight, items, onSelect, scrollToIndex, selected]);

  const handleScroll = () => {
    const el = colRef.current;
    if (el) setScrollTop(el.scrollTop);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => settleSelection(), 80);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = colRef.current;
    if (!el) return;
    event.preventDefault();
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const normalizedDelta =
      rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? itemHeight * 2 : 1);
    wheelCarry.current += normalizedDelta;
    if (Math.abs(wheelCarry.current) < WHEEL_STEP_THRESHOLD_PX) return;
    const direction = Math.sign(wheelCarry.current);
    wheelCarry.current = 0;
    const currentIdx = Math.round(el.scrollTop / itemHeight);
    const nextIdx = Math.max(0, Math.min(items.length - 1, currentIdx + direction));
    scrollToIndex(nextIdx, false);
    handleScroll();
  };

  return (
    <div className="flex-1 relative" aria-label={label}>
      <div
        className="absolute inset-x-0 top-0 z-10 pointer-events-none bg-[linear-gradient(to_bottom,var(--nimi-surface-overlay),transparent)]"
        style={{ height: itemHeight * 2 }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-10 pointer-events-none bg-[linear-gradient(to_top,var(--nimi-surface-overlay),transparent)]"
        style={{ height: itemHeight * 2 }}
      />
      <div
        ref={colRef}
        className="nimi-date-picker-scroll overflow-y-auto"
        onScroll={handleScroll}
        onWheel={handleWheel}
        style={{ height: panelHeight, scrollSnapType: 'y mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {Array.from({ length: padRows }).map((_, i) => (
          <div key={`pad-t-${i}`} style={{ height: itemHeight }} />
        ))}
        {items.map((value, idx) => {
          const centerOffset = idx * itemHeight - scrollTop;
          const distanceRows = Math.min(2.6, Math.abs(centerOffset) / itemHeight);
          const emphasis = Math.max(0, 1 - distanceRows / 2.6);
          const fontSize = Math.max(12, itemHeight * 0.36) + emphasis * Math.max(5, itemHeight * 0.22);
          const fontWeight = 430 + Math.round(emphasis * 350);
          const opacity = 0.22 + emphasis * 0.78;
          const translateY = (centerOffset > 0 ? 1 : -1) * Math.min(8, distanceRows * 3);
          const scale = 0.9 + emphasis * 0.2;
          const isCentered = Math.abs(centerOffset) < itemHeight * 0.35;
          return (
            <div
              key={value}
              onClick={() => {
                onSelect(value);
                scrollToIndex(items.indexOf(value), true);
              }}
              className={`flex items-center justify-center cursor-pointer select-none ${
                isCentered ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'
              }`}
              aria-selected={isCentered}
              style={{
                height: itemHeight,
                scrollSnapAlign: 'center',
                fontSize,
                fontWeight,
                transform: `translateY(${translateY}px) scale(${scale})`,
                transition: 'font-size 0.12s ease, color 0.12s ease, font-weight 0.12s ease, transform 0.12s ease',
                letterSpacing: 0,
                opacity,
              }}
            >
              {renderValue(value)}
            </div>
          );
        })}
        {Array.from({ length: padRows }).map((_, i) => (
          <div key={`pad-b-${i}`} style={{ height: itemHeight }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Text copy used by the DatePicker panel and field affordances.
 *
 * The `labels` props accept a `Partial<DatePickerLabels>`; omitted keys keep
 * the built-in Chinese defaults below, so existing consumers see no visual
 * change.
 */
export interface DatePickerLabels {
  /** Panel title shown above the wheel columns. Default `日期`. */
  panelTitle: string;
  /** Header above the year wheel. Default `年`. */
  yearHeader: string;
  /** Header above the month wheel. Default `月`. */
  monthHeader: string;
  /** Header above the day wheel. Default `日`. */
  dayHeader: string;
  /** aria-label of the year wheel column. Default `年份`. */
  yearWheelAriaLabel: string;
  /** aria-label of the month wheel column. Default `月份`. */
  monthWheelAriaLabel: string;
  /** aria-label of the day wheel column. Default `日期`. */
  dayWheelAriaLabel: string;
  /** Footer button jumping the draft selection to today. Default `今天`. */
  todayButton: string;
  /** Footer button clearing the current value. Default `清除`. */
  clearButton: string;
  /** Footer button committing the draft selection. Default `确定`. */
  confirmButton: string;
  /** aria-label of the in-field clear button. Default `清除日期`. */
  clearValueAriaLabel: string;
}

const DEFAULT_LABELS: DatePickerLabels = {
  panelTitle: '日期',
  yearHeader: '年',
  monthHeader: '月',
  dayHeader: '日',
  yearWheelAriaLabel: '年份',
  monthWheelAriaLabel: '月份',
  dayWheelAriaLabel: '日期',
  todayButton: '今天',
  clearButton: '清除',
  confirmButton: '确定',
  clearValueAriaLabel: '清除日期',
};

function resolveLabels(labels?: Partial<DatePickerLabels>): DatePickerLabels {
  return labels ? { ...DEFAULT_LABELS, ...labels } : DEFAULT_LABELS;
}

export interface DatePickerPanelProps {
  readonly anchorRef: RefObject<HTMLDivElement | null>;
  readonly open: boolean;
  readonly value: string;
  readonly maxDate: Date | null;
  readonly minYear?: number;
  /** Copy overrides; omitted keys keep the built-in Chinese defaults. */
  readonly labels?: Partial<DatePickerLabels>;
  readonly onChange: (value: string) => void;
  readonly onClear?: () => void;
  readonly onClose?: () => void;
}

export const DatePickerPanel = forwardRef<HTMLDivElement, DatePickerPanelProps>(function DatePickerPanel(
  { anchorRef, open, value, maxDate, minYear = DEFAULT_MIN_YEAR, labels, onChange, onClear, onClose },
  ref,
) {
  const effectiveMax = maxDate ?? todayAtNoon();
  const effectiveMaxKey = formatDateValue(effectiveMax);
  const maxYear = effectiveMax.getFullYear();
  const text = resolveLabels(labels);
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const [draft, setDraft] = useState(() => selectionFromValue(value, minYear, effectiveMax));

  useEffect(() => {
    setPos(getPanelPosition(anchorRef, 360, PANEL_HEIGHT));
  }, [anchorRef, open]);

  useEffect(() => {
    if (open) setDraft(selectionFromValue(value, minYear, effectiveMax));
  }, [effectiveMaxKey, minYear, open, value]);

  if (!pos) return null;

  const monthItems = Array.from(
    { length: draft.year === maxYear ? effectiveMax.getMonth() + 1 : 12 },
    (_, i) => i + 1,
  );
  const dayCount =
    draft.year === maxYear && draft.month === effectiveMax.getMonth() + 1
      ? effectiveMax.getDate()
      : daysInMonth(draft.year, draft.month);
  const dayItems = Array.from({ length: dayCount }, (_, i) => i + 1);
  const commitValue = selectionToValue(draft);

  return (
    <div
      ref={ref}
      className="nimi-date-picker-panel fixed z-[var(--nimi-z-popover)] rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-3.5 shadow-[var(--nimi-elevation-floating)] text-[var(--nimi-text-primary)] box-border"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.98)',
        transformOrigin: 'top center',
        transition: 'opacity 0.18s ease, transform 0.18s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-0.5 pb-3">
        <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-secondary)]">{text.panelTitle}</span>
        <span className="min-w-0 truncate font-mono text-[length:var(--nimi-type-mono-size)] text-[var(--nimi-action-primary-bg)]">
          {formatDateDisplay(commitValue)}
        </span>
      </div>
      <div className="grid grid-cols-3 px-3.5 pb-2 text-center text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-text-muted)]">
        <span>{text.yearHeader}</span>
        <span>{text.monthHeader}</span>
        <span>{text.dayHeader}</span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)]">
        <div
          className="absolute left-2 right-2 top-[56px] z-[5] h-7 rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] pointer-events-none shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]"
        />
        <div className="relative flex items-stretch" style={{ height: ITEM_H * VISIBLE_ROWS }}>
          <DrumColumn
            items={years(minYear, maxYear)}
            selected={draft.year}
            onSelect={(year) => setDraft((prev) => normalizeSelection({ ...prev, year }, minYear, effectiveMax))}
            label={text.yearWheelAriaLabel}
            renderValue={(year) => String(year)}
          />
          <div className="relative z-[6] my-[18px] w-px bg-[var(--nimi-border-subtle)]" />
          <DrumColumn
            items={monthItems}
            selected={draft.month}
            onSelect={(month) => setDraft((prev) => normalizeSelection({ ...prev, month }, minYear, effectiveMax))}
            label={text.monthWheelAriaLabel}
            renderValue={pad2}
          />
          <div className="relative z-[6] my-[18px] w-px bg-[var(--nimi-border-subtle)]" />
          <DrumColumn
            items={dayItems}
            selected={draft.day}
            onSelect={(day) => setDraft((prev) => normalizeSelection({ ...prev, day }, minYear, effectiveMax))}
            label={text.dayWheelAriaLabel}
            renderValue={pad2}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-0.5 pt-3">
        <button
          type="button"
          onClick={() => setDraft(selectionFromValue(formatDateValue(todayAtNoon()), minYear, effectiveMax))}
          className={`rounded-lg bg-transparent px-2.5 py-1.5 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] ${FOCUS_RING_CLASS_NAME}`}
        >
          {text.todayButton}
        </button>
        <div className="flex items-center gap-1.5">
          {onClear && value ? (
            <button
              type="button"
              onClick={onClear}
              className={`rounded-lg bg-transparent px-2.5 py-1.5 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] ${FOCUS_RING_CLASS_NAME}`}
            >
              {text.clearButton}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onChange(commitValue);
              onClose?.();
            }}
            className={`rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-2 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] ${FOCUS_RING_CLASS_NAME}`}
          >
            {text.confirmButton}
          </button>
        </div>
      </div>
    </div>
  );
});

export type DatePickerCanonicalSize = 'sm' | 'md';

/** @deprecated Legacy DatePicker sizes; use `'sm'`/`'md'` (`'small'`→`'sm'`, `'normal'`→`'md'`). */
export type DatePickerLegacySize = 'small' | 'normal';

export type DatePickerSize = DatePickerCanonicalSize | DatePickerLegacySize;

export interface DatePickerProps {
  readonly id?: string;
  readonly value: string;
  /** Called with the committed `YYYY-MM-DD` value (or `''` when cleared). Preferred over `onChange`. */
  readonly onValueChange?: (value: string) => void;
  /** @deprecated Use `onValueChange` instead. When both are passed, `onValueChange` wins. */
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly size?: DatePickerSize;
  readonly allowClear?: boolean;
  readonly maxDate?: string;
  readonly minYear?: number;
  /** Copy overrides; omitted keys keep the built-in Chinese defaults. */
  readonly labels?: Partial<DatePickerLabels>;
  readonly autoOpenNonce?: number;
}

export function DatePicker({
  id,
  value,
  onValueChange,
  onChange,
  placeholder = '',
  className = '',
  style,
  size = 'md',
  allowClear = false,
  maxDate,
  minYear = DEFAULT_MIN_YEAR,
  labels,
  autoOpenNonce,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const parsedMax = maxDate ? parseDateValue(maxDate) : null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = resolveLabels(labels);

  useEffect(() => {
    if (!mounted || open) return;
    const timer = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(timer);
  }, [mounted, open]);

  const closePanel = useCallback(() => {
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const handler = (event: globalThis.MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(event.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mounted, closePanel]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closePanel]);

  const openPanel = () => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };

  useEffect(() => {
    if (autoOpenNonce === undefined) return;
    openPanel();
  }, [autoOpenNonce]);

  const toggle = () => {
    if (open) closePanel();
    else openPanel();
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (panelRef.current?.contains(event.target as Node)) return;
    toggle();
  };

  const hasClear = allowClear && Boolean(value);
  const canonicalSize: DatePickerCanonicalSize =
    size === 'small' ? 'sm' : size === 'normal' ? 'md' : size;
  const handleValueChange = (next: string) => {
    if (onValueChange) {
      onValueChange(next);
    } else {
      onChange?.(next);
    }
  };
  const sizeClass =
    canonicalSize === 'sm'
      ? `pl-2.5 ${hasClear ? 'pr-14' : 'pr-8'} py-1.5 text-[length:var(--nimi-type-body-size)]`
      : `pl-3 ${hasClear ? 'pr-16' : 'pr-9'} py-2 text-[length:var(--nimi-type-body-size)]`;

  return (
    <div ref={wrapRef} className="relative">
      <div className="group/field relative flex items-center cursor-pointer" onClick={handleTriggerClick}>
        <input
          ref={inputRef}
          type="text"
          id={id}
          readOnly
          value={formatDateDisplay(value)}
          placeholder={placeholder}
          className={`w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] ${sizeClass} cursor-pointer outline-none transition-shadow focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)] ${className}`}
          style={style}
        />
        <div className={`absolute right-2 flex items-center gap-1 ${canonicalSize === 'sm' ? 'text-[length:var(--nimi-type-body-sm-size)]' : ''}`}>
          {allowClear && value ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleValueChange('');
                closePanel();
              }}
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] ${FOCUS_RING_CLASS_NAME}`}
              aria-label={text.clearValueAriaLabel}
            >
              <svg
                width={canonicalSize === 'sm' ? 12 : 13}
                height={canonicalSize === 'sm' ? 12 : 13}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : null}
          <Calendar
            size={canonicalSize === 'sm' ? 14 : 16}
            strokeWidth={1.5}
            className={`transition-colors ${
              open ? 'text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)] group-focus-within/field:text-[var(--nimi-text-primary)]'
            }`}
          />
        </div>
      </div>
      {mounted &&
        createPortal(
          <DatePickerPanel
            ref={panelRef}
            anchorRef={wrapRef}
            open={open}
            value={value}
            maxDate={parsedMax}
            minYear={minYear}
            onChange={(next) => {
              const clamped = clampToMax(parseDateValue(next), parsedMax);
              handleValueChange(formatDateValue(clamped));
              closePanel();
            }}
            onClear={
              allowClear
                ? () => {
                    handleValueChange('');
                    closePanel();
                  }
                : undefined
            }
            onClose={closePanel}
            labels={text}
          />,
          document.body,
        )}
    </div>
  );
}
