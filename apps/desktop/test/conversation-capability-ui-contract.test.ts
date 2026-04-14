import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(desktopDir, 'src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(nextPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [nextPath];
  });
}

function relativeDesktopPath(filePath: string): string {
  return path.relative(desktopDir, filePath).replaceAll(path.sep, '/');
}

function findFilesContaining(pattern: RegExp): string[] {
  return listSourceFiles(srcDir)
    .filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')))
    .map(relativeDesktopPath)
    .sort();
}

test('conversation capability UI contract: multimodal settings own the production selection writes via surface', () => {
  const settingsSource = readSource('src/shell/renderer/features/chat/chat-conversation-capability-settings.tsx');
  // Phase 3: writes go through surface.aiConfig.update(), not store actions
  assert.match(settingsSource, /surface\.aiConfig\.update\(|capabilitySurface\.aiConfig\.update\(/);
  assert.match(settingsSource, /capability:\s*'audio\.synthesize'/);
  assert.match(settingsSource, /capability:\s*'voice_workflow\.tts_v2v'/);
  assert.match(settingsSource, /capability:\s*'voice_workflow\.tts_t2v'/);
  assert.match(settingsSource, /capability:\s*'image\.generate'/);
  assert.match(settingsSource, /capability:\s*'image\.edit'/);
  assert.match(settingsSource, /capability:\s*'video\.generate'/);
});

test('conversation capability UI contract: image profile selector card was removed (D-AIPC-008)', () => {
  const settingsSource = readSource('src/shell/renderer/features/chat/chat-conversation-capability-settings.tsx');
  // ImageProfileSelectorCard and localProfileRefs access removed
  assert.doesNotMatch(settingsSource, /ImageProfileSelectorCard/);
  assert.doesNotMatch(settingsSource, /aiConfig\.capabilities\.localProfileRefs/);
  assert.doesNotMatch(settingsSource, /setConversationCapabilityDefaultRefs/);
  assert.doesNotMatch(settingsSource, /profile_ref_missing/);
  assert.doesNotMatch(settingsSource, /assetRef|slotRef|passiveAsset/i);
});

test('conversation capability UI contract: runtimeFields projection still only reads text.generate', () => {
  const runtimeSliceSource = readSource('src/shell/renderer/app-shell/providers/runtime-slice.ts');
  assert.match(runtimeSliceSource, /const textProjection = nextProjectionByCapability\['text\.generate'\] \|\| null;/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['image\.generate'\]/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['audio\.synthesize'\]/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['voice_workflow\.tts_v2v'\]/);
});

test('conversation capability UI contract: Phase 4 — image profile selector variables removed with card (D-AIPC-008)', () => {
  const settingsSource = readSource('src/shell/renderer/features/chat/chat-conversation-capability-settings.tsx');
  // Both imageProfileRef and imageCapabilityLocalRef removed with ImageProfileSelectorCard
  assert.doesNotMatch(settingsSource, /const imageProfileRef\b/);
  assert.doesNotMatch(settingsSource, /imageCapabilityLocalRef/);
});

test('conversation capability UI contract: conversationExecution stays confined to host media authority path', () => {
  assert.deepEqual(
    findFilesContaining(/\bconversationExecution\b/),
    [
      'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-media.ts',
      'src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
    ],
  );
});

test('conversation capability UI contract: AI bootstrap only refreshes text.generate and submit owns route gating', () => {
  const aiEffectsSource = readSource('src/shell/renderer/features/chat/chat-ai-shell-capability-effects.ts');
  const aiAdapterSource = readSource('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');
  const aiHostActionsSource = readSource('src/shell/renderer/features/chat/chat-ai-shell-host-actions.ts');
  assert.match(aiEffectsSource, /const AI_CONVERSATION_BOOTSTRAP_CAPABILITIES:[\s\S]*'text\.generate'/);
  assert.doesNotMatch(aiEffectsSource, /CONVERSATION_CAPABILITIES/);
  assert.match(aiAdapterSource, /\(\) => createReadyConversationSetupState\('ai'\)/);
  assert.match(aiAdapterSource, /const composerReady = !isBundleLoading\s+&& !bundleQuery\.error/);
  assert.doesNotMatch(aiAdapterSource, /resolveAiConversationSetupStateFromProjection/);
  assert.match(aiHostActionsSource, /ensureAiConversationSubmitRouteReady/);
});

test('conversation capability UI contract: agent bootstrap prioritizes text.generate and submit owns route gating', () => {
  const agentEffectsSource = readSource('src/shell/renderer/features/chat/chat-agent-shell-capability-effects.ts');
  const agentAdapterSource = readSource('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const agentHostActionsSource = readSource('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');
  assert.match(agentEffectsSource, /const AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES:[\s\S]*'text\.generate'/);
  assert.match(agentEffectsSource, /const AGENT_CONVERSATION_DEFERRED_CAPABILITIES:[\s\S]*'audio\.synthesize'/);
  assert.match(agentEffectsSource, /refreshConversationCapabilityProjections\(AGENT_CONVERSATION_BOOTSTRAP_CAPABILITIES\)/);
  assert.match(agentEffectsSource, /refreshConversationCapabilityProjections\(AGENT_CONVERSATION_DEFERRED_CAPABILITIES\)/);
  assert.match(agentAdapterSource, /return createReadyConversationSetupState\('agent'\);/);
  assert.match(agentAdapterSource, /const composerReady = setupState\.status === 'ready'\s+&& !isBundleLoading\s+&& !bundleError/);
  assert.doesNotMatch(agentAdapterSource, /resolveAiConversationSetupStateFromProjection/);
  assert.match(agentHostActionsSource, /ensureAgentConversationSubmitRouteReady/);
});
