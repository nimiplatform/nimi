import type { ReactNode } from 'react';
import { TextField } from '@nimiplatform/kit/ui';
import { Button as PrimitiveButton } from './runtime-config-primitives';
import { PlusIcon } from './runtime-config-runtime-page-ui';

// Shared icons re-exported from the runtime-page-ui layer; SVGs are identical.
export { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from './runtime-config-runtime-page-ui';

export function CloudIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19c0-3.037-2.463-5.5-5.5-5.5S6.5 15.963 6.5 19" />
      <path d="M17.5 19c2.485 0 4.5-2.015 4.5-4.5S19.985 10 17.5 10c-.186 0-.367.012-.544.035C16.473 6.607 13.487 4 10 4 6.134 4 3 7.134 3 11c0 .37.03.732.086 1.084A4.496 4.496 0 0 0 2 19.5C2 21.985 4.015 24 6.5 24h11c2.485 0 4.5-2.015 4.5-4.5S19.985 15 17.5 15" />
    </svg>
  );
}
export function BoltIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
export function KeyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}
export function ServerIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}
export function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
export function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  icon,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <PrimitiveButton onClick={onClick} variant={variant} size={size} disabled={disabled}>
      {icon}
      {children}
    </PrimitiveButton>
  );
}
export function Input({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  disabled,
  icon,
  rightAccessory,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  icon?: ReactNode;
  rightAccessory?: ReactNode;
}) {
  return (
    <div>
      {label ? <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{label}</label> : null}
      <TextField
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        leading={icon}
        trailing={rightAccessory}
      />
    </div>
  );
}

/** Host portion of a connector endpoint for quiet, scannable labels. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** First-run state for the Cloud page: one welcoming card instead of an empty rail. */
export function CloudEmptyState({
  onAddConnector,
  t,
}: {
  onAddConnector: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section
      className="flex min-h-[320px] flex-col items-center justify-center rounded-[24px] px-6 py-12 text-center ring-1 ring-inset ring-[var(--nimi-border-subtle)]"
      style={{ background: 'var(--nimi-surface-hero)' }}
      data-testid="cloud-empty-state"
    >
      <span className="flex size-16 items-center justify-center rounded-[20px] bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-base)]">
        <CloudIcon className="h-7 w-7" />
      </span>
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-[var(--nimi-text-primary)]">
        {t('runtimeConfig.product.cloudEmptyTitle')}
      </h2>
      <p className="mt-2 max-w-md text-sm text-[var(--nimi-text-secondary)]">
        {t('runtimeConfig.product.cloudEmptyBody')}
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={onAddConnector} icon={<PlusIcon />}>
          {t('runtimeConfig.cloud.addConnector', { defaultValue: 'Add' })}
        </Button>
      </div>
    </section>
  );
}
