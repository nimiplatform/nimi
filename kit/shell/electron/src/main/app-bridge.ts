import { NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import {
  createNimiElectronAppHost,
  NIMI_ELECTRON_APP_HOST_BOOTSTRAP_COMMAND,
} from './app-host.js';
import {
  NimiElectronShellHostError,
  type NimiElectronIpcMain,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const APP_HOST_PROTECTED_LOCAL_ENDPOINT_SENTINEL = 'app-host-protected-local-only';
const INPUT_KEYS = ['allowedRendererUrls', 'appId', 'ipcMain'] as const;

export type RegisterNimiElectronAppBridgeInput = {
  readonly appId: string;
  readonly allowedRendererUrls: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
};

/**
 * Registers the fixed app-host surface shared by production-installed and
 * Desktop-supervised local-development sessions.
 *
 * The app supplies only its public id, exact renderer URLs, and Electron's IPC
 * registrar. Trust-class selection, Runtime endpoint selection, native carrier
 * choice, bootstrap renewal, and command authority remain Kit-owned.
 */
export function registerNimiElectronAppBridge(
  input: RegisterNimiElectronAppBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  assertExactAppBridgeInput(input);
  const allowedRendererUrls = input.allowedRendererUrls.map(normalizeRendererUrl);
  if (allowedRendererUrls.length === 0) {
    throw appBridgeInputError(
      'Electron app bridge requires at least one exact renderer URL',
      'electron-app-host-renderer-url-required',
      'provide_exact_app_host_renderer_url',
    );
  }
  const appHost = createNimiElectronAppHost();
  return registerNimiElectronRuntimeBridge({
    appId: input.appId,
    runtimeEndpoint: APP_HOST_PROTECTED_LOCAL_ENDPOINT_SENTINEL,
    allowedOrigins: [...new Set(allowedRendererUrls.map(rendererOrigin))],
    allowedRendererUrls,
    ipcMain: input.ipcMain,
    createGrpcClient: () => {
      throw new NimiElectronShellHostError({
        code: 'capability-unavailable',
        message: 'Nimi app-host bridge cannot construct an ordinary Runtime gRPC client',
        reasonCode: 'electron-app-host-ordinary-grpc-forbidden',
        actionHint: 'use_typed_app_host_protected_carrier',
      });
    },
    standardShellHost: {
      capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      appHost,
    },
    commandHandlers: {
      [NIMI_ELECTRON_APP_HOST_BOOTSTRAP_COMMAND]: () => appHost.bootstrap(),
    },
  });
}

function assertExactAppBridgeInput(input: RegisterNimiElectronAppBridgeInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw appBridgeInputError(
      'Electron app bridge input must be an object',
      'electron-app-host-bridge-input-invalid',
      'provide_exact_app_host_bridge_input',
    );
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...INPUT_KEYS].sort())) {
    throw appBridgeInputError(
      'Electron app bridge input contains forbidden authority fields',
      'electron-app-host-bridge-input-forbidden',
      'remove_app_owned_app_host_authority',
    );
  }
}

function normalizeRendererUrl(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value) {
    throw appBridgeInputError(
      'Electron app-host renderer URL is invalid',
      'electron-app-host-renderer-url-invalid',
      'provide_exact_app_host_renderer_url',
    );
  }
  try {
    return new URL(normalized).toString();
  } catch {
    throw appBridgeInputError(
      'Electron app-host renderer URL is invalid',
      'electron-app-host-renderer-url-invalid',
      'provide_exact_app_host_renderer_url',
    );
  }
}

function rendererOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function appBridgeInputError(
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
