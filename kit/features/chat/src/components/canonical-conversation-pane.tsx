import type { ReactNode } from 'react';
import type { ConversationCharacterData, ConversationTargetSummary, ConversationViewMode } from '../types.js';
import { CANONICAL_HEADER_ICON_CLASS } from './canonical-character-rail.js';

export const CANONICAL_STAGE_SURFACE_WIDTH_CLASS = 'max-w-[min(1240px,calc(100vw-520px))]';

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
      data-canonical-conversation-pane="true"
    >
      <div className="relative shrink-0 px-6 py-3" data-canonical-pane-header="true">
        <div className="relative z-10 flex items-center justify-end gap-4" data-canonical-pane-controls="true">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={CANONICAL_HEADER_ICON_CLASS}
              aria-label={props.viewMode === 'stage' ? 'Show history' : 'Return to stage'}
              title={props.viewMode === 'stage' ? 'Show history' : 'Return to stage'}
              onClick={() => props.onViewModeChange(props.viewMode === 'stage' ? 'chat' : 'stage')}
              data-canonical-view-toggle="true"
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
                title="Open settings"
                onClick={props.onOpenSettings}
                data-canonical-settings-toggle="true"
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
