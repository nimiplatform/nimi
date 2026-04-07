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
const chatAiPresentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-presentation.tsx');
const chatAgentAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
const chatAgentPresentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
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

test('chat unified shell a2: AI host setup state is sourced from projection and route options', () => {
  assert.match(chatAiAdapterSource, /resolveAiConversationSetupStateFromProjection/);
  assert.match(chatAiAdapterSource, /toRuntimeRouteBindingFromPickerSelection/);
  assert.match(chatAiAdapterSource, /handleModelSelectionChange/);
  assert.match(chatPageSource, /useRuntimeConfigPanelController/);
  assert.match(chatPageSource, /setChatSetupState/);
  assert.doesNotMatch(chatPageSource, /aiRouteReadinessPending/);
  assert.doesNotMatch(chatPageSource, /Loading AI routes\.\.\./);
});

test('chat unified shell a2: chat page mounts the canonical target-first shell', () => {
  assert.match(chatPageSource, /CanonicalConversationShell/);
  assert.match(chatPageSource, /hideTargetPane/);
  assert.match(chatPageSource, /hideCharacterRail/);
  assert.match(chatPageSource, /rightPanel=\{rightPanelNode\}/);
  assert.match(chatPageSource, /sourceFilter="all"/);
  assert.match(chatPageSource, /const selectedTargetId = storeSelectedTargetId \|\| activeHost\?\.selectedTargetId \|\| null/);
  assert.match(chatPageSource, /setSelectedTargetForSource\(activeHost\.mode, activeHost\.selectedTargetId\)/);
  // Contact rail is rendered after the shell (right side)
  assert.match(chatPageSource, /ChatContactsSidebar/);
  assert.match(chatPageSource, /selectedTargetBySource/);
  assert.match(chatPageSource, /setChatViewMode/);
  assert.match(chatPageSource, /setupState=\{activeHost\.adapter\.setupState\}/);
  assert.match(chatPageSource, /setupDescription=\{activeHost\.setupDescription\}/);
  assert.match(chatPageSource, /characterData=\{activeHost\.characterData\}/);
  assert.match(chatPageSource, /messages=\{canonicalMessages\}/);
  assert.match(chatPageSource, /transcriptProps=\{activeHost\.transcriptProps\}/);
  assert.match(chatPageSource, /stagePanelProps=\{activeHost\.stagePanelProps\}/);
  assert.match(chatPageSource, /composer=\{activeHost\.composerContent\}/);
  assert.doesNotMatch(chatPageSource, /settingsDrawer=\{/);
  assert.doesNotMatch(chatPageSource, /profileDrawer=\{/);
  assert.doesNotMatch(chatPageSource, /rightSidebar=\{/);
  assert.match(chatPageSource, /onSelectTarget/);
  assert.doesNotMatch(chatPageSource, /resolveAgentConversationSurfaceState/);
  assert.doesNotMatch(chatPageSource, /resolveAgentConversationHostView/);
  assert.doesNotMatch(chatPageSource, /resolveAgentConversationHostSnapshot/);
  assert.doesNotMatch(chatPageSource, /resolveAgentTargetSummaries/);
  assert.doesNotMatch(chatPageSource, /resolveAgentCanonicalMessages/);
  assert.doesNotMatch(chatPageSource, /resolveAgentSelectedTargetId/);
  assert.doesNotMatch(chatPageSource, /createInitialAgentSubmitDriverState/);
  assert.doesNotMatch(chatPageSource, /chatAgentStoreClient/);
  assert.doesNotMatch(chatPageSource, /RuntimeStreamFooter/);
  assert.doesNotMatch(chatPageSource, /createConversationShellViewModel/);
  assert.doesNotMatch(chatPageSource, /ConversationSetupPanel/);
  assert.doesNotMatch(chatPageSource, /renderChatTranscript=/);
  assert.doesNotMatch(chatPageSource, /renderStagePanel=/);
  // threadAdapter.listThreads is now used in ChatPage to feed the AI session list panel
  assert.match(chatPageSource, /threadAdapter\.listThreads/);
  assert.doesNotMatch(chatPageSource, /fallbackMessages/);
  assert.doesNotMatch(chatPageSource, /<ConversationShell/);
});

test('chat unified shell a2: host contract only exposes canonical data and section props', () => {
  assert.match(chatModeHostTypesSource, /setupDescription\?:/);
  assert.match(chatModeHostTypesSource, /transcriptProps\?:/);
  assert.match(chatModeHostTypesSource, /stagePanelProps\?:/);
  assert.match(chatModeHostTypesSource, /composerContent\?:/);
  assert.match(chatModeHostTypesSource, /profileContent\?:/);
  assert.match(chatModeHostTypesSource, /rightSidebarContent\?:/);
  assert.match(chatModeHostTypesSource, /rightSidebarOverlayMenu\?:/);
  assert.match(chatModeHostTypesSource, /rightSidebarAutoOpenKey\?:/);
  assert.match(chatModeHostTypesSource, /rightPanelContent\?:/);
  assert.match(chatModeHostTypesSource, /onCreateThread\?:/);
  assert.match(chatModeHostTypesSource, /onArchiveThread\?:/);
  assert.match(chatModeHostTypesSource, /onRenameThread\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderTranscript\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderStagePanel\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderComposer\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderTargetRail\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderEmptyState\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderSetupDescription\?:/);
  assert.doesNotMatch(chatModeHostTypesSource, /renderThreadMeta\?:/);
});

test('chat unified shell a2: AI and agent hosts reuse canonical transcript/composer contract without source-owned shell callbacks', () => {
  assert.match(chatAiAdapterSource, /useAiConversationPresentation/);
  assert.match(chatAiAdapterSource, /createChatAiConversationRuntimeAdapter/);
  assert.match(chatAiAdapterSource, /useAiConversationEffects/);
  assert.match(chatAiPresentationSource, /CanonicalComposer/);
  assert.match(chatAiPresentationSource, /onModelSelectionChange=/);
  assert.match(chatAiPresentationSource, /transcriptProps:/);
  assert.match(chatAiPresentationSource, /composerContent:/);
  assert.match(chatAiPresentationSource, /settingsContent:/);
  assert.match(chatAiPresentationSource, /ConversationCapabilitySettingsSection section="voice"/);
  assert.match(chatAiPresentationSource, /ConversationCapabilitySettingsSection section="visual"/);
  assert.match(chatAiPresentationSource, /diagnosticsContent=/);
  assert.match(chatAiPresentationSource, /onArchiveThread: input\.handleArchiveThread/);
  assert.match(chatAiPresentationSource, /onRenameThread: input\.handleRenameThread/);
  assert.doesNotMatch(chatAiPresentationSource, /voiceRouteConfigContent={<RuntimeInspectUnsupportedNote/);
  assert.doesNotMatch(chatAiPresentationSource, /mediaRouteConfigContent={<RuntimeInspectUnsupportedNote/);
  assert.doesNotMatch(chatAiPresentationSource, /rightSidebarContent:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTargetRail:/);

  assert.match(chatAgentAdapterSource, /useAgentConversationPresentation/);
  assert.match(chatAgentAdapterSource, /useAgentConversationEffects/);
  assert.match(chatAgentPresentationSource, /CanonicalComposer/);
  assert.match(chatAgentPresentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(chatAgentPresentationSource, /settingsContent:/);
  assert.match(chatAgentPresentationSource, /ConversationCapabilitySettingsSection section="voice"/);
  assert.match(chatAgentPresentationSource, /ConversationCapabilitySettingsSection section="visual"/);
  assert.match(chatAgentPresentationSource, /diagnosticsContent=/);
  assert.match(chatAgentPresentationSource, /composerContent:/);
  assert.doesNotMatch(chatAgentPresentationSource, /voiceRouteConfigContent={<RuntimeInspectUnsupportedNote/);
  assert.doesNotMatch(chatAgentPresentationSource, /mediaRouteConfigContent={<RuntimeInspectUnsupportedNote/);
  assert.doesNotMatch(chatAgentPresentationSource, /rightSidebarContent:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTargetRail:/);

  assert.match(chatSettingsPanelSource, /SettingsSection/);
  assert.match(chatSettingsPanelSource, /CanonicalSettingsCollapsibleSection/);
  assert.match(chatSettingsPanelSource, /CanonicalSettingsToggleRow/);
  assert.match(chatSettingsPanelSource, /modelPickerContent\?:/);
  assert.match(chatSettingsPanelSource, /chatRouteConfigContent\?:/);
  assert.match(chatSettingsPanelSource, /voiceRouteConfigContent\?:/);
  assert.match(chatSettingsPanelSource, /diagnosticsContent\?:/);
  assert.doesNotMatch(chatSettingsPanelSource, /Coming soon/);

  assert.match(chatHumanAdapterSource, /useHumanCanonicalConversationSurface/);
  assert.match(chatHumanAdapterSource, /HumanCanonicalComposer/);
  assert.match(chatHumanAdapterSource, /settingsContent:/);
  assert.match(chatHumanAdapterSource, /ChatSettingsPanel/);
  assert.doesNotMatch(chatHumanAdapterSource, /settingsContent: null/);
  assert.match(chatHumanAdapterSource, /auxiliaryOverlayContent:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderStagePanel:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatHumanAdapterSource, /renderTargetRail:/);
  assert.doesNotMatch(chatHumanAdapterSource, /HumanConversationTranscript/);
  assert.doesNotMatch(chatHumanAdapterSource, /HumanConversationComposer/);
});
