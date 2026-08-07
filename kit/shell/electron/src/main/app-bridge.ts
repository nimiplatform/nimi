import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import {
  createNimiElectronLocalAppHost,
  startNimiElectronLocalAppHostMaintenance,
} from './local-app-host.js';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandler,
  type NimiElectronIpcMain,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const LOCAL_APP_PROTECTED_CARRIER_SENTINEL = 'local-app-protected-carrier-only';
const REQUIRED_INPUT_KEYS = ['allowedRendererUrls', 'appId', 'ipcMain', 'onProtectedSessionFailure'] as const;
const OPTIONAL_INPUT_KEYS = ['appCommandHandlers'] as const;
const RESERVED_COMMAND_PREFIX = 'nimi.shell.';

export type RegisterNimiElectronAppBridgeInput = {
  readonly appId: string;
  readonly allowedRendererUrls: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
  /**
   * Closes the current Electron host after Kit has revoked its renderer bridge
   * because protected session bootstrap or renewal failed. Desktop's retained
   * supervisor may then reopen a fresh lease/session without changing the
   * project registration. No protected reason or authority is passed to App code.
   */
  readonly onProtectedSessionFailure: () => void;
  /**
   * Exact commands implemented by this app's own native host. These commands
   * are app-owned authority: they receive the same renderer origin checks as
   * the local-app carrier, but they do not become protected App Access and
   * cannot occupy the reserved `nimi.shell.*` namespace.
   */
  readonly appCommandHandlers?: Readonly<Record<string, NimiElectronCommandHandler>>;
};

/**
 * Registers the fixed local-app surface for a Desktop-supervised process.
 *
 * The app supplies only its public id, exact renderer URLs, Electron's IPC
 * registrar, and a no-argument host-close callback. Trust-class selection,
 * Runtime endpoint selection, native carrier choice, session renewal, and
 * command authority remain Kit-owned.
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
  const registered = registerNimiElectronRuntimeBridge({
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
    commandHandlers: validateAppCommandHandlers(input.appCommandHandlers),
  });
  // Bootstrap on the verified Electron main process immediately after bridge
  // registration. Renderer compilation/navigation is outside the one-time
  // process-bind window and must not own its timing. Rotation stays in the
  // native host for the full Electron process lifetime.
  let closed = false;
  let maintenance: ReturnType<typeof startNimiElectronLocalAppHostMaintenance> | undefined;
  const closeBridge = () => {
    if (closed) return;
    closed = true;
    maintenance?.close();
    registered.unregister();
  };
  maintenance = startNimiElectronLocalAppHostMaintenance(localAppHost, undefined, (failure) => {
    console.error(
      `[protected-local local-app-session] stage=closed reason=${failure.reasonCode} action=supervised-host-reopen`,
    );
    closeBridge();
    input.onProtectedSessionFailure();
  });
  void maintenance.ready.catch(() => undefined);
  return {
    invokeChannel: registered.invokeChannel,
    unregister: closeBridge,
  };
}

function assertExactAppBridgeInput(input: RegisterNimiElectronAppBridgeInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw appBridgeInputError(
      'Electron app bridge input must be an object',
      'electron-local-app-bridge-input-invalid',
      'provide_exact_local_app_bridge_input',
    );
  }
  const keys = Object.keys(input);
  const allowedKeys = new Set<string>([...REQUIRED_INPUT_KEYS, ...OPTIONAL_INPUT_KEYS]);
  if (
    REQUIRED_INPUT_KEYS.some((key) => !Object.hasOwn(input, key))
    || keys.some((key) => !allowedKeys.has(key))
    || typeof input.onProtectedSessionFailure !== 'function'
  ) {
    throw appBridgeInputError(
      'Electron app bridge input contains forbidden authority fields',
      'electron-local-app-bridge-input-forbidden',
      'remove_app_owned_local_app_authority',
    );
  }
}

function validateAppCommandHandlers(
  value: RegisterNimiElectronAppBridgeInput['appCommandHandlers'],
): Readonly<Record<string, NimiElectronCommandHandler>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw appBridgeInputError(
      'Electron app command handlers must be an exact command map',
      'electron-local-app-command-map-invalid',
      'provide_exact_app_owned_command_handlers',
    );
  }
  const handlers: Record<string, NimiElectronCommandHandler> = {};
  for (const [command, handler] of Object.entries(value)) {
    if (
      !command
      || command.trim() !== command
      || command.length > 160
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(command)
      || command.toLowerCase().startsWith(RESERVED_COMMAND_PREFIX)
      || typeof handler !== 'function'
    ) {
      throw appBridgeInputError(
        `Electron app command handler is invalid: ${command || '<empty>'}`,
        'electron-local-app-command-handler-invalid',
        'use_non_reserved_exact_app_owned_command',
      );
    }
    handlers[command] = handler;
  }
  return Object.freeze(handlers);
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
