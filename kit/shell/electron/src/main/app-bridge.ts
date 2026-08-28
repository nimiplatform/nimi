import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import {
  createNimiElectronLocalAppHost,
  startNimiElectronLocalAppHostMaintenance,
} from './local-app-host.js';
import {
  createNimiElectronLocalAppAssetMediaHost,
  type NimiElectronAppAssetMediaPlatform,
} from './app-asset-protocol.js';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandler,
  type NimiElectronIpcMain,
  type NimiElectronStandardShellHost,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const LOCAL_APP_PROTECTED_CARRIER_SENTINEL = 'local-app-protected-carrier-only';
const REQUIRED_INPUT_KEYS = ['allowedRendererUrls', 'appId', 'assetMediaPlatform', 'ipcMain'] as const;
const OPTIONAL_INPUT_KEYS = ['agentCenterOpenFileDialog', 'appCommandHandlers'] as const;
const RESERVED_COMMAND_PREFIX = 'nimi.shell.';
let sourceLocalDevelopmentParentMonitor: NodeJS.Timeout | undefined;

export type RegisterNimiElectronAppBridgeInput = {
  readonly appId: string;
  readonly allowedRendererUrls: readonly string[];
  readonly assetMediaPlatform: NimiElectronAppAssetMediaPlatform;
  readonly ipcMain: NimiElectronIpcMain;
  /** Host-native picker used only by Agent Center material commands. */
  readonly agentCenterOpenFileDialog?: NimiElectronAgentCenterOpenFileDialog;
  /**
   * Exact commands implemented by this app's own native host. These commands
   * are app-owned authority: they receive the same renderer origin checks as
   * the local-app carrier, but they do not become protected App Access and
   * cannot occupy the reserved `nimi.shell.*` namespace.
   */
  readonly appCommandHandlers?: Readonly<Record<string, NimiElectronCommandHandler>>;
};

export type NimiElectronAgentCenterOpenFileDialog = NonNullable<
  NimiElectronStandardShellHost['openFileDialog']
>;

/**
 * Registers the fixed local-app surface for a Desktop-supervised process.
 *
 * The app supplies its public id, exact renderer URLs, Electron's IPC registrar,
 * and optionally the bounded Host-native Agent Center picker. Trust-class
 * selection, Runtime endpoint selection, native carrier choice, session
 * renewal, and command authority remain Kit-owned. Protected
 * session unavailability leaves this bridge registered so the App can render
 * the carrier's bounded typed posture and recover on the same Host.
 */
export function registerNimiElectronAppBridge(
  input: RegisterNimiElectronAppBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  assertExactAppBridgeInput(input);
  startSourceLocalDevelopmentParentMonitor();
  const allowedRendererUrls = input.allowedRendererUrls.map(normalizeRendererUrl);
  if (allowedRendererUrls.length === 0) {
    throw appBridgeInputError(
      'Electron app bridge requires at least one exact renderer URL',
      'electron-local-app-renderer-url-required',
      'provide_exact_local_app_renderer_url',
    );
  }
  let localAppAssetMediaHost: ReturnType<typeof createNimiElectronLocalAppAssetMediaHost> | undefined;
  const localAppHost = createNimiElectronLocalAppHost(() => localAppAssetMediaHost?.invalidateAll());
  localAppAssetMediaHost = createNimiElectronLocalAppAssetMediaHost({
    localAppHost,
    platform: input.assetMediaPlatform,
  });
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
      localAppAssetMediaHost,
      openFileDialog: input.agentCenterOpenFileDialog,
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
    localAppAssetMediaHost.close();
    registered.unregister();
  };
  maintenance = startNimiElectronLocalAppHostMaintenance(localAppHost, undefined, () => {
    localAppAssetMediaHost.invalidateAll();
  });
  void maintenance.ready.catch(() => undefined);
  return {
    invokeChannel: registered.invokeChannel,
    unregister: closeBridge,
  };
}

function startSourceLocalDevelopmentParentMonitor(): void {
  const sourceProfile = (
    process.platform === 'darwin'
    && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1'
  ) || (
    process.platform === 'win32'
    && process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1'
  );
  if (!sourceProfile) return;
  const sourceProcess = process as NodeJS.Process & { readonly defaultApp?: boolean };
  const desktopPid = process.ppid;
  if (sourceProcess.defaultApp !== true || !Number.isSafeInteger(desktopPid) || desktopPid <= 1) {
    throw appBridgeInputError(
      'Source local development requires one live Desktop parent',
      'electron-local-app-parent-required',
      'relaunch_local_app_from_desktop',
    );
  }
  if (sourceLocalDevelopmentParentMonitor) return;
  sourceLocalDevelopmentParentMonitor = setInterval(() => {
    let parentAlive = process.ppid === desktopPid;
    if (parentAlive) {
      try {
        process.kill(desktopPid, 0);
      } catch {
        parentAlive = false;
      }
    }
    if (!parentAlive) {
      clearInterval(sourceLocalDevelopmentParentMonitor);
      sourceLocalDevelopmentParentMonitor = undefined;
      process.kill(process.pid, 'SIGTERM');
    }
  }, 250);
  sourceLocalDevelopmentParentMonitor.unref();
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
  ) {
    throw appBridgeInputError(
      'Electron app bridge input contains forbidden authority fields',
      'electron-local-app-bridge-input-forbidden',
      'remove_app_owned_local_app_authority',
    );
  }
  if (input.agentCenterOpenFileDialog !== undefined
    && typeof input.agentCenterOpenFileDialog !== 'function') {
    throw appBridgeInputError(
      'Electron app bridge Agent Center picker must be a Host function',
      'electron-local-app-agent-center-picker-invalid',
      'provide_host_native_agent_center_picker',
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
