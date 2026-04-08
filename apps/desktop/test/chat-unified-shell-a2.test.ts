import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const conversationCapabilitySource = readWorkspaceFile('src/shell/renderer/features/chat/conversation-capability.ts');
const runtimeSliceSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/runtime-slice.ts');
const storeTypesSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/store-types.ts');
const capabilityStorageSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/desktop-ai-config-storage.ts');
const capabilitySettingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-conversation-capability-settings.tsx');

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
  assert.match(chatAiPresentationSource, /diagnosticsContent=/);
  assert.match(chatAiPresentationSource, /onArchiveThread: input\.handleArchiveThread/);
  assert.match(chatAiPresentationSource, /onRenameThread: input\.handleRenameThread/);
  assert.doesNotMatch(chatAiPresentationSource, /rightSidebarContent:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAiAdapterSource, /renderTargetRail:/);

  assert.match(chatAgentAdapterSource, /useAgentConversationPresentation/);
  assert.match(chatAgentAdapterSource, /useAgentConversationEffects/);
  assert.match(chatAgentPresentationSource, /CanonicalComposer/);
  assert.match(chatAgentPresentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(chatAgentPresentationSource, /settingsContent:/);
  assert.match(chatAgentPresentationSource, /diagnosticsContent=/);
  assert.match(chatAgentPresentationSource, /composerContent:/);
  assert.doesNotMatch(chatAgentPresentationSource, /rightSidebarContent:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTranscript:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderComposer:/);
  assert.doesNotMatch(chatAgentAdapterSource, /renderTargetRail:/);

  assert.match(chatSettingsPanelSource, /SettingsSection/);
  assert.match(chatSettingsPanelSource, /CapabilityAccordionSection/);
  assert.match(chatSettingsPanelSource, /ConversationCapabilitySettingsSection/);
  assert.match(chatSettingsPanelSource, /modelPickerContent\?:/);
  assert.match(chatSettingsPanelSource, /diagnosticsContent\?:/);
  assert.match(chatSettingsPanelSource, /ModelPickerModal/);
  assert.match(chatSettingsPanelSource, /ModelSelectorTrigger/);
  assert.match(chatSettingsPanelSource, /mode === 'ai'/);
  assert.doesNotMatch(chatSettingsPanelSource, /thinkingPreference\?:/);
  assert.doesNotMatch(chatSettingsPanelSource, /thinkingSupported\?:/);
  assert.doesNotMatch(chatSettingsPanelSource, /chatRouteConfigContent\?:/);
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

test('chat unified shell a2: AIConfig is the umbrella authority over conversation capability (D-AIPC-010)', () => {
  // SDK types imported in conversation-capability.ts
  assert.match(conversationCapabilitySource, /AIConfig/);
  assert.match(conversationCapabilitySource, /AIScopeRef/);
  assert.match(conversationCapabilitySource, /@nimiplatform\/sdk\/mod/);

  // Bridge functions exist
  assert.match(conversationCapabilitySource, /function aiConfigFromSelectionStore\(/);
  assert.match(conversationCapabilitySource, /function selectionStoreFromAIConfig\(/);

  // AISnapshot factory wraps ConversationExecutionSnapshot
  assert.match(conversationCapabilitySource, /function createAISnapshot\(/);
  assert.match(conversationCapabilitySource, /conversationCapabilitySlice/);

  // Store types include aiConfig as primary truth
  assert.match(storeTypesSource, /aiConfig: AIConfig/);
  assert.match(storeTypesSource, /setAIConfig:/);
  assert.match(storeTypesSource, /applyAIProfile:/);

  // Runtime slice initializes from active scope AIConfig and delegates writes to surface — no legacy store in public shape
  assert.match(runtimeSliceSource, /getDesktopAIConfigService\(\)\.aiConfig\.get\(getActiveScope\(\)\)/);
  assert.match(runtimeSliceSource, /getDesktopAIConfigService/);
  assert.match(runtimeSliceSource, /bindDesktopAIConfigAppStore/);
  assert.match(runtimeSliceSource, /applyAIProfileToConfig/);
  assert.doesNotMatch(runtimeSliceSource, /conversationCapabilitySelectionStore/);

  // Persistence layer is scope-keyed (Phase 5 hard cut — no legacy single key)
  assert.match(capabilityStorageSource, /nimi\.ai-config\.scope-index\.v2/);
  assert.match(capabilityStorageSource, /function loadAIConfigForScope\(/);
  assert.match(capabilityStorageSource, /function persistAIConfigForScope\(/);
  assert.doesNotMatch(capabilityStorageSource, /function loadAIConfig\(/);
  assert.doesNotMatch(capabilityStorageSource, /function persistAIConfig\(/);
  assert.doesNotMatch(capabilityStorageSource, /LEGACY_SINGLE_KEY/);

  assert.doesNotMatch(capabilitySettingsSource, /setConversationCapabilityDefaultRefs/);
  // ImageProfileSelectorCard was removed — no localProfileRefs access in settings
  assert.doesNotMatch(capabilitySettingsSource, /ImageProfileSelectorCard/);
  assert.doesNotMatch(capabilitySettingsSource, /aiConfig\.capabilities\.localProfileRefs/);
});

test('chat unified shell a2: Phase 4 — AI and Agent adapters write through AIConfig surface, not store action (D-AIPC-003)', () => {
  // AI adapter uses surface.aiConfig.update for model selection writes
  assert.match(chatAiAdapterSource, /getDesktopAIConfigService/);
  assert.match(chatAiAdapterSource, /surface\.aiConfig\.update\(/);
  assert.doesNotMatch(chatAiAdapterSource, /setConversationCapabilityBinding/);

  // Agent adapter uses surface.aiConfig.update for model selection writes
  assert.match(chatAgentAdapterSource, /getDesktopAIConfigService/);
  assert.match(chatAgentAdapterSource, /surface\.aiConfig\.update\(/);
  assert.doesNotMatch(chatAgentAdapterSource, /setConversationCapabilityBinding/);
});

test('chat unified shell a2: Phase 4 — conversation-capability module positions itself as submodel (D-AIPC-010)', () => {
  // Module-level comment declares submodel status
  assert.match(conversationCapabilitySource, /submodel.*D-AIPC-010/i);
  assert.match(conversationCapabilitySource, /AIConfig.*live truth/);

  // imageProfileRef and imageCapabilityLocalRef were removed with ImageProfileSelectorCard
  assert.doesNotMatch(capabilitySettingsSource, /const imageProfileRef\b/);
  assert.doesNotMatch(capabilitySettingsSource, /imageCapabilityLocalRef/);
});
