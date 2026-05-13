import { useEffect, type ReactNode } from 'react';
import { S } from '../../app-shell/page-style.js';

/* ── Primitives ────────────────────────────────────────── */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Escape key closes — standard modal behavior. Registered once per mount so
  // multiple open modals don't double-fire (only the topmost should listen,
  // but we don't stack modals in this surface in practice).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', display: 'grid', placeItems: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', padding: 24, borderRadius: 16, minWidth: 360, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="flex items-center justify-between">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 18, color: '#64748b' }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="text-[13px] px-3 py-2 rounded-md flex items-start justify-between gap-2"
      style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
      <span style={{ wordBreak: 'break-word' }}>{message}</span>
      <button type="button" onClick={onDismiss}
        style={{ background: 'transparent', border: 0, color: '#b91c1c', cursor: 'pointer', flexShrink: 0 }}>
        ×
      </button>
    </div>
  );
}

export function ModalFooter({ onCancel, onSubmit, submitLabel, disabled }: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button type="button" onClick={onCancel} className="text-[14px]"
        style={{ background: 'transparent', color: '#64748b', border: 0, cursor: 'pointer', padding: '6px 12px' }}>
        取消
      </button>
      <button type="button" onClick={onSubmit} disabled={disabled} className="text-[14px] font-semibold text-white"
        style={{
          background: disabled ? '#cbd5e1' : S.accent,
          padding: '6px 14px',
          borderRadius: 8,
          border: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {submitLabel}
      </button>
    </div>
  );
}

export function FieldSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FieldInput({ label, type = 'text', value, onChange, placeholder, required }: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      <span>
        {label}
        {required && <span aria-hidden="true" style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
      </span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-required={required || undefined}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}

export function FieldTextarea({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}
