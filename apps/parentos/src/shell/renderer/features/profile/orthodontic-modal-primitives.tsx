import { Button, SelectField, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import { useEffect, type ReactNode } from 'react';

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
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--nimi-scrim-modal)]"
    >
      <Surface
        tone="overlay"
        material="glass-thick"
        elevation="modal"
        padding="lg"
        className="flex min-w-[360px] max-w-[460px] flex-col gap-3 rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[16px] font-semibold text-[var(--nimi-text-primary)]">{title}</h3>
          <Button
            type="button"
            onClick={onClose}
            tone="ghost"
            size="sm"
            className="h-7 min-h-7 w-7 rounded-full px-0 text-[18px]"
            aria-label="关闭"
          >
            ×
          </Button>
        </div>
        {children}
      </Surface>
    </div>
  );
}

export function ModalErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Surface
      role="alert"
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className="flex items-start justify-between gap-2 rounded-md border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] text-[13px] text-[var(--nimi-status-danger)]"
    >
      <span className="break-words">{message}</span>
      <Button
        type="button"
        onClick={onDismiss}
        tone="ghost"
        size="sm"
        className="h-6 min-h-6 w-6 shrink-0 rounded-full px-0 text-[var(--nimi-status-danger)]"
        aria-label="关闭错误提示"
      >
        ×
      </Button>
    </Surface>
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
      <Button type="button" onClick={onCancel} tone="ghost" size="sm">
        取消
      </Button>
      <Button type="button" onClick={onSubmit} disabled={disabled} tone="primary" size="sm">
        {submitLabel}
      </Button>
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
    <div className="flex flex-col gap-1 text-[14px] text-[var(--nimi-text-muted)]">
      <span>{label}</span>
      <SelectField
        value={value}
        onValueChange={onChange}
        options={options}
        className="min-h-9 text-[14px]"
      />
    </div>
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
    <div className="flex flex-col gap-1 text-[14px] text-[var(--nimi-text-muted)]">
      <span>
        {label}
        {required && <span aria-hidden="true" className="ml-1 text-[var(--nimi-status-danger)]">*</span>}
      </span>
      <TextField type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-required={required || undefined}
        className="min-h-9 text-[14px]" />
    </div>
  );
}

export function FieldTextarea({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-[14px] text-[var(--nimi-text-muted)]">
      <span>{label}</span>
      <TextareaField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="text-[14px]"
      />
    </div>
  );
}
