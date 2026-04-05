import type { ReactNode } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';

export type ConversationTranscriptShellProps = {
  header?: ReactNode;
  /** Right-aligned header action buttons (mode menu, history, settings). */
  headerActions?: ReactNode;
  transcript: ReactNode;
  composer?: ReactNode;
  className?: string;
};

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
        'bg-gradient-to-b from-slate-50/60 via-white/80 to-white/95',
        className,
      )}
    >
      {/* header bar */}
      {header || headerActions ? (
        <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/70 px-5 py-3">
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
          <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-white/80 to-transparent" />
          <div className="mx-auto max-w-[min(960px,100%)]">
            {composer}
          </div>
        </div>
      ) : null}
    </div>
  );
}
