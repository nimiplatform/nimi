import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { S } from './page-style.js';

/* ── Types ── */

export interface AppSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface AppSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  /** Text shown when value is '' */
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

/* ── Chevron SVG ── */

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8a8f9a" strokeWidth="2" strokeLinecap="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/* ── Popover (portal) ── */

function SelectPopover({
  anchorRef, options, value, onSelect, onClose, open,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  options: AppSelectOption[];
  value: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  open: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // Position the popover below the trigger
  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 140) });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  // Clamp so it doesn't overflow viewport
  const maxH = 240;
  const left = Math.min(pos.left, window.innerWidth - pos.width - 8);
  const top = Math.min(pos.top, window.innerHeight - maxH - 8);

  return (
    <div
      ref={panelRef}
      className="fixed z-50 rounded-xl p-1 overflow-y-auto"
      style={{
        left, top, width: pos.width, maxHeight: maxH,
        background: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
        border: `1px solid ${S.border}`,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
        transformOrigin: 'top left',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {options.map((opt, idx) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value + idx}
            disabled={opt.disabled}
            onClick={() => { if (!opt.disabled) onSelect(opt.value); }}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left text-[12px] transition-colors hover:bg-[#f5f3ef] disabled:opacity-40 disabled:cursor-default"
            style={{
              ...(active ? { background: '#EEF3F1' } : undefined),
              color: S.text,
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(-4px)',
              transition: `opacity 0.2s ease ${idx * 0.025}s, transform 0.2s ease ${idx * 0.025}s, background-color 0.15s`,
            }}
          >
            <span className="flex-1 truncate">{opt.label}</span>
            {active && (
              <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke={S.accent} strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── AppSelect ── */

export function AppSelect({ value, onChange, options, placeholder, className, style }: AppSelectProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const openMenu = useCallback(() => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback((v: string) => {
    onChange(v);
    closeMenu();
  }, [onChange, closeMenu]);

  // Listen for transition end on the portal panel
  useEffect(() => {
    if (!mounted || open) return;
    // fallback unmount in case transitionEnd doesn't fire
    const t = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(t);
  }, [mounted, open]);

  const selectedLabel = options.find((o) => o.value === value)?.label;
  const displayText = selectedLabel ?? placeholder ?? '';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => open ? closeMenu() : openMenu()}
        className={`rounded-[10px] px-3 py-1.5 text-[12px] cursor-pointer bg-[#f9faf7] hover:bg-[#f0f2ee] transition-colors flex items-center gap-1 text-left ${className ?? ''}`}
        style={{
          borderWidth: 1, borderStyle: 'solid', borderColor: '#e8e5e0',
          color: selectedLabel ? S.text : S.sub,
          ...style,
        }}
      >
        <span className="flex-1 truncate">{displayText}</span>
        <span className="shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transitionDuration: '0.2s' }}>
          {CHEVRON}
        </span>
      </button>
      {mounted && createPortal(
        <SelectPopover
          anchorRef={btnRef}
          options={placeholder ? [{ value: '', label: placeholder }, ...options] : options}
          value={value}
          onSelect={handleSelect}
          onClose={closeMenu}
          open={open}
        />,
        document.body,
      )}
    </>
  );
}
