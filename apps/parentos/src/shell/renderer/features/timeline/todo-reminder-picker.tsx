import React, { useEffect, useRef, useState } from 'react';
import { REMINDER_OFFSET_PRESETS, describeReminderOffset } from './todo-recurrence.js';

type TodoReminderPickerProps = {
  value: number | null;
  onChange: (minutes: number | null) => void;
};

const CLOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export function TodoReminderPicker({ value, onChange }: TodoReminderPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = value !== null && value !== undefined;

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
        {CLOCK_ICON}
        <span>{active ? describeReminderOffset(value) : '提醒'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-[184px] rounded-2xl border p-1.5"
          style={{ background: '#ffffff', borderColor: '#eef0ee', boxShadow: '0 10px 28px rgba(17, 24, 39, 0.08)' }}
        >
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-[#f3f4f6]"
            style={{ color: !active ? '#3BB88A' : '#64748b' }}
          >
            <span>不提醒</span>
            {!active && <span style={{ color: '#3BB88A' }}>✓</span>}
          </button>
          <div className="my-1 h-px" style={{ background: '#eef0ee' }} />
          {REMINDER_OFFSET_PRESETS.map((preset) => {
            const selected = value === preset.minutes;
            return (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => { onChange(preset.minutes); setOpen(false); }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] transition-colors hover:bg-[#f3f4f6]"
                style={{ color: selected ? '#3BB88A' : '#1e293b' }}
              >
                <span>{preset.label}</span>
                {selected && <span style={{ color: '#3BB88A' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
