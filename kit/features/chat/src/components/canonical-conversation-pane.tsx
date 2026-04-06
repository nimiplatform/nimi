import type { ReactNode } from 'react';
import type { ConversationCharacterData, ConversationTargetSummary, ConversationViewMode } from '../types.js';

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
  const themeBackground = props.characterData?.theme?.roomAura || 'radial-gradient(circle at top, rgba(16,185,129,0.14), transparent 72%)';
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-canonical-conversation-pane="true"
      style={{ background: themeBackground }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div key={props.viewMode} className="flex min-h-0 flex-1 flex-col animate-[conv-fade-in_280ms_ease-out]">
          {props.viewMode === 'stage' ? props.stagePanel : props.transcript}
        </div>
        {props.composer ? <div className="shrink-0">{props.composer}</div> : null}
      </div>
    </section>
  );
}
