import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { S } from '../../app-shell/page-style.js';
import {
  RECORDED_AT_PRESETS,
  formatRecordedAtLabel,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from './journal-recorded-at.js';

export function RecordedAtPicker(props: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = useMemo(() => formatRecordedAtLabel(props.value), [props.value]);
  const isCustom = props.value !== null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`${S.radiusSm} px-2.5 py-1.5 text-[13px] flex items-center gap-1.5 transition-colors hover:bg-[#f0f0ec]`}
        style={{
          background: isCustom ? `${S.accent}15` : '#f5f3ef',
          color: isCustom ? S.accent : S.sub,
          border: isCustom ? `1px solid ${S.accent}40` : '1px solid transparent',
        }}
        title="调整记录时间"
        aria-label="调整记录时间"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>{label}</span>
      </button>
      {open ? createPortal(
        <RecordedAtPopover
          anchorRef={buttonRef}
          value={props.value}
          onChange={(next) => {
            props.onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      ) : null}
    </>
  );
}

function RecordedAtPopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  value: string | null;
  onChange: (value: string | null) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [now] = useState(() => new Date());
  const [customValue, setCustomValue] = useState(() => toDatetimeLocalValue(props.value, now));

  useEffect(() => {
    const btn = props.anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({
      left: Math.max(8, rect.left),
      bottom: window.innerHeight - rect.top + 6,
    });
  }, [props.anchorRef]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)
        && props.anchorRef.current && !props.anchorRef.current.contains(event.target as Node)) {
        props.onClose();
      }
    };
    const escHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [props]);

  if (!pos) return null;

  const panelWidth = 280;
  const left = Math.min(pos.left, window.innerWidth - panelWidth - 8);
  const bottom = Math.min(pos.bottom, window.innerHeight - 240);
  const maxDatetime = toDatetimeLocalValue(now.toISOString(), now);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="选择记录时间"
      className={`fixed z-50 ${S.radiusSm} p-3 shadow-xl`}
      style={{ background: S.card, border: `1px solid ${S.border}`, width: panelWidth, left, bottom }}
    >
      <p className="text-[13px] mb-2" style={{ color: S.sub }}>记录时间</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {RECORDED_AT_PRESETS.map((preset) => {
          const resolved = preset.resolve(now);
          const isActive = preset.key === 'now' ? props.value === null : props.value === resolved;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => props.onChange(resolved)}
              className={`${S.radiusSm} px-2.5 py-1 text-[12px] transition-colors`}
              style={isActive
                ? { background: S.accent, color: '#fff' }
                : { background: '#f5f3ef', color: S.text }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <label className="block text-[12px] mb-1.5" style={{ color: S.sub }}>自定义时间</label>
      <input
        type="datetime-local"
        value={customValue}
        max={maxDatetime}
        onChange={(event) => setCustomValue(event.target.value)}
        className={`w-full ${S.radiusSm} px-2 py-1.5 text-[13px] outline-none`}
        style={{ background: '#fafaf8', border: `1px solid ${S.border}`, color: S.text }}
      />
      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={props.onClose}
          className={`${S.radiusSm} px-3 py-1 text-[12px]`}
          style={{ background: '#f5f3ef', color: S.sub }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            const iso = fromDatetimeLocalValue(customValue);
            if (iso) props.onChange(iso);
          }}
          className={`${S.radiusSm} px-3 py-1 text-[12px] font-medium text-white`}
          style={{ background: S.accent }}
        >
          应用
        </button>
      </div>
    </div>
  );
}
