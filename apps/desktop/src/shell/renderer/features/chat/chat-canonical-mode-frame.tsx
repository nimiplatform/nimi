import { useCallback, useEffect, type ReactNode } from 'react';
import { CanonicalConversationShell } from '@nimiplatform/kit/features/chat/components/canonical-conversation-shell';
import { cn } from '@nimiplatform/kit/ui';
import type {
  ConversationMode,
  ConversationSetupAction,
  ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
import type {
  CanonicalStagePanelProps,
} from '@nimiplatform/kit/features/chat/components/canonical-stage-panel';
import type {
  CanonicalTranscriptViewProps,
} from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
import { CHAT_COMPOSER_RAIL_RESERVE_CLASS } from './chat-shared-content-layout';
import { ChatSideSheet } from './chat-shared-side-sheet';

export type ChatCanonicalModeFrameProps = {
  mode: ConversationMode;
  host: DesktopConversationModeHost;
  allTargets: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  selectedTarget: ConversationTargetSummary | null;
  onSelectTarget: (targetId: string | null) => void;
  onSetupAction: (action: ConversationSetupAction) => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  className?: string;
  sceneBackground?: ReactNode;
  afterShell?: ReactNode;
  settingsSheetContent?: ReactNode;
  settingsSheetTitle?: ReactNode;
  settingsSheetSubtitle?: ReactNode;
  settingsSheetEyebrow?: string;
  settingsSheetWorld?: string | null;
  settingsSheetAvatarUrl?: string | null;
  settingsSheetAvatarFallback?: string;
  settingsSheetAvatarAlt?: string;
  settingsSheetBodyClassName?: string;
  transcriptPropsOverride?: Omit<CanonicalTranscriptViewProps, 'messages'>;
  stagePanelPropsOverride?: Omit<
    CanonicalStagePanelProps,
    'messages' | 'characterData' | 'anchorViewportRef' | 'cardAnchorOffsetPx' | 'onIntentOpenHistory'
  >;
};

export function ChatCanonicalModeFrame(props: ChatCanonicalModeFrameProps) {
  const setChatSetupState = useAppStore((state) => state.setChatSetupState);
  const setChatViewMode = useAppStore((state) => state.setChatViewMode);

  useEffect(() => {
    setChatSetupState(props.mode, props.host.adapter.setupState);
  }, [props.host.adapter.setupState, props.mode, setChatSetupState]);

  const viewModeKey = props.selectedTarget
    ? `${props.selectedTarget.source}:${props.selectedTarget.id}`
    : `${props.mode}:landing`;
  const currentViewMode = useAppStore((state) => state.viewModeBySourceTarget[viewModeKey] || 'chat');
  const canonicalMessages = props.host.messages || [];

  const handleViewModeChange = useCallback((mode: 'stage' | 'chat') => {
    if (!props.selectedTarget) {
      return;
    }
    setChatViewMode(props.mode, props.selectedTarget.id, mode);
  }, [props.mode, props.selectedTarget, setChatViewMode]);

  const settingsContent = props.settingsSheetContent ?? props.host.settingsContent ?? null;
  const shouldRenderSettings = Boolean(props.selectedTarget && props.settingsOpen && settingsContent);

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-1', props.className)}>
      <CanonicalConversationShell
        className="h-full min-h-0 flex-1"
        chrome="transparent"
        hideTargetPane
        hideCharacterRail
        sourceFilter="all"
        targets={props.allTargets}
        selectedTargetId={props.selectedTargetId}
        selectedTarget={props.selectedTarget}
        onSelectTarget={props.onSelectTarget}
        viewMode={currentViewMode}
        onViewModeChange={handleViewModeChange}
        setupState={props.host.adapter.setupState}
        setupDescription={props.host.setupDescription}
        onSetupAction={props.onSetupAction}
        characterData={props.host.characterData}
        messages={canonicalMessages}
        transcriptProps={props.transcriptPropsOverride ?? props.host.transcriptProps}
        stagePanelProps={props.stagePanelPropsOverride ?? props.host.stagePanelProps}
        topContent={props.host.topContent}
        sceneBackground={props.sceneBackground}
        composer={props.host.composerContent ? (
          <div className={CHAT_COMPOSER_RAIL_RESERVE_CLASS}>
            {props.host.composerContent}
          </div>
        ) : null}
        auxiliaryOverlayContent={props.host.auxiliaryOverlayContent}
      />
      {props.afterShell}
      {shouldRenderSettings ? (
        <ChatSideSheet
          sheetKey="settings"
          eyebrow={props.settingsSheetEyebrow}
          title={props.settingsSheetTitle ?? props.host.settingsDrawerTitle ?? props.selectedTarget?.title ?? 'Settings'}
          subtitle={props.settingsSheetSubtitle ?? props.host.settingsDrawerSubtitle ?? props.host.characterData?.name ?? null}
          world={props.settingsSheetWorld ?? props.host.settingsDrawerWorld ?? null}
          avatarUrl={props.settingsSheetAvatarUrl}
          avatarFallback={props.settingsSheetAvatarFallback}
          avatarAlt={props.settingsSheetAvatarAlt}
          onClose={props.onCloseSettings}
        >
          <div className={props.settingsSheetBodyClassName || 'px-3 py-3'}>
            {settingsContent}
          </div>
        </ChatSideSheet>
      ) : null}
    </div>
  );
}
