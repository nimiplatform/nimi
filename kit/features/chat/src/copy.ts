/**
 * Copy injection surface for the chat feature.
 *
 * Follows the model-config copy pattern: components accept a partial `copy`
 * prop, `DEFAULT_CHAT_COPY` keeps the existing English strings, and
 * `resolveChatCopy` merges overrides over the defaults. Components that
 * already expose complete label props (CanonicalTranscriptView,
 * RealmChatTimeline, AppAiChatPanel) keep extending those props instead.
 */
export type ChatCopy = {
  /** CanonicalTargetPane loading card label. */
  targetPaneLoadingLabel?: string;
  /** CanonicalTargetPane empty-state title. */
  targetPaneEmptyTitle?: string;
  /** CanonicalTargetPane empty-state description. */
  targetPaneEmptyDescription?: string;
  /** CanonicalCharacterRail bio fallback when neither character nor target has a bio. */
  characterRailNoBioFallback?: string;
  /** CanonicalCharacterRail back action label. */
  characterRailBackLabel?: string;
  /** CanonicalCharacterRail profile action label. */
  characterRailOpenProfileLabel?: string;
  /** CanonicalCharacterRail presence label for the `loading` interaction phase. */
  characterRailPresenceMovingCloserLabel?: string;
  /** CanonicalCharacterRail presence label for the `speaking` interaction phase. */
  characterRailPresenceSpeakingLabel?: string;
  /** CanonicalCharacterRail presence label for the `painting` interaction phase. */
  characterRailPresencePaintingLabel?: string;
  /** CanonicalCharacterRail presence label for the `filming` interaction phase. */
  characterRailPresenceFilmingLabel?: string;
  /** CanonicalCharacterRail presence label for the `thinking` interaction phase. */
  characterRailPresenceThinkingLabel?: string;
  /** CanonicalCharacterRail presence label for the `listening` interaction phase. */
  characterRailPresenceListeningLabel?: string;
  /** CanonicalCharacterRail presence label when the target is offline. */
  characterRailPresenceOfflineLabel?: string;
  /** CanonicalCharacterRail default presence label when the target is online. */
  characterRailPresenceOnlineLabel?: string;
  /** CanonicalCharacterRail badge shown when no avatar presentation profile is available. */
  characterRailAvatarUnavailableLabel?: string;
  /** CanonicalCharacterRail label for a new relationship. */
  characterRailRelationshipNewLabel?: string;
  /** CanonicalCharacterRail label for a friendly relationship. */
  characterRailRelationshipFriendlyLabel?: string;
  /** CanonicalCharacterRail label for a warm relationship. */
  characterRailRelationshipWarmLabel?: string;
  /** CanonicalCharacterRail label for an intimate relationship. */
  characterRailRelationshipIntimateLabel?: string;
  /** Canonical typing bubble role announcement. */
  typingAgentRoleLabel?: string;
  /** Canonical typing bubble visible activity label. */
  typingThinkingLabel?: string;
  /** Canonical typing bubble stop action label. */
  typingStopLabel?: string;
  /** CanonicalStagePanel eyebrow above the beat counter. */
  stageMomentEyebrow?: string;
  /** CanonicalStagePanel beat counter label. */
  stageBeatsInFocusLabel?: (beats: number) => string;
  /** CanonicalStagePanel hint shown when no beat is in focus yet. */
  stageBeginHintLabel?: string;
  /** CanonicalStagePanel empty-stage title. */
  stageEmptyTitle?: string;
  /** CanonicalStagePanel empty-stage description. */
  stageEmptyDescription?: string;
  /** CanonicalMessageBubble label while a voice message is playing. */
  bubbleVoicePlayingLabel?: string;
  /** CanonicalMessageBubble idle voice message label. */
  bubbleVoiceMessageLabel?: string;
  /** CanonicalMessageBubble pending image generation label. */
  bubbleGeneratingImageLabel?: string;
  /** CanonicalMessageBubble pending video generation label. */
  bubbleGeneratingVideoLabel?: string;
  /** CanonicalMessageBubble image preview dialog title. */
  bubbleImagePreviewTitle?: string;
  /** CanonicalMessageBubble aria label for opening the image preview. */
  bubbleOpenImagePreviewLabel?: string;
  /** CanonicalMessageBubble aria label for closing the image preview. */
  bubbleCloseImagePreviewLabel?: string;
  /** CanonicalMessageBubble image fallback alt text. */
  bubbleImageLabel?: string;
  /** CanonicalMessageBubble image failure label. */
  bubbleImageUnavailableLabel?: string;
  /** CanonicalMessageBubble video failure label. */
  bubbleVideoUnavailableLabel?: string;
  /** CanonicalMessageBubble empty streaming label. */
  bubbleStreamingLabel?: string;
  /** CanonicalMessageBubble fallback sender label for the local user. */
  bubbleUserLabel?: string;
  /** CanonicalMessageBubble fallback sender label for the assistant. */
  bubbleAssistantLabel?: string;
  /** CanonicalConversationShell overlay dismissal label. */
  shellDismissOverlayLabel?: string;
  /** ChatStreamStatus suffix marker for interrupted streams. */
  streamInterruptedLabel?: string;
  /** ChatMarkdownRenderer code block copy action label. */
  markdownCopyLabel?: string;
  /** ChatMarkdownRenderer code block copied confirmation label. */
  markdownCopiedLabel?: string;
  /** ChatComposer voice recording/transcription cancel button label. */
  composerCancelLabel?: string;
  /** ConversationThreadList empty-state title. */
  threadListEmptyTitle?: string;
};

export const DEFAULT_CHAT_COPY: Required<ChatCopy> = Object.freeze({
  targetPaneLoadingLabel: 'Loading targets...',
  targetPaneEmptyTitle: 'No targets available',
  targetPaneEmptyDescription: 'Change the source filter or wait until a compatible conversation target appears.',
  characterRailNoBioFallback: 'This Agent has no public bio.',
  characterRailBackLabel: 'Back to character space',
  characterRailOpenProfileLabel: 'Open profile',
  characterRailPresenceMovingCloserLabel: 'Moving closer...',
  characterRailPresenceSpeakingLabel: 'Speaking...',
  characterRailPresencePaintingLabel: 'Drawing something...',
  characterRailPresenceFilmingLabel: 'Cutting together a scene...',
  characterRailPresenceThinkingLabel: 'Thinking…',
  characterRailPresenceListeningLabel: 'Listening to you...',
  characterRailPresenceOfflineLabel: 'Offline',
  characterRailPresenceOnlineLabel: 'Here with you',
  characterRailAvatarUnavailableLabel: 'Avatar unavailable',
  characterRailRelationshipNewLabel: 'New',
  characterRailRelationshipFriendlyLabel: 'Friendly',
  characterRailRelationshipWarmLabel: 'Warm',
  characterRailRelationshipIntimateLabel: 'Intimate',
  typingAgentRoleLabel: 'Assistant pending',
  typingThinkingLabel: 'Thinking…',
  typingStopLabel: 'Stop generating',
  stageMomentEyebrow: 'Moment',
  stageBeatsInFocusLabel: (beats) => `${beats} beat${beats === 1 ? '' : 's'} in focus`,
  stageBeginHintLabel: 'Send a message to begin',
  stageEmptyTitle: 'Waiting for the first exchange',
  stageEmptyDescription: 'The stage keeps the current turn in focus before the full history takes over.',
  bubbleVoicePlayingLabel: 'Playing voice',
  bubbleVoiceMessageLabel: 'Voice message',
  bubbleGeneratingImageLabel: 'Generating image…',
  bubbleGeneratingVideoLabel: 'Generating video…',
  bubbleImagePreviewTitle: 'Image preview',
  bubbleOpenImagePreviewLabel: 'Open image preview',
  bubbleCloseImagePreviewLabel: 'Close image preview',
  bubbleImageLabel: 'Image',
  bubbleImageUnavailableLabel: 'Image unavailable',
  bubbleVideoUnavailableLabel: 'Video unavailable',
  bubbleStreamingLabel: 'Streaming…',
  bubbleUserLabel: 'You',
  bubbleAssistantLabel: 'Assistant',
  shellDismissOverlayLabel: 'Dismiss overlay',
  streamInterruptedLabel: '[Interrupted]',
  markdownCopyLabel: 'Copy',
  markdownCopiedLabel: 'Copied!',
  composerCancelLabel: 'Cancel',
  threadListEmptyTitle: 'No conversations yet.',
});

export function resolveChatCopy(copy?: ChatCopy): Required<ChatCopy> {
  return { ...DEFAULT_CHAT_COPY, ...copy };
}
