import type { NimiStandardShellErrorCode } from './errors.js';

export const NIMI_STANDARD_SHELL_CAPABILITY_IDS = [
  'runtime',
  'runtime-lifecycle',
  'runtime-defaults',
  'oauth',
  'desktop-open',
  'shell-ui',
  'diagnostics',
  'data',
  'storage',
  'config',
  'local-assets',
  'local-app',
  'local-agent',
  'ai-profile',
  'ai-config',
  'avatar',
  'agent-center',
  'platform-projection',
  'file-dialog',
  'file-reveal',
  'export',
  'artifacts',
  'floating-window',
] as const;

export type NimiStandardShellCapabilityId = (typeof NIMI_STANDARD_SHELL_CAPABILITY_IDS)[number];

export type NimiStandardShellNegativeState =
  | NimiStandardShellErrorCode
  | 'process-replaced'
  | 'account-changed'
  | 'runtime-restarted'
  | 'revoked'
  | 'permission-unavailable'
  | 'permission-denied'
  | 'permission-revoked'
  | 'request-pending';

export interface NimiStandardShellOperation {
  id: string;
  command: string;
  negativeStates: readonly NimiStandardShellNegativeState[];
}

export interface NimiStandardShellCapability {
  id: NimiStandardShellCapabilityId;
  operations: readonly NimiStandardShellOperation[];
}

export const NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID = 'local-app-standard-shell-v1';
export const NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID = 'bundled-avatar-standard-shell-v1';

export interface NimiStandardShellCapabilitySet {
  readonly setId: string;
  readonly hostClass: string;
  readonly appPackageKind: string;
  readonly launchResolution: string;
  readonly authBinding: string;
  readonly authorityStatus: string;
  readonly allowedOperations: readonly string[];
  readonly plannedOperations: readonly string[];
  readonly plannedOperationsDisposition: string;
  readonly forbiddenOperations: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
  readonly negativeTests: readonly string[];
  readonly sourceRule: string;
}

export const NIMI_STANDARD_SHELL_CAPABILITIES = [
  {
    id: 'runtime',
    operations: [
      { id: 'unary', command: 'nimi.shell.runtime.unary', negativeStates: ['capability-unavailable', 'external-daemon-required', 'runtime-permission-denied', 'runtime-unauthenticated', 'invalid-payload', 'host-internal-error'] },
      { id: 'streamOpen', command: 'nimi.shell.runtime.stream.open', negativeStates: ['capability-unavailable', 'external-daemon-required', 'runtime-permission-denied', 'runtime-unauthenticated', 'invalid-payload', 'host-internal-error'] },
      { id: 'streamClose', command: 'nimi.shell.runtime.stream.close', negativeStates: ['capability-unavailable', 'not-found', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'runtime-lifecycle',
    operations: [
      { id: 'status', command: 'nimi.shell.runtimeLifecycle.status', negativeStates: ['capability-unavailable', 'external-daemon-required', 'runtime-permission-denied', 'runtime-unauthenticated'] },
      { id: 'start', command: 'nimi.shell.runtimeLifecycle.start', negativeStates: ['external-daemon-required'] },
      { id: 'restart', command: 'nimi.shell.runtimeLifecycle.restart', negativeStates: ['external-daemon-required'] },
    ],
  },
  {
    id: 'runtime-defaults',
    operations: [
      { id: 'get', command: 'nimi.shell.runtimeDefaults.get', negativeStates: ['capability-unavailable', 'invalid-payload'] },
    ],
  },
  {
    id: 'oauth',
    operations: [
      { id: 'openExternalUrl', command: 'nimi.shell.oauth.openExternalUrl', negativeStates: ['capability-unavailable', 'forbidden-renderer-access', 'invalid-payload'] },
      { id: 'tokenExchange', command: 'nimi.shell.oauth.tokenExchange', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'listenForCode', command: 'nimi.shell.oauth.listenForCode', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'desktop-open',
    operations: [
      { id: 'openIntent', command: 'nimi.shell.desktopOpen.openIntent', negativeStates: ['capability-unavailable', 'forbidden-renderer-access', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'shell-ui',
    operations: [
      { id: 'confirmDialog', command: 'nimi.shell.ui.confirmDialog', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'startWindowDrag', command: 'nimi.shell.ui.startWindowDrag', negativeStates: ['capability-unavailable', 'host-internal-error'] },
      { id: 'focusMainWindow', command: 'nimi.shell.ui.focusMainWindow', negativeStates: ['capability-unavailable', 'host-internal-error'] },
    ],
  },
  {
    id: 'diagnostics',
    operations: [
      { id: 'rendererEntryProbe', command: 'nimi.shell.diagnostics.rendererEntryProbe', negativeStates: ['capability-unavailable', 'invalid-payload'] },
    ],
  },
  {
    id: 'data',
    operations: [
      { id: 'pathResolve', command: 'nimi.shell.data.pathResolve', negativeStates: ['capability-unavailable', 'invalid-path', 'invalid-payload'] },
    ],
  },
  {
    id: 'storage',
    operations: [
      { id: 'readJson', command: 'nimi.shell.storage.readJson', negativeStates: ['capability-unavailable', 'invalid-path', 'not-found', 'invalid-payload'] },
      { id: 'writeJson', command: 'nimi.shell.storage.writeJson', negativeStates: ['capability-unavailable', 'invalid-path', 'invalid-payload'] },
      { id: 'removeJson', command: 'nimi.shell.storage.removeJson', negativeStates: ['capability-unavailable', 'invalid-path', 'invalid-payload'] },
    ],
  },
  {
    id: 'config',
    operations: [
      { id: 'get', command: 'nimi.shell.config.get', negativeStates: ['capability-unavailable', 'not-found'] },
      { id: 'set', command: 'nimi.shell.config.set', negativeStates: ['external-daemon-required', 'capability-unavailable', 'invalid-payload'] },
    ],
  },
  {
    id: 'local-assets',
    operations: [
      { id: 'resolveUrl', command: 'nimi.shell.localAssets.resolveUrl', negativeStates: ['capability-unavailable', 'invalid-path', 'not-found'] },
    ],
  },
  {
    id: 'local-app',
    operations: [
      { id: 'sessionStatus', command: 'nimi.shell.localApp.sessionStatus', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-unauthenticated', 'process-replaced', 'account-changed', 'runtime-restarted', 'revoked'] },
      { id: 'permissionStatus', command: 'nimi.shell.localApp.permissionStatus', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-unauthenticated', 'permission-unavailable', 'account-changed', 'runtime-restarted'] },
      { id: 'permissionRequest', command: 'nimi.shell.localApp.permissionRequest', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-unauthenticated', 'invalid-payload', 'permission-unavailable', 'request-pending', 'account-changed', 'runtime-restarted'] },
      { id: 'conversationOpen', command: 'nimi.shell.localApp.conversationOpen', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-unauthenticated', 'process-replaced', 'account-changed', 'runtime-restarted', 'permission-unavailable', 'permission-denied', 'permission-revoked', 'invalid-payload', 'resource-exhausted', 'host-internal-error'] },
      { id: 'conversationSendTurn', command: 'nimi.shell.localApp.conversationSendTurn', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-unauthenticated', 'process-replaced', 'account-changed', 'runtime-restarted', 'permission-unavailable', 'permission-denied', 'permission-revoked', 'invalid-payload', 'resource-exhausted', 'host-internal-error'] },
      { id: 'conversationSubscribe', command: 'nimi.shell.localApp.conversationSubscribe', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-unauthenticated', 'process-replaced', 'account-changed', 'runtime-restarted', 'permission-unavailable', 'permission-denied', 'permission-revoked', 'invalid-payload', 'resource-exhausted', 'not-found', 'host-internal-error'] },
      { id: 'conversationSnapshot', command: 'nimi.shell.localApp.conversationSnapshot', negativeStates: ['protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-unauthenticated', 'process-replaced', 'account-changed', 'runtime-restarted', 'permission-unavailable', 'permission-denied', 'permission-revoked', 'invalid-payload', 'not-found', 'host-internal-error'] },
    ],
  },
  {
    id: 'local-agent',
    operations: [
      { id: 'identity', command: 'nimi.shell.localAgent.identity', negativeStates: ['capability-unavailable'] },
      { id: 'runtimeTrustedCaller', command: 'nimi.shell.localAgent.runtimeTrustedCaller', negativeStates: ['capability-unavailable', 'forbidden-renderer-access'] },
    ],
  },
  {
    id: 'ai-profile',
    operations: [
      { id: 'get', command: 'nimi.shell.aiProfile.get', negativeStates: ['capability-unavailable', 'not-found'] },
    ],
  },
  {
    id: 'ai-config',
    operations: [
      { id: 'get', command: 'nimi.shell.aiConfig.get', negativeStates: ['capability-unavailable', 'not-found'] },
      { id: 'set', command: 'nimi.shell.aiConfig.set', negativeStates: ['capability-unavailable', 'invalid-payload'] },
    ],
  },
  {
    id: 'avatar',
    operations: [
      { id: 'assetResolve', command: 'nimi.shell.avatar.assetResolve', negativeStates: ['capability-unavailable', 'invalid-path', 'not-found'] },
    ],
  },
  {
    id: 'agent-center',
    operations: [
      { id: 'avatarAssetImport', command: 'nimi.shell.agentCenter.avatarAssetImport', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'forbidden-renderer-access', 'host-internal-error'] },
      { id: 'avatarAssetValidate', command: 'nimi.shell.agentCenter.avatarAssetValidate', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'host-internal-error'] },
      { id: 'avatarAssetResolvePreview', command: 'nimi.shell.agentCenter.avatarAssetResolvePreview', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'host-internal-error'] },
      { id: 'live2dAdapterImport', command: 'nimi.shell.agentCenter.live2dAdapterImport', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'forbidden-renderer-access', 'host-internal-error'] },
      { id: 'backgroundImport', command: 'nimi.shell.agentCenter.backgroundImport', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'forbidden-renderer-access', 'host-internal-error'] },
      { id: 'backgroundGet', command: 'nimi.shell.agentCenter.backgroundGet', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'host-internal-error'] },
      { id: 'backgroundValidate', command: 'nimi.shell.agentCenter.backgroundValidate', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'host-internal-error'] },
      { id: 'backgroundRemove', command: 'nimi.shell.agentCenter.backgroundRemove', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'not-found', 'host-internal-error'] },
      { id: 'agentResourcesRemove', command: 'nimi.shell.agentCenter.agentResourcesRemove', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'host-internal-error'] },
      { id: 'accountResourcesRemove', command: 'nimi.shell.agentCenter.accountResourcesRemove', negativeStates: ['capability-unavailable', 'invalid-payload', 'invalid-path', 'host-internal-error'] },
    ],
  },
  {
    id: 'platform-projection',
    operations: [
      { id: 'get', command: 'nimi.shell.platformProjection.get', negativeStates: ['capability-unavailable', 'not-found'] },
    ],
  },
  {
    id: 'file-dialog',
    operations: [
      { id: 'open', command: 'nimi.shell.fileDialog.open', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'file-reveal',
    operations: [
      { id: 'reveal', command: 'nimi.shell.fileReveal.reveal', negativeStates: ['capability-unavailable', 'invalid-path', 'not-found', 'host-internal-error'] },
    ],
  },
  {
    id: 'export',
    operations: [
      { id: 'saveFile', command: 'nimi.shell.export.saveFile', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'artifacts',
    operations: [
      { id: 'write', command: 'nimi.shell.artifacts.write', negativeStates: ['capability-unavailable', 'invalid-path', 'invalid-payload', 'host-internal-error'] },
      { id: 'readRuntimeBytes', command: 'nimi.shell.artifacts.readRuntimeBytes', negativeStates: ['capability-unavailable', 'protected-carrier-required', 'runtime-service-unavailable', 'runtime-service-untrusted', 'runtime-service-repair-required', 'runtime-permission-denied', 'not-found', 'resource-exhausted', 'invalid-payload'] },
    ],
  },
  {
    id: 'floating-window',
    operations: [
      { id: 'setBounds', command: 'nimi.shell.floatingWindow.setBounds', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'setIgnoreCursorEvents', command: 'nimi.shell.floatingWindow.setIgnoreCursorEvents', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'setAlwaysOnTop', command: 'nimi.shell.floatingWindow.setAlwaysOnTop', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'hide', command: 'nimi.shell.floatingWindow.hide', negativeStates: ['capability-unavailable', 'host-internal-error'] },
      { id: 'close', command: 'nimi.shell.floatingWindow.close', negativeStates: ['capability-unavailable', 'host-internal-error'] },
      { id: 'beginManualDrag', command: 'nimi.shell.floatingWindow.beginManualDrag', negativeStates: ['capability-unavailable', 'host-internal-error'] },
      { id: 'moveManualDrag', command: 'nimi.shell.floatingWindow.moveManualDrag', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
      { id: 'constrainToVisibleArea', command: 'nimi.shell.floatingWindow.constrainToVisibleArea', negativeStates: ['capability-unavailable', 'invalid-payload', 'host-internal-error'] },
    ],
  },
] as const satisfies readonly NimiStandardShellCapability[];

const LOCAL_APP_PLANNED_OPERATIONS = [
  'data.pathResolve',
  'config.get',
  'config.set',
  'ai-config.get',
  'ai-config.set',
  'local-assets.resolveUrl',
  'shell-ui.confirmDialog',
  'shell-ui.startWindowDrag',
  'shell-ui.focusMainWindow',
] as const;

const LOCAL_APP_ALLOWED_OPERATIONS = [
  'local-app.sessionStatus',
  'local-app.permissionStatus',
  'local-app.permissionRequest',
  'local-app.conversationOpen',
  'local-app.conversationSendTurn',
  'local-app.conversationSubscribe',
  'local-app.conversationSnapshot',
  'storage.readJson',
  'storage.writeJson',
  'storage.removeJson',
  'desktop-open.openIntent',
];

const LOCAL_APP_FORBIDDEN_OPERATIONS = [
  'runtime.unary',
  'runtime.streamOpen',
  'runtime.streamClose',
  'runtime-lifecycle.status',
  'runtime-lifecycle.start',
  'runtime-lifecycle.restart',
  'runtime-defaults.get',
  'auth.sessionLoad',
  'auth.sessionSave',
  'auth.sessionClear',
  'oauth.openExternalUrl',
  'oauth.tokenExchange',
  'oauth.listenForCode',
  'diagnostics.rendererEntryProbe',
  'local-agent.identity',
  'local-agent.runtimeTrustedCaller',
  'ai-profile.get',
  'avatar.assetResolve',
  'agent-center.avatarAssetImport',
  'agent-center.avatarAssetValidate',
  'agent-center.avatarAssetResolvePreview',
  'agent-center.live2dAdapterImport',
  'agent-center.backgroundImport',
  'agent-center.backgroundGet',
  'agent-center.backgroundValidate',
  'agent-center.backgroundRemove',
  'agent-center.agentResourcesRemove',
  'agent-center.accountResourcesRemove',
  'platform-projection.get',
  'file-dialog.open',
  'file-reveal.reveal',
  'export.saveFile',
  'artifacts.write',
  'floating-window.setBounds',
  'floating-window.setIgnoreCursorEvents',
  'floating-window.setAlwaysOnTop',
  'floating-window.hide',
  'floating-window.close',
  'floating-window.beginManualDrag',
  'floating-window.moveManualDrag',
  'floating-window.constrainToVisibleArea',
  'desktop-private.product-control',
  'tauri-only.commands',
  'electron.raw-ipc',
  'node.raw-fs',
] as const;

export const NIMI_STANDARD_SHELL_CAPABILITY_SETS = [
  {
    setId: NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID,
    hostClass: 'verified-desktop-bundled-avatar-host',
    appPackageKind: 'bundled-nimi-app',
    launchResolution: 'verified_desktop_process_exact_renderer_url',
    authBinding: 'runtime_owned_bundled_avatar_protected_profile',
    authorityStatus: 'fixed_profile_app_private_and_floating_window_only',
    allowedOperations: [
      'runtime.unary',
      'runtime.streamOpen',
      'runtime.streamClose',
      'runtime-lifecycle.status',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'diagnostics.rendererEntryProbe',
      'local-assets.resolveUrl',
      'avatar.assetResolve',
      'floating-window.setBounds',
      'floating-window.setIgnoreCursorEvents',
      'floating-window.setAlwaysOnTop',
      'floating-window.hide',
      'floating-window.close',
      'floating-window.beginManualDrag',
      'floating-window.moveManualDrag',
      'floating-window.constrainToVisibleArea',
    ],
    plannedOperations: [],
    plannedOperationsDisposition: 'deny_until_separate_operation_admission',
    forbiddenOperations: [
      'runtime-lifecycle.start',
      'runtime-lifecycle.restart',
      'runtime-defaults.get',
      'auth.sessionLoad',
      'auth.sessionSave',
      'auth.sessionClear',
      'oauth.openExternalUrl',
      'oauth.tokenExchange',
      'oauth.listenForCode',
      'local-agent.identity',
      'local-agent.runtimeTrustedCaller',
      'ai-profile.get',
      'agent-center.avatarAssetImport',
      'agent-center.avatarAssetValidate',
      'agent-center.avatarAssetResolvePreview',
      'agent-center.live2dAdapterImport',
      'agent-center.backgroundImport',
      'agent-center.backgroundGet',
      'agent-center.backgroundValidate',
      'agent-center.backgroundRemove',
      'agent-center.agentResourcesRemove',
      'agent-center.accountResourcesRemove',
      'platform-projection.get',
      'file-dialog.open',
      'file-reveal.reveal',
      'export.saveFile',
      'artifacts.write',
      'desktop-private.product-control',
      'tauri-only.commands',
      'electron.raw-ipc',
      'node.raw-fs',
    ],
    allowedCommands: [
      'runtime.unary',
      'runtime.streamOpen',
      'runtime.streamClose',
      'runtime-lifecycle.status',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'diagnostics.rendererEntryProbe',
      'local-assets.resolveUrl',
      'avatar.assetResolve',
      'floating-window.setBounds',
      'floating-window.setIgnoreCursorEvents',
      'floating-window.setAlwaysOnTop',
      'floating-window.hide',
      'floating-window.close',
      'floating-window.beginManualDrag',
      'floating-window.moveManualDrag',
      'floating-window.constrainToVisibleArea',
    ].map(resolveStandardShellOperationCommand),
    forbiddenCommands: [
      'runtime-lifecycle.start',
      'runtime-lifecycle.restart',
      'runtime-defaults.get',
      'auth.sessionLoad',
      'auth.sessionSave',
      'auth.sessionClear',
      'oauth.openExternalUrl',
      'oauth.tokenExchange',
      'oauth.listenForCode',
      'local-agent.identity',
      'local-agent.runtimeTrustedCaller',
      'ai-profile.get',
      'agent-center.avatarAssetImport',
      'agent-center.avatarAssetValidate',
      'agent-center.avatarAssetResolvePreview',
      'agent-center.live2dAdapterImport',
      'agent-center.backgroundImport',
      'agent-center.backgroundGet',
      'agent-center.backgroundValidate',
      'agent-center.backgroundRemove',
      'agent-center.agentResourcesRemove',
      'agent-center.accountResourcesRemove',
      'platform-projection.get',
      'file-dialog.open',
      'file-reveal.reveal',
      'export.saveFile',
      'artifacts.write',
      'desktop-private.product-control',
      'tauri-only.commands',
      'electron.raw-ipc',
      'node.raw-fs',
    ].map(resolveOptionalStandardShellOperationCommand).filter((command): command is string => Boolean(command)),
    negativeTests: [
      'bundled-avatar-denies-renderer-selected-profile',
      'bundled-avatar-denies-runtime-start-restart',
      'bundled-avatar-denies-auth-and-oauth-custody',
      'bundled-avatar-denies-agent-center-mutation',
      'bundled-avatar-denies-desktop-private-commands',
      'bundled-avatar-storage-root-stays-host-private',
      'bundled-avatar-window-commands-bind-invoking-window',
    ],
    sourceRule: 'P-KIT-047',
  },
  {
    setId: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    hostClass: 'protected-local-app-host',
    appPackageKind: 'nimi-app',
    launchResolution: 'runtime_prepare_local_app_launch_and_verified_process_binding',
    authBinding: 'runtime_owned_request_empty_local_app_session',
    authorityStatus: 'permission_model_v1_base_entitlement_only',
    allowedOperations: LOCAL_APP_ALLOWED_OPERATIONS,
    plannedOperations: LOCAL_APP_PLANNED_OPERATIONS,
    plannedOperationsDisposition: 'deny_until_separate_operation_admission',
    forbiddenOperations: LOCAL_APP_FORBIDDEN_OPERATIONS,
    allowedCommands: LOCAL_APP_ALLOWED_OPERATIONS.map(resolveStandardShellOperationCommand),
    forbiddenCommands: LOCAL_APP_FORBIDDEN_OPERATIONS
      .map(resolveOptionalStandardShellOperationCommand)
      .filter((command): command is string => Boolean(command)),
    negativeTests: [
      'local-app-session-does-not-imply-protected-operation-authority',
      'local-app-reserved-permission-request-fails-closed',
      'local-app-denies-runtime-lifecycle',
      'local-app-denies-generic-runtime-proxy',
      'local-app-denies-auth-session-custody',
      'local-app-denies-oauth-token-exchange',
      'local-app-denies-platform-projection',
      'local-app-denies-desktop-private-bridge',
      'local-app-denies-tauri-only-commands',
      'local-app-denies-file-system-handoff',
      'local-app-denies-floating-window',
      'local-app-process-mismatch_denied',
      'local-app-reserved-permission-unavailable-on-protected-operation',
    ],
    sourceRule: 'P-KIT-044',
  },
] as const satisfies readonly NimiStandardShellCapabilitySet[];

function resolveStandardShellOperationCommand(operationRef: string): string {
  const command = resolveOptionalStandardShellOperationCommand(operationRef);
  if (!command) {
    throw new Error(`Unknown standard shell operation ref: ${operationRef}`);
  }
  return command;
}

function resolveOptionalStandardShellOperationCommand(operationRef: string): string | undefined {
  const separator = operationRef.indexOf('.');
  const capabilityId = operationRef.slice(0, separator);
  const operationId = operationRef.slice(separator + 1);
  const capability = NIMI_STANDARD_SHELL_CAPABILITIES.find((entry) => entry.id === capabilityId);
  const operation = capability?.operations.find((entry) => entry.id === operationId);
  return operation?.command;
}
