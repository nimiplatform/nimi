import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from './host.js';
import { rendererOriginFromUrl } from './diagnostics.js';
import { createAppBusinessServices, type NimiElectronAppBusinessServices } from './app-business-services.js';
import { requestElectronAgentCenterResourcePackPlacement } from './agent-center-resource-pack-placement.js';
import {
  createNimiElectronLocalAppHost,
  NimiElectronLocalAppHostError,
  startNimiElectronLocalAppHostMaintenance,
  type NimiElectronLocalAppHost,
} from './local-app-host.js';
import {
  createNimiElectronLocalAppAssetMediaHost,
  type NimiElectronAppAssetMediaPlatform,
} from './app-asset-protocol.js';
import { NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY } from './app-host-profile.js';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandler,
  type NimiElectronIpcMain,
  type NimiElectronStandardShellHost,
  type RegisteredNimiElectronRuntimeBridge,
} from './types.js';

const LOCAL_APP_PROTECTED_CARRIER_SENTINEL = 'local-app-protected-carrier-only';
const REQUIRED_INPUT_KEYS = ['allowedRendererUrls', 'appId', 'assetMediaPlatform', 'ipcMain'] as const;
const OPTIONAL_INPUT_KEYS = ['agentCenterOpenFileDialog', 'appCommandHandlers', 'onSessionInvalidated', 'onSessionReady'] as const;
const RESERVED_COMMAND_PREFIX = 'nimi.shell.';
const DESKTOP_PARENT_POLL_MS = 250;
/** Mirrors the 2 s a Desktop stop gives a Host between SIGTERM and SIGKILL. */
export const DESKTOP_PARENT_LOSS_EXIT_BUDGET_MS = 2_000;
let desktopParentMonitor: NodeJS.Timeout | undefined;

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
  /** Cancel App-owned work and discard account-scoped memory on this Host. */
  readonly onSessionInvalidated?: () => void;
  /** Receive fresh scope-bound services after initial readiness or a real rebind. Never resumes old work. */
  readonly onSessionReady?: (services: NimiElectronAppBusinessServices) => void;
};

export type NimiElectronAgentCenterOpenFileDialog = NonNullable<
  NimiElectronStandardShellHost['openFileDialog']
>;

export type RegisteredNimiElectronAppBridge = RegisteredNimiElectronRuntimeBridge & Readonly<{
  localAppHost: Pick<NimiElectronLocalAppHost, 'agentReferenceList' | 'conversationSnapshot'>;
  /** Current scope-bound clients. Captured old objects remain permanently retired after invalidation. */
  services: NimiElectronAppBusinessServices;
  /** Check technical readiness before new Node work; never replay a business call. */
  prepareSession: (signal?: AbortSignal) => Promise<void>;
}>;

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
): RegisteredNimiElectronAppBridge {
  assertExactAppBridgeInput(input);
  startDesktopParentMonitor();
  const allowedRendererUrls = input.allowedRendererUrls.map(normalizeRendererUrl);
  if (allowedRendererUrls.length === 0) {
    throw appBridgeInputError(
      'Electron app bridge requires at least one exact renderer URL',
      'electron-local-app-renderer-url-required',
      'provide_exact_local_app_renderer_url',
    );
  }
  let localAppAssetMediaHost: ReturnType<typeof createNimiElectronLocalAppAssetMediaHost> | undefined;
  let business: ReturnType<typeof createAppBusinessServices> | undefined;
  let closed = false;
  let businessInvalidated = false;
  let readyDelivered = false;
  const invalidate = () => {
    if (closed || businessInvalidated) return;
    businessInvalidated = true;
    readyDelivered = false;
    localAppAssetMediaHost?.invalidateAll();
    business?.close();
    input.onSessionInvalidated?.();
  };
  const ready = () => {
    if (closed || readyDelivered) return;
    if (businessInvalidated) {
      business = createAppBusinessServices(localAppHost);
      businessInvalidated = false;
    }
    readyDelivered = true;
    if (business) input.onSessionReady?.(business.services);
  };
  const localAppHost = createNimiElectronLocalAppHost(invalidate, ready);
  business = createAppBusinessServices(localAppHost);
  localAppAssetMediaHost = createNimiElectronLocalAppAssetMediaHost({
    localAppHost,
    platform: input.assetMediaPlatform,
  });
  const registered = registerNimiElectronRuntimeBridge({
    appId: input.appId,
    runtimeEndpoint: LOCAL_APP_PROTECTED_CARRIER_SENTINEL,
    allowedOrigins: [...new Set(allowedRendererUrls.map(rendererOriginFromUrl))],
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
      agentCenterResourcePackPlacement: (payload) => requestElectronAgentCenterResourcePackPlacement({
        conversationAnchorId: payload.conversationAnchorId,
      }),
    },
    commandHandlers: validateAppCommandHandlers(input.appCommandHandlers),
  });
  // Bootstrap on the verified Electron main process immediately after bridge
  // registration. Renderer compilation/navigation is outside the one-time
  // process-bind window and must not own its timing. Rotation stays in the
  // native host for the full Electron process lifetime.
  let maintenance: ReturnType<typeof startNimiElectronLocalAppHostMaintenance> | undefined;
  const closeBridge = () => {
    if (closed) return;
    closed = true;
    maintenance?.close();
    business?.close();
    input.onSessionInvalidated?.();
    localAppAssetMediaHost.close();
    registered.unregister();
  };
  maintenance = startNimiElectronLocalAppHostMaintenance(localAppHost, undefined, invalidate);
  void maintenance.ready.catch(() => undefined);
  const placementLocalAppHost: RegisteredNimiElectronAppBridge['localAppHost'] = Object.freeze({
    agentReferenceList: () => localAppHost.agentReferenceList(),
    conversationSnapshot: (request) => localAppHost.conversationSnapshot(request),
  });
  return {
    invokeChannel: registered.invokeChannel,
    localAppHost: placementLocalAppHost,
    get services() { return business!.services; },
    // @nimi-authority: rule.nimi.runtime.protected-session.r016
    prepareSession: async (signal) => {
      signal?.throwIfAborted();
      if (closed) throw new NimiElectronLocalAppHostError('session-invalid', false);
      const status = await localAppHost.sessionStatus();
      signal?.throwIfAborted();
      if (closed) throw new NimiElectronLocalAppHostError('session-invalid', false);
      if (status.state !== 'ready') {
        throw new NimiElectronLocalAppHostError(
          typeof status.reasonCode === 'string' ? status.reasonCode : 'runtime-unauthenticated',
          status.retryable === true,
        );
      }
    },
    unregister: closeBridge,
  };
}

/** @internal The process facts the Desktop parent monitor reads; `process` in production. */
export type DesktopParentMonitorProcess = {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly defaultApp?: boolean;
  readonly pid: number;
  readonly ppid: number;
  kill(pid: number, signal: NodeJS.Signals | 0): unknown;
  exit(code: number): unknown;
};

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
/**
 * @internal A Host that Desktop launched lives only while that Desktop does:
 * Desktop owns its launch and supervision, and no later Desktop adopts it.
 * When the parent is gone the Host quits and, should a quit handler hold on,
 * leaves after the same budget a Desktop stop allows.
 */
export function startDesktopParentMonitor(
  host: DesktopParentMonitorProcess = process as DesktopParentMonitorProcess,
): void {
  const sourceProfile = (
    host.platform === 'darwin'
    && host.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1'
  ) || (
    host.platform === 'win32'
    && host.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1'
  );
  const desktopLaunched = Boolean(host.env[NIMI_APP_HOST_PROFILE_ENVIRONMENT_KEY]);
  if (!sourceProfile && !desktopLaunched) return;
  const desktopPid = host.ppid;
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-037a
  if ((sourceProfile && host.platform === 'darwin' && host.defaultApp !== true)
    || !Number.isSafeInteger(desktopPid) || desktopPid <= 1) {
    throw appBridgeInputError(
      'A Desktop-launched App Host requires its live Desktop parent',
      'electron-local-app-parent-required',
      'relaunch_local_app_from_desktop',
    );
  }
  if (desktopParentMonitor) return;
  desktopParentMonitor = setInterval(() => {
    let parentAlive = host.ppid === desktopPid;
    if (parentAlive) {
      try {
        host.kill(desktopPid, 0);
      } catch {
        parentAlive = false;
      }
    }
    if (parentAlive) return;
    clearInterval(desktopParentMonitor);
    desktopParentMonitor = undefined;
    setTimeout(() => host.exit(1), DESKTOP_PARENT_LOSS_EXIT_BUDGET_MS);
    host.kill(host.pid, 'SIGTERM');
  }, DESKTOP_PARENT_POLL_MS);
  desktopParentMonitor.unref();
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
  if (input.onSessionInvalidated !== undefined && typeof input.onSessionInvalidated !== 'function') {
    throw appBridgeInputError(
      'Electron App session invalidation callback must be a Host function',
      'electron-local-app-invalidation-callback-invalid',
      'provide_host_session_invalidation_callback',
    );
  }
  if (input.onSessionReady !== undefined && typeof input.onSessionReady !== 'function') {
    throw appBridgeInputError('Electron App session readiness callback must be a Host function', 'electron-local-app-readiness-callback-invalid', 'provide_host_session_readiness_callback');
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
