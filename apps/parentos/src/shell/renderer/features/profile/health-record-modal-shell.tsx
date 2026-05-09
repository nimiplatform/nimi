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
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { X, type LucideIcon } from 'lucide-react';
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
  shadow: '0 24px 64px -24px rgba(15, 23, 42, 0.18), 0 8px 24px -12px rgba(15, 23, 42, 0.08)',
  surface: '#ffffff',
  surfaceMuted: '#f7f7f4',
  border: '#ECECE6',
  text: '#1e293b',
  sub: '#475569',
  accent: '#4ECCA3',
  fieldBg: '#fafaf8',
  fieldBorder: '#E5E5DD',
  footerGlass: 'rgba(255, 255, 255, 0.78)',
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--nimi-scrim-modal, rgba(15, 23, 42, 0.32))' }}
      onClick={onClose}
    >
      <section
        className="flex overflow-hidden"
        style={{
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: HEALTH_MODAL_TOKENS.maxHeight,
          background: HEALTH_MODAL_TOKENS.surface,
          borderRadius: HEALTH_MODAL_TOKENS.radius,
          boxShadow: HEALTH_MODAL_TOKENS.shadow,
          border: `1px solid ${HEALTH_MODAL_TOKENS.border}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {sidebar}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </section>
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
};

export function HealthRecordSidebar({ items, selected, onSelect, title }: HealthRecordSidebarProps) {
  return (
    <aside
      className="flex shrink-0 flex-col gap-1 px-3 py-5"
      style={{
        width: HEALTH_MODAL_TOKENS.sidebarWidth,
        background: HEALTH_MODAL_TOKENS.surfaceMuted,
        borderRight: `1px solid ${HEALTH_MODAL_TOKENS.border}`,
      }}
    >
      {title ? (
        <div
          className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: HEALTH_MODAL_TOKENS.sub }}
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
              className="flex items-center gap-2 rounded-[14px] px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors disabled:opacity-40"
              style={
                isSelected
                  ? {
                      background: HEALTH_MODAL_TOKENS.accent,
                      color: '#ffffff',
                      boxShadow: '0 6px 16px -8px rgba(78,204,163,0.55)',
                    }
                  : {
                      background: 'transparent',
                      color: HEALTH_MODAL_TOKENS.text,
                    }
              }
            >
              {item.emoji ? <span aria-hidden="true">{item.emoji}</span> : null}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
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
      className="flex shrink-0 items-center gap-3 px-6"
      style={{
        height: HEALTH_MODAL_TOKENS.headerHeight,
        borderBottom: `1px solid ${HEALTH_MODAL_TOKENS.border}`,
        background: HEALTH_MODAL_TOKENS.surface,
      }}
    >
      {icon ? (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[18px]"
          style={{ background: '#f1f5f9' }}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2
          className="truncate text-[16px] font-bold leading-tight"
          style={{ color: HEALTH_MODAL_TOKENS.text }}
        >
          {title}
        </h2>
        {subtitle ? (
          <p
            className="truncate text-[12.5px] leading-tight mt-0.5"
            style={{ color: HEALTH_MODAL_TOKENS.sub }}
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
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-[#f0f0ec]"
        style={{ color: HEALTH_MODAL_TOKENS.sub }}
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
      style={{ background: HEALTH_MODAL_TOKENS.surface }}
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
      className="flex shrink-0 items-center justify-end gap-3 px-6"
      style={{
        height: HEALTH_MODAL_TOKENS.footerHeight,
        background: HEALTH_MODAL_TOKENS.footerGlass,
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderTop: `1px solid ${HEALTH_MODAL_TOKENS.border}`,
      }}
    >
      {leading ? <div className="mr-auto flex items-center gap-2">{leading}</div> : null}
      {children}
    </footer>
  );
}

/* ── Buttons (footer actions) ───────────────────────────────────────────── */

type ButtonProps = {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
  type?: 'button' | 'submit';
  ariaLabel?: string;
};

export function CancelButton({ onClick, disabled, children = '取消', ariaLabel }: Partial<ButtonProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-10 items-center justify-center rounded-[14px] px-4 text-[14px] font-medium transition-colors hover:bg-[#e8e8e4] disabled:opacity-50"
      style={{ background: '#f0f0ec', color: HEALTH_MODAL_TOKENS.sub }}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({ onClick, disabled, children, type = 'button', ariaLabel }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[14px] px-5 text-[14px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
      style={{
        background: HEALTH_MODAL_TOKENS.accent,
        boxShadow: '0 8px 18px -8px rgba(78,204,163,0.55)',
      }}
    >
      {children}
    </button>
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
    <section
      className={isCard ? 'rounded-[18px] p-5' : ''}
      style={
        isCard
          ? {
              background: HEALTH_MODAL_TOKENS.surfaceMuted,
              border: `1px solid ${HEALTH_MODAL_TOKENS.border}`,
            }
          : undefined
      }
    >
      {(title || trailing) ? (
        <header className="mb-3 flex items-center gap-2">
          {icon ? <span className="text-[16px]">{icon}</span> : null}
          {title ? (
            <h3 className="text-[14px] font-semibold" style={{ color: HEALTH_MODAL_TOKENS.text }}>
              {title}
            </h3>
          ) : null}
          {trailing ? <span className="ml-auto">{trailing}</span> : null}
        </header>
      ) : null}
      {description ? (
        <p className="-mt-1 mb-3 text-[12.5px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>
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
        className="inline-flex items-baseline gap-0.5 text-[13px] font-medium"
        style={{ color: HEALTH_MODAL_TOKENS.sub }}
      >
        <span>{label}</span>
        {required ? (
          <span aria-hidden="true" className="text-[10px]" style={{ color: '#dc2626' }}>
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span className="text-[12px]" style={{ color: '#b91c1c' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="text-[12px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ── Field primitives (uniform 48px / radius-14) ───────────────────────── */

const fieldBase: CSSProperties = {
  height: HEALTH_MODAL_TOKENS.fieldHeight,
  borderRadius: HEALTH_MODAL_TOKENS.fieldRadius,
  border: `1px solid ${HEALTH_MODAL_TOKENS.fieldBorder}`,
  background: HEALTH_MODAL_TOKENS.fieldBg,
  color: HEALTH_MODAL_TOKENS.text,
  paddingLeft: 14,
  paddingRight: 14,
  fontSize: 14,
  outline: 'none',
  transition: 'box-shadow 120ms ease, border-color 120ms ease',
};

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> & {
  invalid?: boolean;
  size?: 'normal' | 'compact';
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = 'normal', className, ...rest },
  ref,
) {
  const style: CSSProperties = { ...fieldBase };
  if (size === 'compact') style.height = 40;
  if (invalid) {
    style.borderColor = '#dc2626';
    style.boxShadow = '0 0 0 3px rgba(220,38,38,0.12)';
  }
  return (
    <input
      ref={ref}
      {...rest}
      className={`w-full focus:ring-2 focus:ring-[#4ECCA3]/35 ${className ?? ''}`}
      style={style}
      aria-invalid={invalid || undefined}
    />
  );
});

type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  invalid?: boolean;
};

export function TextArea({ invalid, className, rows = 3, ...rest }: TextAreaProps) {
  const style: CSSProperties = {
    ...fieldBase,
    height: 'auto',
    paddingTop: 12,
    paddingBottom: 12,
    resize: 'none' as const,
  };
  if (invalid) {
    style.borderColor = '#dc2626';
    style.boxShadow = '0 0 0 3px rgba(220,38,38,0.12)';
  }
  return (
    <textarea
      {...rest}
      rows={rows}
      className={`w-full focus:ring-2 focus:ring-[#4ECCA3]/35 ${className ?? ''}`}
      style={style}
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
      className={`relative ${className ?? ''}`}
      style={{
        height: HEALTH_MODAL_TOKENS.fieldHeight,
        borderRadius: HEALTH_MODAL_TOKENS.fieldRadius,
        border: `1px solid ${HEALTH_MODAL_TOKENS.fieldBorder}`,
        background: HEALTH_MODAL_TOKENS.fieldBg,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <AppSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        className="w-full"
        style={{ background: 'transparent', border: 'none', height: '100%' }}
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
      style={{
        height: HEALTH_MODAL_TOKENS.fieldHeight,
        borderRadius: HEALTH_MODAL_TOKENS.fieldRadius,
        border: `1px solid ${invalid ? '#dc2626' : HEALTH_MODAL_TOKENS.fieldBorder}`,
        background: HEALTH_MODAL_TOKENS.fieldBg,
        color: HEALTH_MODAL_TOKENS.text,
        boxShadow: invalid ? '0 0 0 3px rgba(220,38,38,0.12)' : undefined,
      }}
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
            className={`${heightCls} inline-flex items-center justify-center gap-1.5 rounded-[12px] font-medium transition-all disabled:opacity-40 ${
              layout === 'fill' ? 'flex-1' : ''
            }`}
            style={
              isSelected
                ? {
                    background: accent,
                    color: '#ffffff',
                    boxShadow: '0 4px 10px -6px rgba(78,204,163,0.5)',
                  }
                : {
                    background: '#f4f4f0',
                    color: HEALTH_MODAL_TOKENS.sub,
                    border: `1px solid ${HEALTH_MODAL_TOKENS.fieldBorder}`,
                  }
            }
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
        <p className="text-[12.5px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>
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
      className="rounded-[12px] px-3 py-2 text-[13px]"
      style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
    >
      {children}
    </div>
  );
}

export function InfoBanner({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent'; children: ReactNode }) {
  const palette =
    tone === 'accent'
      ? { background: '#EEF6EE', color: '#3a7a3a', border: '1px solid #d6ecd6' }
      : { background: '#f1f5f9', color: HEALTH_MODAL_TOKENS.sub, border: `1px solid ${HEALTH_MODAL_TOKENS.border}` };
  return (
    <div className="rounded-[14px] px-4 py-3 text-[13px]" style={palette}>
      {children}
    </div>
  );
}
