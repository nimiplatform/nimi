import type { ReactNode } from 'react';
import { ScrollArea, cn } from '@nimiplatform/kit/ui';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalTranscriptView` or `CanonicalConversationPane` instead.
 */
export type ConversationTranscriptShellProps = {
  header?: ReactNode;
  /** Right-aligned header action buttons (mode menu, history, settings). */
  headerActions?: ReactNode;
  transcript: ReactNode;
  composer?: ReactNode;
  className?: string;
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalTranscriptView` or `CanonicalConversationPane` instead.
 */
export function ConversationTranscriptShell({
  header,
  headerActions,
  transcript,
  composer,
  className,
}: ConversationTranscriptShellProps) {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full flex-col overflow-hidden',
        'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent),color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent),color-mix(in_srgb,var(--nimi-surface-card)_95%,transparent))]',
        className,
      )}
    >
      {/* header bar */}
      {header || headerActions ? (
        <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-3">
          <div className="min-w-0 flex-1">{header}</div>
          {headerActions ? (
            <div className="flex items-center gap-2">{headerActions}</div>
          ) : null}
        </div>
      ) : null}

      {/* transcript area */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 py-6">
        <div className="mx-auto max-w-[min(960px,100%)]">
          {transcript}
        </div>
      </ScrollArea>

      {/* composer */}
      {composer ? (
        <div className="relative shrink-0 px-6 pb-5 pt-3">
          <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent),transparent)]" />
          <div className="mx-auto max-w-[min(960px,100%)]">
            {composer}
          </div>
        </div>
      ) : null}
    </div>
  );
}
