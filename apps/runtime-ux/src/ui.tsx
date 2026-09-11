import { useState, type ReactNode } from 'react';
import { IconChevronRight } from './icons';

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rt-card">
      {(title || actions) && (
        <div className="rt-page-header-row" style={{ marginBottom: subtitle ? 0 : 10 }}>
          <div>
            {title && <h3 className="rt-card-title">{title}</h3>}
            {subtitle && <p className="rt-card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="rt-row-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`rt-pill ${tone}`}>{children}</span>;
}

export function Button({
  variant,
  size,
  onClick,
  disabled,
  children,
}: {
  variant?: 'primary' | 'ghost';
  size?: 'sm';
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls = ['rt-btn', variant, size].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rt-segmented">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          aria-pressed={opt === value}
          className={opt === value ? 'active' : undefined}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rt-chips">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`rt-chip${opt === value ? ' active' : ''}`}
          aria-pressed={opt === value}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="rt-progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${value}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rt-empty">
      <div className="rt-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusDot({ tone }: { tone: 'success' | 'warning' | 'danger' }) {
  return <span className={`rt-dot ${tone}`} aria-hidden />;
}

export function Disclosure({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rt-disclosure${open ? ' open' : ''}`}>
      <button
        type="button"
        className="rt-disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {title}
        {badge}
        {subtitle && <span className="rt-disclosure-sub">{subtitle}</span>}
        <IconChevronRight size={14} className="rt-chev" />
      </button>
      {open && <div className="rt-disclosure-body">{children}</div>}
    </div>
  );
}
