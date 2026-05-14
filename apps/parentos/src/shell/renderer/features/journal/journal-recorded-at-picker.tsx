import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button, Surface, TextField, cn } from '@nimiplatform/nimi-kit/ui';
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
      <Button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        tone="secondary"
        size="sm"
        className={cn(
          'min-h-0 parentos-radius-sm px-2.5 py-1.5 text-[13px]',
          isCustom
            ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]'
            : 'border-transparent bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)]',
        )}
        leadingIcon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        }
        title="调整记录时间"
        aria-label="调整记录时间"
      >
        <span>{label}</span>
      </Button>
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
      className="parentos-portal-frame fixed z-50"
      style={{
        '--parentos-portal-bottom': `${bottom}px`,
        '--parentos-portal-left': `${left}px`,
        '--parentos-portal-width': `${panelWidth}px`,
      } as CSSProperties}
    >
      <Surface tone="overlay" elevation="floating" padding="sm" className="parentos-radius-sm p-3">
        <p className="mb-2 text-[13px] text-[var(--nimi-text-muted)]">记录时间</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {RECORDED_AT_PRESETS.map((preset) => {
            const resolved = preset.resolve(now);
            const isActive = preset.key === 'now' ? props.value === null : props.value === resolved;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => props.onChange(resolved)}
                className={cn(
                  'parentos-radius-sm px-2.5 py-1 text-[12px] transition-colors',
                  isActive
                    ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                    : 'bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)]',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <label className="mb-1.5 block text-[12px] text-[var(--nimi-text-muted)]">自定义时间</label>
        <TextField
          type="datetime-local"
          value={customValue}
          max={maxDatetime}
          onChange={(event) => setCustomValue(event.target.value)}
          className="min-h-0 w-full parentos-radius-sm px-2 py-1.5 text-[13px]"
        />
        <div className="flex items-center justify-end gap-2 mt-3">
          <Button
            type="button"
            onClick={props.onClose}
            tone="ghost"
            size="sm"
            className="min-h-0 parentos-radius-sm px-3 py-1 text-[12px]"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => {
              const iso = fromDatetimeLocalValue(customValue);
              if (iso) props.onChange(iso);
            }}
            tone="primary"
            size="sm"
            className="min-h-0 parentos-radius-sm px-3 py-1 text-[12px] font-medium"
          >
            应用
          </Button>
        </div>
      </Surface>
    </div>
  );
}
