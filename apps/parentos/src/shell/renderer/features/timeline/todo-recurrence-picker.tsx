import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TodoRecurrenceRule, TodoRecurrencePreset, TodoRecurrenceUnit } from '../../bridge/sqlite-bridge.js';
import { describeRecurrenceRule } from './todo-recurrence.js';

type TodoRecurrencePickerProps = {
  value: TodoRecurrenceRule | null;
  onChange: (rule: TodoRecurrenceRule | null) => void;
};

const REPEAT_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>
);

const PRESETS: ReadonlyArray<{ preset: TodoRecurrencePreset; label: string }> = [
  { preset: 'daily', label: '每天' },
  { preset: 'weekly', label: '每周' },
  { preset: 'monthly', label: '每月' },
  { preset: 'yearly', label: '每年' },
  { preset: 'custom', label: '自定义' },
];

const UNITS: ReadonlyArray<{ unit: TodoRecurrenceUnit; label: string }> = [
  { unit: 'day', label: '天' },
  { unit: 'week', label: '周' },
  { unit: 'month', label: '月' },
  { unit: 'year', label: '年' },
];

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

export function TodoRecurrencePicker({ value, onChange }: TodoRecurrencePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = value !== null;

  const [customInterval, setCustomInterval] = useState<number>(value?.interval ?? 1);
  const [customUnit, setCustomUnit] = useState<TodoRecurrenceUnit>(value?.unit ?? 'day');
  const [customWeekdays, setCustomWeekdays] = useState<number[]>(value?.weekdays ?? []);
  const [showCustomEditor, setShowCustomEditor] = useState(value?.preset === 'custom');

  useEffect(() => {
    if (value?.preset === 'custom') {
      setCustomInterval(value.interval ?? 1);
      setCustomUnit(value.unit ?? 'day');
      setCustomWeekdays(value.weekdays ?? []);
      setShowCustomEditor(true);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const node = wrapperRef.current;
      if (node && !node.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handlePresetClick = (preset: TodoRecurrencePreset) => {
    if (preset === 'custom') {
      setShowCustomEditor(true);
      return;
    }
    onChange({ preset });
    setShowCustomEditor(false);
    setOpen(false);
  };

  const handleCustomApply = () => {
    const interval = Math.max(1, Math.min(999, Math.floor(customInterval) || 1));
    const rule: TodoRecurrenceRule = {
      preset: 'custom',
      interval,
      unit: customUnit,
    };
    if (customUnit === 'week' && customWeekdays.length > 0) {
      rule.weekdays = [...customWeekdays].sort((a, b) => a - b);
    }
    onChange(rule);
    setOpen(false);
  };

  const toggleWeekday = (day: number) => {
    setCustomWeekdays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      return [...prev, day];
    });
  };

  const chipLabel = useMemo(() => (active ? describeRecurrenceRule(value) : '重复'), [active, value]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors"
        style={{
          color: active ? '#ffffff' : '#64748b',
          background: active ? '#3BB88A' : 'transparent',
          border: 'none',
          boxShadow: active ? '0 2px 8px rgba(59, 184, 138, 0.28)' : 'none',
        }}
      >
        {REPEAT_ICON}
        <span className="max-w-[160px] truncate">{chipLabel}</span>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[260px] rounded-2xl border p-2"
          style={{ background: '#ffffff', borderColor: '#eef0ee', boxShadow: '0 10px 28px rgba(17, 24, 39, 0.08)' }}
        >
          <button
            type="button"
            onClick={() => { onChange(null); setShowCustomEditor(false); setOpen(false); }}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-[#f3f4f6]"
            style={{ color: !active ? '#3BB88A' : '#64748b' }}
          >
            <span>不重复</span>
            {!active && <span style={{ color: '#3BB88A' }}>✓</span>}
          </button>
          <div className="my-1 h-px" style={{ background: '#eef0ee' }} />

          {PRESETS.map((item) => {
            const selected = value?.preset === item.preset
              || (item.preset === 'custom' && showCustomEditor && value?.preset !== 'custom');
            return (
              <button
                key={item.preset}
                type="button"
                onClick={() => handlePresetClick(item.preset)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-[#f3f4f6]"
                style={{ color: selected ? '#3BB88A' : '#1e293b' }}
              >
                <span>{item.label}</span>
                {selected && <span style={{ color: '#3BB88A' }}>✓</span>}
              </button>
            );
          })}

          {showCustomEditor && (
            <div
              className="mt-2 rounded-xl p-3"
              style={{ background: '#f9fafb', border: '1px solid #eef0ee' }}
            >
              <div className="mb-2 text-[12px] font-semibold" style={{ color: '#111827' }}>自定义重复</div>
              <div className="flex items-center gap-2">
                <span className="text-[12px]" style={{ color: '#64748b' }}>每</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={customInterval}
                  onChange={(e) => setCustomInterval(Number(e.target.value))}
                  className="h-8 w-14 rounded-lg border px-2 text-[13px] outline-none"
                  style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                />
                <select
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as TodoRecurrenceUnit)}
                  className="h-8 rounded-lg border px-2 text-[13px] outline-none"
                  style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                >
                  {UNITS.map((u) => (
                    <option key={u.unit} value={u.unit}>{u.label}</option>
                  ))}
                </select>
              </div>

              {customUnit === 'week' && (
                <div className="mt-2.5">
                  <div className="mb-1.5 text-[11px]" style={{ color: '#64748b' }}>在这些日子重复</div>
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((d) => {
                      const on = customWeekdays.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleWeekday(d.value)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] transition-colors"
                          style={{
                            background: on ? '#3BB88A' : '#ffffff',
                            color: on ? '#ffffff' : '#64748b',
                            border: `1px solid ${on ? '#3BB88A' : '#e5e7eb'}`,
                          }}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCustomEditor(false); }}
                  className="h-7 rounded-full px-3 text-[12px] font-medium"
                  style={{ color: '#64748b', background: 'transparent' }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCustomApply}
                  className="h-7 rounded-full px-3 text-[12px] font-medium"
                  style={{ background: '#3BB88A', color: '#ffffff' }}
                >
                  确定
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
