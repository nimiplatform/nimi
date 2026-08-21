import type { ButtonHTMLAttributes, CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
import { Button, IconButton } from './button.js';
import { Surface } from './surface.js';

export type AppCardSurfaceKind = 'promoted-glass' | 'operational-solid';

const APP_CARD_SURFACE_CLASS: Record<AppCardSurfaceKind, string> = {
  'promoted-glass': 'rounded-[var(--nimi-radius-lg)] border-white/60 bg-[var(--nimi-surface-card-promoted-glass-elevated)]',
  'operational-solid': 'rounded-[var(--nimi-radius-lg)] border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-card-operational-solid-elevated)]',
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
      elevation={kind === 'promoted-glass' ? 'raised' : 'base'}
      padding="none"
      interactive={interactive}
      active={active}
      data-nimi-app-card-surface={kind}
      className={cn(APP_CARD_SURFACE_CLASS[kind], active && 'border-[var(--nimi-action-primary-bg)]', className)}
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
        'rounded-[var(--nimi-radius-action)] shadow-[var(--nimi-elevation-base)]',
        tone === 'neutral' && 'border-[var(--nimi-border-subtle)] text-[var(--nimi-text-primary)]',
        tone === 'primary' && 'border-[var(--nimi-action-primary-bg)]',
        tone === 'danger' && 'border-transparent bg-[var(--nimi-status-danger)] text-[var(--nimi-text-inverse)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_86%,black)]',
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
        'h-8 w-8 rounded-full shadow-[var(--nimi-elevation-base)]',
        !active && 'border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]',
        active && activeTone === 'primary' && 'border-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
        active && activeTone === 'danger' && 'border-transparent bg-[var(--nimi-status-danger)] text-[var(--nimi-text-inverse)]',
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
        'flex h-10 w-full items-center gap-3 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)]',
        'bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] px-3 text-left text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-primary)]',
        'shadow-[var(--nimi-elevation-base)] transition-[border-color,box-shadow] duration-[var(--nimi-motion-fast)]',
        'hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]',
        'disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        FOCUS_RING_CLASS_NAME,
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
