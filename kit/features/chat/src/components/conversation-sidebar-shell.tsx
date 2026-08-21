import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import type { ConversationCharacterBadge } from '../types.js';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalCharacterRail` or `CanonicalRightSidebar` instead.
 */
export type ConversationSidebarShellProps = {
  /** Avatar image URL. Falls back to `avatarFallback` initial. */
  avatarUrl?: string | null;
  /** Fallback initial letter(s) when no avatar image. */
  avatarFallback?: string;
  /** Display name. */
  name?: string;
  /** Handle / username. */
  handle?: string | null;
  /** Bio text. */
  bio?: string | null;
  /** Status / relationship badges. */
  badges?: readonly ConversationCharacterBadge[];
  /** Extra content below badges. */
  children?: ReactNode;
  className?: string;
};

const BADGE_VARIANT_CLASSES: Record<ConversationCharacterBadge['variant'], string> = {
  default: 'border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]',
  online: 'border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
  busy: 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]',
  warm: 'border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]',
  new: 'border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalCharacterRail` or `CanonicalRightSidebar` instead.
 */
export function ConversationSidebarShell({
  avatarUrl,
  avatarFallback,
  name,
  handle,
  bio,
  badges,
  children,
  className,
}: ConversationSidebarShellProps) {
  const initial = avatarFallback || (name ? name.charAt(0).toUpperCase() : '?');

  return (
    <aside
      className={cn(
        'relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden',
        'border-r border-[var(--nimi-border-subtle)]',
        'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-panel)_98%,transparent),color-mix(in_srgb,var(--nimi-surface-panel)_96%,transparent))]',
        className,
      )}
    >
      {/* decorative radial orbs */}
      <div className="pointer-events-none absolute left-[-64px] top-[-52px] h-48 w-48 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)_0%,transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-16 right-[-56px] h-56 w-56 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)_0%,transparent_70%)]" />

      {/* main content */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        {/* avatar */}
        <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
          <div className="group relative rounded-full outline-none transition-transform duration-[var(--nimi-motion-slow)] hover:scale-[1.02]">
            {/* aura glow */}
            <div className="absolute inset-[-28px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)_0%,transparent_70%)] opacity-75" />
            {/* border ring */}
            <div className="absolute inset-[-12px] rounded-full border border-[var(--nimi-border-subtle)] shadow-[0_22px_56px_color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,transparent)]" />
            {/* avatar frame */}
            <div
              className={cn(
                'relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-full',
                'border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)]',
                'shadow-[var(--nimi-elevation-floating)]',
              )}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name || 'Avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-6xl font-black text-[var(--nimi-action-primary-bg)]/70">
                  {initial}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* info */}
        <div className="shrink-0 text-center">
          {name ? (
            <h1 className="text-[length:var(--nimi-type-hero-title-size)] font-black leading-none tracking-tight text-[var(--nimi-text-primary)]">
              {name}
            </h1>
          ) : null}
          {handle ? (
            <p className="mt-1.5 text-sm font-medium text-[var(--nimi-text-muted)]">
              {handle}
            </p>
          ) : null}
          {bio ? (
            <p className="mt-3 line-clamp-3 min-h-[72px] text-sm leading-6 text-[var(--nimi-text-muted)]">
              {bio}
            </p>
          ) : null}
        </div>

        {/* badges */}
        {badges && badges.length > 0 ? (
          <div className="mt-4 flex shrink-0 flex-wrap justify-center gap-2">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-semibold',
                  'shadow-[var(--nimi-elevation-raised)]',
                  BADGE_VARIANT_CLASSES[badge.variant],
                )}
              >
                {badge.pulse ? (
                  <span className={cn(
                    'inline-block h-2.5 w-2.5 rounded-full',
                    badge.variant === 'online' ? 'bg-[var(--nimi-status-success)] animate-pulse' : 'bg-current',
                  )} />
                ) : (
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-current opacity-60" />
                )}
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* extra content slot */}
        {children ? (
          <div className="mt-4 shrink-0">{children}</div>
        ) : null}
      </div>
    </aside>
  );
}
