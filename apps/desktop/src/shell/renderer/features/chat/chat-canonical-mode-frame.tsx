import { useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CanonicalConversationShell } from '@nimiplatform/kit/features/chat/components/canonical-conversation-shell';
import type { ChatCopy } from '@nimiplatform/kit/features/chat/ui';
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
import {
  CHAT_COMPOSER_RAIL_RESERVE_CLASS,
  CHAT_SIDE_SHEET_RAIL_RESERVE_CLASS,
} from './chat-shared-content-layout';
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
  settingsSheetHideHeader?: boolean;
  /** The owner surface (e.g. Agent Center) renders its own full-height card chrome;
   *  skip the side-sheet card wrapper so the content is not nested in a second card. */
  settingsSheetBare?: boolean;
  transcriptPropsOverride?: Omit<CanonicalTranscriptViewProps, 'messages'>;
  stagePanelPropsOverride?: Omit<
    CanonicalStagePanelProps,
    'messages' | 'characterData' | 'anchorViewportRef' | 'cardAnchorOffsetPx' | 'onIntentOpenHistory'
  >;
};

export function ChatCanonicalModeFrame(props: ChatCanonicalModeFrameProps) {
  const { t } = useTranslation();
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
  const canonicalCopy: ChatCopy = {
    targetPaneLoadingLabel: t('Chat.loadingTargets', { defaultValue: 'Loading targets…' }),
    targetPaneEmptyTitle: t('Chat.noTargetsTitle', { defaultValue: 'No targets available' }),
    targetPaneEmptyDescription: t('Chat.noTargetsDescription', { defaultValue: 'Change the source filter or wait until a compatible conversation target appears.' }),
    characterRailNoBioFallback: t('Chat.noPublicBio', { defaultValue: 'This Agent has no public bio.' }),
    characterRailBackLabel: t('Chat.backToCharacterSpace', { defaultValue: 'Back to character space' }),
    characterRailOpenProfileLabel: t('Chat.openProfile', { defaultValue: 'Open profile' }),
    characterRailPresenceMovingCloserLabel: t('Chat.presenceMovingCloser', { defaultValue: 'Moving closer…' }),
    characterRailPresenceSpeakingLabel: t('Chat.presenceSpeaking', { defaultValue: 'Speaking…' }),
    characterRailPresencePaintingLabel: t('Chat.presencePainting', { defaultValue: 'Drawing something…' }),
    characterRailPresenceFilmingLabel: t('Chat.presenceFilming', { defaultValue: 'Cutting together a scene…' }),
    characterRailPresenceThinkingLabel: t('Chat.presenceThinking', { defaultValue: 'Thinking…' }),
    characterRailPresenceListeningLabel: t('Chat.presenceListening', { defaultValue: 'Listening to you…' }),
    characterRailPresenceOfflineLabel: t('Chat.offline', { defaultValue: 'Offline' }),
    characterRailPresenceOnlineLabel: t('Chat.presenceOnline', { defaultValue: 'Here with you' }),
    characterRailAvatarUnavailableLabel: t('Chat.avatarUnavailable', { defaultValue: 'Avatar unavailable' }),
    characterRailRelationshipNewLabel: t('Chat.relationshipNew', { defaultValue: 'New' }),
    characterRailRelationshipFriendlyLabel: t('Chat.relationshipFriendly', { defaultValue: 'Friendly' }),
    characterRailRelationshipWarmLabel: t('Chat.relationshipWarm', { defaultValue: 'Warm' }),
    characterRailRelationshipIntimateLabel: t('Chat.relationshipIntimate', { defaultValue: 'Intimate' }),
    typingAgentRoleLabel: t('Chat.assistantPending', { defaultValue: 'Assistant pending' }),
    typingThinkingLabel: t('Chat.thinking', { defaultValue: 'Thinking…' }),
    typingStopLabel: t('Chat.stopGenerating', { defaultValue: 'Stop generating' }),
    stageMomentEyebrow: t('Chat.stageMoment', { defaultValue: 'Moment' }),
    stageBeatsInFocusLabel: (beats) => t('Chat.stageBeatsInFocus', { count: beats, defaultValue: '{{count}} beats in focus' }),
    stageBeginHintLabel: t('Chat.stageBeginHint', { defaultValue: 'Send a message to begin' }),
    stageEmptyTitle: t('Chat.stageEmptyTitle', { defaultValue: 'Waiting for the first exchange' }),
    stageEmptyDescription: t('Chat.stageEmptyDescription', { defaultValue: 'The stage keeps the current turn in focus before the full history takes over.' }),
    bubbleVoicePlayingLabel: t('Chat.voicePlaying', { defaultValue: 'Playing voice' }),
    bubbleVoiceMessageLabel: t('Chat.voiceMessage', { defaultValue: 'Voice message' }),
    bubbleGeneratingImageLabel: t('Chat.generatingImage', { defaultValue: 'Generating image…' }),
    bubbleGeneratingVideoLabel: t('Chat.generatingVideo', { defaultValue: 'Generating video…' }),
    bubbleImagePreviewTitle: t('Chat.imagePreview', { defaultValue: 'Image preview' }),
    bubbleOpenImagePreviewLabel: t('Chat.openImagePreview', { defaultValue: 'Open image preview' }),
    bubbleCloseImagePreviewLabel: t('Chat.closeImagePreview', { defaultValue: 'Close image preview' }),
    bubbleImageLabel: t('Chat.image', { defaultValue: 'Image' }),
    bubbleImageUnavailableLabel: t('Chat.imageUnavailable', { defaultValue: 'Image unavailable' }),
    bubbleVideoUnavailableLabel: t('Chat.videoUnavailable', { defaultValue: 'Video unavailable' }),
    bubbleStreamingLabel: t('Chat.streaming', { defaultValue: 'Streaming…' }),
    bubbleUserLabel: t('Chat.you', { defaultValue: 'You' }),
    bubbleAssistantLabel: t('Chat.assistant', { defaultValue: 'Assistant' }),
    markdownCopyLabel: t('Chat.markdownCopy', { defaultValue: 'Copy' }),
    markdownCopiedLabel: t('Chat.markdownCopied', { defaultValue: 'Copied!' }),
    shellDismissOverlayLabel: t('Chat.dismissOverlay', { defaultValue: 'Dismiss overlay' }),
  };

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
        copy={canonicalCopy}
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
        noSelectionLabel={t('Chat.selectConversationPrompt', { defaultValue: 'Select a conversation from the list' })}
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
        props.settingsSheetBare ? (
          <aside
            className={cn(CHAT_SIDE_SHEET_RAIL_RESERVE_CLASS, 'flex min-h-0 w-[min(500px,calc(100cqw-96px))] shrink-0')}
            data-chat-shared-side-sheet="settings"
          >
            {settingsContent}
          </aside>
        ) : (
          <ChatSideSheet
            sheetKey="settings"
            eyebrow={props.settingsSheetEyebrow}
            title={props.settingsSheetTitle ?? props.host.settingsDrawerTitle ?? props.selectedTarget?.title ?? 'Settings'}
            subtitle={props.settingsSheetSubtitle ?? props.host.settingsDrawerSubtitle ?? props.host.characterData?.name ?? null}
            world={props.settingsSheetWorld ?? props.host.settingsDrawerWorld ?? null}
            avatarUrl={props.settingsSheetAvatarUrl}
            avatarFallback={props.settingsSheetAvatarFallback}
            avatarAlt={props.settingsSheetAvatarAlt}
            hideHeader={props.settingsSheetHideHeader}
            onClose={props.onCloseSettings}
          >
            <div className={props.settingsSheetBodyClassName || 'px-3 py-3'}>
              {settingsContent}
            </div>
          </ChatSideSheet>
        )
      ) : null}
    </div>
  );
}
