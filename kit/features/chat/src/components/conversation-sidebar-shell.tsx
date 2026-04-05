import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterBadge } from '../types.js';

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

  /* ── legacy compat (kept for transition) ── */
  modeSwitcher?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
};

const BADGE_VARIANT_CLASSES: Record<ConversationCharacterBadge['variant'], string> = {
  default: 'border-slate-200 bg-slate-50 text-slate-600',
  online: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  busy: 'border-amber-200 bg-amber-50 text-amber-700',
  warm: 'border-rose-200 bg-rose-50 text-rose-700',
  new: 'border-sky-200 bg-sky-50 text-sky-700',
};

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
        'border-r border-white/70',
        'bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]',
        className,
      )}
    >
      {/* decorative blur orbs */}
      <div className="pointer-events-none absolute left-[-64px] top-[-52px] h-48 w-48 rounded-full bg-emerald-100/70 blur-3xl" />
      <div className="pointer-events-none absolute bottom-16 right-[-56px] h-56 w-56 rounded-full bg-sky-100/70 blur-3xl" />

      {/* main content */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
        {/* avatar */}
        <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
          <div className="group relative rounded-full outline-none transition-transform duration-300 hover:scale-[1.02]">
            {/* aura glow */}
            <div className="absolute inset-[-28px] rounded-full bg-emerald-100/60 opacity-75 blur-3xl" />
            {/* border ring */}
            <div className="absolute inset-[-12px] rounded-full border border-white/75 shadow-[0_22px_56px_rgba(167,243,208,0.3)]" />
            {/* avatar frame */}
            <div
              className={cn(
                'relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-full',
                'border border-white/90 bg-white/82',
                'shadow-[0_24px_60px_rgba(15,23,42,0.12)]',
              )}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name || 'Avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-6xl font-black text-emerald-600/70">
                  {initial}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* info */}
        <div className="shrink-0 text-center">
          {name ? (
            <h1 className="text-[34px] font-black leading-none tracking-tight text-slate-950">
              {name}
            </h1>
          ) : null}
          {handle ? (
            <p className="mt-1.5 text-sm font-medium text-slate-500">
              {handle}
            </p>
          ) : null}
          {bio ? (
            <p className="mt-3 line-clamp-3 min-h-[72px] text-sm leading-6 text-slate-500">
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
                  'shadow-[0_10px_24px_rgba(15,23,42,0.05)]',
                  BADGE_VARIANT_CLASSES[badge.variant],
                )}
              >
                {badge.pulse ? (
                  <span className={cn(
                    'inline-block h-2.5 w-2.5 rounded-full',
                    badge.variant === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-current',
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

/** @deprecated Use ConversationSidebarShell with character rail props instead. */
export type ConversationSidebarShellProps_Legacy = {
  modeSwitcher?: ReactNode;
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};
