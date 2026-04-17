import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button, IconButton, cn } from '@nimiplatform/nimi-kit/ui';

type DesktopCompactActionTone = 'neutral' | 'primary' | 'danger';

function toButtonTone(tone: DesktopCompactActionTone) {
  if (tone === 'primary') {
    return 'primary' as const;
  }
  if (tone === 'danger') {
    return 'danger' as const;
  }
  return 'secondary' as const;
}

export function DesktopCompactAction(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    tone?: DesktopCompactActionTone;
    fullWidth?: boolean;
  },
) {
  const { children, tone = 'neutral', fullWidth = false, className, ...domProps } = props;
  return (
    <Button
      {...domProps}
      tone={toButtonTone(tone)}
      size="sm"
      fullWidth={fullWidth}
      className={cn(
        'rounded-xl shadow-[0_8px_18px_rgba(15,23,42,0.05)]',
        tone === 'neutral' && 'border-[var(--nimi-border-subtle)] text-[var(--nimi-text-primary)]',
        tone === 'primary' && 'border-[var(--nimi-action-primary-bg)]',
        tone === 'danger' && 'border-transparent bg-[var(--nimi-status-danger)] text-white hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_86%,black)]',
        className,
      )}
    >
      {children}
    </Button>
  );
}

export function DesktopIconToggleAction(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: ReactNode;
    active?: boolean;
    activeTone?: 'primary' | 'danger';
  },
) {
  const {
    icon,
    active = false,
    activeTone = 'primary',
    className,
    ...domProps
  } = props;

  return (
    <IconButton
      {...domProps}
      icon={icon}
      tone={active ? (activeTone === 'danger' ? 'danger' : 'primary') : 'secondary'}
      size="sm"
      className={cn(
        'h-8 w-8 rounded-full shadow-[0_8px_18px_rgba(15,23,42,0.08)]',
        !active && 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]',
        active && activeTone === 'primary' && 'border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
        active && activeTone === 'danger' && 'border-transparent bg-[var(--nimi-status-danger)] text-white',
        className,
      )}
    />
  );
}

export function DesktopFieldTrigger(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  },
) {
  const { children, className, ...domProps } = props;
  return (
    <button
      type="button"
      {...domProps}
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-xl border border-[var(--nimi-border-subtle)]',
        'bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] px-3 text-left text-sm text-[var(--nimi-text-primary)]',
        'shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition-all duration-[var(--nimi-motion-fast)]',
        'hover:border-[var(--nimi-border-strong)] hover:shadow-[0_10px_22px_rgba(15,23,42,0.06)]',
        'disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        className,
      )}
    >
      {children}
    </button>
  );
}
