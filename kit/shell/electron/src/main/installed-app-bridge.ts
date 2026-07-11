import { NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import { createNimiElectronInstalledHost } from './installed-host.js';
import {
  NimiElectronShellHostError,
  type NimiElectronIpcMain,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const INSTALLED_PROTECTED_LOCAL_ENDPOINT_SENTINEL = 'installed-protected-local-only';
const INPUT_KEYS = ['allowedRendererUrls', 'appId', 'ipcMain'] as const;

export type RegisterNimiElectronInstalledAppBridgeInput = {
  readonly appId: string;
  readonly allowedRendererUrls: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
};

/**
 * Registers the fixed artifact-only Electron surface for an installed Nimi app.
 *
 * The app supplies only its public id, exact renderer URLs, and Electron's IPC
 * registrar. Runtime endpoint selection, ordinary gRPC construction, native
 * carrier choice, capability-set choice, and command extension stay Kit-owned.
 */
export function registerNimiElectronInstalledAppBridge(
  input: RegisterNimiElectronInstalledAppBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  assertExactInstalledBridgeInput(input);
  const allowedRendererUrls = input.allowedRendererUrls.map(normalizeRendererUrl);
  if (allowedRendererUrls.length === 0) {
    throw installedBridgeInputError(
      'Electron installed app bridge requires at least one exact renderer URL',
      'electron-installed-renderer-url-required',
      'provide_exact_installed_renderer_url',
    );
  }
  return registerNimiElectronRuntimeBridge({
    appId: input.appId,
    runtimeEndpoint: INSTALLED_PROTECTED_LOCAL_ENDPOINT_SENTINEL,
    allowedOrigins: [...new Set(allowedRendererUrls.map(rendererOrigin))],
    allowedRendererUrls,
    ipcMain: input.ipcMain,
    createGrpcClient: () => {
      throw new NimiElectronShellHostError({
        code: 'capability-unavailable',
        message: 'Installed Nimi app bridge cannot construct an ordinary Runtime gRPC client',
        reasonCode: 'electron-installed-ordinary-grpc-forbidden',
        actionHint: 'use_typed_installed_protected_carrier',
      });
    },
    standardShellHost: {
      capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      installedHost: createNimiElectronInstalledHost(),
    },
  });
}

function assertExactInstalledBridgeInput(input: RegisterNimiElectronInstalledAppBridgeInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw installedBridgeInputError(
      'Electron installed app bridge input must be an object',
      'electron-installed-bridge-input-invalid',
      'provide_exact_installed_bridge_input',
    );
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...INPUT_KEYS].sort())) {
    throw installedBridgeInputError(
      'Electron installed app bridge input contains forbidden authority fields',
      'electron-installed-bridge-input-forbidden',
      'remove_app_owned_installed_authority',
    );
  }
}

function normalizeRendererUrl(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value) {
    throw installedBridgeInputError(
      'Electron installed renderer URL is invalid',
      'electron-installed-renderer-url-invalid',
      'provide_exact_installed_renderer_url',
    );
  }
  try {
    return new URL(normalized).toString();
  } catch {
    throw installedBridgeInputError(
      'Electron installed renderer URL is invalid',
      'electron-installed-renderer-url-invalid',
      'provide_exact_installed_renderer_url',
    );
  }
}

function rendererOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function installedBridgeInputError(
  message: string,
  reasonCode: string,
  actionHint: string,
): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message,
    reasonCode,
    actionHint,
  });
}
