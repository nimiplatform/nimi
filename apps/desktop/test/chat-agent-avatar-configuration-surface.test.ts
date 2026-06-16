import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, String(value)),
  } as Storage;
}

const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installFreshStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
}

test.afterEach(() => {
  if (previousLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('Agent Chat Settings Avatar surface exposes closed configuration controls', () => {
  const settingsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
    'utf8',
  );
  const avatarSettingsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-avatar-settings-content.tsx'),
    'utf8',
  );
  const settingsProjectionSource = `${settingsSource}\n${avatarSettingsSource}`;
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx'),
    'utf8',
  );
  const localAvatarControlsSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts'),
    'utf8',
  );
  const bridgeSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store.ts'),
    'utf8',
  );
  const mutationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts'),
    'utf8',
  );

  for (const requiredControl of [
    'backend_kind',
    'avatar_instance_policy',
    'generated_motion_provider_policy',
    'launch_mode',
    'debug_profile',
    'backend_capability_profile_ref',
  ]) {
    assert.match(settingsProjectionSource, new RegExp(requiredControl, 'u'));
  }

  assert.match(localAvatarControlsSource, /useAgentCenterAvatarConfigMutation/u);
  assert.match(localAvatarControlsSource, /importAgentCenterAvatarAsset/u);
  assert.match(localAvatarControlsSource, /validateAgentCenterAvatarAsset/u);
  assert.doesNotMatch(localAvatarControlsSource, /listAgentCenterAvatarAssets/u);
  assert.doesNotMatch(localAvatarControlsSource, /selectAgentCenterAvatarAsset/u);
  assert.doesNotMatch(localAvatarControlsSource, /removeAgentCenterAvatarAsset/u);
  assert.match(localAvatarControlsSource, /importAgentCenterLive2dAdapterManifest/u);
  assert.match(avatarSettingsSource, /AgentCenterLive2dCalibrationWorkbench/u);
  assert.match(localAvatarControlsSource, /getAgentCenterBackgroundAsset/u);
  assert.match(localAvatarControlsSource, /importAgentCenterBackground/u);
  assert.match(mutationSource, /putAgentCenterLocalConfig/u);
  assert.match(mutationSource, /backend_kind/u);
  assert.doesNotMatch(settingsProjectionSource, /onChange: \(backend_kind\) => avatarConfigMutation\.mutate\(\{ backend_kind \}\)/u);
  assert.match(bridgeSource, /desktop_agent_center_avatar_asset_import/u);
  assert.match(bridgeSource, /desktop_agent_center_avatar_asset_validate/u);
  assert.doesNotMatch(bridgeSource, /desktop_agent_center_avatar_asset_list/u);
  assert.doesNotMatch(bridgeSource, /desktop_agent_center_avatar_asset_select/u);
  assert.match(bridgeSource, /desktop_agent_center_avatar_asset_pick_live2d_source/u);
  assert.match(bridgeSource, /desktop_agent_center_avatar_asset_pick_vrm_source/u);
  assert.doesNotMatch(bridgeSource, /desktop_agent_center_avatar_asset_remove/u);
  assert.doesNotMatch(mutationSource, /selected_package/u);
  assert.doesNotMatch(mutationSource, /last_validated_at/u);
  assert.doesNotMatch(mutationSource, /live2d_calibration|model_digest|render_scale|target_fps|framing_calibration/u);
  assert.doesNotMatch(presentationSource, /chat-agent-avatar-store/u);
  assert.doesNotMatch(bridgeSource, /desktop_agent_avatar_store/u);
});

test('Agent Chat Settings Avatar surface does not widen Avatar launch handoff', () => {
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts'),
    'utf8',
  );
  const launchCall = presentationSource.match(/launchDesktopAvatarHandoff\(\{[\s\S]*?\}\)/u);
  assert.ok(launchCall, 'launchDesktopAvatarHandoff call must stay visible to the guard');
  assert.match(launchCall[0], /agentId/u);
  assert.match(launchCall[0], /activeTarget\.localAgentRef/u);
  assert.match(launchCall[0], /avatarInstanceId/u);
  assert.match(launchCall[0], /launchSource/u);
  assert.doesNotMatch(launchCall[0], /activeTarget\.realmAgentId/u);
  assert.doesNotMatch(launchCall[0], /\b(ownerUserId|realmAgentId|localAgentRef|conversationAnchorId|sourceSurface)\s*:/u);
  assert.doesNotMatch(launchCall[0], /package|descriptor|path|profile|token|account|binding|carrier/u);
  assert.doesNotMatch(launchCall[0], /calibration|modelDigest|renderScale|targetFps|framing|expressionInventory|previewArtifact/u);
});

test('Agent Chat composer Avatar launch fails closed without local asset and backend evidence', async () => {
  installFreshStorage();
  const { resolveAvatarComposerActionState } = await import(
    '../src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.js'
  );
  const presentationSource = readFileSync(
    join(repoRoot, 'src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts'),
    'utf8',
  );
  assert.equal(resolveAvatarComposerActionState({
    avatarActionPending: false,
    avatarHandoffReady: true,
    avatarRuntimeAccountReady: true,
    avatarRunning: false,
    avatarConfigured: false,
    avatarAssetValid: false,
  }), 'not_configured');
  assert.equal(resolveAvatarComposerActionState({
    avatarActionPending: false,
    avatarHandoffReady: true,
    avatarRuntimeAccountReady: true,
    avatarRunning: false,
    avatarConfigured: true,
    avatarAssetValid: false,
  }), 'local_asset_invalid');
  assert.equal(resolveAvatarComposerActionState({
    avatarActionPending: false,
    avatarHandoffReady: true,
    avatarRuntimeAccountReady: true,
    avatarRunning: false,
    avatarConfigured: true,
    avatarAssetValid: true,
  }), 'ready_stopped');

  const invalidEvidenceGuard = presentationSource.match(/if \(!avatarRunning && !input\.avatarAssetValid\) \{[\s\S]*?\n {4}\}/u);
  assert.ok(invalidEvidenceGuard, 'Avatar launch must guard resolver and backend evidence before handoff');
  assert.match(invalidEvidenceGuard[0], /presentation\.onOpenAgentCenter\?\.\(\)/u);
  assert.match(invalidEvidenceGuard[0], /Chat\.agentCenterAvatarStartBackendEvidenceRequired/u);
  assert.match(invalidEvidenceGuard[0], /Chat\.agentCenterAvatarStartLocalAssetRequired/u);

  // The explicit composer launch routes through the D-LLM-106 instance-policy
  // arbitration (executeArbitratedLaunch). The local-asset / backend evidence
  // guard must run before that arbitrated launch is triggered.
  const composerAction = presentationSource.match(
    /handleComposerAvatarAction = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[/u,
  );
  assert.ok(composerAction, 'handleComposerAvatarAction callback must be visible to the guard check');
  const guardIndex = composerAction[0].indexOf('if (!avatarRunning && !input.avatarAssetValid)');
  const launchIndex = composerAction[0].indexOf('executeArbitratedLaunch({');
  assert.ok(
    guardIndex >= 0 && launchIndex >= 0 && guardIndex < launchIndex,
    'evidence guard must precede the arbitrated launch in the composer action',
  );
});
