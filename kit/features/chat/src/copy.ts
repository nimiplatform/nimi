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
  bubbleDownloadOriginalLabel?: string;
  bubbleDownloadFailedLabel?: string;
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
  composerRemoveAttachmentLabel?: (name: string | number) => string;
  /** ChatComposer voice recording/transcription cancel button label. */
  composerCancelLabel?: string;
  composerVoiceInputLabel?: string;
  composerRecordVoiceLabel?: string;
  composerSendRecordingLabel?: string;
  composerPlayingVoiceLabel?: string;
  composerTranscribingLabel?: string;
  composerStopVoiceLabel?: string;
  composerCancelTranscriptionLabel?: string;
  composerCancelRecordingLabel?: string;
  /** ConversationThreadList empty-state title. */
  threadListEmptyTitle?: string;
  messageActionsLabel?: string;
  messageMoreLabel?: string;
  messageCopyLabel?: string;
  messageCopySelectionLabel?: string;
  messageCopiedLabel?: string;
  messageCopyFailedLabel?: string;
  messageQuoteLabel?: string;
  messageQuotePendingLabel?: string;
  messageSelectionChangedLabel?: string;
  messageSelectionMultipleLabel?: string;
  messageNavigationLabel?: string;
  messageKeyboardHelpLabel?: string;
  messageKeyboardHelp?: string;
  voicePlayLabel?: string;
  voiceReadLabel?: string;
  voicePauseLabel?: string;
  voiceResumeLabel?: string;
  voiceStopLabel?: string;
  voiceStopWaitingLabel?: string;
  voiceCloseLabel?: string;
  voicePreparingLabel?: string;
  voiceProgressLabel?: string;
  voicePlaybackFailedLabel?: string;
  voiceReadFailedLabel?: string;
  voiceGenerationFailedLabel?: string;
  voiceResultUnknownLabel?: string;
  voiceRetryPlaybackLabel?: string;
  voiceRegenerateLabel?: string;
  voiceRefreshLabel?: string;
  voiceContinueRequestLabel?: string;
  voiceContinueRequestHint?: string;
  voiceRealtimeBlockedLabel?: string;
  voiceLocateLabel?: string;
  voiceSettingsLabel?: string;
  quotePreparingLabel?: string;
  quoteFailedLabel?: string;
  quoteCancelLabel?: string;
  quotePartialLabel?: string;
  quoteSourceLabel?: string;
  quoteReturnLabel?: string;
  quoteTooLongLabel?: string;
  quoteChangedLabel?: string;
  quoteReadFailedLabel?: string;
  quoteRetryLabel?: string;
  quoteAppSourceLabel?: string;
  historyLoadingLabel?: string;
  historyFailedLabel?: string;
  historyRetryLabel?: string;
  historyLatestLabel?: string;
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
  bubbleDownloadOriginalLabel: 'Download original',
  bubbleDownloadFailedLabel: 'Could not download the original. Try again.',
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
  composerRemoveAttachmentLabel: (name) => `Remove attachment ${name}`,
  composerCancelLabel: 'Cancel',
  composerVoiceInputLabel: 'Voice input',
  composerRecordVoiceLabel: 'Record a voice message',
  composerSendRecordingLabel: 'Send recording',
  composerPlayingVoiceLabel: 'Playing voice reply',
  composerTranscribingLabel: 'Transcribing recording…',
  composerStopVoiceLabel: 'Stop voice reply',
  composerCancelTranscriptionLabel: 'Cancel transcription',
  composerCancelRecordingLabel: 'Cancel recording',
  threadListEmptyTitle: 'No conversations yet.',
  messageActionsLabel: 'Message actions',
  messageMoreLabel: 'More actions',
  messageCopyLabel: 'Copy text',
  messageCopySelectionLabel: 'Copy selected text',
  messageCopiedLabel: 'Copied',
  messageCopyFailedLabel: 'Could not copy. Select the text and try again.',
  messageQuoteLabel: 'Reply with quote',
  messageQuotePendingLabel: 'Available when this reply has been saved.',
  messageSelectionChangedLabel: 'The text selection changed. Select the passage again.',
  messageSelectionMultipleLabel: 'Select text from one message to quote it.',
  messageNavigationLabel: 'Conversation messages',
  messageKeyboardHelpLabel: 'Message keyboard shortcuts',
  messageKeyboardHelp: 'Page Up and Page Down move between messages. Enter opens actions. Escape returns to the composer. Tab moves through links and controls in the current message.',
  voicePlayLabel: 'Play voice',
  voiceReadLabel: 'Read aloud',
  voicePauseLabel: 'Pause',
  voiceResumeLabel: 'Resume',
  voiceStopLabel: 'Stop playback',
  voiceStopWaitingLabel: 'Stop waiting',
  voiceCloseLabel: 'Close',
  voicePreparingLabel: 'Preparing voice…',
  voiceProgressLabel: 'Playback progress',
  voicePlaybackFailedLabel: 'Voice playback failed. The text is still available.',
  voiceReadFailedLabel: 'Could not load this audio. The text is still available.',
  voiceGenerationFailedLabel: 'Voice generation did not complete. The text is still available.',
  voiceResultUnknownLabel: 'The result of this voice request is not confirmed.',
  voiceRetryPlaybackLabel: 'Retry playback',
  voiceRegenerateLabel: 'Generate voice again',
  voiceRefreshLabel: 'Refresh voice result',
  voiceContinueRequestLabel: 'Continue this voice request',
  voiceContinueRequestHint: 'This may start voice generation if the original request was not received.',
  voiceRealtimeBlockedLabel: 'End realtime voice to play a message.',
  voiceLocateLabel: 'Go to playing message',
  voiceSettingsLabel: 'Voice settings',
  quotePreparingLabel: 'Preparing quote…',
  quoteFailedLabel: 'This quote is unavailable. Cancel it and select the passage again.',
  quoteCancelLabel: 'Cancel quote',
  quotePartialLabel: 'Original reply incomplete',
  quoteSourceLabel: 'Go to quoted message',
  quoteReturnLabel: 'Return to previous position',
  quoteTooLongLabel: 'This message is too long to quote in full. Select a shorter passage.',
  quoteChangedLabel: 'The source text’s display format has changed. Select the passage again.',
  quoteReadFailedLabel: 'Could not read the source message. Your draft is kept.',
  quoteRetryLabel: 'Retry quote',
  quoteAppSourceLabel: 'App',
  historyLoadingLabel: 'Loading the source message…',
  historyFailedLabel: 'The source message is currently unavailable.',
  historyRetryLabel: 'Retry locating source',
  historyLatestLabel: 'Back to latest messages',
});

export function resolveChatCopy(copy?: ChatCopy): Required<ChatCopy> {
  return { ...DEFAULT_CHAT_COPY, ...copy };
}
