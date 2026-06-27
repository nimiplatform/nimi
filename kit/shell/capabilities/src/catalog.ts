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

export const NIMI_STANDARD_SHELL_CAPABILITIES = [
  {
    id: 'runtime',
    operations: [
      { id: 'unary', command: 'nimi.shell.runtime.unary', negativeStates: ['capability-unavailable', 'external-daemon-required', 'invalid-payload', 'host-internal-error'] },
      { id: 'streamOpen', command: 'nimi.shell.runtime.stream.open', negativeStates: ['capability-unavailable', 'external-daemon-required', 'invalid-payload', 'host-internal-error'] },
      { id: 'streamClose', command: 'nimi.shell.runtime.stream.close', negativeStates: ['capability-unavailable', 'not-found', 'invalid-payload', 'host-internal-error'] },
    ],
  },
  {
    id: 'runtime-lifecycle',
    operations: [
      { id: 'status', command: 'nimi.shell.runtimeLifecycle.status', negativeStates: ['capability-unavailable', 'external-daemon-required'] },
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
