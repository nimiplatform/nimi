import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const humanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
const canonicalHumanSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-canonical-components.tsx');
const canonicalHumanComposerProfileSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-canonical-composer-profile.tsx');
const giftModalSource = readWorkspaceFile('src/shell/renderer/features/turns/human-conversation-gift-modal.tsx');
const messageTimelineSource = readWorkspaceFile('src/shell/renderer/features/turns/message-timeline.tsx');

test('chat human shell a5: human host now uses shell-native transcript, composer, and target rail', () => {
  assert.match(humanAdapterSource, /useHumanCanonicalConversationSurface/);
  assert.match(humanAdapterSource, /HumanCanonicalComposer/);
  assert.match(humanAdapterSource, /HumanCanonicalProfileDrawer/);
  assert.match(humanAdapterSource, /HumanConversationGiftModal/);
  assert.match(humanAdapterSource, /transcriptProps:/);
  assert.match(humanAdapterSource, /stagePanelProps:/);
  assert.match(humanAdapterSource, /composerContent:/);
  assert.match(humanAdapterSource, /profileContent:/);
  assert.match(humanAdapterSource, /settingsContent:/);
  assert.match(humanAdapterSource, /ChatRuntimeInspectContent/);
  assert.match(humanAdapterSource, /rightSidebarContent:/);
  assert.match(humanAdapterSource, /rightSidebarOverlayMenu:/);
  assert.match(humanAdapterSource, /rightSidebarAutoOpenKey:/);
  assert.match(humanAdapterSource, /auxiliaryOverlayContent:/);
  assert.doesNotMatch(humanAdapterSource, /useRealmMessageTimeline/);
  assert.doesNotMatch(humanAdapterSource, /getRealmChatTimelineDisplayModel/);
  assert.doesNotMatch(humanAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(humanAdapterSource, /renderStagePanel:/);
  assert.doesNotMatch(humanAdapterSource, /renderComposer:/);
  assert.doesNotMatch(humanAdapterSource, /renderTargetRail:/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationTranscript/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationComposer/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationTargetRail/);
  assert.doesNotMatch(humanAdapterSource, /ConversationOrchestrationRegistry/);
  assert.doesNotMatch(humanAdapterSource, /matchConversationTurnEvent/);
  assert.doesNotMatch(humanAdapterSource, /createAgentLocalChatConversationProvider/);
  assert.doesNotMatch(humanAdapterSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.doesNotMatch(humanAdapterSource, /resolveCompletedAgentSubmitHostFlow/);
  assert.doesNotMatch(humanAdapterSource, /resolveInterruptedAgentSubmitHostFlow/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentProjectionRefreshOutcome/);
  assert.doesNotMatch(humanAdapterSource, /resolveCompletedAgentHostInteraction/);
  assert.doesNotMatch(humanAdapterSource, /resolveInterruptedAgentHostInteraction/);
  assert.doesNotMatch(humanAdapterSource, /resolveProjectionRefreshAgentHostInteraction/);
  assert.doesNotMatch(humanAdapterSource, /createInitialAgentSubmitSessionState/);
  assert.doesNotMatch(humanAdapterSource, /reduceAgentSubmitSessionEvent/);
  assert.doesNotMatch(humanAdapterSource, /resolveCompletedAgentSubmitSession/);
  assert.doesNotMatch(humanAdapterSource, /resolveInterruptedAgentSubmitSession/);
  assert.doesNotMatch(humanAdapterSource, /resolveProjectionRefreshAgentSubmitSession/);
  assert.doesNotMatch(humanAdapterSource, /createInitialAgentSubmitDriverState/);
  assert.doesNotMatch(humanAdapterSource, /reduceAgentSubmitDriverEvent/);
  assert.doesNotMatch(humanAdapterSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(humanAdapterSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentFooterViewState/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentConversationSurfaceState/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentConversationHostView/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentConversationHostSnapshot/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentTargetSummaries/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentCanonicalMessages/);
  assert.doesNotMatch(humanAdapterSource, /resolveAgentSelectedTargetId/);
  assert.doesNotMatch(humanAdapterSource, /overlayAgentAssistantVisibleState/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-footer-state/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-host-flow/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-host-interaction/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-submit-session/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-submit-driver/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-visible-state/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-host-view/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-host-snapshot/);
  assert.doesNotMatch(humanAdapterSource, /chat-agent-shell-view-model/);
  assert.doesNotMatch(humanAdapterSource, /chatAgentStoreClient/);
});

test('chat human shell a5: canonical human bridge projects realm data into canonical message slots and stream wiring', () => {
  assert.match(canonicalHumanSource, /useHumanCanonicalConversationSurface/);
  assert.match(canonicalHumanSource, /useHumanCanonicalTranscriptProps/);
  assert.match(canonicalHumanSource, /useHumanCanonicalStagePanelProps/);
  assert.match(canonicalHumanSource, /CanonicalTranscriptView/);
  assert.match(canonicalHumanSource, /CanonicalStagePanel/);
  assert.match(canonicalHumanSource, /renderMessageContent/);
  assert.match(canonicalHumanSource, /renderMessageAvatar/);
  assert.match(canonicalHumanSource, /renderMessageAccessory/);
  assert.match(canonicalHumanSource, /resolveCanonicalChatAttachmentUrl/);
  assert.match(canonicalHumanSource, /attachmentDisplayKind === 'AUDIO'/);
  assert.match(canonicalHumanSource, /new Audio\(/);
  assert.match(canonicalHumanSource, /selectedVoiceMessageId/);
  assert.match(canonicalHumanSource, /HumanVoiceInspectSidebar/);
  assert.match(canonicalHumanSource, /rightSidebarContent/);
  assert.match(canonicalHumanSource, /diagnosticsSummary/);
  assert.match(canonicalHumanSource, /toggleVoiceTranscript/);
  assert.match(canonicalHumanSource, /rightSidebarOverlayMenu/);
  assert.match(canonicalHumanSource, /'image-pending'/);
  assert.match(canonicalHumanSource, /'video-pending'/);
  assert.match(canonicalHumanSource, /ChatStreamStatus/);
  assert.match(canonicalHumanSource, /cancelStream\(props\.selectedChatId\)/);
  assert.doesNotMatch(canonicalHumanSource, /RealmChatTimeline,/);
  assert.doesNotMatch(canonicalHumanSource, /content=\{/);
});

test('chat human shell a5: composer and profile drawer reuse existing desktop transport surfaces without reusing the old outer UI', () => {
  assert.match(canonicalHumanSource, /chat-human-canonical-composer-profile/);
  assert.match(canonicalHumanComposerProfileSource, /createRealmChatComposerAdapter/);
  assert.match(canonicalHumanComposerProfileSource, /createChatUploadPlaceholder/);
  assert.match(canonicalHumanComposerProfileSource, /ChatProfileCard/);
  assert.match(giftModalSource, /SendGiftModal/);
  assert.doesNotMatch(canonicalHumanComposerProfileSource, /<TurnInput/);
});

test('chat human shell a5: legacy message timeline is now a compatibility wrapper around extracted parts', () => {
  assert.match(messageTimelineSource, /HumanCanonicalTranscriptSurface/);
  assert.match(messageTimelineSource, /HumanCanonicalComposer/);
  assert.match(messageTimelineSource, /HumanCanonicalProfileDrawer/);
  assert.match(messageTimelineSource, /HumanConversationGiftModal/);
  assert.doesNotMatch(messageTimelineSource, /HumanConversationTranscript/);
  assert.doesNotMatch(messageTimelineSource, /HumanConversationComposer/);
  assert.doesNotMatch(messageTimelineSource, /HumanConversationTargetRail/);
});
