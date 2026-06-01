import type { ButtonHTMLAttributes, CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { Button, IconButton } from './button.js';
import { Surface } from './surface.js';

export type AppCardSurfaceKind = 'promoted-glass' | 'operational-solid';

const APP_CARD_SURFACE_CLASS: Record<AppCardSurfaceKind, string> = {
  'promoted-glass': 'rounded-2xl border-white/60 bg-[var(--nimi-surface-card-promoted-glass-elevated)] shadow-[0_14px_34px_rgba(15,23,42,0.05)]',
  'operational-solid': 'rounded-2xl border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-card-operational-solid-elevated)] shadow-[0_10px_22px_rgba(15,23,42,0.04)]',
};

type AppCardSurfaceProps = {
  kind?: AppCardSurfaceKind;
  as?: ElementType;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  interactive?: boolean;
  active?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className' | 'style'>;

export function AppCardSurface(props: AppCardSurfaceProps) {
  const {
    kind = 'operational-solid',
    as = 'section',
    children,
    className,
    style,
    interactive = false,
    active = false,
    ...domProps
  } = props;

  return (
    <Surface
      {...domProps}
      as={as}
      tone="card"
      material={kind === 'promoted-glass' ? 'glass-regular' : 'solid'}
      elevation="base"
      padding="none"
      interactive={interactive}
      active={active}
      data-nimi-app-card-surface={kind}
      className={cn(APP_CARD_SURFACE_CLASS[kind], className)}
      style={style}
    >
      {children}
    </Surface>
  );
}

export type CompactActionTone = 'neutral' | 'primary' | 'danger';

function toButtonTone(tone: CompactActionTone) {
  if (tone === 'primary') {
    return 'primary' as const;
  }
  if (tone === 'danger') {
    return 'danger' as const;
  }
  return 'secondary' as const;
}

export function CompactAction(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    tone?: CompactActionTone;
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

export function IconToggleAction(
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

export function FieldTrigger(
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

export type ScrollShellProps = HTMLAttributes<HTMLDivElement>;

export function ScrollShell({ className, ...props }: ScrollShellProps) {
  return (
    <div
      {...props}
      className={cn('min-h-0 overflow-y-auto overscroll-contain', className)}
    />
  );
}

export type StateTone = 'selected' | 'danger';

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  selected: 'bg-[var(--nimi-surface-active)]',
  danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_var(--nimi-opacity-subtle-fill),transparent)]',
};
