import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoDir = path.resolve(desktopDir, '../..');
const srcDir = path.join(desktopDir, 'src');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readRepoSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoDir, relativePath), 'utf8');
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

test('conversation capability UI contract: runtimeFields no longer mirrors route projection truth', () => {
  const runtimeSliceSource = readSource('src/shell/renderer/app-shell/providers/runtime-slice.ts');
  const storeTypesSource = readSource('src/shell/renderer/app-shell/providers/store-types.ts');
  const conversationCapabilitySource = readSource('src/shell/renderer/features/chat/conversation-capability.ts');
  assert.match(runtimeSliceSource, /const RETIRED_ROUTE_RUNTIME_FIELD_KEYS = new Set\(\[/);
  assert.doesNotMatch(runtimeSliceSource, /setRuntimeRouteProjection/);
  assert.doesNotMatch(runtimeSliceSource, /toConversationCapabilityRouteProjectionFields/);
  assert.doesNotMatch(storeTypesSource, /setRuntimeRouteProjection/);
  assert.doesNotMatch(storeTypesSource, /\bprovider: string;/);
  assert.doesNotMatch(storeTypesSource, /\blocalProviderEndpoint: string;/);
  assert.doesNotMatch(storeTypesSource, /\bconnectorId: string;/);
  assert.doesNotMatch(conversationCapabilitySource, /toConversationCapabilityRouteProjectionFields/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['text\.generate'\][\s\S]*runtimeFields:/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['image\.generate'\]/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['audio\.synthesize'\]/);
  assert.doesNotMatch(runtimeSliceSource, /nextProjectionByCapability\['voice_workflow\.voice_clone'\]/);
});

test('conversation capability UI contract: conversationExecution stays confined to host media authority path', () => {
  assert.deepEqual(
    findFilesContaining(/\bconversationExecution\b/),
    [],
  );
});

test('conversation capability UI contract: AI bootstrap only refreshes text.generate and submit owns route gating', () => {
  const aiEffectsSource = readSource('src/shell/renderer/features/chat/chat-nimi-shell-capability-effects.ts');
  const aiAdapterSource = readSource('src/shell/renderer/features/chat/chat-nimi-shell-adapter.tsx');
  const aiHostActionsSource = readSource('src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts');
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

test('conversation capability UI contract: projection refresh also refreshes derived agent execution resolution', () => {
  const projectionSource = readSource('src/shell/renderer/features/chat/conversation-capability-projection.ts');
  assert.match(projectionSource, /setConversationCapabilityProjections\(projections\);[\s\S]*refreshAgentEffectiveCapabilityResolution\(\);/);
});

test('conversation capability UI contract: Nimi active model selector uses Kit route model picker and writes AIConfig targetRef', () => {
  const settingsSource = readSource('src/shell/renderer/features/chat/chat-shared-settings-panel.tsx');
  const modelCardSource = readRepoSource('kit/features/model-config/src/components/capability-model-card.tsx');
  const modelDetailSource = readRepoSource('kit/features/model-config/src/components/model-config-capability-detail.tsx');
  const bindingHelpersSource = readRepoSource('kit/features/model-config/src/binding-helpers.ts');
  const modelTypesSource = readRepoSource('kit/features/model-config/src/types.ts');
  assert.match(modelTypesSource, /provider\?: RouteModelPickerDataProvider \| null/);
  assert.match(modelDetailSource, /resolveProvider\([\s\S]*surface\.providerResolver\(routeCapability\)/);
  assert.match(modelDetailSource, /provider,/);
  assert.match(modelCardSource, /ModelSelectorTrigger/);
  assert.match(modelCardSource, /ModelPickerModal/);
  assert.match(modelCardSource, /targetRefToPickerSelection\(item\.targetRef\)/);
  assert.match(modelCardSource, /pickerSelectionToTargetRef\(pickerSelection\)/);
  assert.match(bindingHelpersSource, /targetRefToPickerSelection/);
  assert.match(bindingHelpersSource, /pickerSelectionToTargetRef/);
  assert.match(bindingHelpersSource, /kind: 'cloud-connector'/);
  assert.match(bindingHelpersSource, /kind: 'local-runtime'/);
  assert.match(settingsSource, /getDesktopRouteModelPickerProvider/);
  assert.match(settingsSource, /providerResolver: \(routeCapability: string\) => getDesktopRouteModelPickerProvider\(routeCapability\)/);
  assert.match(settingsSource, /Model selection required/);
  assert.match(settingsSource, /A route is selected, but runtime describe metadata is not available yet/);
  assert.match(settingsSource, /supported: Boolean\(projection\.selectedBinding && projection\.resolvedBinding\)/);
  assert.doesNotMatch(settingsSource, /This capability cannot execute until runtime describe metadata is available/);
  assert.doesNotMatch(settingsSource, /function TextRouteModelSelector/);
  assert.doesNotMatch(settingsSource, /<select[\s\S]*settingsActiveModelSelect/);
  assert.doesNotMatch(settingsSource, /capabilityOverrides:[\s\S]*targetControl/);
});
