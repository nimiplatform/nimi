import type { ReactNode } from 'react';
import type { ConversationCharacterData, ConversationTargetSummary, ConversationViewMode } from '../types.js';
import { CANONICAL_HEADER_ICON_CLASS } from './canonical-character-rail.js';
import { CANONICAL_SOURCE_LABELS } from './canonical-target-pane.js';

export type CanonicalConversationPaneProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  viewMode: ConversationViewMode;
  onBackToTargets: () => void;
  onViewModeChange: (mode: ConversationViewMode) => void;
  onOpenSettings?: () => void;
  stagePanel: ReactNode;
  transcript: ReactNode;
  composer?: ReactNode;
};

export function CanonicalConversationPane(props: CanonicalConversationPaneProps) {
  const theme = props.characterData?.theme;
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      style={theme?.roomSurface ? { background: theme.roomSurface } : undefined}
    >
      <div className="relative overflow-hidden border-b border-white/70 px-6 py-3">
        <div
          className="absolute inset-0 opacity-80"
          style={{ background: theme?.roomAura || 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(232,245,245,0.78))' }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/70" />
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={props.onBackToTargets}
              className={CANONICAL_HEADER_ICON_CLASS}
              aria-label="Back to targets"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">
                {props.characterData?.name || props.selectedTarget.title}
              </div>
              <div className="truncate text-xs text-slate-500">
                {props.characterData?.handle || props.selectedTarget.handle || CANONICAL_SOURCE_LABELS[props.selectedTarget.source]}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={CANONICAL_HEADER_ICON_CLASS}
              aria-label={props.viewMode === 'stage' ? 'Open chat history' : 'Return to stage'}
              onClick={() => props.onViewModeChange(props.viewMode === 'stage' ? 'chat' : 'stage')}
            >
              {props.viewMode === 'stage' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v5h5" />
                  <path d="M3.05 13A9 9 0 1 0 6 6.3L3 8" />
                  <path d="M12 7v5l3 3" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="14" rx="2" />
                  <path d="M8 20h8" />
                  <path d="M12 18v2" />
                </svg>
              )}
            </button>
            {props.onOpenSettings ? (
              <button
                type="button"
                className={CANONICAL_HEADER_ICON_CLASS}
                aria-label="Open settings"
                onClick={props.onOpenSettings}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10.91 3H11a2 2 0 1 1 4 0h.09a1.65 1.65 0 0 0 1.51 1 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {props.viewMode === 'stage' ? props.stagePanel : props.transcript}
        {props.composer ? <div className="shrink-0">{props.composer}</div> : null}
      </div>
    </section>
  );
}
