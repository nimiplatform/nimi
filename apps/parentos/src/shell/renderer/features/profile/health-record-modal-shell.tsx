/**
 * Unified modal system for "添加健康数据" pages on the ParentOS profile/档案 surface.
 *
 * Layout (composed by the shell):
 *   ┌──────────────┬───────────────────────────────────┐
 *   │              │ ModalHeader   (72px)              │
 *   │ Sidebar      ├───────────────────────────────────┤
 *   │ (200px,      │ ModalContent  (scrollable, p-6)   │
 *   │  optional)   │                                   │
 *   │              ├───────────────────────────────────┤
 *   │              │ ModalFooter   (76px, glass blur)  │
 *   └──────────────┴───────────────────────────────────┘
 *
 * Sizes (total modal width — sidebar included):
 *   M  = 720  → use for: growth, sleep, outdoor
 *   L  = 920  → use for: fitness
 *   XL = 1040 → use for: vision, dental, medical, development
 *
 * All chrome (radius 28, max-h 88vh, shadow, header/footer height) is owned by
 * this module. Per-page Content components must NOT redefine width, radius,
 * padding, or footer chrome.
 */

import {
  forwardRef,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { Button as KitButton, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import { ProfileDatePicker } from './profile-date-picker.js';
import { AppSelect, type AppSelectOption } from '../../app-shell/app-select.js';

/* ── Tokens ─────────────────────────────────────────────────────────────── */

export type HealthModalSize = 'M' | 'L' | 'XL';

const SIZE_WIDTH: Record<HealthModalSize, number> = {
  M: 720,
  L: 920,
  XL: 1040,
};

export const HEALTH_MODAL_TOKENS = {
  radius: 28,
  fieldRadius: 14,
  fieldHeight: 48,
  headerHeight: 72,
  footerHeight: 76,
  sidebarWidth: 200,
  maxHeight: '88vh',
  shadow: 'var(--nimi-elevation-modal)',
  surface: 'var(--nimi-surface-card)',
  surfaceMuted: 'var(--nimi-surface-panel)',
  border: 'var(--nimi-border-subtle)',
  text: 'var(--nimi-text-primary)',
  sub: 'var(--nimi-text-muted)',
  accent: 'var(--nimi-action-primary-bg)',
  fieldBg: 'var(--nimi-field-bg)',
  fieldBorder: 'var(--nimi-field-border)',
  footerGlass: 'var(--nimi-material-glass-regular-bg)',
} as const;

/* ── Shell ──────────────────────────────────────────────────────────────── */

type HealthRecordModalShellProps = {
  open: boolean;
  size: HealthModalSize;
  onClose: () => void;
  sidebar?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
};

export function HealthRecordModalShell({
  open,
  size,
  onClose,
  sidebar,
  children,
  ariaLabel = 'health-capture-modal',
}: HealthRecordModalShellProps) {
  if (!open) return null;
  const width = SIZE_WIDTH[size];

  return (
    <div
      role="dialog"
      aria-label={ariaLabel}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nimi-scrim-modal)]"
      onClick={onClose}
    >
      <Surface
        as="section"
        tone="overlay"
        material="glass-thick"
        elevation="modal"
        padding="none"
        className="flex overflow-hidden rounded-3xl"
        style={{
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: HEALTH_MODAL_TOKENS.maxHeight,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {sidebar}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </Surface>
    </div>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */

export type HealthRecordSidebarItem = {
  id: string;
  label: ReactNode;
  emoji?: string;
  disabled?: boolean;
};

type HealthRecordSidebarProps = {
  items: HealthRecordSidebarItem[];
  selected: string;
  onSelect: (id: string) => void;
  title?: string;
  footer?: ReactNode;
};

export function HealthRecordSidebar({ items, selected, onSelect, title, footer }: HealthRecordSidebarProps) {
  return (
    <aside
      className="flex shrink-0 flex-col border-r border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-5"
      style={{
        width: HEALTH_MODAL_TOKENS.sidebarWidth,
      }}
    >
      {title ? (
        <div
          className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]"
        >
          {title}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const isSelected = selected === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => onSelect(item.id)}
              className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors disabled:opacity-40 ${
                isSelected
                  ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]'
                  : 'bg-transparent text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)]'
              }`}
            >
              {item.emoji ? <span aria-hidden="true">{item.emoji}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
      {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
    </aside>
  );
}

/* ── SmartInputButton ──────────────────────────────────────────────────── */

type SmartInputButtonProps = {
  loading: boolean;
  error: string | null;
  imageName: string | null;
  accept?: string;
  hint?: string;
  onUpload: (file: File) => void;
};

export function SmartInputButton({
  loading,
  error,
  imageName,
  accept = 'image/*',
  hint,
  onUpload,
}: SmartInputButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = loading
    ? imageName
      ? `正在识别 ${imageName}…`
      : '识别中…'
    : error
      ? error
      : imageName
        ? `✓ 已从 ${imageName} 提取`
        : (hint ?? '上传图片，AI 自动填表');
  const statusClass = loading
    ? 'text-[var(--nimi-action-primary-bg)]'
    : error
      ? 'text-[var(--nimi-status-danger)]'
      : imageName
        ? 'text-[var(--nimi-action-primary-bg)]'
        : 'text-[var(--nimi-text-muted)]';

  return (
    <div
      className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3"
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex w-full items-center gap-2 rounded-xl bg-[var(--nimi-action-primary-bg)] px-3 py-2.5 text-[13px] font-semibold text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] transition-all hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-[16px]">
          {loading ? '⏳' : '🤖'}
        </span>
        <span className="flex-1 text-left truncate">
          {loading ? '识别中…' : '智能录入'}
        </span>
      </button>
      <p className={`mt-2 text-[11px] leading-snug ${statusClass}`}>
        {status}
      </p>
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

type ModalHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  trailing?: ReactNode;
};

export function ModalHeader({ title, subtitle, icon, onClose, trailing }: ModalHeaderProps) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-6"
      style={{
        height: HEALTH_MODAL_TOKENS.headerHeight,
      }}
    >
      {icon ? (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)] text-[18px]"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2
          className="truncate text-[16px] font-bold leading-tight text-[var(--nimi-text-primary)]"
        >
          {title}
        </h2>
        {subtitle ? (
          <p
            className="truncate text-[12.5px] leading-tight mt-0.5 text-[var(--nimi-text-muted)]"
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {trailing}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </header>
  );
}

/* ── Content ────────────────────────────────────────────────────────────── */

type ModalContentProps = {
  children: ReactNode;
  className?: string;
  /** Override default x-padding if a form needs full-width tables. */
  noPadding?: boolean;
};

export function ModalContent({ children, className, noPadding }: ModalContentProps) {
  return (
    <div
      className={[
        'flex-1 min-h-0 overflow-y-auto',
        noPadding ? '' : 'px-6 py-5',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────── */

type ModalFooterProps = {
  children: ReactNode;
  leading?: ReactNode;
};

export function ModalFooter({ children, leading }: ModalFooterProps) {
  return (
    <footer
      className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-material-glass-regular-bg)] px-6 nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      style={{
        height: HEALTH_MODAL_TOKENS.footerHeight,
      }}
    >
      {leading ? <div className="mr-auto flex items-center gap-2">{leading}</div> : null}
      {children}
    </footer>
  );
}

/* ── Buttons (footer actions) ───────────────────────────────────────────── */

type ButtonProps = {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
  type?: 'button' | 'submit';
  ariaLabel?: string;
};

export function CancelButton({ onClick, disabled, children = '取消', ariaLabel }: Partial<ButtonProps>) {
  return (
    <KitButton type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} tone="ghost" size="md">
      {children}
    </KitButton>
  );
}

export function PrimaryButton({ onClick, disabled, children, type = 'button', ariaLabel }: ButtonProps) {
  return (
    <KitButton
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      tone="primary"
      size="md"
    >
      {children}
    </KitButton>
  );
}

/* ── SectionCard ────────────────────────────────────────────────────────── */

type SectionCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Use 'plain' to drop the card chrome but keep title spacing. */
  variant?: 'card' | 'plain';
};

export function SectionCard({ title, description, trailing, icon, children, variant = 'card' }: SectionCardProps) {
  const isCard = variant === 'card';
  return (
    <section className={isCard ? 'rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-5' : ''}>
      {(title || trailing) ? (
        <header className="mb-3 flex items-center gap-2">
          {icon ? <span className="text-[16px]">{icon}</span> : null}
          {title ? (
            <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
              {title}
            </h3>
          ) : null}
          {trailing ? <span className="ml-auto">{trailing}</span> : null}
        </header>
      ) : null}
      {description ? (
        <p className="-mt-1 mb-3 text-[12.5px] text-[var(--nimi-text-muted)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/* ── FormGrid ───────────────────────────────────────────────────────────── */

type FormGridProps = {
  cols?: 1 | 2 | 3 | 4;
  gap?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
};

export function FormGrid({ cols = 2, gap = 3, children, className }: FormGridProps) {
  const colClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-4';
  const gapClass = gap === 2 ? 'gap-2' : gap === 3 ? 'gap-3' : 'gap-4';
  return <div className={`grid ${colClass} ${gapClass} ${className ?? ''}`}>{children}</div>;
}

/* ── FormField ──────────────────────────────────────────────────────────── */

type FormFieldProps = {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  /** Visual span (kept implicit; consumer chooses placement). */
  className?: string;
};

export function FormField({ label, required, hint, error, children, className }: FormFieldProps) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span
        className="inline-flex items-baseline gap-0.5 text-[13px] font-medium text-[var(--nimi-text-muted)]"
      >
        <span>{label}</span>
        {required ? (
          <span aria-hidden="true" className="text-[10px] text-[var(--nimi-status-danger)]">
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span className="text-[12px] text-[var(--nimi-status-danger)]">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[12px] text-[var(--nimi-text-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ── Field primitives (uniform 48px / radius-14) ───────────────────────── */

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> & {
  invalid?: boolean;
  size?: 'normal' | 'compact';
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = 'normal', className, ...rest },
  ref,
) {
  return (
    <TextField
      ref={ref}
      {...rest}
      className={`w-full ${size === 'compact' ? 'min-h-10' : 'min-h-12'} ${invalid ? 'border-[var(--nimi-status-danger)] ring-[length:var(--nimi-focus-ring-width)] ring-[var(--nimi-status-danger)]' : ''} ${className ?? ''}`}
      aria-invalid={invalid || undefined}
    />
  );
});

type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  invalid?: boolean;
};

export function TextArea({ invalid, className, rows = 3, ...rest }: TextAreaProps) {
  return (
    <TextareaField
      {...rest}
      rows={rows}
      className={`w-full ${invalid ? 'border-[var(--nimi-status-danger)] ring-[length:var(--nimi-focus-ring-width)] ring-[var(--nimi-status-danger)]' : ''} ${className ?? ''}`}
      aria-invalid={invalid || undefined}
    />
  );
}

/* Select — wraps the existing AppSelect to provide uniform sizing. */
type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  className?: string;
};

export function Select({ value, onChange, options, placeholder, className }: SelectProps) {
  return (
    <div
      className={`relative flex h-12 items-center rounded-2xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] ${className ?? ''}`}
      style={{
      }}
    >
      <AppSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        className="w-full"
        style={{ height: '100%' }}
      />
    </div>
  );
}

/* DateField — wraps ProfileDatePicker with uniform sizing. */
type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
  maxDate?: string;
  invalid?: boolean;
};

export function DateField({ value, onChange, allowClear, maxDate, invalid }: DateFieldProps) {
  return (
    <ProfileDatePicker
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      maxDate={maxDate}
      className={`h-12 ${invalid ? 'border-[var(--nimi-status-danger)] ring-[length:var(--nimi-focus-ring-width)] ring-[var(--nimi-status-danger)]' : ''}`}
    />
  );
}

/* ── ChipGroup ─────────────────────────────────────────────────────────── */

export type ChipOption<V extends string = string> = {
  value: V;
  label: ReactNode;
  emoji?: string;
  Icon?: LucideIcon;
};

type ChipGroupProps<V extends string = string> = {
  options: ReadonlyArray<ChipOption<V>>;
  value: V | null | '';
  onChange: (value: V) => void;
  /** When true, clicking the active chip clears it (toggle). */
  clearable?: boolean;
  size?: 'sm' | 'md';
  /** Use 'fill' so chips share the row equally (good for binary/quaternary toggles). */
  layout?: 'wrap' | 'fill';
  /** Override the active chip color. */
  activeColor?: string;
  disabled?: boolean;
};

export function ChipGroup<V extends string = string>({
  options,
  value,
  onChange,
  clearable = false,
  size = 'md',
  layout = 'wrap',
  activeColor,
  disabled,
}: ChipGroupProps<V>) {
  const heightCls = size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13px]';
  const layoutCls = layout === 'fill' ? 'flex flex-1 gap-1.5' : 'flex flex-wrap gap-1.5';
  const accent = activeColor ?? HEALTH_MODAL_TOKENS.accent;

  return (
    <div className={layoutCls}>
      {options.map((option) => {
        const isSelected = value === option.value;
        const Icon = option.Icon;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (clearable && isSelected) {
                onChange('' as V);
              } else {
                onChange(option.value);
              }
            }}
            className={`${heightCls} inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border font-medium transition-all disabled:opacity-40 ${
              layout === 'fill' ? 'flex-1' : ''
            } ${isSelected ? 'border-[var(--parentos-chip-active)] bg-[var(--parentos-chip-active)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]' : 'border-[var(--nimi-field-border)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]'}`}
            style={{ '--parentos-chip-active': accent } as CSSProperties}
          >
            {Icon ? <Icon size={14} strokeWidth={1.75} /> : option.emoji ? <span>{option.emoji}</span> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── UploadBox ─────────────────────────────────────────────────────────── */

type UploadBoxProps = {
  hint?: ReactNode;
  /** Used when the consumer wraps a complex grid (PhotoGrid) and only needs label/hint chrome. */
  children: ReactNode;
};

export function UploadBox({ hint, children }: UploadBoxProps) {
  return (
    <div className="space-y-2">
      {hint ? (
        <p className="text-[12.5px] text-[var(--nimi-text-muted)]">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/* ── Inline error / banner helpers ─────────────────────────────────────── */

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-3 py-2 text-[13px] text-[var(--nimi-status-danger)]"
    >
      {children}
    </div>
  );
}

export function InfoBanner({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent'; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-[13px] ${tone === 'accent' ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]'}`}>
      {children}
    </div>
  );
}
