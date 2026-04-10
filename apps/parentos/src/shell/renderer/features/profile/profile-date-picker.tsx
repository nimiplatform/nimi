/**
 * ProfileDatePicker — shared date picker component.
 * Extracted from sleep-page.tsx's proven DatePickerInput implementation
 * which uses scroll-based DrumColumn for reliable Tauri WebView support.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { S } from '../../app-shell/page-style.js';

/* ── Helpers ── */

const ITEM_H = 28;
const VISIBLE_ROWS = 3;
const WHEEL_STEP_THRESHOLD_PX = 72;

function parseDateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

function formatDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(value: string): string {
  const [y, m, d] = value.split('-');
  return y && m && d ? `${y}/${m}/${d}` : '';
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isAfterDay(a: Date, b: Date): boolean {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() > b.getFullYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() > b.getMonth();
  return a.getDate() > b.getDate();
}

function clampToMax(date: Date, maxDate: Date | null): Date {
  if (!maxDate) return date;
  return isAfterDay(date, maxDate) ? maxDate : date;
}

function startOfCalendarMonth(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  const day = first.getDay();
  const offset = (day + 6) % 7;
  first.setDate(first.getDate() - offset);
  return first;
}

/* ── DrumColumn (scroll-based, proven in sleep-page) ── */

function DrumColumn({ items, selected, onSelect, label, itemHeight = ITEM_H, visibleRows = VISIBLE_ROWS, renderValue = (v: number) => String(v) }: {
  items: number[];
  selected: number;
  onSelect: (v: number) => void;
  label: string;
  itemHeight?: number;
  visibleRows?: number;
  renderValue?: (v: number) => string;
}) {
  const panelHeight = itemHeight * visibleRows;
  const padRows = Math.floor(visibleRows / 2);
  const colRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCarry = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollToIndex = useCallback((idx: number, smooth = false) => {
    const nextTop = idx * itemHeight;
    colRef.current?.scrollTo({ top: nextTop, behavior: smooth ? 'smooth' : 'auto' });
    setScrollTop(nextTop);
  }, [itemHeight]);

  useEffect(() => {
    const idx = items.indexOf(selected);
    if (idx >= 0) scrollToIndex(idx, false);
  }, [items, selected, scrollToIndex]);

  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

  const settleSelection = useCallback(() => {
    const el = colRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    const val = items[clamped];
    if (val !== undefined && val !== selected) onSelect(val);
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
    const normalizedDelta = rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? itemHeight * 2 : 1);
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
      <div className="absolute inset-x-0 top-0 z-10 pointer-events-none" style={{ height: itemHeight * 2, background: 'linear-gradient(to bottom, rgba(255,255,255,0.92), rgba(255,255,255,0))' }} />
      <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none" style={{ height: itemHeight * 2, background: 'linear-gradient(to top, rgba(255,255,255,0.92), rgba(255,255,255,0))' }} />
      <div ref={colRef} className="time-picker-col overflow-y-auto"
        onScroll={handleScroll} onWheel={handleWheel}
        style={{ height: panelHeight, scrollSnapType: 'y mandatory', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {Array.from({ length: padRows }).map((_, i) => <div key={`pad-t-${i}`} style={{ height: itemHeight }} />)}
        {items.map((v, idx) => {
          const centerOffset = idx * itemHeight - scrollTop;
          const distanceRows = Math.min(2.6, Math.abs(centerOffset) / itemHeight);
          const emphasis = Math.max(0, 1 - distanceRows / 2.6);
          const fontSize = Math.max(12, itemHeight * 0.36) + emphasis * Math.max(5, itemHeight * 0.22);
          const fontWeight = 430 + Math.round(emphasis * 350);
          const opacity = 0.22 + emphasis * 0.78;
          const translateY = (centerOffset > 0 ? 1 : -1) * Math.min(8, distanceRows * 3);
          const scale = 0.9 + emphasis * 0.2;
          const isCentered = Math.abs(centerOffset) < itemHeight * 0.35;
          const color = isCentered ? '#5e7316' : `rgba(118, 123, 132, ${opacity})`;
          return (
            <div key={v} onClick={() => { onSelect(v); scrollToIndex(items.indexOf(v), true); }}
              className="flex items-center justify-center cursor-pointer select-none" aria-selected={isCentered}
              style={{ height: itemHeight, scrollSnapAlign: 'center', fontSize, fontWeight, color,
                transform: `translateY(${translateY}px) scale(${scale})`,
                transition: 'font-size 0.12s ease, color 0.12s ease, font-weight 0.12s ease, transform 0.12s ease',
                letterSpacing: isCentered ? '0.02em' : '0.01em',
                textShadow: isCentered ? '0 1px 0 rgba(255,255,255,0.9), 0 4px 12px rgba(148,165,51,0.12)' : 'none',
              }}>
              {renderValue(v)}
            </div>
          );
        })}
        {Array.from({ length: padRows }).map((_, i) => <div key={`pad-b-${i}`} style={{ height: itemHeight }} />)}
      </div>
    </div>
  );
}

/* ── DatePickerPanel ── */

const DatePickerPanel = forwardRef<HTMLDivElement, {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  value: string;
  displayMonth: Date;
  maxDate: Date | null;
  onDisplayMonthChange: (date: Date) => void;
  onChange: (value: string) => void;
  onClear?: () => void;
  onClose: () => void;
}>(function DatePickerPanel({ anchorRef, open, value, displayMonth, maxDate, onDisplayMonthChange, onChange, onClear, onClose }, ref) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [showMonthYearPicker, setShowMonthYearPicker] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 304) });
  }, [anchorRef, open]);

  useEffect(() => { if (!open) setShowMonthYearPicker(false); }, [open]);

  if (!pos) return null;

  const selectedDate = value ? parseDateValue(value) : new Date();
  const today = new Date();
  const safeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  const effectiveMax = maxDate ?? safeToday;
  const isCurrentMonth = displayMonth.getFullYear() === effectiveMax.getFullYear() && displayMonth.getMonth() === effectiveMax.getMonth();
  const calendarStart = startOfCalendarMonth(displayMonth);
  const currentYear = effectiveMax.getFullYear();
  const yearItems = Array.from({ length: currentYear - 1999 + 2 }, (_, i) => 2000 + i);
  const monthItems = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(calendarStart);
    d.setDate(calendarStart.getDate() + i);
    return d;
  });

  const left = Math.min(pos.left, window.innerWidth - pos.width - 8);
  const top = Math.min(pos.top, window.innerHeight - 380);

  return (
    <div ref={ref} className="fixed z-[60] rounded-[16px] overflow-hidden p-3"
      onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
      style={{
        left, top, width: pos.width, background: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: `1px solid ${S.border}`,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.97)',
        transformOrigin: 'top center', transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}>
      {/* Navigation */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => onDisplayMonthChange(addMonths(displayMonth, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef4dd]"
            style={{ color: '#6d7d2a', background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)' }}
            aria-label="上个月">
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>

          <div className="relative flex-1">
            <button type="button" onClick={() => setShowMonthYearPicker((p) => !p)}
              className="relative flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 transition-colors hover:bg-[#f3f7e8]"
              style={{ background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)', color: '#5e7316' }}>
              <span className="text-[15px] font-semibold tracking-[0.02em]">{displayMonth.getFullYear()}年</span>
              <span className="relative pr-4 text-[15px] font-semibold tracking-[0.02em]">
                {displayMonth.getMonth() + 1}月
                <ChevronRight size={13} strokeWidth={2} className="absolute right-[-1px] bottom-[1px] transition-transform"
                  style={{ color: '#7b8d30', transform: `rotate(${showMonthYearPicker ? 270 : 90}deg)` }} />
              </span>
            </button>

            {showMonthYearPicker && (
              <div className="absolute left-1/2 top-[calc(100%+10px)] z-20 w-[216px] -translate-x-1/2 overflow-hidden rounded-[16px]"
                style={{ background: '#fff', border: `1px solid ${S.border}`, boxShadow: '0 10px 28px rgba(0,0,0,0.14)' }}
                onMouseDown={(e) => e.stopPropagation()}>
                <div className="absolute inset-x-0 pointer-events-none z-[5]"
                  style={{ top: 28, height: 28, background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.07))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.24)' }} />
                <div className="absolute top-0 bottom-0 left-1/2 w-px z-[6]" style={{ background: S.border }} />
                <div className="flex relative" style={{ height: 84 }}>
                  <DrumColumn items={yearItems} selected={displayMonth.getFullYear()}
                    onSelect={(y) => onDisplayMonthChange(new Date(y, displayMonth.getMonth(), 1, 12, 0, 0, 0))}
                    label="年份" itemHeight={28} visibleRows={3} renderValue={(y) => String(y)} />
                  <DrumColumn items={monthItems} selected={displayMonth.getMonth() + 1}
                    onSelect={(m) => onDisplayMonthChange(new Date(displayMonth.getFullYear(), m - 1, 1, 12, 0, 0, 0))}
                    label="月份" itemHeight={28} visibleRows={3} renderValue={(m) => `${m}月`} />
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={() => { if (!isCurrentMonth) onDisplayMonthChange(addMonths(displayMonth, 1)); }}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef4dd]"
            style={{
              color: isCurrentMonth ? 'rgba(109,125,42,0.35)' : '#6d7d2a',
              background: isCurrentMonth ? 'linear-gradient(180deg, rgba(148,165,51,0.06), rgba(148,165,51,0.03))' : 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)', cursor: isCurrentMonth ? 'not-allowed' : 'pointer', opacity: isCurrentMonth ? 0.72 : 1,
            }}
            aria-label="下个月" disabled={isCurrentMonth}>
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="mb-2 grid grid-cols-7 gap-1 px-1">
        {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
          <div key={label} className="flex h-8 items-center justify-center text-[11px] font-medium" style={{ color: S.sub }}>{label}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1 rounded-[16px] p-2.5"
        style={{ background: 'linear-gradient(180deg, rgba(251,252,247,0.98), rgba(247,249,241,0.95))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.82)' }}>
        {days.map((day) => {
          const inMonth = day.getMonth() === displayMonth.getMonth();
          const isSelected = sameDay(day, selectedDate);
          const isToday = sameDay(day, safeToday);
          const isFuture = isAfterDay(day, effectiveMax);
          const textColor = isSelected ? '#556813' : isFuture ? 'rgba(164,170,178,0.46)' : inMonth ? S.text : 'rgba(139,145,153,0.62)';
          return (
            <button key={day.toISOString()} type="button"
              onClick={() => { if (!isFuture) onChange(formatDateValue(day)); }}
              className="relative flex h-10 items-center justify-center rounded-[13px] text-[13px] transition-all duration-150 hover:-translate-y-[1px]"
              disabled={isFuture}
              style={{
                color: textColor,
                background: isFuture ? 'transparent' : isSelected ? 'linear-gradient(180deg, rgba(148,165,51,0.24), rgba(148,165,51,0.12))' : isToday ? 'linear-gradient(180deg, rgba(148,165,51,0.10), rgba(148,165,51,0.05))' : 'transparent',
                fontWeight: isFuture ? 500 : isSelected ? 750 : isToday ? 650 : 520,
                boxShadow: isFuture ? 'none' : isSelected ? '0 4px 12px rgba(148,165,51,0.12), inset 0 0 0 1px rgba(148,165,51,0.18)' : isToday ? 'inset 0 0 0 1px rgba(148,165,51,0.10)' : 'none',
                opacity: isFuture ? 0.42 : inMonth ? 1 : 0.78,
                cursor: isFuture ? 'not-allowed' : 'pointer',
              }}>
              <span>{day.getDate()}</span>
              {isToday && !isSelected && <span className="absolute bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" style={{ background: 'rgba(148,165,51,0.75)' }} />}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between px-1">
        <button type="button" onClick={() => { const now = new Date(); onDisplayMonthChange(new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0)); onChange(formatDateValue(clampToMax(now, maxDate))); }}
          className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#f3f5ea]" style={{ color: '#5e7316' }}>
          今天
        </button>
        <div className="flex items-center gap-1">
          {onClear && value && (
            <button type="button" onClick={onClear}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#f4f4ef]" style={{ color: '#9aa0a7' }}>
              清空
            </button>
          )}
          <button type="button" onClick={onClose}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#f4f4ef]" style={{ color: S.sub }}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── ProfileDatePicker (public API) ── */

export function ProfileDatePicker({
  value, onChange, className = '', style, size = 'normal', allowClear = false, maxDate,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: CSSProperties;
  size?: 'normal' | 'small';
  allowClear?: boolean;
  maxDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const parsedMax = maxDate ? parseDateValue(maxDate) : null;
  const [displayMonth, setDisplayMonth] = useState(() => {
    const base = value ? parseDateValue(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1, 12, 0, 0, 0);
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) return;
    const parsed = parseDateValue(value);
    setDisplayMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12, 0, 0, 0));
  }, [value]);

  useEffect(() => {
    if (!mounted || open) return;
    const timer = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(timer);
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const handler = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node) &&
          panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mounted]);

  const openPanel = () => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };

  const toggle = () => { if (open) setOpen(false); else openPanel(); };

  const handleTriggerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (panelRef.current?.contains(event.target as Node)) return;
    toggle();
  };

  const sizeClass = size === 'small' ? 'pl-2.5 pr-14 py-1.5 text-[12px]' : 'pl-3 pr-16 py-2 text-[13px]';

  return (
    <div ref={wrapRef} className="relative">
      <div className="group/field relative flex items-center cursor-pointer" onClick={handleTriggerClick}>
        <input type="text" readOnly value={formatDateDisplay(value)}
          className={`w-full ${S.radiusSm} ${sizeClass} outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 cursor-pointer ${className}`}
          style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fafaf8', ...style }} />
        <div className={`absolute right-2 flex items-center gap-1 ${size === 'small' ? 'text-[11px]' : ''}`}>
          {allowClear && value && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
              className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-[#eef1e6]" style={{ color: '#9ea5ad' }} aria-label="清空日期">
              <svg width={size === 'small' ? 12 : 13} height={size === 'small' ? 12 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
          <Calendar size={size === 'small' ? 14 : 16} strokeWidth={1.5}
            className={`transition-colors ${open ? 'text-[#94A533]' : 'text-gray-400 group-focus-within/field:text-[#94A533]'}`} />
        </div>
      </div>

      {mounted && createPortal(
        <DatePickerPanel ref={panelRef} anchorRef={wrapRef} open={open}
          value={value} displayMonth={displayMonth} maxDate={parsedMax}
          onDisplayMonthChange={setDisplayMonth}
          onChange={(next) => {
            const clamped = clampToMax(parseDateValue(next), parsedMax);
            onChange(formatDateValue(clamped));
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange(''); setOpen(false); } : undefined}
          onClose={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
