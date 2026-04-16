import type { ReactNode } from 'react';
import type { ConversationCharacterData, ConversationTargetSummary, ConversationViewMode } from '../types.js';

export const CANONICAL_STAGE_SURFACE_WIDTH_CLASS = 'max-w-[min(1240px,calc(100vw-520px))]';

export type CanonicalConversationPaneProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  chrome?: 'card' | 'transparent';
  viewMode: ConversationViewMode;
  onBackToTargets: () => void;
  onViewModeChange: (mode: ConversationViewMode) => void;
  onOpenSettings?: () => void;
  topContent?: ReactNode;
  stagePanel: ReactNode;
  transcript: ReactNode;
  composer?: ReactNode;
};

export function CanonicalConversationPane(props: CanonicalConversationPaneProps) {
  const themeBackground = props.chrome === 'transparent'
    ? 'transparent'
    : props.characterData?.theme?.roomAura || 'radial-gradient(circle at top, rgba(16,185,129,0.14), transparent 72%)';
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-canonical-conversation-pane="true"
      data-conversation-pane-chrome={props.chrome || 'card'}
      style={{ background: themeBackground }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {props.topContent ? (
          <div className="shrink-0 px-6 pt-5">
            <div className="mx-auto w-full max-w-[min(1240px,calc(100vw-520px))]">
              {props.topContent}
            </div>
          </div>
        ) : null}
        <div key={props.viewMode} className="flex min-h-0 flex-1 flex-col animate-[conv-fade-in_280ms_ease-out]">
          {props.viewMode === 'stage' ? props.stagePanel : props.transcript}
        </div>
        {props.composer ? <div className="shrink-0">{props.composer}</div> : null}
      </div>
    </section>
  );
}
