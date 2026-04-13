import { useState, useEffect, useMemo, useRef, forwardRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { upsertSleepRecord, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { Calendar, Moon, Sun, Clock, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/* 鈹€鈹€ Constants 鈹€鈹€ */

const QUALITY_OPTIONS = ['good', 'fair', 'poor'] as const;
const QUALITY_LABELS: Record<string, string> = { good: '好', fair: '一般', poor: '差' };
const QUALITY_COLOR: Record<string, { bg: string; text: string }> = {
  good: { bg: '#dcfce7', text: '#15803d' },
  fair: { bg: '#fef3c7', text: '#b45309' },
  poor: { bg: '#fee2e2', text: '#dc2626' },
};

/* 鈹€鈹€ Age tiers 鈹€鈹€ */

type SleepAgeTier = 'infant' | 'toddler' | 'preschool' | 'school';

function sleepAgeTier(ageMonths: number): SleepAgeTier {
  if (ageMonths < 12) return 'infant';
  if (ageMonths < 36) return 'toddler';
  if (ageMonths < 72) return 'preschool';
  return 'school';
}

const TIER_LABELS: Record<SleepAgeTier, string> = {
  infant: '婴儿期', toddler: '幼儿期', preschool: '学龄前', school: '学龄期',
};

const TIER_DEFAULTS: Record<SleepAgeTier, { bed: string; wake: string }> = {
  infant: { bed: '20:00', wake: '06:00' },
  toddler: { bed: '20:30', wake: '06:30' },
  preschool: { bed: '21:00', wake: '07:00' },
  school: { bed: '21:00', wake: '07:00' },
};

function referenceSleepRange(ageMonths: number): [number, number] {
  if (ageMonths < 4) return [14, 17];
  if (ageMonths < 12) return [12, 16];
  if (ageMonths < 24) return [11, 14];
  if (ageMonths < 36) return [11, 14];
  if (ageMonths < 72) return [10, 13];
  if (ageMonths < 144) return [9, 12];
  return [8, 10];
}

/* 鈹€鈹€ Helpers 鈹€鈹€ */

function calcDuration(bedtime: string, wakeTime: string): number | null {
  if (!bedtime || !wakeTime) return null;
  const bParts = bedtime.split(':').map(Number);
  const wParts = wakeTime.split(':').map(Number);
  const bh = bParts[0] ?? 0, bm = bParts[1] ?? 0;
  const wh = wParts[0] ?? 0, wm = wParts[1] ?? 0;
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function parseDateValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}/${month}/${day}`;
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isAfterDay(a: Date, b: Date): boolean {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() > b.getFullYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() > b.getMonth();
  return a.getDate() > b.getDate();
}

function clampDateToToday(date: Date): Date {
  const today = new Date();
  const safeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  return isAfterDay(date, safeToday) ? safeToday : date;
}

function startOfCalendarMonth(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  const day = first.getDay();
  const offset = (day + 6) % 7;
  first.setDate(first.getDate() - offset);
  return first;
}

/** Pack structured fields into notes string */
function packNotes(nightWakings: string, napNotes: string, freeNotes: string): string | null {
  const parts: string[] = [];
  const nw = parseInt(nightWakings, 10);
  if (Number.isFinite(nw) && nw > 0) parts.push(`night_wakings:${nw}`);
  if (napNotes.trim()) parts.push(`nap_notes:${napNotes.trim()}`);
  if (freeNotes.trim()) parts.push(freeNotes.trim());
  return parts.length > 0 ? parts.join(' | ') : null;
}

/** Unpack structured fields from notes string */
function unpackNotes(notes: string | null): { nightWakings: number | null; napNotes: string; freeNotes: string } {
  if (!notes) return { nightWakings: null, napNotes: '', freeNotes: '' };
  let nightWakings: number | null = null;
  let napNotes = '';
  const remaining: string[] = [];
  for (const part of notes.split(' | ')) {
    const nwMatch = part.match(/^night_wakings:(\d+)$/);
    if (nwMatch) { nightWakings = parseInt(nwMatch[1]!, 10); continue; }
    const napMatch = part.match(/^nap_notes:(.+)$/);
    if (napMatch) { napNotes = napMatch[1]!; continue; }
    remaining.push(part);
  }
  return { nightWakings, napNotes, freeNotes: remaining.join(' | ') };
}

/* 鈹€鈹€ Shared input style 鈹€鈹€ */

const inputCls = (extra = '') =>
  `w-full ${S.radiusSm} pl-3 pr-8 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 ${extra}`;
const inputSty = { borderColor: S.border, borderWidth: 1, borderStyle: 'solid' as const, background: '#ffffff' };

/* 鈹€鈹€ Custom Time Picker (drum-roller style) 鈹€鈹€ */

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ITEM_H = 36; // px per row
const VISIBLE_ROWS = 5; // odd number so center row is the selection
const PANEL_H = ITEM_H * VISIBLE_ROWS; // 180px
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2); // 2 blank rows above/below
const WHEEL_STEP_THRESHOLD_PX = 72;

/** A single scroll-snap column */
function DrumColumn({ items, selected, onSelect, label, itemHeight = ITEM_H, visibleRows = VISIBLE_ROWS, renderValue = (v: number) => String(v).padStart(2, '0') }: {
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

  useEffect(() => () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

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
    scrollTimer.current = setTimeout(() => {
      settleSelection();
    }, 80);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = colRef.current;
    if (!el) return;
    event.preventDefault();
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const normalizedDelta = rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? itemHeight * 2 : 1);
    wheelCarry.current += normalizedDelta;

    if (Math.abs(wheelCarry.current) < WHEEL_STEP_THRESHOLD_PX) {
      return;
    }

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

      <div
        ref={colRef}
        className="time-picker-col overflow-y-auto"
        onScroll={handleScroll}
        onWheel={handleWheel}
        style={{
          height: panelHeight,
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {Array.from({ length: padRows }).map((_, i) => (
          <div key={`pad-t-${i}`} style={{ height: itemHeight }} />
        ))}
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
            <div
              key={v}
              onClick={() => { onSelect(v); scrollToIndex(items.indexOf(v), true); }}
              className="flex items-center justify-center cursor-pointer select-none"
              aria-selected={isCentered}
              style={{
                height: itemHeight,
                scrollSnapAlign: 'center',
                fontSize,
                fontWeight,
                color,
                transform: `translateY(${translateY}px) scale(${scale})`,
                transition: 'font-size 0.12s ease, color 0.12s ease, font-weight 0.12s ease, transform 0.12s ease',
                letterSpacing: isCentered ? '0.02em' : '0.01em',
                textShadow: isCentered ? '0 1px 0 rgba(255,255,255,0.9), 0 4px 12px rgba(148,165,51,0.12)' : 'none',
              }}
            >
              {renderValue(v)}
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

function TimePickerInput({ value, onChange, icon: Icon, size = 'normal' }: {
  value: string;
  onChange: (v: string) => void;
  icon: typeof Moon;
  size?: 'normal' | 'small';
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [h, m] = (value || '00:00').split(':').map(Number) as [number, number];

  const openPanel = () => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };
  const closePanel = () => setOpen(false);
  const toggle = () => open ? closePanel() : openPanel();

  useEffect(() => {
    if (!mounted || open) return;
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) &&
          panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mounted]);

  const fmt = (hh: number, mm: number) => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  const isSmall = size === 'small';
  const py = isSmall ? 'py-1' : 'py-2';
  const iconSize = isSmall ? 14 : 16;

  return (
    <div ref={wrapRef} className="relative">
      <div className="group/field relative flex items-center cursor-pointer" onClick={toggle}>
        <input type="text" readOnly value={value}
          className={`w-full ${S.radiusSm} ${isSmall ? 'pl-2 pr-7' : 'pl-3 pr-8'} ${py} text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 cursor-pointer ${isSmall ? 'bg-white' : ''}`}
          style={isSmall ? { borderColor: S.border, borderWidth: 1, borderStyle: 'solid' } : inputSty} />
        <Icon size={iconSize} strokeWidth={1.5}
          className={`absolute ${isSmall ? 'right-2' : 'right-2.5'} text-gray-400 transition-colors cursor-pointer ${open ? 'text-[#94A533]' : 'group-focus-within/field:text-[#94A533]'}`} />
      </div>

      {mounted && createPortal(
        <TimePickerPanel ref={panelRef} anchorRef={wrapRef} open={open}
          hour={h} minute={m}
          onHourChange={(hh) => onChange(fmt(hh, m))}
          onMinuteChange={(mm) => onChange(fmt(h, mm))}
        />,
        document.body,
      )}
    </div>
  );
}

const TimePickerPanel = forwardRef<HTMLDivElement, {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}>(function TimePickerPanel({ anchorRef, open, hour, minute, onHourChange, onMinuteChange }, ref) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 160) });
  }, [anchorRef]);

  if (!pos) return null;
  const left = Math.min(pos.left, window.innerWidth - pos.width - 8);
  const top = Math.min(pos.top, window.innerHeight - PANEL_H - 16);

  return (
    <div ref={ref} className="fixed z-[60] rounded-[16px] overflow-hidden"
      style={{
        left, top, width: pos.width,
        background: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        border: `1px solid ${S.border}`,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.97)',
        transformOrigin: 'top center',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}>

      <div className="absolute inset-x-0 pointer-events-none z-[5]"
        style={{
          top: PAD_ROWS * ITEM_H,
          height: ITEM_H,
          background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.07))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.24)',
        }} />

      <div className="absolute top-0 bottom-0 left-1/2 w-px z-[6]" style={{ background: S.border }} />

      <div className="flex relative" style={{ height: PANEL_H }}>
        <DrumColumn items={HOURS} selected={hour} onSelect={onHourChange} label="小时" />
        <DrumColumn items={MINUTES} selected={minute} onSelect={onMinuteChange} label="分钟" />
      </div>
    </div>
  );
});

function DatePickerInput({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => {
    const parsed = value ? parseDateValue(value) : new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12, 0, 0, 0);
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) return;
    const parsed = clampDateToToday(parseDateValue(value));
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

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    openPanel();
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="group/field relative flex items-center cursor-pointer" onClick={toggle}>
        <input
          type="text"
          readOnly
          value={formatDateDisplay(value)}
          className={`${inputCls()} cursor-pointer`}
          style={inputSty}
        />
        <Calendar
          size={16}
          strokeWidth={1.5}
          className={`absolute right-2.5 transition-colors cursor-pointer ${open ? 'text-[#94A533]' : 'text-gray-400 group-focus-within/field:text-[#94A533]'}`}
        />
      </div>

      {mounted && createPortal(
        <DatePickerPanel
          ref={panelRef}
          anchorRef={wrapRef}
          open={open}
          value={value}
          displayMonth={displayMonth}
          onDisplayMonthChange={setDisplayMonth}
          onChange={(next) => {
            onChange(formatDateValue(clampDateToToday(parseDateValue(next))));
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </div>
  );
}

const DatePickerPanel = forwardRef<HTMLDivElement, {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  value: string;
  displayMonth: Date;
  onDisplayMonthChange: (date: Date) => void;
  onChange: (value: string) => void;
  onClose: () => void;
}>(function DatePickerPanel({
  anchorRef,
  open,
  value,
  displayMonth,
  onDisplayMonthChange,
  onChange,
  onClose,
}, ref) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [showMonthYearPicker, setShowMonthYearPicker] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 304) });
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) setShowMonthYearPicker(false);
  }, [open]);

  if (!pos) return null;

  const selectedDate = parseDateValue(value);
  const today = new Date();
  const safeToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  const isCurrentMonth = displayMonth.getFullYear() === safeToday.getFullYear() && displayMonth.getMonth() === safeToday.getMonth();
  const calendarStart = startOfCalendarMonth(displayMonth);
  const currentYear = today.getFullYear();
  const yearItems = Array.from({ length: currentYear - 1999 + 2 }, (_, index) => 2000 + index);
  const monthItems = Array.from({ length: 12 }, (_, index) => index + 1);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });

  const left = Math.min(pos.left, window.innerWidth - pos.width - 8);
  const top = Math.min(pos.top, window.innerHeight - 332);

  return (
    <div
      ref={ref}
      className="fixed z-[60] rounded-[16px] overflow-hidden p-3"
      style={{
        left,
        top,
        width: pos.width,
        background: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        border: `1px solid ${S.border}`,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.97)',
        transformOrigin: 'top center',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onDisplayMonthChange(addMonths(displayMonth, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef4dd]"
            style={{
              color: '#6d7d2a',
              background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
            }}
            aria-label="上个月"
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <div className="relative flex-1">
            <button
              type="button"
              onClick={() => setShowMonthYearPicker((prev) => !prev)}
              className="relative flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 transition-colors hover:bg-[#f3f7e8]"
              style={{
                background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
                color: '#5e7316',
              }}
            >
              <span className="text-[15px] font-semibold tracking-[0.02em]">
                {displayMonth.getFullYear()}年
              </span>
              <span className="relative pr-4 text-[15px] font-semibold tracking-[0.02em]">
                {displayMonth.getMonth() + 1}月
                <ChevronRight
                  size={13}
                  strokeWidth={2}
                  className="absolute right-[-1px] bottom-[1px] transition-transform"
                  style={{
                    color: '#7b8d30',
                    transform: `rotate(${showMonthYearPicker ? 270 : 90}deg)`,
                  }}
                />
              </span>
            </button>

            {showMonthYearPicker && (
              <div
                className="absolute left-1/2 top-[calc(100%+10px)] z-20 w-[216px] -translate-x-1/2 overflow-hidden rounded-[16px]"
                style={{
                  background: '#fff',
                  border: `1px solid ${S.border}`,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.14)',
                }}
              >
                <div
                  className="absolute inset-x-0 pointer-events-none z-[5]"
                  style={{
                    top: 28,
                    height: 28,
                    background: 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.07))',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.24)',
                  }}
                />
                <div className="absolute top-0 bottom-0 left-1/2 w-px z-[6]" style={{ background: S.border }} />
                <div className="flex relative" style={{ height: 84 }}>
                  <DrumColumn
                    items={yearItems}
                    selected={displayMonth.getFullYear()}
                    onSelect={(nextYear) => onDisplayMonthChange(new Date(nextYear, displayMonth.getMonth(), 1, 12, 0, 0, 0))}
                    label="年份"
                    itemHeight={28}
                    visibleRows={3}
                    renderValue={(year) => String(year)}
                  />
                  <DrumColumn
                    items={monthItems}
                    selected={displayMonth.getMonth() + 1}
                    onSelect={(nextMonth) => onDisplayMonthChange(new Date(displayMonth.getFullYear(), nextMonth - 1, 1, 12, 0, 0, 0))}
                    label="月份"
                    itemHeight={28}
                    visibleRows={3}
                    renderValue={(month) => `${month}月`}
                  />
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDisplayMonthChange(addMonths(displayMonth, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef4dd]"
            style={{
              color: isCurrentMonth ? 'rgba(109,125,42,0.35)' : '#6d7d2a',
              background: isCurrentMonth ? 'linear-gradient(180deg, rgba(148,165,51,0.06), rgba(148,165,51,0.03))' : 'linear-gradient(180deg, rgba(148,165,51,0.12), rgba(148,165,51,0.06))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
              cursor: isCurrentMonth ? 'not-allowed' : 'pointer',
              opacity: isCurrentMonth ? 0.72 : 1,
            }}
            aria-label="下个月"
            disabled={isCurrentMonth}
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
        </div>

      </div>

      <div className="mb-2 grid grid-cols-7 gap-1 px-1">
        {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
          <div key={label} className="flex h-8 items-center justify-center text-[11px] font-medium" style={{ color: S.sub }}>
            {label}
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-1 rounded-[16px] p-2.5"
        style={{
          background: 'linear-gradient(180deg, rgba(251,252,247,0.98), rgba(247,249,241,0.95))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.82)',
        }}
      >
        {days.map((day) => {
          const inMonth = day.getMonth() === displayMonth.getMonth();
          const isSelected = sameDay(day, selectedDate);
          const isToday = sameDay(day, today);
          const isFuture = isAfterDay(day, safeToday);
          const textColor = isSelected
            ? '#556813'
            : isFuture
              ? 'rgba(164, 170, 178, 0.46)'
              : inMonth
              ? S.text
              : 'rgba(139, 145, 153, 0.62)';

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => {
                if (isFuture) return;
                onChange(formatDateValue(day));
              }}
              className="relative flex h-10 items-center justify-center rounded-[13px] text-[13px] transition-all duration-150 hover:-translate-y-[1px]"
              disabled={isFuture}
              style={{
                color: textColor,
                background: isFuture
                  ? 'transparent'
                  : isSelected
                  ? 'linear-gradient(180deg, rgba(148,165,51,0.24), rgba(148,165,51,0.12))'
                  : isToday
                    ? 'linear-gradient(180deg, rgba(148,165,51,0.10), rgba(148,165,51,0.05))'
                    : 'transparent',
                fontWeight: isFuture ? 500 : isSelected ? 750 : isToday ? 650 : 520,
                boxShadow: isFuture
                  ? 'none'
                  : isSelected
                  ? '0 4px 12px rgba(148,165,51,0.12), inset 0 0 0 1px rgba(148,165,51,0.18)'
                  : isToday
                    ? 'inset 0 0 0 1px rgba(148,165,51,0.10)'
                    : 'none',
                opacity: isFuture ? 0.42 : inMonth ? 1 : 0.78,
                cursor: isFuture ? 'not-allowed' : 'pointer',
                transform: isFuture ? 'none' : undefined,
              }}
            >
              <span>{day.getDate()}</span>
              {isToday && !isSelected && (
                <span
                  className="absolute bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: 'rgba(148,165,51,0.75)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            onDisplayMonthChange(new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0));
            onChange(formatDateValue(now));
          }}
          className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#f3f5ea]"
          style={{ color: '#5e7316' }}
        >
          今天
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors hover:bg-[#f4f4ef]"
          style={{ color: S.sub }}
        >
          关闭
        </button>
      </div>
    </div>
  );
});
/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Trend Chart
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

function SleepTrendChart({ records, ageMonths }: { records: SleepRecordRow[]; ageMonths: number }) {
  const [refLo, refHi] = referenceSleepRange(ageMonths);

  const data = useMemo(() => {
    const last7 = [...records]
      .sort((a, b) => a.sleepDate.localeCompare(b.sleepDate))
      .slice(-7);
    return last7.map((r) => {
      const totalH = ((r.durationMinutes ?? 0) + (r.napMinutes ?? 0)) / 60;
      return {
        date: r.sleepDate.slice(5), // MM-DD
        hours: Math.round(totalH * 10) / 10,
      };
    });
  }, [records]);

  if (data.length < 2) return null;

  return (
    <div className={`${S.radius} p-4 mb-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium" style={{ color: S.text }}>睡眠趋势</span>
        <span className="text-[11px]" style={{ color: S.sub }}>参考 {refLo}-{refHi}h/天</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={S.accent} stopOpacity={0.3} />
              <stop offset="95%" stopColor={S.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: S.sub }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: S.sub }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
          <ReferenceArea y1={refLo} y2={refHi} fill="#94A533" fillOpacity={0.08} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${S.border}`, boxShadow: S.shadow }}
            formatter={(v: number) => [`${v}h`, '睡眠时长']}
          />
          <Area type="monotone" dataKey="hours" stroke={S.accent} strokeWidth={2} fill="url(#sleepGrad)" dot={{ r: 3, fill: S.accent }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Main Page
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

export default function SleepPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<SleepRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const tier = sleepAgeTier(ageMonths);
  const showNightWakings = tier === 'infant' || tier === 'toddler';
  const showNapNotes = tier === 'infant' || tier === 'toddler';
  const defaults = TIER_DEFAULTS[tier];

  // Form state
  const [formSleepDate, setFormSleepDate] = useState(new Date().toISOString().slice(0, 10));
  const [formBedtime, setFormBedtime] = useState(defaults.bed);
  const [formWakeTime, setFormWakeTime] = useState(defaults.wake);
  const [formQuality, setFormQuality] = useState('good');
  const [formNotes, setFormNotes] = useState('');
  const [formNightWakings, setFormNightWakings] = useState('');
  // Dynamic nap rows: each has start/end time
  const [napRows, setNapRows] = useState<Array<{ start: string; end: string }>>([]);
  const [napAddHover, setNapAddHover] = useState(false);

  useEffect(() => {
    if (activeChildId) getSleepRecords(activeChildId).then(setRecords).catch(catchLog('sleep', 'action:load-sleep-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.sleepDate).getTime() - new Date(a.sleepDate).getTime(),
  );
  const [refLo, refHi] = referenceSleepRange(ageMonths);

  // Nap helpers
  const addNapRow = () => setNapRows((prev) => [...prev, { start: '13:00', end: '14:30' }]);
  const removeNapRow = (i: number) => setNapRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateNapRow = (i: number, field: 'start' | 'end', val: string) =>
    setNapRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const napDurations = napRows.map((r) => calcDuration(r.start, r.end) ?? 0);
  const totalNapMinutes = napDurations.reduce((s, d) => s + d, 0);
  const napCount = napRows.length;

  const resetForm = () => {
    setFormSleepDate(new Date().toISOString().slice(0, 10));
    setFormBedtime(defaults.bed);
    setFormWakeTime(defaults.wake);
    setFormQuality('good');
    setFormNotes('');
    setFormNightWakings('');
    setNapRows([]);
    setShowForm(false);
  };

  const autoDuration = calcDuration(formBedtime, formWakeTime);

  const handleSubmit = async () => {
    if (!formSleepDate) return;
    const safeSleepDate = formatDateValue(clampDateToToday(parseDateValue(formSleepDate)));
    const now = isoNow();
    // Pack nap details into notes
    const napNotes = napRows.length > 0
      ? napRows.map((r, i) => `${r.start}-${r.end}(${fmtDuration(napDurations[i]!)})`).join(', ')
      : '';
    const notes = packNotes(formNightWakings, napNotes, formNotes);
    try {
      await upsertSleepRecord({
        recordId: ulid(),
        childId: child.childId,
        sleepDate: safeSleepDate,
        bedtime: formBedtime || null,
        wakeTime: formWakeTime || null,
        durationMinutes: autoDuration,
        napCount: napCount > 0 ? napCount : null,
        napMinutes: totalNapMinutes > 0 ? totalNapMinutes : null,
        quality: formQuality || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formSleepDate),
        notes,
        now,
      });
      const updated = await getSleepRecords(child.childId);
      setRecords(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>睡眠记录</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加记录
          </button>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>
      <AISummaryCard domain="sleep" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={records.length > 0 ? `近期 ${records.length} 条睡眠记录，最近一次: ${records[0]?.sleepDate ?? ''}` : ''}
      />
      <p className="text-sm mb-4" style={{ color: S.sub }}>
        参考睡眠时长: {refLo}-{refHi} 小时/天（{formatAge(ageMonths)} · {TIER_LABELS[tier]}）</p>

      {/* 鈹€鈹€ Add Form Modal 鈹€鈹€ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <section className={`w-[480px] max-h-[85vh] overflow-y-auto ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#EEF3F1' }}>
                <Moon size={18} strokeWidth={1.5} style={{ color: S.accent }} />
              </span>
              <h2 className="text-[15px] font-bold" style={{ color: S.text }}>新增睡眠记录</h2>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-2 space-y-4 flex-1">

            {/* 鈹€鈹€ Row 1: Date + Night sleep 鈹€鈹€ */}
              <div className="grid grid-cols-3 gap-3">
                <label className="text-[11px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
                  日期
                  <DatePickerInput value={formSleepDate} onChange={setFormSleepDate} />
                </label>
              <label className="text-[11px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
                入睡时间
                <TimePickerInput value={formBedtime} onChange={setFormBedtime} icon={Moon} />
              </label>
              <label className="text-[11px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
                起床时间
                <TimePickerInput value={formWakeTime} onChange={setFormWakeTime} icon={Sun} />
              </label>
            </div>

            {/* Auto night duration */}
            {autoDuration !== null && (
              <p className="text-[11px] -mt-2 font-medium" style={{ color: S.accent }}>
                夜间 {fmtDuration(autoDuration)}
              </p>
            )}

            {/* 鈹€鈹€ Night wakings (infant/toddler only) 鈹€鈹€ */}
            {showNightWakings && (
              <label className="text-[11px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
                夜醒次数
                <div className="group/field relative flex items-center w-32">
                  <input type="number" min="0" max="20" placeholder="0" value={formNightWakings} onChange={(e) => setFormNightWakings(e.target.value)}
                    className={inputCls()} style={inputSty} />
                  <Moon size={16} strokeWidth={1.5} className="absolute right-2.5 pointer-events-none text-gray-400 transition-colors group-focus-within/field:text-[#94A533]" />
                </div>
              </label>
            )}

            {/* 鈹€鈹€ Nap section: dynamic rows 鈹€鈹€ */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium" style={{ color: S.text }}>
                  {tier === 'infant' || tier === 'toddler' ? '日间小睡' : '午睡'}
                </span>
                {napCount > 0 && (
                  <span className="text-[11px] font-medium" style={{ color: S.accent }}>
                    {napCount} 次 · {fmtDuration(totalNapMinutes)}
                  </span>
                )}
              </div>

              {/* Nap rows */}
              <div className="space-y-2">
                {napRows.map((row, i) => (
                  <div key={i} className={`flex items-center gap-2 ${S.radiusSm} px-3 py-2`} style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
                    <div className="flex-1">
                      <TimePickerInput value={row.start} onChange={(v) => updateNapRow(i, 'start', v)} icon={Clock} size="small" />
                    </div>
                    <span className="text-[11px] shrink-0" style={{ color: S.sub }}>至</span>
                    <div className="flex-1">
                      <TimePickerInput value={row.end} onChange={(v) => updateNapRow(i, 'end', v)} icon={Clock} size="small" />
                    </div>
                    {napDurations[i]! > 0 && (
                      <span className="text-[11px] font-medium shrink-0 w-10 text-right" style={{ color: S.accent }}>
                        {fmtDuration(napDurations[i]!)}
                      </span>
                    )}
                    <button onClick={() => removeNapRow(i)}
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors"
                      style={{ color: S.sub }}>
                      <X size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add nap button */}
              <button onClick={addNapRow}
                onMouseEnter={() => setNapAddHover(true)}
                onMouseLeave={() => setNapAddHover(false)}
                className={`flex flex-col items-center justify-center gap-1 w-full mt-2 py-3 ${S.radiusSm} cursor-pointer`}
                style={{
                  border: `2px dashed ${napAddHover ? '#c8e64a' : '#d0d0cc'}`,
                  background: '#fafaf8',
                  transition: 'border-color 0.25s ease',
                }}>
                <Plus size={18} strokeWidth={1.5}
                  style={{
                    color: napAddHover ? '#94A533' : '#b0b0aa',
                    transform: napAddHover ? 'scale(1.15)' : 'scale(1)',
                    transition: 'color 0.25s ease, transform 0.25s ease',
                  }} />
                <span className="text-[11px] font-medium" style={{
                  color: napAddHover ? '#94A533' : '#a0a0a0',
                  transition: 'color 0.25s ease',
                }}>
                  添加{tier === 'infant' || tier === 'toddler' ? '小睡' : '午睡'}
                </span>
              </button>
            </div>

            {/* 鈹€鈹€ Whole-day assessment: Quality + Notes 鈹€鈹€ */}
            <div className="pt-1 space-y-3">
              <label className="text-[11px] flex flex-col gap-1 font-medium w-32" style={{ color: S.sub }}>
                睡眠质量
                <AppSelect value={formQuality} onChange={setFormQuality}
                  options={QUALITY_OPTIONS.map((v) => ({ value: v, label: QUALITY_LABELS[v] ?? v }))} />
              </label>
              <div>
                <label className="text-[11px] mb-1 font-medium block" style={{ color: S.sub }}>备注</label>
                <input placeholder="补充今天的睡眠细节..." value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                  className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                  style={inputSty} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pt-3 pb-5 mt-1">
            <div className="flex items-center justify-end gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={handleSubmit} className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存</button>
            </div>
          </div>
        </section>
        </div>
      )}

      {/* 鈹€鈹€ Trend Chart 鈹€鈹€ */}
      {records.length >= 2 && <SleepTrendChart records={records} ageMonths={ageMonths} />}

      {/* 鈹€鈹€ Records List 鈹€鈹€ */}
      <section>
        {sortedRecords.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[28px]">😴</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有睡眠记录</p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>点击上方按钮添加第一条记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map((r) => (
              <SleepRecordCard key={r.recordId} record={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Record Card 鈥?age-adaptive display
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

function SleepRecordCard({ record: r }: { record: SleepRecordRow }) {
  const tier = sleepAgeTier(r.ageMonths);
  const totalMin = (r.durationMinutes ?? 0) + (r.napMinutes ?? 0);
  const { nightWakings, napNotes, freeNotes } = unpackNotes(r.notes);
  const qc = r.quality ? QUALITY_COLOR[r.quality] : null;

  return (
    <div className={S.radius + ' p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
      {/* Header row: date + quality + age */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: S.text }}>{r.sleepDate.split('T')[0]}</span>
          {r.quality && qc && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: qc.bg, color: qc.text }}>
              {QUALITY_LABELS[r.quality] ?? r.quality}
            </span>
          )}
        </div>
        <span className="text-[10px]" style={{ color: S.sub }}>{formatAge(r.ageMonths)}</span>
      </div>

      {/* Tier-adaptive body */}
      {tier === 'infant' || tier === 'toddler' ? (
        /* 鈹€鈹€ Infant/Toddler: hero total, naps prominent 鈹€鈹€ */
        <div className="flex items-baseline gap-4">
          {totalMin > 0 && (
            <div>
              <span className="text-[22px] font-bold" style={{ color: S.text }}>{(totalMin / 60).toFixed(1)}</span>
              <span className="text-[11px] ml-0.5" style={{ color: S.sub }}>小时</span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: S.sub }}>
            {r.bedtime && r.wakeTime && <span>{r.bedtime.slice(0, 5)} - {r.wakeTime.slice(0, 5)}</span>}
            {r.durationMinutes != null && <span>夜间 {fmtDuration(r.durationMinutes)}</span>}
            {r.napCount != null && <span>小睡 {r.napCount} 次</span>}
            {r.napMinutes != null && r.napMinutes > 0 && <span>小睡 {r.napMinutes}分钟</span>}
            {nightWakings != null && nightWakings > 0 && (
              <span style={{ color: '#d97706' }}>夜醒 {nightWakings} 次</span>
            )}
          </div>
        </div>
      ) : tier === 'preschool' ? (
        /* 鈹€鈹€ Preschool: night duration + nap 鈹€鈹€ */
        <div className="flex items-baseline gap-4">
          {r.durationMinutes != null && (
            <div>
              <span className="text-[18px] font-bold" style={{ color: S.text }}>{fmtDuration(r.durationMinutes)}</span>
              <span className="text-[11px] ml-1" style={{ color: S.sub }}>夜间</span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 text-[11px]" style={{ color: S.sub }}>
            {r.bedtime && r.wakeTime && <span>{r.bedtime.slice(0, 5)} - {r.wakeTime.slice(0, 5)}</span>}
            {r.napMinutes != null && r.napMinutes > 0 && <span>午睡 {r.napMinutes}分钟</span>}
            {totalMin > 0 && <span>总计 {(totalMin / 60).toFixed(1)}h</span>}
          </div>
        </div>
      ) : (
        /* 鈹€鈹€ School: bedtime/wake prominent 鈹€鈹€ */
        <div className="flex items-baseline gap-4">
          {r.bedtime && r.wakeTime && (
            <span className="text-[16px] font-semibold" style={{ color: S.text }}>
              {r.bedtime.slice(0, 5)} - {r.wakeTime.slice(0, 5)}
            </span>
          )}
          <div className="flex gap-x-3 text-[11px]" style={{ color: S.sub }}>
            {r.durationMinutes != null && <span>{fmtDuration(r.durationMinutes)}</span>}
            {r.napCount != null && r.napCount > 0 && <span>小睡 {r.napCount} 次</span>}
            {r.napMinutes != null && r.napMinutes > 0 && <span>小睡 {r.napMinutes}分钟</span>}
            {totalMin > 0 && r.napMinutes != null && r.napMinutes > 0 && <span>总计 {(totalMin / 60).toFixed(1)}h</span>}
          </div>
        </div>
      )}

      {/* Nap detail notes */}
      {napNotes && (
        <p className="text-[11px] mt-1.5" style={{ color: S.sub }}>小睡: {napNotes}</p>
      )}
      {/* Free-form notes */}
      {freeNotes && (
        <p className="text-[11px] mt-1" style={{ color: S.sub }}>{freeNotes}</p>
      )}
    </div>
  );
}
