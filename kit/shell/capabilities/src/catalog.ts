import type { NimiStandardShellErrorCode } from './errors.js';

export const NIMI_STANDARD_SHELL_CAPABILITY_IDS = [
  'runtime',
  'runtime-lifecycle',
  'runtime-defaults',
  'auth',
  'oauth',
  'shell-ui',
  'diagnostics',
  'data',
  'storage',
  'config',
  'local-assets',
  'local-agent',
  'ai-profile',
  'ai-config',
  'avatar',
  'platform-projection',
] as const;

export type NimiStandardShellCapabilityId = (typeof NIMI_STANDARD_SHELL_CAPABILITY_IDS)[number];

export interface NimiStandardShellOperation {
  id: string;
  command: string;
  negativeStates: readonly NimiStandardShellErrorCode[];
}

export interface NimiStandardShellCapability {
  id: NimiStandardShellCapabilityId;
  operations: readonly NimiStandardShellOperation[];
}

export const NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID = 'installed-nimi-app-standard-shell-v1';

export interface NimiStandardShellCapabilitySet {
  readonly setId: string;
  readonly hostClass: string;
  readonly appPackageKind: string;
  readonly launchResolution: string;
  readonly authBinding: string;
  readonly allowedOperations: readonly string[];
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
      { id: 'stop', command: 'nimi.shell.runtimeLifecycle.stop', negativeStates: ['external-daemon-required'] },
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
    id: 'auth',
    operations: [
      { id: 'sessionLoad', command: 'nimi.shell.auth.session.load', negativeStates: ['external-daemon-required', 'capability-unavailable'] },
      { id: 'sessionSave', command: 'nimi.shell.auth.session.save', negativeStates: ['external-daemon-required', 'capability-unavailable', 'invalid-payload'] },
      { id: 'sessionClear', command: 'nimi.shell.auth.session.clear', negativeStates: ['external-daemon-required', 'capability-unavailable'] },
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
      { id: 'pathResolve', command: 'nimi.shell.data.pathResolve', negativeStates: ['capability-unavailable', 'invalid-path'] },
    ],
  },
  {
    id: 'storage',
    operations: [
      { id: 'readJson', command: 'nimi.shell.storage.readJson', negativeStates: ['capability-unavailable', 'invalid-path', 'not-found'] },
      { id: 'writeJson', command: 'nimi.shell.storage.writeJson', negativeStates: ['capability-unavailable', 'invalid-path', 'invalid-payload'] },
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
    id: 'platform-projection',
    operations: [
      { id: 'get', command: 'nimi.shell.platformProjection.get', negativeStates: ['capability-unavailable', 'not-found'] },
    ],
  },
] as const satisfies readonly NimiStandardShellCapability[];

const INSTALLED_NIMI_APP_ALLOWED_OPERATIONS = [
  'runtime.unary',
  'runtime.streamOpen',
  'runtime.streamClose',
  'data.pathResolve',
  'storage.readJson',
  'storage.writeJson',
  'config.get',
  'config.set',
  'ai-config.get',
  'ai-config.set',
  'local-assets.resolveUrl',
  'shell-ui.confirmDialog',
  'shell-ui.startWindowDrag',
  'shell-ui.focusMainWindow',
] as const;

const INSTALLED_NIMI_APP_FORBIDDEN_OPERATIONS = [
  'runtime-lifecycle.status',
  'runtime-lifecycle.start',
  'runtime-lifecycle.stop',
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
  'platform-projection.get',
  'desktop-private.product-control',
  'tauri-only.commands',
  'electron.raw-ipc',
  'node.raw-fs',
] as const;

export const NIMI_STANDARD_SHELL_CAPABILITY_SETS = [
  {
    setId: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    hostClass: 'desktop-electron-installed-app-host',
    appPackageKind: 'nimi-app',
    launchResolution: 'runtime-openapp-attested',
    authBinding: 'host-owned-runtime-app-session',
    allowedOperations: INSTALLED_NIMI_APP_ALLOWED_OPERATIONS,
    forbiddenOperations: INSTALLED_NIMI_APP_FORBIDDEN_OPERATIONS,
    allowedCommands: INSTALLED_NIMI_APP_ALLOWED_OPERATIONS.map(resolveStandardShellOperationCommand),
    forbiddenCommands: INSTALLED_NIMI_APP_FORBIDDEN_OPERATIONS
      .map(resolveOptionalStandardShellOperationCommand)
      .filter((command): command is string => Boolean(command)),
    negativeTests: [
      'desktop-installed-app-denies-runtime-lifecycle',
      'desktop-installed-app-denies-auth-session-custody',
      'desktop-installed-app-denies-oauth-token-exchange',
      'desktop-installed-app-denies-local-agent-trusted-caller',
      'desktop-installed-app-denies-platform-projection',
      'desktop-installed-app-denies-desktop-private-bridge',
      'desktop-installed-app-denies-tauri-only-commands',
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
