import { type ReactNode } from 'react';
import { i18n } from '@renderer/i18n';

import {
  Button as KitButton,
  TextField,
  SelectField as KitSelectField,
  cn,
} from '@nimiplatform/nimi-kit/ui';
import { DesktopCardSurface } from '@renderer/components/surface';
import {
  statusTextV11,
  type ProviderStatusV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DesktopCardSurface
      kind="operational-solid"
      className={cn(
        className,
      )}
    >
      {children}
    </DesktopCardSurface>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <KitButton
      tone={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </KitButton>
  );
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      {label ? <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{label}</label> : null}
      <TextField
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

export type RuntimeSelectOption = {
  value: string;
  label: string;
};

export function RuntimeSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size = 'md',
  className = '',
  contentClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: RuntimeSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  contentClassName?: string;
}) {
  const triggerClass = size === 'sm'
    ? 'min-h-8 rounded-md px-2 text-xs'
    : 'min-h-10 rounded-xl px-3 text-sm';

  return (
    <KitSelectField
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      selectClassName={triggerClass}
      contentClassName={contentClassName}
    />
  );
}

// Status indicator with dot - using semi-transparent backgrounds
function StatusIndicator({
  status,
  text,
  variant: _variant,
}: {
  status: 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded' | 'running' | 'stopped';
  text: string;
  variant?: 'daemon' | 'provider';
}) {
  const styles = {
    // Daemon states
    running: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]',
      text: 'text-[var(--nimi-status-success)]',
      dot: 'bg-[var(--nimi-status-success)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
    },
    stopped: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]',
      text: 'text-[var(--nimi-status-danger)]',
      dot: 'bg-[var(--nimi-status-danger)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]',
    },
    // Provider states
    healthy: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]',
      text: 'text-[var(--nimi-status-success)]',
      dot: 'bg-[var(--nimi-status-success)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
    },
    idle: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_12%,transparent)]',
      text: 'text-[var(--nimi-status-neutral)]',
      dot: 'bg-[var(--nimi-status-neutral)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-neutral)_24%,transparent)]',
    },
    unreachable: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]',
      text: 'text-[var(--nimi-status-danger)]',
      dot: 'bg-[var(--nimi-status-danger)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]',
    },
    unsupported: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]',
      text: 'text-[var(--nimi-status-warning)]',
      dot: 'bg-[var(--nimi-status-warning)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
    },
    degraded: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]',
      text: 'text-[var(--nimi-status-warning)]',
      dot: 'bg-[var(--nimi-status-warning)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
    },
  };

  const style = styles[status];

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
      style.bg,
      style.text,
      style.ring,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {text}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProviderStatusV11 }) {
  const statusMap: Record<ProviderStatusV11, 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded'> = {
    healthy: 'healthy',
    idle: 'idle',
    unreachable: 'unreachable',
    unsupported: 'unsupported',
    degraded: 'degraded',
  };

  return (
    <StatusIndicator
      status={statusMap[status]}
      text={statusTextV11(status)}
      variant="provider"
    />
  );
}

export function DaemonStatusBadge({ running }: { running: boolean }) {
  return (
    <StatusIndicator
      status={running ? 'running' : 'stopped'}
      text={i18n.t(`runtimeConfig.overview.${running ? 'running' : 'stopped'}`, {
        defaultValue: running ? 'daemon running' : 'daemon stopped',
      })}
      variant="daemon"
    />
  );
}

export function renderModelChips(models: string[], prefix: string) {
  if (models.length === 0) {
    return (
      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
        {i18n.t('runtimeConfig.common.noModelsDiscovered', { defaultValue: 'No models discovered yet.' })}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <span
          key={`${prefix}-${model}`}
          className="rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 py-0.5 text-[11px] text-[var(--nimi-action-primary-bg)]"
        >
          {model}
        </span>
      ))}
    </div>
  );
}
