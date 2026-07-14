import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import { createNimiElectronLocalAppHost } from './local-app-host.js';
import {
  NimiElectronShellHostError,
  type NimiElectronIpcMain,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const LOCAL_APP_PROTECTED_CARRIER_SENTINEL = 'local-app-protected-carrier-only';
const INPUT_KEYS = ['allowedRendererUrls', 'appId', 'ipcMain'] as const;

export type RegisterNimiElectronAppBridgeInput = {
  readonly appId: string;
  readonly allowedRendererUrls: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
};

/**
 * Registers the fixed local-app surface for a Desktop-supervised process.
 *
 * The app supplies only its public id, exact renderer URLs, and Electron's IPC
 * registrar. Trust-class selection, Runtime endpoint selection, native carrier
 * choice, session renewal, and command authority remain Kit-owned.
 */
export function registerNimiElectronAppBridge(
  input: RegisterNimiElectronAppBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  assertExactAppBridgeInput(input);
  const allowedRendererUrls = input.allowedRendererUrls.map(normalizeRendererUrl);
  if (allowedRendererUrls.length === 0) {
    throw appBridgeInputError(
      'Electron app bridge requires at least one exact renderer URL',
      'electron-local-app-renderer-url-required',
      'provide_exact_local_app_renderer_url',
    );
  }
  const localAppHost = createNimiElectronLocalAppHost();
  return registerNimiElectronRuntimeBridge({
    appId: input.appId,
    runtimeEndpoint: LOCAL_APP_PROTECTED_CARRIER_SENTINEL,
    allowedOrigins: [...new Set(allowedRendererUrls.map(rendererOrigin))],
    allowedRendererUrls,
    ipcMain: input.ipcMain,
    createGrpcClient: () => {
      throw new NimiElectronShellHostError({
        code: 'capability-unavailable',
        message: 'Nimi local-app bridge cannot construct an ordinary Runtime gRPC client',
        reasonCode: 'electron-local-app-ordinary-grpc-forbidden',
        actionHint: 'use_typed_local_app_protected_carrier',
      });
    },
    standardShellHost: {
      capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
      localAppHost,
    },
  });
}

function assertExactAppBridgeInput(input: RegisterNimiElectronAppBridgeInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw appBridgeInputError(
      'Electron app bridge input must be an object',
      'electron-local-app-bridge-input-invalid',
      'provide_exact_local_app_bridge_input',
    );
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...INPUT_KEYS].sort())) {
    throw appBridgeInputError(
      'Electron app bridge input contains forbidden authority fields',
      'electron-local-app-bridge-input-forbidden',
      'remove_app_owned_local_app_authority',
    );
  }
}

function normalizeRendererUrl(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value) {
    throw appBridgeInputError(
      'Electron local-app renderer URL is invalid',
      'electron-local-app-renderer-url-invalid',
      'provide_exact_local_app_renderer_url',
    );
  }
  try {
    return new URL(normalized).toString();
  } catch {
    throw appBridgeInputError(
      'Electron local-app renderer URL is invalid',
      'electron-local-app-renderer-url-invalid',
      'provide_exact_local_app_renderer_url',
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
