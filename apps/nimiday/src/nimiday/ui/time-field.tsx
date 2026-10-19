/**
 * TimeField — NimiDay-local HH:MM wheel field.
 *
 * The visual language and interaction mirror the shared Kit DatePicker panel
 * (drum wheels, highlight band, overlay tokens); Kit has no shared time
 * picker, so this composition stays app-owned while consuming the same
 * design tokens.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import type { Copy } from '../i18n/index.js';

const ITEM_H = 28;
const VISIBLE_ROWS = 5;
const WHEEL_STEP_THRESHOLD_PX = 72;
const PANEL_HEIGHT = 252;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);

export interface TimeFieldLabels {
  /** Panel title shown above the wheel columns. */
  panelTitle: string;
  /** Header above the hour wheel. */
  hourHeader: string;
  /** Header above the minute wheel. */
  minuteHeader: string;
  /** aria-label of the hour wheel column. */
  hourWheelAriaLabel: string;
  /** aria-label of the minute wheel column. */
  minuteWheelAriaLabel: string;
  /** Footer button committing the draft selection. */
  confirmButton: string;
}

export function timeFieldLabels(copy: Copy, panelTitle: string): TimeFieldLabels {
  return {
    panelTitle,
    hourHeader: copy.time.picker.hour,
    minuteHeader: copy.time.picker.minute,
    hourWheelAriaLabel: copy.time.picker.hourWheel,
    minuteWheelAriaLabel: copy.time.picker.minuteWheel,
    confirmButton: copy.time.picker.confirm,
  };
}

interface TimeSelection {
  readonly hour: number;
  readonly minute: number;
}

interface PanelPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function parseTimeValue(value: string): TimeSelection | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function selectionFromValue(value: string, minTime = '00:00'): TimeSelection {
  const parsed = parseTimeValue(value);
  const minimum = parseTimeValue(minTime)!;
  if (parsed) return value < minTime ? minimum : parsed;
  const now = new Date();
  const current = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return current < minTime ? minimum : { hour: now.getHours(), minute: now.getMinutes() };
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

function WheelColumn({
  items,
  selected,
  onSelect,
  label,
}: {
  readonly items: readonly number[];
  readonly selected: number;
  readonly onSelect: (value: number) => void;
  readonly label: string;
}) {
  const panelHeight = ITEM_H * VISIBLE_ROWS;
  const padRows = Math.floor(VISIBLE_ROWS / 2);
  const colRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCarry = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollToIndex = useCallback((index: number, smooth = false) => {
    const nextTop = index * ITEM_H;
    const column = colRef.current;
    if (typeof column?.scrollTo === 'function') {
      column.scrollTo({ top: nextTop, behavior: smooth ? 'smooth' : 'auto' });
    } else if (column) {
      column.scrollTop = nextTop;
    }
    setScrollTop(nextTop);
  }, []);

  useEffect(() => {
    // While a scroll gesture is still settling, the settle path owns the
    // landing position; forcing a jump back to `selected` here would yank
    // the column out from under an in-flight drag or wheel step.
    if (scrollTimer.current) return;
    const index = items.indexOf(selected);
    if (index >= 0) scrollToIndex(index, false);
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
    const index = Math.round(el.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    const value = items[clamped];
    if (value !== undefined && value !== selected) onSelect(value);
    scrollToIndex(clamped, true);
  }, [items, onSelect, scrollToIndex, selected]);

  const scheduleSettle = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      settleSelection();
    }, 80);
  }, [settleSelection]);

  const handleScroll = () => {
    const el = colRef.current;
    if (el) setScrollTop(el.scrollTop);
    scheduleSettle();
  };

  // React registers root `onWheel` listeners as passive, so preventDefault
  // inside a React handler silently fails and the native scroll runs on top
  // of the programmatic step below (one wheel tick then jumps several rows).
  // Bind a non-passive native listener so wheel input only moves one row per
  // accumulated threshold.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const listener = (event: WheelEvent) => {
      event.preventDefault();
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const normalizedDelta =
        rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ITEM_H * 2 : 1);
      wheelCarry.current += normalizedDelta;
      if (Math.abs(wheelCarry.current) < WHEEL_STEP_THRESHOLD_PX) return;
      const direction = Math.sign(wheelCarry.current);
      wheelCarry.current = 0;
      const currentIndex = Math.round(el.scrollTop / ITEM_H);
      const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + direction));
      scrollToIndex(nextIndex, false);
      scheduleSettle();
    };
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, [items.length, scheduleSettle, scrollToIndex]);

  return (
    <div className="flex-1 relative" aria-label={label}>
      <div
        className="absolute inset-x-0 top-0 z-10 pointer-events-none bg-[linear-gradient(to_bottom,var(--nimi-surface-overlay),transparent)]"
        style={{ height: ITEM_H * 2 }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-10 pointer-events-none bg-[linear-gradient(to_top,var(--nimi-surface-overlay),transparent)]"
        style={{ height: ITEM_H * 2 }}
      />
      <div
        ref={colRef}
        className="nd-time-wheel overflow-y-auto"
        onScroll={handleScroll}
        style={{ height: panelHeight, scrollSnapType: 'y mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {Array.from({ length: padRows }).map((_, index) => (
          <div key={`pad-t-${index}`} style={{ height: ITEM_H }} />
        ))}
        {items.map((value, index) => {
          const centerOffset = index * ITEM_H - scrollTop;
          const distanceRows = Math.min(2.6, Math.abs(centerOffset) / ITEM_H);
          const emphasis = Math.max(0, 1 - distanceRows / 2.6);
          const fontSize = Math.max(12, ITEM_H * 0.36) + emphasis * Math.max(5, ITEM_H * 0.22);
          const fontWeight = 430 + Math.round(emphasis * 350);
          const opacity = 0.22 + emphasis * 0.78;
          const translateY = (centerOffset > 0 ? 1 : -1) * Math.min(8, distanceRows * 3);
          const scale = 0.9 + emphasis * 0.2;
          const isCentered = Math.abs(centerOffset) < ITEM_H * 0.35;
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
                height: ITEM_H,
                scrollSnapAlign: 'center',
                fontSize,
                fontWeight,
                transform: `translateY(${translateY}px) scale(${scale})`,
                transition: 'font-size 0.12s ease, color 0.12s ease, font-weight 0.12s ease, transform 0.12s ease',
                letterSpacing: 0,
                opacity,
              }}
            >
              {pad2(value)}
            </div>
          );
        })}
        {Array.from({ length: padRows }).map((_, index) => (
          <div key={`pad-b-${index}`} style={{ height: ITEM_H }} />
        ))}
      </div>
    </div>
  );
}

function TimePanel({
  anchorRef,
  open,
  value,
  minTime = '00:00',
  contentLayer,
  labels,
  onChange,
  onClose,
  ref,
}: {
  readonly anchorRef: RefObject<HTMLDivElement | null>;
  readonly open: boolean;
  readonly value: string;
  readonly minTime?: string;
  readonly contentLayer: 'popover' | 'dialog';
  readonly labels: TimeFieldLabels;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly ref: RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<PanelPosition | null>(null);
  const [draft, setDraft] = useState<TimeSelection>(() => selectionFromValue(value, minTime));

  useEffect(() => {
    setPos(getPanelPosition(anchorRef, 220, PANEL_HEIGHT));
  }, [anchorRef, open]);

  useEffect(() => {
    if (open) setDraft(selectionFromValue(value, minTime));
  }, [open, value]);

  useEffect(() => {
    setDraft((current) => selectionFromValue(`${pad2(current.hour)}:${pad2(current.minute)}`, minTime));
  }, [minTime]);

  if (!pos) return null;

  const selection = selectionFromValue(`${pad2(draft.hour)}:${pad2(draft.minute)}`, minTime);
  const minimum = parseTimeValue(minTime)!;
  const commitValue = `${pad2(selection.hour)}:${pad2(selection.minute)}`;

  return (
    <div
      ref={ref}
      className={`nd-time-panel fixed rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-3.5 shadow-[var(--nimi-elevation-floating)] text-[var(--nimi-text-primary)] box-border ${
        contentLayer === 'dialog' ? 'z-[calc(var(--nimi-z-dialog)+1)]' : 'z-[var(--nimi-z-popover)]'
      }`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      // A containing modal overlay treats pointerdown outside its own content
      // as an outside interaction; panel presses are inside this component.
      onPointerDown={(event) => event.stopPropagation()}
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
        <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-secondary)]">{labels.panelTitle}</span>
        <span className="min-w-0 truncate font-mono text-[length:var(--nimi-type-mono-size)] text-[var(--nimi-action-primary-bg)]">
          {commitValue}
        </span>
      </div>
      <div className="grid grid-cols-2 px-3.5 pb-2 text-center text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-text-muted)]">
        <span>{labels.hourHeader}</span>
        <span>{labels.minuteHeader}</span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)]">
        <div
          className="absolute left-2 right-2 top-[56px] z-[5] h-7 rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] pointer-events-none shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]"
        />
        <div className="relative flex items-stretch" style={{ height: ITEM_H * VISIBLE_ROWS }}>
          <WheelColumn
            items={HOURS.filter((hour) => hour >= minimum.hour)}
            selected={selection.hour}
            onSelect={(hour) => setDraft(selectionFromValue(`${pad2(hour)}:${pad2(selection.minute)}`, minTime))}
            label={labels.hourWheelAriaLabel}
          />
          <div className="relative z-[6] my-[18px] w-px bg-[var(--nimi-border-subtle)]" />
          <WheelColumn
            items={MINUTES.filter((minute) => selection.hour > minimum.hour || minute >= minimum.minute)}
            selected={selection.minute}
            onSelect={(minute) => setDraft({ ...selection, minute })}
            label={labels.minuteWheelAriaLabel}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 px-0.5 pt-3">
        <button
          type="button"
          onClick={() => {
            onChange(commitValue);
            onClose();
          }}
          className="rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-2 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]"
        >
          {labels.confirmButton}
        </button>
      </div>
    </div>
  );
}

export function TimeField({
  id,
  value,
  minTime,
  onValueChange,
  disabled = false,
  placeholder = '',
  className = '',
  style,
  contentLayer = 'popover',
  labels,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': dataTestId,
}: {
  readonly id?: string;
  readonly value: string;
  readonly minTime?: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Raises the portalled panel above a containing dialog without changing its popover semantics. */
  readonly contentLayer?: 'popover' | 'dialog';
  readonly labels: TimeFieldLabels;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'data-testid'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (event.key !== 'Escape') return;
      // Window capture runs ahead of the document listeners of a containing
      // modal overlay: closing this panel must not also close that overlay.
      event.stopPropagation();
      closePanel();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, closePanel]);

  const openPanel = () => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };

  const toggle = () => {
    if (disabled) return;
    if (open) closePanel();
    else openPanel();
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (panelRef.current?.contains(event.target as Node)) return;
    toggle();
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={style}>
      <div className={`group/field relative flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`} onClick={handleTriggerClick}>
        <input
          ref={inputRef}
          type="time"
          id={id}
          disabled={disabled}
          value={parseTimeValue(value) ? value : ''}
          min={minTime}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (parseTimeValue(next) && (!minTime || next >= minTime)) onValueChange(next);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          data-testid={dataTestId}
          className="nd-time-input w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] pl-3 pr-9 py-2 text-[length:var(--nimi-type-body-size)] cursor-pointer outline-none transition-shadow focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]"
        />
        <div className="absolute right-2 flex items-center gap-1 pointer-events-none">
          <Clock
            size={16}
            strokeWidth={1.5}
            className={`transition-colors ${
              open ? 'text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)] group-focus-within/field:text-[var(--nimi-text-primary)]'
            }`}
          />
        </div>
      </div>
      {mounted &&
        createPortal(
          <TimePanel
            ref={panelRef}
            anchorRef={wrapRef}
            open={open}
            value={value}
            minTime={minTime}
            contentLayer={contentLayer}
            labels={labels}
            onChange={onValueChange}
            onClose={closePanel}
          />,
          document.body,
        )}
    </div>
  );
}
