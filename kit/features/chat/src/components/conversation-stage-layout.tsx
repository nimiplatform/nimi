import { useState, useCallback, type ReactNode } from 'react';
import { IconButton, SidebarShell, cn } from '@nimiplatform/kit/ui';
import { ConversationAnimationStyles } from './conversation-animations.js';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalConversationShell` or `CanonicalConversationPane` instead.
 */
export type ConversationStageLayoutProps = {
  /** Left character rail (avatar + name + bio). */
  characterRail: ReactNode;
  /** Center conversation pane (transcript + composer). */
  transcript: ReactNode;
  /** Settings drawer content rendered inside the slide-in panel. */
  settingsDrawer?: ReactNode;
  /** Whether the settings drawer is open (controlled). If omitted, uses internal state. */
  settingsOpen?: boolean;
  /** Callback when settings open state changes. */
  onSettingsOpenChange?: (open: boolean) => void;
  className?: string;
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalConversationShell` or `CanonicalConversationPane` instead.
 */
export function ConversationStageLayout({
  characterRail,
  transcript,
  settingsDrawer,
  settingsOpen: controlledOpen,
  onSettingsOpenChange,
  className,
}: ConversationStageLayoutProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onSettingsOpenChange?.(next);
    },
    [onSettingsOpenChange],
  );

  return (
    <div
      className={cn(
        'conversation-root relative flex min-h-0 w-full flex-1 overflow-hidden rounded-2xl',
        'bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--nimi-status-success)_10%,transparent),_transparent_38%),linear-gradient(180deg,_color-mix(in_srgb,var(--nimi-surface-canvas)_98%,transparent),_color-mix(in_srgb,var(--nimi-surface-canvas)_94%,transparent))]',
        className,
      )}
    >
      <ConversationAnimationStyles />

      {/* character rail */}
      <div className="flex min-h-0 w-[clamp(320px,28vw,520px)] shrink-0">{characterRail}</div>

      {/* conversation pane */}
      <div className="flex min-h-0 min-w-0 flex-1">{transcript}</div>

      {/* overlay */}
      {settingsDrawer ? (
        <button
          type="button"
          aria-label="Close settings"
          className={cn(
            'absolute inset-0 z-20 bg-[var(--nimi-overlay-backdrop)] transition-opacity duration-[var(--nimi-motion-base)]',
            isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* settings drawer */}
      {settingsDrawer ? (
        <SidebarShell
          as="aside"
          className={cn(
            'absolute inset-y-0 right-0 z-30 flex w-[360px] max-w-[92vw] flex-col',
            'rounded-none border-y-0 border-r-0 bg-[var(--nimi-sidebar-canvas)]',
            'shadow-[var(--nimi-elevation-floating)]',
            'transition-transform duration-[var(--nimi-motion-slow)] ease-[var(--nimi-motion-ease-standard)]',
            isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
          )}
        >
          {/* close button */}
          <div className="flex shrink-0 items-center justify-end px-4 pt-4">
            <IconButton
              aria-label="Close settings"
              onClick={() => setOpen(false)}
              className={cn(
                'h-8 w-8 rounded-full border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] text-[var(--nimi-text-muted)]',
                'transition-colors hover:border-[var(--nimi-action-primary-bg)]/50 hover:text-[var(--nimi-action-primary-bg)]',
              )}
              icon={(
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            {settingsDrawer}
          </div>
        </SidebarShell>
      ) : null}
    </div>
  );
}
