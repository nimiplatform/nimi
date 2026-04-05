import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const humanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
const canonicalHumanSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-canonical-components.tsx');
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
  assert.match(humanAdapterSource, /rightSidebarOverlayMenu:/);
  assert.match(humanAdapterSource, /auxiliaryOverlayContent:/);
  assert.doesNotMatch(humanAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(humanAdapterSource, /renderStagePanel:/);
  assert.doesNotMatch(humanAdapterSource, /renderComposer:/);
  assert.doesNotMatch(humanAdapterSource, /renderTargetRail:/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationTranscript/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationComposer/);
  assert.doesNotMatch(humanAdapterSource, /HumanConversationTargetRail/);
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
  assert.match(canonicalHumanSource, /rightSidebarOverlayMenu/);
  assert.match(canonicalHumanSource, /'image-pending'/);
  assert.match(canonicalHumanSource, /'video-pending'/);
  assert.match(canonicalHumanSource, /ChatStreamStatus/);
  assert.match(canonicalHumanSource, /cancelStream\(props\.selectedChatId\)/);
  assert.doesNotMatch(canonicalHumanSource, /RealmChatTimeline,/);
  assert.doesNotMatch(canonicalHumanSource, /content=\{/);
});

test('chat human shell a5: composer and profile drawer reuse existing desktop transport surfaces without reusing the old outer UI', () => {
  assert.match(canonicalHumanSource, /createRealmChatComposerAdapter/);
  assert.match(canonicalHumanSource, /createChatUploadPlaceholder/);
  assert.match(canonicalHumanSource, /ChatProfileCard/);
  assert.match(giftModalSource, /SendGiftModal/);
  assert.doesNotMatch(canonicalHumanSource, /<TurnInput/);
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
