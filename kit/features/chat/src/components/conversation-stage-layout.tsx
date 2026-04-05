import { useState, useCallback, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { ConversationAnimationStyles } from './conversation-animations.js';

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

  /* ── legacy compat (ignored if characterRail is provided) ── */
  sidebar?: ReactNode;
  targetRail?: ReactNode;
};

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
        'bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.10),_transparent_38%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.94))]',
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
            'absolute inset-0 z-20 bg-slate-900/28 transition-opacity duration-200',
            isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* settings drawer */}
      {settingsDrawer ? (
        <aside
          className={cn(
            'absolute inset-y-0 right-0 z-30 flex w-[360px] max-w-[92vw] flex-col',
            'border-l border-white/70 bg-[#f8fbfb]',
            'shadow-[-8px_0_24px_rgba(15,23,42,0.08)]',
            'transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]',
            isOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
          )}
        >
          {/* close button */}
          <div className="flex shrink-0 items-center justify-end px-4 pt-4">
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setOpen(false)}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full',
                'border border-slate-200/80 bg-white/90 text-slate-500',
                'transition-colors hover:border-emerald-300 hover:text-teal-700',
              )}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            {settingsDrawer}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
