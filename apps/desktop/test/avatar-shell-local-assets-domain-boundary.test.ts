import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function readRepo(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Avatar shell/local-assets domain boundary', () => {
  it('keeps Avatar app shell authority outside Desktop launch handoff', () => {
    const appShellContract = readRepo('.nimi/spec/avatar/kernel/app-shell-contract.md');
    const avatarBootstrap = readRepo('apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts');
    const avatarCarrier = readRepo('apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts');
    const launcher = readRepo(
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
    );

    assert.match(appShellContract, /Desktop 启动时只传递 `agent_id`/);
    assert.match(appShellContract, /optional `avatar_instance_id`/);
    assert.match(appShellContract, /optional non-authoritative `launch_source`/);
    assert.match(appShellContract, /不得把 scoped binding、visual package truth、conversation anchor truth、account\/user truth、Realm\/auth material 透传/);

    assert.match(avatarBootstrap, /launch/);
    assert.match(avatarCarrier, /carrier/);
    assert.match(launcher, /buildDesktopAvatarLaunchHandoffPayload/);
    assert.match(launcher, /FORBIDDEN_LAUNCH_INPUT_FIELDS/);
    assert.match(launcher, /agentId/);
    assert.match(launcher, /avatarInstanceId/);
    assert.match(launcher, /launchSource/);
    assert.match(launcher, /accessToken/);
    assert.match(launcher, /refreshToken/);
    assert.match(launcher, /conversationAnchorId/);
    assert.doesNotMatch(launcher, /from ['"].*apps\/avatar/);
  });

  it('keeps Desktop visual renderer policy delegated to Kit avatar surfaces', () => {
    const live2dViewport = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport.tsx',
    );
    const live2dCubismModel = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-cubism-model.ts',
    );
    const vrmViewport = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.tsx',
    );
    const voiceCapture = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-capture.ts',
    );
    const runtimeStreamUi = [
      readRepo('apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx'),
      readRepo('apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-voice-message-content.tsx'),
    ].join('\n');

    assert.equal(
      existsSync(new URL('../../../apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-framing.ts', import.meta.url)),
      false,
    );
    assert.equal(
      existsSync(new URL('../../../apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-framing.ts', import.meta.url)),
      false,
    );
    assert.match(live2dViewport, /@nimiplatform\/kit\/features\/avatar\/live2d/);
    assert.match(live2dCubismModel, /Desktop Live2D carrier execution is decommissioned/);
    assert.doesNotMatch(live2dCubismModel, /fetchArrayBufferFromUrl/);
    assert.match(vrmViewport, /@nimiplatform\/kit\/features\/avatar\/vrm/);
    assert.match(vrmViewport, /resolveAvatarVrmFramingFromScene/);
    assert.doesNotMatch(live2dViewport, /chat-agent-avatar-live2d-framing/);
    assert.doesNotMatch(vrmViewport, /chat-agent-avatar-vrm-framing/);

    assert.match(voiceCapture, /@nimiplatform\/kit\/features\/avatar\/headless/);
    assert.match(runtimeStreamUi, /@nimiplatform\/kit\/features\/avatar\/runtime/);
  });

  it('keeps Desktop live instance registry as Runtime app-storage projection consumer', () => {
    const registryStore = readRepo(
      'apps/desktop/src-tauri/src/desktop_avatar_instance_registry/store.rs',
    );
    const registryTypes = readRepo(
      'apps/desktop/src-tauri/src/desktop_avatar_instance_registry/types.rs',
    );
    const registryBridge = readRepo(
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry.ts',
    );

    assert.match(registryStore, /GetAppStorageRequest/);
    assert.match(registryStore, /RUNTIME_APP_GET_APP_STORAGE_METHOD_ID/);
    assert.doesNotMatch(registryStore, /ensure_apps_packages|AppsPackageRow/);
    assert.match(registryStore, /AVATAR_APP_ID:\s*&str = "nimi\.avatar"/);
    assert.match(registryStore, /Runtime app storage projection/);
    assert.match(registryStore, /projection_is_fresh/);
    assert.match(registryStore, /is_projection_owned_by_live_process/);
    assert.doesNotMatch(registryStore, /conversation_anchor_id|binding_id|refresh_token/);
    assert.doesNotMatch(registryStore, /access_token:\s*String/);

    assert.match(registryTypes, /avatar_instance_id/);
    assert.match(registryTypes, /owner_user_id/);
    assert.match(registryTypes, /realm_agent_id/);
    assert.match(registryTypes, /local_agent_ref/);
    assert.doesNotMatch(registryTypes, /conversation_anchor|binding|token|package_path|manifest_path/);

    assert.match(registryBridge, /projectRuntimeLocalAgentIdentity/);
    assert.match(registryBridge, /FORBIDDEN_LIVE_INSTANCE_FIELDS/);
    assert.match(registryBridge, /conversationAnchorId/);
    assert.match(registryBridge, /avatarPackageId/);
    assert.match(registryBridge, /accessToken/);
  });

  it('keeps Agent Center local resource storage out of Desktop-local avatar package custody', () => {
    const resources = readRepo('apps/desktop/src-tauri/src/desktop_agent_center_store/resources.rs');
    const resourceTypes = readRepo('apps/desktop/src-tauri/src/desktop_agent_center_store/types.rs');
    const localConfig = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-local-config.ts',
    );
    const avatarConfigTypes = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.ts',
    );
    const bridge = readRepo(
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store.ts',
    );

    assert.match(resources, /VALIDATION_FILE_NAME/);
    assert.doesNotMatch(resources, /MAX_AVATAR_ASSET_BYTES/);
    assert.doesNotMatch(resources, /resources_avatar_asset/);
    assert.doesNotMatch(resources, /CAPABILITY_PROFILE_FILE_NAME/);
    assert.doesNotMatch(resources, /capability-profile\.json/);
    assert.match(resources, /LIVE2D_ADAPTER_FILE_NAME/);
    assert.match(resources, /OPERATIONS_FILE_NAME/);
    assert.doesNotMatch(resources, /refresh_token|access_token|realm_base_url|conversation_anchor_id/);

    assert.match(localConfig, /validateAgentCenterLocalConfig/);
    assert.match(avatarConfigTypes, /backend_capability_profile_ref/);
    assert.match(avatarConfigTypes, /local_avatar_asset_ref/);
    assert.doesNotMatch(resourceTypes, /DesktopAgentCenterAvatarAssetImportPayload/);
    assert.doesNotMatch(resourceTypes, /AgentCenterAvatarAssetValidationStatus/);
    assert.doesNotMatch(bridge, /validateAgentCenterAvatarAssetImportResult/);
    assert.doesNotMatch(bridge, /desktop_agent_center_avatar_asset_import/);
    assert.doesNotMatch(bridge, /desktop_agent_center_avatar_asset_validate/);
    assert.doesNotMatch(bridge, /desktop_avatar_launch_handoff/);
  });

  it('keeps Avatar launch controls fail-closed before shell handoff', () => {
    const controls = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts',
    );
    const launchControls = readRepo(
      'apps/desktop/src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts',
    );
    const configSurfaceTest = readRepo('apps/desktop/test/chat-agent-avatar-configuration-surface.test.ts');
    const arbitrationTest = readRepo('apps/desktop/test/chat-agent-avatar-launch-arbitration.test.ts');

    assert.match(controls, /avatarAssetValid/);
    assert.doesNotMatch(controls, /status:\s*['"]valid['"]/);
    assert.doesNotMatch(controls, /backend_capability_profile_ref/);
    assert.match(launchControls, /backendCapabilityProfileRef/);
    assert.match(launchControls, /executeArbitratedLaunch/);
    assert.match(launchControls, /launchDesktopAvatarHandoff/);
    assert.match(launchControls, /agentId:\s*presentation\.activeTarget\.localAgentRef/);
    assert.doesNotMatch(launchControls, /agentId:\s*presentation\.activeTarget\.realmAgentId/);

    assert.match(configSurfaceTest, /does not widen Avatar launch handoff/);
    assert.match(configSurfaceTest, /fails closed without local asset and backend evidence/);
    assert.match(arbitrationTest, /arbitrateAvatarLaunch/);
  });
});
