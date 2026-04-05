import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatModeRegistrySource = readWorkspaceFile('src/shell/renderer/features/chat/chat-mode-registry.ts');
const chatModeHostTypesSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-mode-host-types.ts');
const chatAiAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');
const chatAgentAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
const chatHumanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
const chatSettingsPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-settings-panel.tsx');
const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');

test('chat unified shell a2: main layout mounts the dedicated chat page host', () => {
  assert.match(mainLayoutViewSource, /@renderer\/features\/chat\/chat-page/);
  assert.match(mainLayoutViewSource, /<ChatPage \/>/);
  assert.doesNotMatch(mainLayoutViewSource, /function ChatLayout\(/);
});

test('chat unified shell a2: anonymous desktop only exposes AI mode', () => {
  assert.match(chatModeRegistrySource, /input\.authStatus === 'authenticated'\s*\?\s*\[input\.aiHost, input\.humanHost, input\.agentHost\]\s*:\s*\[input\.aiHost\]/);
});

test('chat unified shell a2: AI host setup state is sourced from route readiness', () => {
  assert.match(chatAiAdapterSource, /resolveAiConversationRouteReadiness/);
  assert.match(chatPageSource, /useRuntimeConfigPanelController/);
  assert.match(chatPageSource, /setChatSetupState/);
});

test('chat unified shell a2: chat page mounts the canonical target-first shell', () => {
  assert.match(chatPageSource, /CanonicalConversationShell/);
  assert.match(chatPageSource, /CanonicalTranscriptView/);
  assert.match(chatPageSource, /CanonicalStagePanel/);
  assert.match(chatPageSource, /chatSourceFilter/);
  assert.match(chatPageSource, /selectedTargetBySource/);
  assert.match(chatPageSource, /setChatViewMode/);
  assert.match(chatPageSource, /transcriptProps=\{activeHost\.transcriptProps\}/);
  assert.match(chatPageSource, /stagePanelProps=\{activeHost\.stagePanelProps\}/);
  assert.match(chatPageSource, /rightSidebarOverlayMenu=\{activeHost\.rightSidebarOverlayMenu\}/);
  assert.match(chatPageSource, /settingsOpen=\{settingsOpen\}/);
  assert.match(chatPageSource, /profileOpen=\{profileOpen\}/);
  assert.match(chatPageSource, /rightSidebarOpen=\{rightSidebarOpen\}/);
  assert.match(chatPageSource, /onSelectTarget/);
  assert.doesNotMatch(chatPageSource, /threadAdapter\.listThreads/);
  assert.doesNotMatch(chatPageSource, /fallbackMessages/);
  assert.doesNotMatch(chatPageSource, /<ConversationShell/);
});

test('chat unified shell a2: host contract only exposes canonical data and section props', () => {
  assert.match(chatModeHostTypesSource, /transcriptProps\?:/);
  assert.match(chatModeHostTypesSource, /stagePanelProps\?:/);
  assert.match(chatModeHostTypesSource, /composerContent\?:/);
  assert.match(chatModeHostTypesSource, /profileContent\?:/);
  assert.match(chatModeHostTypesSource, /rightSidebarOverlayMenu\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderTranscript\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderStagePanel\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderComposer\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderTargetRail\?:/);
});

test('chat unified shell a2: AI and agent hosts reuse canonical transcript/composer contract without source-owned shell callbacks', () => {
  assert.match(chatAiAdapterSource, /CanonicalComposer/);
  assert.match(chatAiAdapterSource, /CanonicalDrawerSection/);
  assert.match(chatAiAdapterSource, /transcriptProps:/);
  assert.match(chatAiAdapterSource, /composerContent:/);
  assert.match(chatAiAdapterSource, /profileContent:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTargetRail:/);

  assert.match(chatAgentAdapterSource, /CanonicalComposer/);
  assert.match(chatAgentAdapterSource, /CanonicalDrawerSection/);
  assert.match(chatAgentAdapterSource, /transcriptProps:/);
  assert.match(chatAgentAdapterSource, /composerContent:/);
  assert.match(chatAgentAdapterSource, /profileContent:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTargetRail:/);

  assert.match(chatSettingsPanelSource, /CanonicalDrawerSection/);

  assert.match(chatHumanAdapterSource, /useHumanCanonicalConversationSurface/);
  assert.match(chatHumanAdapterSource, /HumanCanonicalComposer/);
  assert.match(chatHumanAdapterSource, /profileContent:/);
  assert.match(chatHumanAdapterSource, /rightSidebarOverlayMenu:/);
  assert.match(chatHumanAdapterSource, /auxiliaryOverlayContent:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderStagePanel:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderTargetRail:/);
  assert.doesNotMatch(chatHumanAdapterSource, /HumanConversationTranscript/);
  assert.doesNotMatch(chatHumanAdapterSource, /HumanConversationComposer/);
});
