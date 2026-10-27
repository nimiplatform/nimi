import { createDesktopExecutionNoticesHost } from './execution-notices-host.js';
import { writeDesktopStderr } from './stderr-log.js';
import { DesktopProductUpdateHost } from './product-update-host.js';
import { MacOSProductUpdateAdapter } from './macos-product-update-adapter.js';
import { WindowsProductUpdateAdapter } from './windows-product-update-adapter.js';
import { ProductUpdateFailureStore, readUpdateFailureDiagnostic } from './product-update-failure-store.js';
import desktopPackage from '../package.json' with { type: 'json' };
import { getRuntimeWireCodec, RuntimeHealthStatus } from '@nimiplatform/sdk/runtime/generated';
import { ProductUpdateError } from '../../../config/product-update-contract.mjs';
import { verifyProductInstaller } from './product-update-installer-verification.js';
import { DesktopShutdownBlockedError, runDesktopProductShutdown, type DesktopShutdownReport } from './product-update-shutdown.js';
import { createDesktopFinalExit } from './desktop-final-exit.js';
import { createDesktopHomeCommandPolicy } from './home-host-policy.js';
import { installDesktopPermissionPolicy } from './desktop-permission-policy.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  protocol,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
  type MessageBoxOptions,
} from 'electron';
import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION,
  NimiElectronShellHostError,
  createElectronRuntimeBridgeCommandNames,
  createElectronShellFileProtocolHost,
  createNimiElectronDesktopControlHost,
  createNimiElectronDeveloperModeStatusProbe,
  createNimiElectronRuntimeLifecycleHost,
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  type NimiElectronAppChromeHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronFileDialogOpenPayload,
  type NimiElectronFileDialogOpenResult,
  type NimiElectronIpcMainInvokeEvent,
  type NimiElectronShellFileProtocolHost,
  type RegisteredNimiElectronRuntimeBridge,
} from '@nimiplatform/kit/shell/electron/main';
import { buildAvatarHostHandoffRequest } from '@nimiplatform/kit/features/avatar/headless';
import {
  readOrCreateDesktopConnectorAuthHostId,
  startDesktopConnectorAuthCallback,
} from './connector-auth-callback-host.js';
import type { NimiDesktopOpenIntentEnvelope } from '@nimiplatform/kit/core/desktop-open';
import {
  createDesktopElectronLocalDevelopmentHost,
  type DesktopElectronLocalDevelopmentHost,
} from './local-development-host.js';
import { createDesktopElectronProductControlHost } from './product-control-host.js';
import { createDesktopMacOSRuntimeServiceHost } from './macos-runtime-service.js';
import { readDesktopRuntimeMaintenance, NIMI_RUNTIME_STORED_DATA_UNSUPPORTED } from './runtime-maintenance.js';
import { createDesktopInstalledAppHost, type DesktopInstalledAppHost } from './installed-app-host.js';
import {
  DesktopSourceRuntimeUnavailableError,
  requireDesktopSourceRuntime,
  sourceRuntimeBootstrapFailureMessage,
} from './source-runtime-bootstrap.js';
import {
  createDesktopElectronOpenIntentHost,
  DESKTOP_OPEN_INTENT_EVENT,
  type DesktopElectronOpenIntentHost,
} from './desktop-open-intent-host.js';
import { requestRunningZhiyuResourcePackPlacement } from './zhiyu-resource-pack-placement.js';
import { createDesktopAppActivitySourceLaunch } from './app-activity-source-launch-host.js';
import {
  assertMacOSElectronSecurity,
  resolveElectronRuntimeDeploymentProfile,
} from './macos-electron-security.js';
import {
  createDesktopElectronBundledAvatarHost,
  resolveDesktopAvatarFormalLaunchBinding,
  resolveDesktopAvatarFormalPresentation,
  type DesktopElectronBundledAvatarHost,
} from './bundled-avatar-host.js';
import { createDesktopElectronSystemResourcesHost } from './system-resources-host.js';
import { createDesktopElectronSupportLogsHost } from './support-logs-host.js';
import {
  createDesktopElectronChatAiStoreHost,
  type DesktopElectronChatAiStoreHost,
} from './chat-ai-store-host.js';
import { createDesktopElectronDataCleanupHost } from './data-cleanup-host.js';
import {
  createDesktopDataRootOperationGate,
  type DesktopDataRootOperationGate,
} from './data-root-operation-gate.js';
import {
  captureDesktopTemporaryEnvironment,
  prepareDesktopHomeHostProfile,
  prepareDesktopHomeRootProfile,
  shouldRetryDesktopHomeProfile,
  releaseDesktopHomeBootstrapSlot,
  type DesktopHomeHostProfile,
  type DesktopTemporaryEnvironment,
} from './home-host-profile.js';
import { createDesktopElectronHttpHost } from './http-request-host.js';
import {
  bindDesktopSenderInvalidation,
  createDesktopElectronConnectorAuthAcquisitionHost,
  createDesktopManagedConnectorCredentialRuntime,
  type DesktopElectronConnectorAuthAcquisitionHost,
} from './connector-auth-acquisition-host.js';
import { createDesktopElectronRendererLogHost } from './renderer-log-host.js';
import { createDesktopSystemEntryHost, type DesktopSystemEntryHost } from './system-entry-host.js';
import { createSystemEntryAdmission, type SystemEntryFocusAuthorization } from './system-entry-admission.js';
import { createSystemEntryActionRelay } from './system-entry-action-relay.js';
import { createDesktopQuitCoordinator } from './system-entry-quit-coordinator.js';
import {
  createDesktopAppOriginProtocol,
  desktopRendererOrigin,
  NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES,
  NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
} from './app-origin-protocol.js';
import { SYSTEM_ENTRY_ACTION_EVENT, SYSTEM_ENTRY_HOME_COMMANDS, SYSTEM_ENTRY_VISIBILITY_EVENT, parseSystemEntryActionResult,
  type SystemEntryAction, type SystemEntryActionContext, type SystemEntryActionDispatch,
} from '../src/shell/shared/system-entry-types.js';

const APP_ID = 'nimi.desktop';
const ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean;
const MACOS_LOCAL_DEVELOPMENT_BUILD = typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;
const ELECTRON_DEVELOPMENT_BUILD = typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_DEVELOPMENT_BUILD__;
const SOURCE_PER_USER_RUNTIME_D2 = ELECTRON_DEVELOPMENT_BUILD
  && !MACOS_LOCAL_DEVELOPMENT_BUILD
  && (
    (process.platform === 'darwin' && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1')
    || (process.platform === 'win32' && process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1')
  );

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const systemEntryPreloadPath = path.join(currentDir, 'system-entry-preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistAvatarIndex = path.join(appRoot, 'avatar', 'dist', 'index.html');
const appOriginProtocol = createDesktopAppOriginProtocol({
  protocol,
  roots: {
    desktop: path.dirname(rendererDistIndex),
    avatar: path.dirname(rendererDistAvatarIndex),
  },
});
const rendererUrl = ELECTRON_DEVELOPMENT_BUILD
  ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL)
  : '';
const bundledAvatarRendererUrl = ELECTRON_DEVELOPMENT_BUILD
  ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL) || 'http://127.0.0.1:1427'
  : appOriginProtocol.rendererUrl('avatar');
const AVATAR_ONLY_DEVELOPMENT_MODE = ELECTRON_DEVELOPMENT_BUILD
  && normalizeText(process.env.NIMI_DESKTOP_ELECTRON_AVATAR_ONLY) === '1';
// Nimi Desktop has no public Runtime TCP endpoint. Kit uses this non-endpoint
// label only in lifecycle/error projections; every admitted unary is carried
// by the native protected Desktop control session.
const PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF = 'protected-desktop-control';

// Standard shell local-asset protocol host. Serves only files explicitly
// registered readable (kit host also allows configured `roots`; desktop keeps
// the historical registered-only serving gate by passing no roots). The
// path-allow gate for which absolute paths may be resolved stays on the
// standard shell host via `localAssetRoots`.
//
// Privileged scheme registration is centralized below because Electron reads
// these declarations during app bootstrap.
const localAssetProtocolHost: NimiElectronShellFileProtocolHost = createElectronShellFileProtocolHost({
  protocol: {
    registerSchemesAsPrivileged: () => {
      throw new Error('Desktop registers Electron privileged schemes once during app bootstrap.');
    },
    handle: (scheme, handler) =>
      protocol.handle(scheme, async (request) => (await handler(request)) as Response),
  },
});
let mainWindow: BrowserWindow | undefined;
let mainWindowCreation: Promise<BrowserWindow> | undefined;
let mainWindowRecovery: Promise<void> | undefined;
let mainRendererUnavailable = false;
let mainRendererUnresponsive = false;
let systemEntryRendererReady = false;
const systemEntryDeniedWebContents = new Set<number>();
const desktopSenderInvalidationListeners = new Set<() => void>();
const systemNotices = new Set<Notification>();
const executionNotices = createDesktopExecutionNoticesHost({
  supported: () => Notification.isSupported(),
  readAdmission: async () => systemEntryAdmission?.read() ?? { generation: 'unavailable', state: 'unknown' },
  notify: (title, body, outcome) => {
    const notification = new Notification({ title, body });
    systemNotices.add(notification);
    notification.once('show', () => outcome('shown'));
    notification.once('failed', () => { outcome('failed'); systemNotices.delete(notification); });
    notification.once('close', () => systemNotices.delete(notification));
    notification.on('click', () => focusDesktopMainWindow());
    notification.show();
  },
});
let localDevelopmentHost: DesktopElectronLocalDevelopmentHost | undefined;
let installedAppHost: DesktopInstalledAppHost | undefined;
let desktopOpenIntentHost: DesktopElectronOpenIntentHost | undefined;
let bundledAvatarHost: DesktopElectronBundledAvatarHost | undefined;
let chatAiStoreHost: DesktopElectronChatAiStoreHost | undefined;
let systemEntryHost: DesktopSystemEntryHost | undefined;
let systemEntryAdmission: ReturnType<typeof createSystemEntryAdmission> | undefined;
let systemEntryActionRelay: ReturnType<typeof createSystemEntryActionRelay> | undefined;
let systemEntryAccountUnsubscribe: (() => void) | undefined;
let systemEntryLocale: 'en' | 'zh' = 'en';
let connectorAuthAcquisitionHost: DesktopElectronConnectorAuthAcquisitionHost | undefined;
let registeredRuntimeBridge: RegisteredNimiElectronRuntimeBridge | undefined;
const desktopFinalExit = createDesktopFinalExit({
  takeRuntimeBridge: () => {
    const bridge = registeredRuntimeBridge;
    registeredRuntimeBridge = undefined;
    return bridge;
  },
  reportDiagnostic: (reason) => writeDesktopStderr(`[desktop-shutdown] runtime-bridge:${reason}\n`),
  exit: (code) => app.exit(code),
});
// Install before startup can exit. Home remains an IPC consumer until all
// windows close; synchronous app.exit paths use the same finalizer directly.
app.on('will-quit', desktopFinalExit.finish);
let homeChromeHost: NimiElectronAppChromeHost | undefined;
let quitCleanup: Promise<void> | undefined;
let stopProductRuntime: (() => Promise<void>) | undefined;
let quitCleanupComplete = false;
let ownerQuitRequested = false;
let systemSessionEnding = false;
let entryUnavailableNoticeOpen = false;
type DesktopRuntimeStatus = { readonly running: boolean; readonly managed: boolean; readonly launchMode: string; readonly version?: string; readonly lastError?: string };
let productUpdateHost: DesktopProductUpdateHost | undefined;
let productUpdateAdapter: MacOSProductUpdateAdapter | WindowsProductUpdateAdapter | undefined;
let reconcileProductActivation: (() => Promise<void>) | undefined;
let productUpdateHomeReady = false;
let productRetentionBusy = false;
const DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS = 5_000;
// Home's own Host technical profile (P-MIG-006d / P-COLD-017a).
const HOME_PROFILE_RELAUNCH_ARGUMENT = '--nimi-home-profile-relaunch';
const HOME_PROFILE_RELAUNCH_EXIT_CODE = 75;
const HOME_PROFILE_SCOPE_READ_TIMEOUT_MS = 12_000;
const HOME_PROFILE_RELAUNCHED = process.argv.includes(HOME_PROFILE_RELAUNCH_ARGUMENT);
const HOME_PROFILE_REPAIR_COMMANDS: ReadonlySet<string> = new Set([
  'product_control_record_select_data_root',
  'product_control_root_activation_initialize',
  'product_control_record_admit_ready_for_use',
  'product_control_check_sync_start',
]);
let homeHostProfile: DesktopHomeHostProfile | undefined;
let homeTemporaryEnvironment: DesktopTemporaryEnvironment | undefined;
let homeRelaunchRequested = false;
let homeProfileWorkBlocked = false;
let homeDataRootOperationGate: DesktopDataRootOperationGate | undefined;
let homeProfileCheckAt = 0;
// While Runtime serves only its maintenance surface, Home runs no root-bound
// work; a committed maintenance replacement relaunches Home into the new root.
let runtimeMaintenance = false;
let runtimeStartupFailure: string | null = null;
let maintenanceRelaunchRequested = false;
// Until startup finished constructing its hosts, a requested relaunch waits
// for startup's own checkpoint so shutdown sees every host it must dispose.
let desktopStartupSettled = false;
const desktopQuitCoordinator = createDesktopQuitCoordinator({
  readImpact: async () => {
    const view = await systemEntryHost?.snapshot();
    const work = view?.observation === 'current' && view.admission.state === 'ready' ? view.projection?.work : undefined;
    return {
      installed: installedAppHost?.quitImpact() ?? [],
      development: localDevelopmentHost?.quitImpact() ?? [],
      avatar: bundledAvatarHost?.quitImpact() ?? { active: 0, pending: false },
      observedWorkCount: work?.total ?? null,
      workComplete: work?.status === 'available' && work.total !== null,
    };
  },
  confirm: confirmDesktopUserQuit,
  shutdown: prepareDesktopQuit,
  finishQuit: async () => { quitCleanupComplete = true; await finishDesktopHomeProfileBeforeExit(); },
  recoverAfterFailedQuit: recoverDesktopAfterFailedQuit,
  phaseChanged: (phase) => {
    systemEntryHost?.setQuitPhase(phase);
    if (phase === 'stopping' || phase === 'system-ending') systemEntryAdmission?.invalidate();
  },
});

app.setName(MACOS_LOCAL_DEVELOPMENT_BUILD ? 'Nimi Dev' : 'Nimi');
if (process.platform === 'win32') {
  // Explorer resolves matching installed shortcuts before the window icon.
  // Keep the workspace Electron carrier separate from installed Home.
  app.setAppUserModelId(ELECTRON_DEVELOPMENT_BUILD ? `${APP_ID}.dev` : APP_ID);
}
if (SOURCE_PER_USER_RUNTIME_D2) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { ownerQuitRequested = true; app.quit(); });
  }
}
configureDesktopElectronChromiumRuntime();

const unregisterProductionService = process.platform === 'darwin' && app.isPackaged
  && !ELECTRON_DEVELOPMENT_BUILD && !MACOS_LOCAL_DEVELOPMENT_BUILD
  && process.argv.includes('--unregister-runtime-service');
// The single-instance lock keeps its fixed location: it is requested before
// the profile preflight moves userData, so modes and roots never split Home.
const ownsDesktopInstanceLock = unregisterProductionService || app.requestSingleInstanceLock();
if (!ownsDesktopInstanceLock) {
  app.quit();
} else if (!await configureDesktopHomeHostProfile()) {
  desktopFinalExit.exit(1);
} else {
  app.on('second-instance', () => {
    void focusDesktopMainWindow();
  });

  protocol.registerSchemesAsPrivileged([
    {
      scheme: NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION.scheme,
      privileges: { ...NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION.privileges },
    },
    {
      scheme: NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
      privileges: { ...NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES },
    },
  ]);

  void bootstrapDesktopElectronHost();
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-017a
// Bounded pre-ready preflight: only this runs before `app.whenReady()`; the
// bootstrap below awaits readiness, so awaiting it here would self-wait.
async function configureDesktopHomeHostProfile(): Promise<boolean> {
  const temporaryEnvironment = captureDesktopTemporaryEnvironment();
  try {
    const profile = await prepareDesktopHomeHostProfile({
      readScopeRoot: () => readDesktopHomeProfileScope(),
      singleInstanceScope: app.getPath('userData'),
      temporaryEnvironment,
      reportCleanupFailure: (error) => {
        writeDesktopStderr(`[desktop-home-profile] bootstrap-slot-cleanup:${desktopBootstrapFailureCode(error)}\n`);
      },
    });
    app.setPath('userData', profile.userData);
    app.setPath('sessionData', profile.sessionData);
    app.setPath('temp', profile.temp);
    temporaryEnvironment.apply(profile.temp);
    homeHostProfile = profile;
    homeTemporaryEnvironment = temporaryEnvironment;
    if (profile.mode === 'bootstrap') {
      writeDesktopStderr(`[desktop-home-profile] bootstrap:${profile.bootstrapReason ?? 'unavailable'}\n`);
    }
    return true;
  } catch (error) {
    const failureCode = desktopBootstrapFailureCode(error);
    writeDesktopStderr(`[desktop-home-profile] ${failureCode}\n`);
    dialog.showErrorBox(
      'Nimi could not prepare its startup profile',
      `Nimi could not prepare its temporary setup profile (${failureCode}). Close other Nimi windows or free the temporary folder, then open Nimi again.`,
    );
    return false;
  }
}

function requestDesktopMaintenanceRelaunch(): void {
  if (maintenanceRelaunchRequested) return;
  maintenanceRelaunchRequested = true;
  // Let the renderer receive the reply that started this before Home quits.
  setTimeout(() => app.quit(), 250);
}

async function readDesktopHomeProfileScope(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      createDesktopElectronProductControlHost().resolveHostProfileScope(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('desktop-home-profile-scope-read-timeout')),
          HOME_PROFILE_SCOPE_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Bootstrap serves setup and repair only: App launches are refused until Home
// relaunches into the selected root's profile.
function normalHomeWorkAllowed(): boolean {
  return homeHostProfile?.mode === 'root' && !homeProfileWorkBlocked && !homeRelaunchRequested
    && !homeDataRootOperationGate?.isClosed();
}

function desktopAppLaunchGate(gate: DesktopDataRootOperationGate): DesktopDataRootOperationGate {
  const requireNormalHomeWork = <T>(operation: () => Promise<T>) => async (): Promise<T> => {
    if (desktopQuitCoordinator.isLaunchBlocked() || ownerQuitRequested || quitCleanup || systemSessionEnding) throw new Error('desktop-home-quit-in-progress');
    if (!normalHomeWorkAllowed()) throw new Error('desktop-home-profile-repair-required');
    return operation();
  };
  return Object.freeze({
    ...gate,
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      return gate.runExclusive(requireNormalHomeWork(operation));
    },
    runShared<T>(operation: () => Promise<T>): Promise<T> {
      return gate.runShared(requireNormalHomeWork(operation));
    },
  });
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007h
// Home adopts a different profile only by relaunching: from bootstrap once the
// selected root is usable and GUI-writable, or after a committed root switch.
async function checkDesktopHomeProfileScope(
  resolveScope: () => Promise<string>,
  trigger: 'startup' | 'activation' | 'command' | 'user-action',
): Promise<boolean> {
  const current = homeHostProfile;
  if (!current || homeRelaunchRequested) return false;
  // Bound automatic retries, not an explicit user repair attempt. A marker
  // from the previous process must never permanently strand setup/repair.
  if (!shouldRetryDesktopHomeProfile({
    mode: current.mode, alreadyRelaunched: HOME_PROFILE_RELAUNCHED,
    startupSettled: desktopStartupSettled, trigger,
  })) return false;
  const now = Date.now();
  if (trigger === 'command' && now - homeProfileCheckAt < 2_000) return false;
  homeProfileCheckAt = now;
  let scope: string;
  try {
    scope = await resolveScope();
  } catch {
    return false;
  }
  if (current.mode === 'root' && scope === current.scopeRoot) return true;
  try {
    await prepareDesktopHomeRootProfile(scope);
  } catch {
    return false;
  }
  writeDesktopStderr(`[desktop-home-profile] relaunch:${trigger}\n`);
  homeProfileWorkBlocked = true;
  homeRelaunchRequested = true;
  if (desktopStartupSettled) app.quit();
  return false;
}

async function bootstrapDesktopElectronHost(): Promise<void> {
  try {
    await app.whenReady();
    systemEntryLocale = app.getLocale().startsWith('zh') ? 'zh' : 'en';
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(path.join(appRoot, 'assets', 'macos-icon.png'));
    }
    const updateCacheRoot = process.platform === 'darwin'
      ? path.join(app.getPath('home'), 'Library', 'Caches', 'ai.nimi.product-update')
      : process.platform === 'win32' ? path.join(app.getPath('appData'), 'Nimi', 'product-updates') : path.join(app.getPath('userData'), 'product-updates');
    const productionUpdate = app.isPackaged && !ELECTRON_DEVELOPMENT_BUILD && !MACOS_LOCAL_DEVELOPMENT_BUILD;
    productUpdateAdapter = process.platform === 'win32' ? new WindowsProductUpdateAdapter(updateCacheRoot, productionUpdate) : new MacOSProductUpdateAdapter(updateCacheRoot, productionUpdate);
    const windowsUpdate = productUpdateAdapter instanceof WindowsProductUpdateAdapter ? productUpdateAdapter : undefined;
    const updateFailureStore = new ProductUpdateFailureStore(updateCacheRoot, windowsUpdate ? (file) => windowsUpdate.validatePrivateFile(file) : undefined);
    // @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-002
    const productVersion = ELECTRON_DEVELOPMENT_BUILD ? desktopPackage.version : app.getVersion();
    productUpdateHost = new DesktopProductUpdateHost({
      currentVersion: productVersion,
      maintenanceAvailable: Boolean(windowsUpdate && productionUpdate),
      target: process.platform === 'darwin' && process.arch === 'arm64' ? 'macos-arm64'
        : process.platform === 'win32' && process.arch === 'x64' ? 'windows-amd64' : 'unsupported',
      osVersion: process.getSystemVersion(),
      cacheRoot: updateCacheRoot,
      prepareCache: windowsUpdate ? () => windowsUpdate.prepareCache() : undefined,
      verifyInstaller: verifyProductInstaller,
      installation: {
        ready: () => productUpdateAdapter!.ready(),
        preflight: (candidate) => productUpdateAdapter!.preflight(candidate),
        shutdown: async () => {
          homeProfileWorkBlocked = true;
          systemEntryAdmission?.invalidate();
          return shutdownBeforeQuit(true);
        },
        handoff: (candidate, report) => productUpdateAdapter!.handoff(candidate, report),
        preserveFailure: async (failure) => {
          try { await updateFailureStore.save(failure); }
          catch (error) { writeDesktopStderr('[product-update] diagnostic-write-unavailable\n'); throw error; }
        },
        reopenCurrentVersion: async () => {
          await productUpdateAdapter!.prepareCurrentVersionReopen();
          await shutdownBeforeQuit();
          maintenanceRelaunchRequested = true;
          quitCleanupComplete = true;
          await finishDesktopHomeProfileBeforeExit();
        },
        quit: () => { quitCleanupComplete = true; app.quit(); },
      },
    });
    let updateDiagnosticUnavailable = false;
    const previousUpdateFailure = await readUpdateFailureDiagnostic(updateFailureStore, () => {
      updateDiagnosticUnavailable = true;
      writeDesktopStderr('[product-update] diagnostic-read-unavailable\n');
    });
    if (previousUpdateFailure) productUpdateHost.restorePreinstallationFailure(previousUpdateFailure);
    if (!await productUpdateAdapter.hasPending()) productUpdateHost.start(!previousUpdateFailure);
    if (updateDiagnosticUnavailable) productUpdateHost.projectDiagnosticUnavailable();
    if (SOURCE_PER_USER_RUNTIME_D2) {
      runtimeMaintenance = await requireDesktopSourceRuntime(createNimiElectronDeveloperModeStatusProbe())
        === 'maintenance';
    }
    localAssetProtocolHost.registerProtocolHandler();
    appOriginProtocol.register();
    installDesktopPermissionPolicy(session.defaultSession, new Set([
      ...allowedRendererOrigins(),
      desktopRendererOrigin(bundledAvatarRendererUrl),
    ]), systemEntryDeniedWebContents);
    const dataRootOperationGate = createDesktopDataRootOperationGate();
    homeDataRootOperationGate = dataRootOperationGate;
    const appLaunchGate = desktopAppLaunchGate(dataRootOperationGate);
    const authorizeSystemEntryFocus: SystemEntryFocusAuthorization = async (generation, requestId, source) => {
      if (!systemEntryAdmission || !systemEntryActionRelay) throw new Error('system-entry-admission-required');
      const claim = systemEntryActionRelay.prepareFocus(requestId, generation, source);
      const assertCurrent = await systemEntryAdmission.authorizeFocus(generation);
      return () => { assertCurrent(); claim(); };
    };
    localDevelopmentHost = await createDesktopElectronLocalDevelopmentHost({
      homeDirectory: app.getPath('home'),
      authorizeSystemEntryFocus,
      operationGate: appLaunchGate,
      onExecutorChanged: executionNotices.observe,
    });
    installedAppHost = createDesktopInstalledAppHost(undefined, appLaunchGate, executionNotices.observe, authorizeSystemEntryFocus);
    const runtimeDeploymentProfile = resolveElectronRuntimeDeploymentProfile({
      electronDevelopmentBuild: ELECTRON_DEVELOPMENT_BUILD,
      macOSLocalDevelopmentBuild: MACOS_LOCAL_DEVELOPMENT_BUILD,
    });
    const runtimeLifecycleProfile = SOURCE_PER_USER_RUNTIME_D2 ? 'source' : 'fixed';
    const runtimeCommandNames = createElectronRuntimeBridgeCommandNames();
    const fixedRuntimeLifecycleHost = createNimiElectronRuntimeLifecycleHost(
      PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      runtimeLifecycleProfile,
    );
    const macOSProductionService = process.platform === 'darwin' && runtimeDeploymentProfile === 'production'
      ? createDesktopMacOSRuntimeServiceHost(fixedRuntimeLifecycleHost, {
          runtimeEndpoint: PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
          socketExists: () => existsSync('/private/var/run/nimi/runtime-desktop.sock'),
          registration: async (operation) => {
            const native = createRequire(import.meta.url)(path.join(
              process.resourcesPath, 'nimi-native', 'protected-local', 'index.cjs',
            )) as { macosRuntimeServiceRegistration(operation: string): Promise<{
              status: string; reasonCode?: string; value?: { registrationStatus?: number };
            }> };
            const result = await native.macosRuntimeServiceRegistration(operation);
            if (result.status !== 'ok' || ![0, 1, 2, 3].includes(result.value?.registrationStatus ?? -1)) {
              throw new Error(result.reasonCode || 'runtime-service-unavailable');
            }
            return result.value!.registrationStatus!;
          },
          showApproval: async () => (await dialog.showMessageBox({
            type: 'info',
            title: 'Approve Nimi Runtime',
            message: 'Nimi Runtime needs approval to run in the background.',
            detail: 'Open System Settings → Login Items & Extensions and allow Nimi. A Mac administrator must approve this once. The local AI service runs with Nimi Home, including when its window is hidden, and stops when you choose Quit Nimi. This does not enable launch at login. Nimi will close while approval is pending. After allowing Nimi, open it again; daily use requires no administrator privileges.',
            buttons: ['Open System Settings', 'Later'],
            defaultId: 0,
            cancelId: 1,
          })).response === 0,
        })
      : undefined;
    if (macOSProductionService && unregisterProductionService) {
      await macOSProductionService.unregister();
      desktopFinalExit.exit(0);
      return;
    }
    if (macOSProductionService) {
      try {
        const prepared = await macOSProductionService.prepare(runtimeCommandNames);
        if (prepared === 'approval-pending') {
          if (await productUpdateAdapter.hasPending()) {
            runtimeStartupFailure = 'runtime-service-approval-required';
            homeProfileWorkBlocked = true;
          } else { app.quit(); return; }
        }
        runtimeMaintenance = prepared === 'maintenance';
      }
      catch (error) {
        // Home's bootstrap profile and repair UI remain usable. This failure
        // says nothing about stored-data compatibility or ordinary readiness.
        runtimeStartupFailure = desktopBootstrapFailureCode(error);
        homeProfileWorkBlocked = true;
        writeDesktopStderr(`[desktop-bootstrap] runtime-start-failed:${runtimeStartupFailure}\n`);
      }
    }
    const runtimeLifecycleHost = macOSProductionService ?? fixedRuntimeLifecycleHost;
    if (!SOURCE_PER_USER_RUNTIME_D2) stopProductRuntime = () => runtimeLifecycleHost.stop();
    const updateHealthControl = createNimiElectronDesktopControlHost();
    let activationInFlight: Promise<void> | undefined;
    const readProductRuntimeHealth = async () => {
          const lifecycle = await runtimeLifecycleHost.invoke(runtimeCommandNames.status, runtimeCommandNames) as { running: boolean; managed?: boolean; launchMode?: string; version?: string; lastError?: string };
          if (!lifecycle.running) return { ...lifecycle, healthy: false, homeReady: false, approvalPending: lifecycle.lastError === 'runtime-service-approval-required' };
          if (runtimeStartupFailure === 'runtime-service-approval-required') {
            runtimeStartupFailure = null;
            requestDesktopMaintenanceRelaunch();
          }
          const method = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
          const codec = getRuntimeWireCodec(method);
          const bytes = await updateHealthControl.machineProductUnary({ methodId: method, requestBytes: codec.encodeRequest({}), timeoutMs: 2_000 });
          const health = codec.decodeResponse(bytes) as { status?: number };
          return { ...lifecycle, healthy: lifecycle.managed === true && lifecycle.launchMode === 'RELEASE' && health.status === RuntimeHealthStatus.READY, homeReady: productUpdateHomeReady && normalHomeWorkAllowed() };
    };
    const assertProductRetentionReady = async (expected?: { currentVersion: string; runtimeVersion: string }) => {
      if (!productUpdateHomeReady || !normalHomeWorkAllowed() || !(productUpdateAdapter instanceof WindowsProductUpdateAdapter)
        || await productUpdateAdapter.hasPending()
        || ['quiescing', 'handoff', 'awaiting-activation', 'recovery-required'].includes(productUpdateHost?.status().phase ?? '')) {
        throw new ProductUpdateError('UPDATE_RETENTION_UNAVAILABLE');
      }
      const facts = await readProductRuntimeHealth();
      if (!facts.healthy || !facts.homeReady || (expected && (expected.currentVersion !== app.getVersion() || expected.runtimeVersion !== facts.version))) {
        throw new ProductUpdateError('UPDATE_RETENTION_UNAVAILABLE');
      }
    };
    reconcileProductActivation = () => {
      activationInFlight ??= (async () => {
        const result = await productUpdateAdapter?.reconcile(readProductRuntimeHealth);
        if (result) productUpdateHost?.projectActivation(result.phase, result.release, result.reason);
        if (result?.phase === 'completed') productUpdateHost?.start(false);
      })().catch((error: unknown) => {
        productUpdateHost?.projectRecoveryFailure(error instanceof ProductUpdateError ? error.code : 'UPDATE_ACTIVATION_IDENTITY_FAILED');
        writeDesktopStderr(`[product-update] activation:${desktopBootstrapFailureCode(error)}\n`);
      }).finally(() => { activationInFlight = undefined; });
      return activationInFlight;
    };
    if (await productUpdateAdapter.hasPending()) await reconcileProductActivation();
    const invokeRuntimeLifecycle = async (
      command: string,
    ): Promise<DesktopRuntimeStatus> => (
      await runtimeLifecycleHost.invoke(command, runtimeCommandNames)
    ) as DesktopRuntimeStatus;
    if (!SOURCE_PER_USER_RUNTIME_D2 && !macOSProductionService) {
      runtimeMaintenance = await readDesktopRuntimeMaintenance(
        () => invokeRuntimeLifecycle(runtimeCommandNames.start),
      );
    }
    const productControlHost = createDesktopElectronProductControlHost({
      operationGate: dataRootOperationGate,
      runtimeLifecycleProfile,
      restartRuntime: () => invokeRuntimeLifecycle(runtimeCommandNames.restart),
      quiesceHostDataRoot: async () => {
        systemEntryAdmission?.invalidate();
        await localDevelopmentHost?.quiesceDataRoot();
        await installedAppHost?.shutdown();
        await bundledAvatarHost?.quiesceDataRoot();
        await localAssetProtocolHost.quiesceDataRootReadableGrants();
      },
      abortHostDataRoot: () => {
        installedAppHost?.resume();
        localAssetProtocolHost.resumeDataRootReadableGrants();
        bundledAvatarHost?.resumeDataRoot();
      },
      commitHostDataRoot: () => localAssetProtocolHost.retireDataRootReadableGrants(),
      activateHostDataRoot: async () => {
        homeProfileWorkBlocked = true;
        const active = await checkDesktopHomeProfileScope(
          () => productControlHost.resolveHostProfileScope(), 'activation',
        );
        if (!active) return false;
        homeProfileWorkBlocked = false;
        installedAppHost?.resume();
        localAssetProtocolHost.activateDataRootReadableGrants();
        bundledAvatarHost?.resumeDataRoot();
        return true;
      },
      runtimeMaintenance: () => runtimeMaintenance,
      relaunchHome: requestDesktopMaintenanceRelaunch,
    });
    if (runtimeStartupFailure) {
      dataRootOperationGate.close(runtimeStartupFailure);
    } else if (runtimeMaintenance) {
      // @nimi-authority: rule.nimi.desktop.shell-runtime.r025
      // The refused root is never handed to Hosts, cleanup, or a Home profile;
      // only repair commands and the maintenance replacement stay reachable.
      dataRootOperationGate.close(NIMI_RUNTIME_STORED_DATA_UNSUPPORTED);
      writeDesktopStderr(`[desktop-bootstrap] runtime-maintenance:${NIMI_RUNTIME_STORED_DATA_UNSUPPORTED}\n`);
    } else {
      await productControlHost.bootstrapDataRootHandoff();
      if (homeHostProfile?.mode === 'bootstrap') {
        await checkDesktopHomeProfileScope(() => productControlHost.resolveHostProfileScope(), 'startup');
      }
    }
    if (homeRelaunchRequested) {
      // Only the launch hosts exist yet; relaunch before building the rest.
      app.quit();
      return;
    }
    const productControlCommandHandlers = Object.fromEntries(
      Object.entries(productControlHost.commandHandlers).map(([command, handler]) => [
        command,
        async (context: Parameters<typeof handler>[0]) => {
          const result = await handler(context);
          if (homeHostProfile?.mode === 'bootstrap' && !runtimeMaintenance && !runtimeStartupFailure) {
            void checkDesktopHomeProfileScope(
              () => productControlHost.resolveHostProfileScope(),
              HOME_PROFILE_REPAIR_COMMANDS.has(command) ? 'user-action' : 'command',
            );
          }
          return result;
        },
      ]),
    ) as typeof productControlHost.commandHandlers;
    const resolveProductControlDataRoot = createDesktopProductControlDataRootResolver(
      productControlHost.resolveSelectedDataRoot,
    );
    const resolveProductControlSupportDataRoot = createDesktopProductControlDataRootResolver(
      productControlHost.resolveSupportDataRoot,
    );
    const systemResourcesHost = createDesktopElectronSystemResourcesHost({
      resolveDataRoot: resolveProductControlSupportDataRoot,
    });
    chatAiStoreHost = createDesktopElectronChatAiStoreHost({
      resolveSelectedDataRoot: productControlHost.resolveReadyDataRoot,
      operationGate: dataRootOperationGate,
    });
    const supportLogsHost = createDesktopElectronSupportLogsHost({
      resolveSelectedDataRoot: resolveProductControlSupportDataRoot,
      downloadsDirectory: app.getPath('downloads'),
      revealFile: (filePath) => shell.showItemInFolder(filePath),
      operationGate: dataRootOperationGate,
    });
    const dataCleanupHost = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: productControlHost.resolveReadyDataRoot,
      resolveHostProfileScope: productControlHost.resolveHostProfileScope,
      hasActiveManagedApps: async () => Boolean(localDevelopmentHost?.hasActiveRuns())
        || Boolean(await installedAppHost?.hasActiveRuns()),
      operationGate: dataRootOperationGate,
    });
    const httpRequestHost = createDesktopElectronHttpHost({});
    connectorAuthAcquisitionHost = createDesktopElectronConnectorAuthAcquisitionHost({
      proxyHttp: httpRequestHost.connectorAuthRequest,
      runtime: createDesktopManagedConnectorCredentialRuntime(
        createNimiElectronDesktopControlHost(),
      ),
      openExternalUrl: openDesktopExternalUrl,
      startAuthorizationCallback: startDesktopConnectorAuthCallback,
      hostIdentifier: () => readOrCreateDesktopConnectorAuthHostId(app.getPath('userData')),
      authorizeSender: authorizeDesktopRendererSender,
      subscribeSenderInvalidation: (listener) => {
        desktopSenderInvalidationListeners.add(listener);
        return () => desktopSenderInvalidationListeners.delete(listener);
      },
    });
    const rendererLogHost = createDesktopElectronRendererLogHost();
    systemEntryActionRelay = createSystemEntryActionRelay({ send: emitDesktopSystemEntryAction });
    systemEntryAdmission = createSystemEntryAdmission({
      readAccount: async () => {
        const read = registeredRuntimeBridge?.readDesktopAccountSessionStatus;
        if (!read || !systemEntryAccountUnsubscribe) throw new Error('system-entry-account-unavailable');
        return read();
      },
      readProduct: () => productControlHost.commandHandlers.product_control_record_get({ command: 'product_control_record_get', payload: {} }),
      normalWorkAllowed: () => normalHomeWorkAllowed()
        && !['stopping', 'committed', 'system-ending'].includes(desktopQuitCoordinator.phase())
        && !ownerQuitRequested && !quitCleanup && !systemSessionEnding,
      onInvalidated: () => {
        executionNotices.disableNotifications();
        systemEntryHost?.invalidate(); systemEntryActionRelay?.invalidate();
      },
      onScopeChanged: (previous) => {
        if (previous.state === 'ready') executionNotices.disableNotifications();
        systemEntryActionRelay?.invalidate();
      },
    });
    systemEntryHost = createDesktopSystemEntryHost({
      electron: { Menu, Tray, BrowserWindow, ipcMain, screen },
      icon: process.platform === 'darwin' ? createDesktopMenuBarIcon() : createDesktopIcon(),
      popup: { url: new URL('system-entry.html', rendererUrl || appOriginProtocol.rendererUrl('desktop')).href, preloadPath: systemEntryPreloadPath },
      configurePopup: (window) => {
        const id = window.webContents.id;
        systemEntryDeniedWebContents.add(id);
        window.webContents.once('destroyed', () => systemEntryDeniedWebContents.delete(id));
      },
      getAdmission: () => systemEntryAdmission!.read(),
      executeAction: dispatchDesktopSystemEntryAction,
      ensureHomeWindow: focusDesktopMainWindow,
      hideHomeWindow: hideDesktopMainWindow,
      requestQuit: () => desktopQuitCoordinator.requestUserQuit(),
      locale: systemEntryLocale,
      reportError: (operation, error) => {
        writeDesktopStderr(`[desktop-system-entry] ${normalizeText(operation) || 'operation'}:${desktopBootstrapFailureCode(error)}\n`);
      },
    });
    bundledAvatarHost = await createDesktopElectronBundledAvatarHost({
      rendererUrl: bundledAvatarRendererUrl,
      packagedRendererIndexPath: ELECTRON_DEVELOPMENT_BUILD ? undefined : rendererDistAvatarIndex,
      ...(!rendererUrl ? {
        publishPreviewImage: (bytes: Uint8Array) => appOriginProtocol.publishAvatarPreview(bytes),
      } : {}),
      preloadPath,
      resolveFormalLaunchBinding: (request) => {
        const host = registeredRuntimeBridge?.bundledAvatarLocalAppHost;
        if (!host) throw new Error('Avatar formal App host is unavailable.');
        return resolveDesktopAvatarFormalLaunchBinding(host, request);
      },
      resolveFormalPresentation: (request) => {
        const host = registeredRuntimeBridge?.bundledAvatarLocalAppHost;
        if (!host) throw new Error('Avatar formal App host is unavailable.');
        return resolveDesktopAvatarFormalPresentation(host, request);
      },
      resolveAppPrivateDataRoot: async () => path.join(
        await resolveProductControlDataRoot(),
        'apps',
        'nimi.avatar',
        'data',
      ),
      localAssetProtocolHost,
      revalidateFormalPresentationForMaterialization: async ({
        avatarHostTargetRef,
        agentHandle,
        conversationAnchorId,
        avatarAssetRef,
        backendKind,
        presentationRevision,
      }) => {
        const localAppHost = registeredRuntimeBridge?.bundledAvatarLocalAppHost;
        if (!localAppHost) throw new Error('Avatar formal App host is unavailable.');
        const presentation = await resolveDesktopAvatarFormalPresentation(localAppHost, {
          avatarHostTargetRef,
          agentHandle,
          conversationAnchorId,
        });
        if (presentation.presentationRevision !== presentationRevision
          || presentation.avatarAssetRef !== avatarAssetRef
          || presentation.backendKind !== backendKind) {
          throw new Error('Avatar materialization request no longer matches the formal presentation.');
        }
      },
      resolveFormalAvatarHostTarget: async ({ agentHandle, conversationAnchorId }) => {
        const localAppHost = registeredRuntimeBridge?.bundledAvatarLocalAppHost;
        if (!localAppHost) throw new Error('Avatar formal App host is unavailable.');
        const resolved = await localAppHost.avatarHostTargetResolve({
          agentHandle,
          conversationAnchorId,
        });
        const avatarHostTargetRef = normalizeText(resolved.avatarHostTargetRef);
        if (!/^avatar_target_[A-Za-z0-9_-]{43}$/u.test(avatarHostTargetRef)) {
          throw new Error('Avatar formal App target is invalid.');
        }
        return avatarHostTargetRef;
      },
      runDataRootOperation: (operation) => appLaunchGate.runShared(operation),
      resolveFormalPresentationAsset: async ({ agentHandle, assetRef }) => {
        const localAppHost = registeredRuntimeBridge?.bundledAvatarLocalAppHost;
        if (!localAppHost) throw new Error('Avatar formal App host is unavailable.');
        return localAppHost.agentPresentationReadAsset({ agentHandle, assetRef }) as never;
      },
      revalidateCurrentAvatarHostTarget: async (avatarHostTargetRef) => {
        const revalidate = registeredRuntimeBridge?.revalidateAvatarHostTarget;
        if (!revalidate) throw new Error('Avatar current Host target revalidation is unavailable.');
        return revalidate(avatarHostTargetRef);
      },
      devRendererRoot: ELECTRON_DEVELOPMENT_BUILD
        ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT)
        : undefined,
    });
    const appActivitySourceLaunch = createDesktopAppActivitySourceLaunch({
      isAvailable: normalHomeWorkAllowed,
      resolve: () => registeredRuntimeBridge?.resolveAppActivityOpenLaunch,
      launchInstalled: () => installedAppHost?.launchSelector,
      startLocalDevelopment: () => localDevelopmentHost?.startRegistrationHandle,
    });
    desktopOpenIntentHost = await createDesktopElectronOpenIntentHost({
      homeDirectory: app.getPath('home'),
      focusMainWindow: focusDesktopMainWindow,
      emitIntent: emitDesktopOpenIntent,
      avatarHostHandoff: bundledAvatarHost.hostHandoff,
      appActivitySourceLaunch,
      zhiyuResourcePackPlacement: (request) => requestRunningZhiyuResourcePackPlacement({
        homeDirectory: app.getPath('home'),
        request,
        startExactZhiyu: () => localDevelopmentHost?.startExactZhiyu() ?? Promise.resolve(false),
      }),
    });
    // @nimi-authority: definition.nimi.desktop.bridge-ipc.command-registration-plane
    // @nimi-authority: definition.nimi.desktop.command-execution.registered-surface
    // @nimi-authority: rule.nimi.desktop.command-execution.r005
    // @nimi-authority: rule.nimi.desktop.command-execution.r006
    homeChromeHost = createNimiElectronAppChromeHost({
      metadata: { name: 'Nimi Home', version: desktopPackage.version },
      allowedRendererUrls: allowedRendererUrls(), app,
      appCommands: [
        { id: 'home.open-settings', menu: 'file', labels: { en: 'Settings', zh: '设置' }, shortcut: 'Ctrl+,', macShortcut: 'Cmd+,' },
        { id: 'home.open-troubleshooting', menu: 'help', labels: { en: 'Troubleshooting', zh: '故障排查' } },
        { id: 'home.open-logs', menu: 'help', labels: { en: 'Export Logs', zh: '日志导出' } },
        { id: 'home.open-terms', menu: 'help', labels: { en: 'Terms of Service', zh: '服务条款' } },
        { id: 'home.open-privacy', menu: 'help', labels: { en: 'Privacy Policy', zh: '隐私政策' } },
        { id: 'home.open-downloads', menu: 'view', labels: { en: 'Downloads', zh: '下载' } },
        { id: 'home.open-docs', menu: 'help', labels: { en: 'Documentation', zh: '文档' } },
        { id: 'home.check-update', menu: 'help', labels: { en: 'Check for updates', zh: '检查更新' } },
      ],
      menu: { buildFromTemplate: template => Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]), setApplicationMenu: menu => Menu.setApplicationMenu(menu as Electron.Menu | null) },
    });
    registeredRuntimeBridge = registerNimiElectronRuntimeBridge({
      appId: APP_ID,
      commandPolicy: createDesktopHomeCommandPolicy(normalHomeWorkAllowed),
      runtimeEndpoint: PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      runtimeDeploymentProfile,
      runtimeLifecycleProfile,
      allowedOrigins: allowedRendererOrigins(),
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
      desktopHost: {
        runtimeLifecycle: runtimeLifecycleHost,
        authorizeSender: authorizeDesktopRendererSender,
        subscribeSenderInvalidation: (listener) => {
          desktopSenderInvalidationListeners.add(listener);
          return () => desktopSenderInvalidationListeners.delete(listener);
        },
      },
      commandHandlers: {
        [SYSTEM_ENTRY_HOME_COMMANDS.context]: async ({ payload, event }) => {
          assertSystemEntryHomeRequest(payload, event, false);
          if (!systemEntryHost) throw new Error('system-entry-unavailable');
          const context = await systemEntryHost.context();
          assertSystemEntryHomeRequest(payload, event, false);
          return context;
        },
        [SYSTEM_ENTRY_HOME_COMMANDS.publish]: async ({ payload, event }) => {
          assertSystemEntryHomeRequest(payload, event, true);
          if (!systemEntryHost) throw new Error('system-entry-unavailable');
          await systemEntryHost.publish(payload.payload);
          assertSystemEntryHomeRequest(payload, event, true);
          systemEntryLocale = (payload.payload as { locale: 'en' | 'zh' }).locale;
          systemEntryRendererReady = true;
          return { accepted: true };
        },
        [SYSTEM_ENTRY_HOME_COMMANDS.heartbeat]: async ({ payload, event }) => {
          assertSystemEntryHomeRequest(payload, event, true);
          if (!systemEntryHost) throw new Error('system-entry-unavailable');
          await systemEntryHost.heartbeat(payload.payload);
          return { accepted: true };
        },
        [SYSTEM_ENTRY_HOME_COMMANDS.actionResult]: async ({ payload, event }) => {
          assertSystemEntryHomeRequest(payload, event, true);
          const result = parseSystemEntryActionResult(payload.payload);
          const current = await systemEntryAdmission?.read();
          assertSystemEntryHomeRequest(payload, event, true);
          if (!current || current.generation !== result.generation || current.state !== 'ready' || !systemEntryActionRelay) throw new Error('system-entry-action-stale');
          systemEntryActionRelay.settle(result);
          return { accepted: true };
        },
        // @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-009
        nimi_product_update_status: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          if (productUpdateHost?.status().phase !== 'failed' && await productUpdateAdapter?.hasPending()) await reconcileProductActivation?.();
          return productUpdateHost?.status();
        },
        nimi_product_update_install: ({ payload, event }) => {
          if (!authorizeDesktopRendererSender(event) || Object.keys(payload).sort().join(',') !== 'consentApproved,releaseId'
            || payload.consentApproved !== true || typeof payload.releaseId !== 'string' || !productUpdateHost || productRetentionBusy) throw new Error('desktop-product-update-request-rejected');
          void productUpdateHost.install(payload.releaseId, true);
          return productUpdateHost.status();
        },
        nimi_product_update_home_ready: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          productUpdateHomeReady = true;
          if (productUpdateHost?.status().phase !== 'failed' && await productUpdateAdapter?.hasPending()) await reconcileProductActivation?.();
          return productUpdateHost?.status();
        },
        nimi_product_update_check: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          if (!productUpdateHost?.status().checkAvailable) throw new ProductUpdateError('UPDATE_CHECK_UNAVAILABLE');
          if (await productUpdateAdapter?.hasPending()) {
            await productUpdateHost?.checkAfterFailedHandoffCleared(normalHomeWorkAllowed, () => productUpdateAdapter!.clearFailedPending());
          } else if (normalHomeWorkAllowed()) {
            await productUpdateHost?.checkAfterFailedHandoffCleared(normalHomeWorkAllowed, async () => true);
          } else { void productUpdateHost?.check(); }
          return productUpdateHost?.status();
        },
        nimi_product_update_cancel: ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          productUpdateHost?.cancel();
          return productUpdateHost?.status();
        },
        nimi_product_update_reopen_current: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          await productUpdateHost?.reopenCurrentVersion();
          return productUpdateHost?.status();
        },
        // @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
        nimi_product_retention_preview: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          if (productRetentionBusy) throw new ProductUpdateError('UPDATE_HANDOFF_IN_PROGRESS');
          productRetentionBusy = true;
          try {
            await assertProductRetentionReady();
            const adapter = productUpdateAdapter as WindowsProductUpdateAdapter;
            const preview = await adapter.previewRetention();
            await assertProductRetentionReady(preview);
            return preview;
          } finally { productRetentionBusy = false; }
        },
        nimi_product_retention_cleanup: async ({ payload, event }) => {
          if (!authorizeDesktopRendererSender(event) || Object.keys(payload).sort().join(',') !== 'consentApproved,versions'
            || payload.consentApproved !== true || !Array.isArray(payload.versions) || payload.versions.length > 256
            || payload.versions.some((value: unknown) => typeof value !== 'string') || productRetentionBusy
            || !(productUpdateAdapter instanceof WindowsProductUpdateAdapter)) throw new ProductUpdateError('UPDATE_RETENTION_SELECTION_INVALID');
          productRetentionBusy = true;
          try {
            await assertProductRetentionReady(productUpdateAdapter.retentionIdentity());
            return await productUpdateAdapter.cleanupRetention(payload.versions as string[]);
          } finally { productRetentionBusy = false; }
        },
        // @nimi-authority: rule.nimi.runtime.agent-participation.r197
        desktop_agent_reference_resolve: async ({ payload, event }) => {
          if (!authorizeDesktopRendererSender(event)) throw new Error('Desktop sender is required.');
          if (Object.keys(payload).length !== 1 || typeof payload.localAgentRef !== 'string'
            || !payload.localAgentRef || payload.localAgentRef !== payload.localAgentRef.trim()
            || payload.localAgentRef.length > 512 || payload.localAgentRef.includes('\0')) {
            throw new Error('A single LocalAgent reference is required.');
          }
          const resolve = registeredRuntimeBridge?.resolveDesktopAgentReference;
          if (!resolve) throw new Error('Desktop Agent reference resolution is unavailable.');
          return resolve({ localAgentRef: payload.localAgentRef });
        },
        desktop_runtime_maintenance_relaunch: () => {
          if (!runtimeMaintenance) throw new Error('desktop-runtime-not-in-maintenance');
          requestDesktopMaintenanceRelaunch();
          return { requested: true };
        },
        desktop_home_profile_status_get: () => ({
          mode: homeHostProfile?.mode ?? 'bootstrap',
          workAllowed: normalHomeWorkAllowed(),
          relaunchRequested: homeRelaunchRequested,
          startupFailure: runtimeStartupFailure,
        }),
        desktop_home_profile_retry: async () => {
          if (runtimeStartupFailure && macOSProductionService) {
            const prepared = await macOSProductionService.prepare(runtimeCommandNames);
            if (prepared === 'approval-pending') { app.quit(); return { requested: true }; }
            runtimeMaintenance = prepared === 'maintenance';
            runtimeStartupFailure = null;
            requestDesktopMaintenanceRelaunch();
            return { requested: true };
          }
          if (dataRootOperationGate.isClosed()) {
            await productControlHost.commandHandlers.product_control_check_sync_start({
              command: 'product_control_check_sync_start', payload: {},
            });
          }
          await checkDesktopHomeProfileScope(() => productControlHost.resolveHostProfileScope(), 'user-action');
          return { requested: homeRelaunchRequested || normalHomeWorkAllowed() };
        },
        ...executionNotices.commandHandlers,
        ...localDevelopmentHost.commandHandlers,
        ...installedAppHost.commandHandlers,
        ...desktopOpenIntentHost.commandHandlers,
        ...productControlCommandHandlers,
        ...chatAiStoreHost.commandHandlers,
        ...systemResourcesHost.commandHandlers,
        ...supportLogsHost.commandHandlers,
        ...dataCleanupHost.commandHandlers,
        ...connectorAuthAcquisitionHost.commandHandlers,
        ...rendererLogHost.commandHandlers,
        ...bundledAvatarHost.desktopCommandHandlers,
      },
      standardShellHost: {
        chromeHost: homeChromeHost,
        allowAllStandardShellCommands: true,
        runDataRootOperation: (operation) => dataRootOperationGate.runShared(operation),
        standardDataRootBinding: {
          source: 'product-control-projection',
          resolveDataRoot: resolveProductControlDataRoot,
        },
        localAssetRoots: resolveStandardLocalAssetRoots(),
        localAssetProtocolHost,
        openFileDialog: openDesktopStandardFileDialog,
        revealInOs: (targetPath) => shell.showItemInFolder(targetPath),
        openExternalUrl: openDesktopExternalUrl,
        confirmDialog: confirmDesktopDialog,
        focusMainWindow: focusDesktopMainWindow,
        appActivitySourceLaunch,
        agentCenterResourcePackPlacement: (payload) => (
          desktopOpenIntentHost?.requestZhiyuResourcePackPlacement({
            conversationAnchorId: payload.conversationAnchorId,
          }) ?? Promise.resolve({
            status: 'unavailable',
            reasonCode: 'operation-unavailable',
            actionHint: 'retry_zhiyu_resource_pack_placement',
          })
        ),
      },
      bundledAvatarHost: bundledAvatarHost.runtimeBridgeHost,
    });
    systemEntryAccountUnsubscribe = registeredRuntimeBridge.subscribeDesktopAccountSessionProjection?.((projection) => {
      systemEntryAdmission?.observeAccount(projection);
    });
    powerMonitor.on('lock-screen', lockDesktopSystemEntry);
    powerMonitor.on('unlock-screen', unlockDesktopSystemEntry);
    powerMonitor.on('suspend', suspendDesktopSystemEntry);
    powerMonitor.on('resume', resumeDesktopSystemEntry);
    powerMonitor.on('shutdown', handleDesktopSystemSessionEnd);

    desktopStartupSettled = true;
    if (homeRelaunchRequested) {
      app.quit();
      return;
    }

    if (AVATAR_ONLY_DEVELOPMENT_MODE) {
      const localAppHost = registeredRuntimeBridge.bundledAvatarLocalAppHost;
      if (!localAppHost) throw new Error('Avatar formal App host is unavailable.');
      await localAppHost.sessionStatus();
      const references = await localAppHost.agentReferenceList();
      const requestedHandle = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_HANDLE);
      const selected = requestedHandle
        ? references.find((reference) => reference.agentHandle === requestedHandle)
        : references.length === 1 ? references[0] : undefined;
      if (!selected) {
        throw new Error(requestedHandle
          ? 'Avatar requested Agent handle is not present in the formal App reference catalog.'
          : 'Avatar-only Electron dev requires exactly one current formal App Agent reference.');
      }
      const selectedAgentHandle = normalizeText(selected.agentHandle);
      if (!selectedAgentHandle) throw new Error('Avatar formal Agent handle is invalid.');
      const conversation = await localAppHost.conversationOpen({ agentHandle: selectedAgentHandle });
      const conversationAnchorId = normalizeText(conversation.conversationAnchorId);
      if (!conversationAnchorId) throw new Error('Avatar formal Conversation anchor is unavailable.');
      const hostTarget = await localAppHost.avatarHostTargetResolve({
        agentHandle: selectedAgentHandle,
        conversationAnchorId,
      });
      const launchResult = await bundledAvatarHost.hostHandoff({
        sourceApp: 'nimi.desktop',
        avatarHostTargetRef: normalizeText(hostTarget.avatarHostTargetRef),
        request: buildAvatarHostHandoffRequest({
          command: 'launch',
          target: {
            agentHandle: selectedAgentHandle,
            conversationAnchorId,
            avatarInstanceId: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID) || null,
            launchSource: 'official-avatar-electron-dev-launcher',
            switchIntentRef: null,
            committedPresentationRef: null,
            temporaryCustodyRef: null,
          },
        }),
      });
      if (launchResult.state !== 'present' && launchResult.state !== 'focused') {
        throw new Error('Avatar-only Electron dev launch did not create or focus an Avatar instance.');
      }
    } else {
      if (systemEntryHost.enabled) {
        try { await systemEntryHost.initialize(); }
        catch (error) { writeDesktopStderr(`[desktop-system-entry] initialize:${desktopBootstrapFailureCode(error)}\n`); }
      }
      await createMainWindow();
    }

    app.on('activate', () => {
      if (AVATAR_ONLY_DEVELOPMENT_MODE) return;
      void focusDesktopMainWindow();
    });
  } catch (error: unknown) {
    await shutdownBeforeQuit().catch(() => undefined);
    const failureCode = desktopBootstrapFailureCode(error);
    writeDesktopStderr(`[desktop-bootstrap] ${failureCode}\n`);
    if (error instanceof DesktopSourceRuntimeUnavailableError) {
      writeDesktopStderr(`[desktop-bootstrap] ${sourceRuntimeBootstrapFailureMessage(error.runtimeReasonCode)}\n`);
    }
    dialog.showErrorBox(
      'Nimi could not start safely',
      SOURCE_PER_USER_RUNTIME_D2
        ? sourceRuntimeBootstrapFailureMessage(failureCode)
        : MACOS_LOCAL_DEVELOPMENT_BUILD
          ? `Nimi Dev bootstrap failed (${failureCode}). Start it with "pnpm dev:runtime -- --desktop" and inspect the terminal output.`
          : 'The verified Desktop carrier could not be initialized. Repair the Nimi installation and try again.',
    );
    desktopFinalExit.exit(1);
  }
}

function desktopBootstrapFailureCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'desktop-bootstrap-failed';
  for (const key of ['reasonCode', 'code', 'message'] as const) {
    const value = (error as Readonly<Record<string, unknown>>)[key];
    if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,127}$/u.test(value)) return value;
  }
  return 'desktop-bootstrap-failed';
}

function configureDesktopElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
  assertMacOSElectronSecurity({
    platform: process.platform,
    commandLine: app.commandLine,
  });
}

app.on('window-all-closed', () => {
  if (quitCleanupComplete || systemSessionEnding || !desktopStartupSettled || AVATAR_ONLY_DEVELOPMENT_MODE) {
    ownerQuitRequested = true;
    app.quit();
    return;
  }
  if (!systemEntryHost?.hasRecoverableEntry()) {
    void focusDesktopMainWindow().catch((error) => writeDesktopStderr(`[desktop-system-entry] restore:${desktopBootstrapFailureCode(error)}\n`));
  }
});

app.on('before-quit', (event) => {
  if (systemSessionEnding) return;
  if (productUpdateAdapter && !productUpdateAdapter.canSafelyReopen()) {
    event.preventDefault();
    dialog.showErrorBox('Nimi could not close safely', 'The canceled update helper has not stopped yet. Nimi remains open to prevent an unintended installation. Try closing Nimi again after it stops.');
    return;
  }
  if (quitCleanupComplete) return;
  event.preventDefault();
  if (ownerQuitRequested || homeRelaunchRequested || maintenanceRelaunchRequested || !desktopStartupSettled || AVATAR_ONLY_DEVELOPMENT_MODE) {
    void prepareDesktopQuit().then(async () => {
      quitCleanupComplete = true;
      await finishDesktopHomeProfileBeforeExit();
    }).catch(recoverDesktopAfterFailedQuit);
    return;
  }
  void desktopQuitCoordinator.requestUserQuit().catch((error) => writeDesktopStderr(`[desktop-quit] ${desktopBootstrapFailureCode(error)}\n`));
});

function prepareDesktopQuit(): Promise<void> {
  if (!quitCleanup) {
    const cleanup = shutdownBeforeQuit().then(() => undefined);
    const tracked = cleanup.catch((error: unknown) => { if (quitCleanup === tracked) quitCleanup = undefined; throw error; });
    quitCleanup = tracked;
  }
  return quitCleanup;
}

async function recoverDesktopAfterFailedQuit(): Promise<void> {
  ownerQuitRequested = false;
  homeRelaunchRequested = false;
  maintenanceRelaunchRequested = false;
  systemEntryHost?.setQuitPhase('idle');
  installedAppHost?.resume();
  try { await localDevelopmentHost?.resumeAfterFailedShutdown(); }
  catch (error) { writeDesktopStderr(`[desktop-quit] supervisor-recovery:${desktopBootstrapFailureCode(error)}\n`); }
  productUpdateHost?.start();
  await focusDesktopMainWindow().catch((error) => writeDesktopStderr(`[desktop-quit] window-recovery:${desktopBootstrapFailureCode(error)}\n`));
  dialog.showErrorBox(systemEntryLocale === 'zh' ? 'Nimi Home 尚未退出' : 'Nimi Home could not close',
    systemEntryLocale === 'zh' ? '部分 App、本地 AI 服务或关键资源尚未关闭。Nimi 仍保持打开，请重试退出；已关闭的 App 不会自动重新启动。'
      : 'An App, the local AI service, or a critical resource did not close cleanly. Nimi remains available so you can retry. Apps that already closed will not restart automatically.');
}

async function confirmDesktopUserQuit(impact: { installed: readonly string[]; development: readonly string[]; avatar: Readonly<{ active: number; pending: boolean }>; observedWorkCount: number | null; workComplete: boolean }): Promise<boolean> {
  const chinese = systemEntryLocale === 'zh';
  const names = (items: readonly string[]) => items.slice(0, 6).map((name) => name.replace(/[\r\n\t]/gu, ' ').slice(0, 80)).join(', ');
  const detail = chinese
    ? [`已安装 App：${impact.installed.length}${impact.installed.length ? `（${names(impact.installed)}）` : ''}`,
      `开发 App：${impact.development.length}${impact.development.length ? `（${names(impact.development)}）` : ''}`,
      `Avatar：${impact.avatar.active}${impact.avatar.pending ? '，还有实例正在准备' : ''}`,
      impact.workComplete ? `当前 AI 工作：${impact.observedWorkCount}`
        : impact.observedWorkCount !== null ? `已记录 ${impact.observedWorkCount} 项 AI 工作；其余状态尚未完整确认。` : '当前 AI 工作状态尚未完整确认。',
      SOURCE_PER_USER_RUNTIME_D2
        ? '退出会关闭 Home 和以上 App。源码 Runtime 由开发终端管理；已提交给云端的工作不保证取消。'
        : '退出会关闭 Home、以上 App 和本地 AI 服务，并停止本地计算；正在进行的任务可能中断。已提交给云端的工作不保证取消。'].join('\n')
    : [`Installed Apps: ${impact.installed.length}${impact.installed.length ? ` (${names(impact.installed)})` : ''}`,
      `Development Apps: ${impact.development.length}${impact.development.length ? ` (${names(impact.development)})` : ''}`,
      `Avatars: ${impact.avatar.active}${impact.avatar.pending ? '; more are being prepared' : ''}`,
      impact.workComplete ? `Current AI work: ${impact.observedWorkCount}`
        : impact.observedWorkCount !== null ? `${impact.observedWorkCount} AI work items observed; other activity is not fully confirmed.` : 'Current AI activity is not fully confirmed.',
      SOURCE_PER_USER_RUNTIME_D2
        ? 'Quitting closes Home and these Apps. The source Runtime is managed by its development terminal; work already submitted to cloud services may continue.'
        : 'Quitting closes Home, these Apps, and the local AI service, and stops local computation. Active tasks may be interrupted. Work already submitted to cloud services may continue.'].join('\n');
  const options: MessageBoxOptions = { type: 'question', title: chinese ? '退出 Nimi？' : 'Quit Nimi?',
    message: SOURCE_PER_USER_RUNTIME_D2
      ? (chinese ? '退出会关闭 Home 和托管 App。' : 'Quitting will close Home and its supervised Apps.')
      : (chinese ? '退出会关闭 Nimi 及其本地 AI 服务。' : 'Quitting will close Nimi and its local AI service.'), detail,
    buttons: chinese ? ['取消', '退出 Nimi'] : ['Cancel', 'Quit Nimi'], defaultId: 0, cancelId: 0, noLink: true };
  // A sheet on a hidden window is inaccessible; a standalone macOS dialog
  // can merely bounce the Dock icon while the app is inactive. Explicit quit
  // must restore the owner window before asking the user to confirm.
  if (systemSessionEnding) return false;
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  // Keep native quit independent of a crashed/unresponsive renderer: do not
  // await Home creation or loadURL just to make the confirmation actionable.
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.moveTop();
    window.focus();
  }
  if (process.platform === 'darwin') app.focus({ steal: true });
  const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

function assertSystemEntryHomeRequest(payload: Readonly<Record<string, unknown>>, event: NimiElectronIpcMainInvokeEvent, hasPayload: boolean): void {
  if (!authorizeDesktopRendererSender(event) || Object.keys(payload).sort().join('|') !== (hasPayload ? 'payload' : '')) {
    throw new Error('system-entry-home-request-rejected');
  }
}

async function dispatchDesktopSystemEntryAction(action: SystemEntryAction, context: SystemEntryActionContext): Promise<void> {
  const admission = await systemEntryAdmission?.read().catch(() => null);
  if (!admission || admission.state !== 'ready') {
    if (action.kind === 'home' || action.kind === 'support' || action.kind === 'refresh') {
      await focusDesktopMainWindow();
      return;
    }
    throw new Error('system-entry-admission-required');
  }
  if (context.generation !== admission.generation) {
    await focusDesktopMainWindow();
    throw new Error('system-entry-view-stale');
  }
  if (!mainWindow || mainWindow.isDestroyed() || mainRendererUnavailable || !systemEntryRendererReady) {
    await focusDesktopMainWindow();
    throw new Error('system-entry-view-stale');
  }
  // macOS panels do not activate their owning application. Cooperative
  // activation can only be yielded by the active owner; activate Home's
  // application for this explicit action without showing its hidden window.
  if (process.platform === 'darwin' && action.kind === 'focus-app') app.focus({ steal: true });
  if (!['focus-app', 'open-activity', 'pause-notifications', 'resume-notifications', 'refresh'].includes(action.kind)) {
    await focusDesktopMainWindow();
  }
  if (!systemEntryActionRelay) throw new Error('system-entry-action-unavailable');
  await systemEntryActionRelay.dispatch(action, context);
}

function emitDesktopSystemEntryAction(request: SystemEntryActionDispatch): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || window.webContents.isDestroyed() || mainRendererUnavailable || !systemEntryRendererReady) throw new Error('system-entry-renderer-unavailable');
  window.webContents.send(`${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${SYSTEM_ENTRY_ACTION_EVENT}`, request);
}

function publishDesktopHomeVisibility(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const homeVisible = Boolean(window && window.isVisible() && !window.isMinimized());
  systemEntryHost?.setHomeVisibility(homeVisible);
  const admission = systemEntryAdmission?.snapshot();
  if (window && !window.webContents.isDestroyed() && admission) {
    window.webContents.send(`${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${SYSTEM_ENTRY_VISIBILITY_EVENT}`, { generation: admission.generation, homeVisible });
  }
}

function lockDesktopSystemEntry(): void { systemEntryAdmission?.setLocked(true); }
function unlockDesktopSystemEntry(): void { systemEntryAdmission?.setLocked(false); }
function suspendDesktopSystemEntry(): void { systemEntryAdmission?.invalidate(); }
function resumeDesktopSystemEntry(): void { systemEntryAdmission?.invalidate(); publishDesktopHomeVisibility(); }

function handleDesktopSystemSessionEnd(): void {
  if (systemSessionEnding) return;
  systemSessionEnding = true;
  desktopQuitCoordinator.beginSystemEnd();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The OS owns process termination. Best-effort cleanup is bounded and
  // never invokes ordinary confirmation or a Home relaunch. Runtime stop is
  // attempted within the same bound; system shutdown retains final OS control.
  void Promise.race([
    prepareDesktopQuit().catch((error) => writeDesktopStderr(`[desktop-session-end] ${desktopBootstrapFailureCode(error)}\n`)),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, 2_000); }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    desktopFinalExit.exit(0);
  });
}

// Relaunch only after supervised Apps stopped. The original temporary
// environment is restored first so the next Home never nests its bootstrap
// slot inside this profile; it re-reads Product Control itself.
async function finishDesktopHomeProfileBeforeExit(): Promise<void> {
  if (homeHostProfile?.mode === 'bootstrap') {
    await Promise.race([
      releaseDesktopHomeBootstrapSlot(homeHostProfile.profileRoot),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  if (maintenanceRelaunchRequested) {
    // A fresh Home reads the committed root from Runtime like any other start,
    // so this relaunch carries no Home-profile relaunch marker.
    homeTemporaryEnvironment?.restore();
    if (SOURCE_PER_USER_RUNTIME_D2) {
      desktopFinalExit.exit(HOME_PROFILE_RELAUNCH_EXIT_CODE);
      return;
    }
    app.relaunch({
      args: process.argv.slice(1).filter((argument) => argument !== HOME_PROFILE_RELAUNCH_ARGUMENT),
    });
    app.quit();
    return;
  }
  if (!homeRelaunchRequested) {
    app.quit();
    return;
  }
  homeTemporaryEnvironment?.restore();
  if (SOURCE_PER_USER_RUNTIME_D2) {
    // The source dev launcher owns the renderer and restarts this host.
    desktopFinalExit.exit(HOME_PROFILE_RELAUNCH_EXIT_CODE);
    return;
  }
  app.relaunch({
    args: [
      ...process.argv.slice(1).filter((argument) => argument !== HOME_PROFILE_RELAUNCH_ARGUMENT),
      HOME_PROFILE_RELAUNCH_ARGUMENT,
    ],
  });
  app.quit();
}

function assertProductUpdateRequest(payload: Readonly<Record<string, unknown>>, event: NimiElectronIpcMainInvokeEvent): void {
  if (!authorizeDesktopRendererSender(event) || Object.keys(payload).length !== 0 || !productUpdateHost) {
    throw new Error('desktop-product-update-request-rejected');
  }
}

async function shutdownBeforeQuit(forUpdate = false): Promise<DesktopShutdownReport> {
  const localHost = localDevelopmentHost;
  const installedHost = installedAppHost;
  const openIntentHost = desktopOpenIntentHost;
  const avatarHost = bundledAvatarHost;
  const chatStoreHost = chatAiStoreHost;
  const currentSystemEntryHost = systemEntryHost;
  currentSystemEntryHost?.setQuitPhase('stopping');
  const connectorAuthHost = connectorAuthAcquisitionHost;
  const runtimeBridge = registeredRuntimeBridge;
  const ordinaryDiagnostics: Array<{ operation: string; reason: string }> = [];
  const stopAvatar = async (): Promise<void> => {
    if (!avatarHost) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (forUpdate) await avatarHost.shutdown();
      else await Promise.race([
        avatarHost.shutdown(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('avatar-resource-cleanup-timeout')), 25_000); }),
      ]);
    } catch (error) {
      if (forUpdate || avatarHost.hasUnclosedProcesses()) throw error;
      // Native processes are already confirmed closed. Ordinary exit may
      // retain a resource-release diagnostic; update installation may not.
      ordinaryDiagnostics.push({ operation: 'avatar-resources', reason: desktopBootstrapFailureCode(error) });
    } finally { if (timer) clearTimeout(timer); }
  };
  const steps = [
    { operation: 'product-update-download', critical: true, abortRemainingOnFailure: false, timeoutMs: 30_000, run: () => productUpdateHost?.stop() },
    { operation: 'local-app-host', critical: true, timeoutMs: 30_000, run: () => localHost?.shutdown() },
    { operation: 'installed-app-host', critical: true, timeoutMs: 30_000, run: () => installedHost?.shutdown(
      forUpdate || homeRelaunchRequested || maintenanceRelaunchRequested ? 'required' : 'quit-after-process-exit',
    ) },
    { operation: 'formal-app-resources', critical: true, abortRemainingOnFailure: false, timeoutMs: DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS, run: () => runtimeBridge?.disposeFormalAppResources?.() },
    { operation: 'avatar-host', critical: true, timeoutMs: 30_000, run: stopAvatar },
    { operation: 'chat-store', critical: true, abortRemainingOnFailure: false, timeoutMs: 30_000, run: () => chatStoreHost?.close() },
    { operation: 'system-entry-observation', critical: false, timeoutMs: 5_000, run: () => {
      systemEntryAccountUnsubscribe?.(); systemEntryAccountUnsubscribe = undefined;
      systemEntryAdmission?.invalidate(); systemEntryActionRelay?.invalidate();
      systemEntryRendererReady = false;
      powerMonitor.removeListener('lock-screen', lockDesktopSystemEntry);
      powerMonitor.removeListener('unlock-screen', unlockDesktopSystemEntry);
      powerMonitor.removeListener('suspend', suspendDesktopSystemEntry);
      powerMonitor.removeListener('resume', resumeDesktopSystemEntry);
      powerMonitor.removeListener('shutdown', handleDesktopSystemSessionEnd);
    } },
    { operation: 'open-intent', critical: false, timeoutMs: 5_000, run: () => openIntentHost?.shutdown() },
    { operation: 'connector-auth', critical: false, timeoutMs: 5_000, run: () => connectorAuthHost?.shutdown() },
    { operation: 'system-entry', critical: false, timeoutMs: 5_000, run: () => currentSystemEntryHost?.dispose() },
  ];
  const result = await runDesktopProductShutdown({
    steps, forUpdate,
    stopRuntime: homeRelaunchRequested || maintenanceRelaunchRequested ? undefined : stopProductRuntime,
  });
  const report: DesktopShutdownReport = { ...result, diagnostics: [...result.diagnostics, ...ordinaryDiagnostics] };
  for (const failure of [...report.criticalFailures, ...report.diagnostics]) {
    writeDesktopStderr(`[desktop-shutdown] ${failure.operation}:${failure.reason}\n`);
  }
  if (forUpdate) return report;
  // Product exit requires complete critical cleanup and verified Runtime stop.
  // Keep the bridge and system entry on failure so the same quit can be retried.
  // Updates consume their separate critical report before installer handoff.
  if (!report.criticalCleanupComplete) {
    throw new DesktopShutdownBlockedError(report);
  }
  if (localDevelopmentHost === localHost) localDevelopmentHost = undefined;
  if (installedAppHost === installedHost) installedAppHost = undefined;
  if (desktopOpenIntentHost === openIntentHost) desktopOpenIntentHost = undefined;
  if (bundledAvatarHost === avatarHost) bundledAvatarHost = undefined;
  if (chatAiStoreHost === chatStoreHost) chatAiStoreHost = undefined;
  if (systemEntryHost === currentSystemEntryHost) systemEntryHost = undefined;
  if (connectorAuthAcquisitionHost === connectorAuthHost) connectorAuthAcquisitionHost = undefined;
  return report;
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-002
async function createMainWindow(): Promise<BrowserWindow> {
  if (mainWindowCreation) return mainWindowCreation;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const creating = buildMainWindow();
  mainWindowCreation = creating;
  try { return await creating; }
  finally { if (mainWindowCreation === creating) mainWindowCreation = undefined; }
}

async function buildMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    width: 1440,
    height: 940,
    minWidth: 390,
    minHeight: 600,
    title: 'Nimi Home',
    icon: createDesktopIcon(),
    // Apply the native icon before Explorer sees the window.
    show: process.platform !== 'win32',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The mounted Desktop Open listener must keep its readiness heartbeat
      // while Home is hidden/minimized, so another App can wake it once.
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  homeChromeHost?.bindWindow(window);
  if (process.platform === 'win32' && !ELECTRON_DEVELOPMENT_BUILD) {
    window.setAppDetails({
      appId: APP_ID,
      // Keep the installed taskbar icon, name and relaunch target together.
      appIconPath: process.execPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"`,
      relaunchDisplayName: app.getName(),
    });
  }
  window.on('close', (event) => {
    if (quitCleanupComplete || systemSessionEnding) return;
    event.preventDefault();
    if (systemEntryHost?.hideHomeWindowOnClose()) return;
    if (desktopQuitCoordinator.isLaunchBlocked() || entryUnavailableNoticeOpen) return;
    entryUnavailableNoticeOpen = true;
    const chinese = systemEntryLocale === 'zh';
    void dialog.showMessageBox(window, { type: 'info',
      title: chinese ? 'Home 将保持打开' : 'Home will stay open',
      message: chinese ? '系统入口暂不可用，关闭窗口后将无法从该入口恢复。' : 'The system entry is unavailable, so Home cannot be safely hidden.',
      detail: chinese ? '可以继续使用 Home，或明确退出并关闭其托管的 App。' : 'You can continue using Home, or explicitly quit and close its supervised Apps.',
      buttons: chinese ? ['继续使用', '退出 Home'] : ['Keep open', 'Quit Home'], defaultId: 0, cancelId: 0,
    }).then((result) => { if (result.response === 1) return desktopQuitCoordinator.requestUserQuit(); return false; })
      .catch((error) => writeDesktopStderr(`[desktop-close] ${desktopBootstrapFailureCode(error)}\n`))
      .finally(() => { entryUnavailableNoticeOpen = false; });
  });
  window.on('show', publishDesktopHomeVisibility);
  window.on('hide', publishDesktopHomeVisibility);
  window.on('minimize', publishDesktopHomeVisibility);
  window.on('restore', publishDesktopHomeVisibility);
  window.on('session-end', handleDesktopSystemSessionEnd);
  window.on('unresponsive', () => {
    mainRendererUnavailable = true; mainRendererUnresponsive = true;
    systemEntryAdmission?.invalidate();
  });
  window.on('responsive', () => { mainRendererUnresponsive = false; mainRendererUnavailable = false; });
  window.webContents.on('render-process-gone', () => {
    mainRendererUnavailable = true; systemEntryRendererReady = false;
    systemEntryAdmission?.invalidate();
  });
  window.webContents.on('did-finish-load', () => {
    mainRendererUnavailable = false; mainRendererUnresponsive = false;
    publishDesktopHomeVisibility();
  });
  const invalidateDesktopSender = () => {
    systemEntryRendererReady = false;
    systemEntryAdmission?.invalidate();
    homeChromeHost?.invalidateAll();
    executionNotices.disableNotifications();
    for (const listener of desktopSenderInvalidationListeners) listener();
  };
  bindDesktopSenderInvalidation(window.webContents, invalidateDesktopSender);
  window.on('closed', () => {
    invalidateDesktopSender();
    if (mainWindow === window) {
      mainWindow = undefined;
    }
    publishDesktopHomeVisibility();
  });
  secureDesktopWindow(window);
  if (process.platform === 'win32') window.show();
  await window.loadURL(rendererUrl || appOriginProtocol.rendererUrl('desktop'));
  return window;
}

async function openDesktopStandardFileDialog(
  payload: NimiElectronFileDialogOpenPayload,
): Promise<NimiElectronFileDialogOpenResult> {
  const properties: Electron.OpenDialogOptions['properties'] = [
    payload.kind === 'directory' ? 'openDirectory' : 'openFile',
  ];
  if (payload.multiple) properties.push('multiSelections');
  const options: Electron.OpenDialogOptions = {
    title: payload.title,
    properties,
    filters: payload.filters?.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return {
    canceled: result.canceled,
    paths: result.filePaths,
  };
}

function secureDesktopWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isDesktopRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(desktopRendererOrigin(url));
  }
  const configured = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_ORIGINS)
    : '';
  for (const origin of configured.split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || appOriginProtocol.rendererUrl('desktop')]);
  const configured = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_RENDERER_URLS)
    : '';
  for (const url of configured.split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function isDesktopRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function resolveStandardLocalAssetRoots(): string[] {
  const fromEnv = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS)
    : '';
  if (!fromEnv) {
    return [path.resolve(app.getPath('downloads'))];
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function createDesktopProductControlDataRootResolver(
  resolveSelectedDataRoot: () => Promise<string>,
): () => Promise<string> {
  return async () => {
    try {
      const dataRoot = await resolveSelectedDataRoot();
      if (!path.isAbsolute(dataRoot)) {
        throw new NimiElectronShellHostError({
          code: 'host-internal-error',
          message: 'Desktop canonical Product Control data root is not absolute',
          reasonCode: 'electron-product-control-data-root-invalid',
          actionHint: 'repair_canonical_product_control_data_root',
          details: { valueType: typeof dataRoot },
        });
      }
      return dataRoot;
    } catch (error) {
      if (error instanceof NimiElectronShellHostError) {
        throw error;
      }
      throw new NimiElectronShellHostError({
        code: 'capability-unavailable',
        message: 'Desktop canonical Product Control data root is unavailable',
        reasonCode: 'electron-product-control-data-root-unavailable',
        actionHint: 'complete_or_repair_canonical_product_control',
        details: {
          cause: error instanceof Error ? error.message : String(error ?? ''),
        },
      });
    }
  };
}

async function openDesktopExternalUrl(url: string): Promise<void> {
  await shell.openExternal(url);
}

function authorizeDesktopRendererSender(event: NimiElectronIpcMainInvokeEvent): boolean {
  const window = mainWindow;
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame);
}

async function confirmDesktopDialog(payload: {
  readonly title: string;
  readonly description: string;
  readonly level?: string;
}): Promise<{ readonly confirmed: boolean }> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const options: MessageBoxOptions = {
    type: payload.level === 'error' ? 'error' : payload.level === 'warning' ? 'warning' : 'info',
    buttons: ['Cancel', 'OK'],
    cancelId: 0,
    defaultId: 1,
    title: payload.title,
    message: payload.title,
    detail: payload.description,
  };
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return { confirmed: result.response === 1 };
}

// @nimi-authority: rule.nimi.desktop.bridge-ipc.r014
async function focusDesktopMainWindow(): Promise<void> {
  if (!desktopStartupSettled || AVATAR_ONLY_DEVELOPMENT_MODE || quitCleanupComplete || systemSessionEnding) return;
  let window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (window?.webContents.isDestroyed()) {
    window.destroy();
    window = undefined;
  }
  if (!window) window = await createMainWindow();
  if (mainWindowRecovery) await mainWindowRecovery;
  else if (mainRendererUnavailable) {
    const recoveringWindow = window;
    const recovering = (async () => {
      systemEntryRendererReady = false;
      systemEntryAdmission?.invalidate();
      if (mainRendererUnresponsive) recoveringWindow.webContents.forcefullyCrashRenderer();
      await recoveringWindow.loadURL(rendererUrl || appOriginProtocol.rendererUrl('desktop'));
      mainRendererUnavailable = false;
      mainRendererUnresponsive = false;
    })();
    mainWindowRecovery = recovering;
    try { await recovering; }
    finally { if (mainWindowRecovery === recovering) mainWindowRecovery = undefined; }
  }
  if (window.isMinimized()) {
    window.restore();
  }
  // A browser callback can arrive while Windows still keeps the browser in front.
  // Keep the raise across a native event-loop turn before restoring normal stacking.
  const raiseTemporarily = process.platform === 'win32' && !window.isAlwaysOnTop();
  try {
    if (raiseTemporarily) window.setAlwaysOnTop(true);
    window.show();
    window.moveTop();
    window.focus();
    if (raiseTemporarily) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    if (raiseTemporarily && !window.isDestroyed()) {
      window.setAlwaysOnTop(false);
      window.moveTop();
      window.focus();
    }
  }
  publishDesktopHomeVisibility();
}

function hideDesktopMainWindow(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  window?.hide();
}

function emitDesktopOpenIntent(envelope: NimiDesktopOpenIntentEnvelope): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || window.webContents.isDestroyed()) {
    throw new Error('desktop-open-desktop-not-ready');
  }
  window.webContents.send(
    `${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${DESKTOP_OPEN_INTENT_EVENT}`,
    envelope,
  );
}

function desktopIconPath(): string {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'nimi-home-symbol.ico')
      : path.join(appRoot, 'assets', 'nimi-home-symbol.ico');
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, 'favicon-32x32.png')
    : path.join(appRoot, 'src', 'shell', 'renderer', 'assets', 'favicon-32x32.png');
}

function createDesktopIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(desktopIconPath());
  if (icon.isEmpty()) {
    throw new Error('desktop-icon-unavailable');
  }
  return icon;
}

function createDesktopMenuBarIcon(): Electron.NativeImage {
  return createDesktopIcon().resize({ width: 18, height: 18 });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
