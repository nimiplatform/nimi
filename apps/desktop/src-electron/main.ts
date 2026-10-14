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
import { DesktopShutdownBlockedError, runDesktopShutdownSteps, type DesktopShutdownReport } from './product-update-shutdown.js';
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
import {
  createDesktopElectronMenuBarHost,
  type DesktopElectronMenuBarHost,
  type MenuBarRuntimeStatus,
} from './menu-bar-host.js';
import {
  createDesktopAppOriginProtocol,
  desktopRendererOrigin,
  NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES,
  NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
} from './app-origin-protocol.js';
import {
  MENU_BAR_OPEN_TAB_EVENT,
  type MenuBarOpenTabPayload,
} from '../src/shell/shared/menu-bar-types.js';

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
const desktopSenderInvalidationListeners = new Set<() => void>();
const systemNotices = new Set<Notification>();
const executionNotices = createDesktopExecutionNoticesHost({
  supported: () => Notification.isSupported(),
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
let menuBarHost: DesktopElectronMenuBarHost | undefined;
let connectorAuthAcquisitionHost: DesktopElectronConnectorAuthAcquisitionHost | undefined;
let registeredRuntimeBridge: RegisteredNimiElectronRuntimeBridge | undefined;
let homeChromeHost: NimiElectronAppChromeHost | undefined;
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;
let productUpdateHost: DesktopProductUpdateHost | undefined;
let productUpdateAdapter: MacOSProductUpdateAdapter | WindowsProductUpdateAdapter | undefined;
let reconcileProductActivation: (() => Promise<void>) | undefined;
let productUpdateHomeReady = false;
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

app.setName(MACOS_LOCAL_DEVELOPMENT_BUILD ? 'Nimi Dev' : 'Nimi');
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}
if (SOURCE_PER_USER_RUNTIME_D2) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => app.quit());
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
  app.exit(1);
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
    ]));
    const dataRootOperationGate = createDesktopDataRootOperationGate();
    homeDataRootOperationGate = dataRootOperationGate;
    const appLaunchGate = desktopAppLaunchGate(dataRootOperationGate);
    localDevelopmentHost = await createDesktopElectronLocalDevelopmentHost({
      homeDirectory: app.getPath('home'),
      operationGate: appLaunchGate,
      onExecutorChanged: executionNotices.observe,
    });
    installedAppHost = createDesktopInstalledAppHost(undefined, appLaunchGate, executionNotices.observe);
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
            detail: 'Open System Settings → Login Items & Extensions and allow Nimi. A Mac administrator must approve this once. Nimi will close while approval is pending. After allowing Nimi, open it again; daily use requires no administrator privileges.',
            buttons: ['Open System Settings', 'Later'],
            defaultId: 0,
            cancelId: 1,
          })).response === 0,
        })
      : undefined;
    if (macOSProductionService && unregisterProductionService) {
      await macOSProductionService.unregister();
      app.exit(0);
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
    const updateHealthControl = createNimiElectronDesktopControlHost();
    let activationInFlight: Promise<void> | undefined;
    reconcileProductActivation = () => {
      activationInFlight ??= (async () => {
        const result = await productUpdateAdapter?.reconcile(async () => {
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
        });
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
    ): Promise<MenuBarRuntimeStatus> => (
      await runtimeLifecycleHost.invoke(command, runtimeCommandNames)
    ) as MenuBarRuntimeStatus;
    if (!SOURCE_PER_USER_RUNTIME_D2 && !macOSProductionService) {
      runtimeMaintenance = await readDesktopRuntimeMaintenance(
        () => invokeRuntimeLifecycle(runtimeCommandNames.status),
      );
    }
    const productControlHost = createDesktopElectronProductControlHost({
      operationGate: dataRootOperationGate,
      runtimeLifecycleProfile,
      restartRuntime: () => invokeRuntimeLifecycle(runtimeCommandNames.restart),
      quiesceHostDataRoot: async () => {
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
    const restartRuntimeFromMenu = async (): Promise<MenuBarRuntimeStatus> => {
      const status = await dataRootOperationGate.runRecovery(() => invokeRuntimeLifecycle(runtimeCommandNames.restart));
      if (dataRootOperationGate.isClosed()) {
        await productControlHost.recoverDataRootHandoff();
      }
      return status;
    };
    menuBarHost = createDesktopElectronMenuBarHost({
      electron: { Menu, Tray },
      icon: process.platform === 'darwin' ? createDesktopMenuBarIcon() : '',
      runtimeLifecycleProfile,
      lifecycle: {
        status: () => invokeRuntimeLifecycle(runtimeCommandNames.status),
        start: () => invokeRuntimeLifecycle(runtimeCommandNames.start),
        restart: restartRuntimeFromMenu,
      },
      focusMainWindow: focusDesktopMainWindow,
      hideMainWindow: hideDesktopMainWindow,
      emitRendererEvent: emitDesktopMenuBarEvent,
      quit: () => app.quit(),
      reportError: (operation, error) => {
        writeDesktopStderr(
          `[desktop-menu-bar] ${normalizeText(operation) || 'operation'}:${desktopBootstrapFailureCode(error)}\n`,
        );
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
        const resolvedTarget = await localAppHost.avatarHostTargetResolve({
          agentHandle,
          conversationAnchorId,
        });
        if (normalizeText(resolvedTarget.avatarHostTargetRef) !== avatarHostTargetRef) {
          throw new Error('Avatar materialization target no longer matches the hosted LocalAgent.');
        }
        const snapshot = await localAppHost.agentPresentationSnapshot({ agentHandle });
        const profileValue = snapshot.profile;
        if (!profileValue || typeof profileValue !== 'object' || Array.isArray(profileValue)) {
          throw new Error('Avatar formal presentation snapshot is unavailable.');
        }
        const profile = profileValue as Readonly<Record<string, unknown>>;
        if (normalizeText(snapshot.presentationRevision) !== presentationRevision
          || normalizeText(profile.revision) !== presentationRevision
          || normalizeText(profile.avatarAssetRef) !== avatarAssetRef
          || normalizeText(profile.backendKind) !== backendKind) {
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
        // @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-009
        nimi_product_update_status: async ({ payload, event }) => {
          assertProductUpdateRequest(payload, event);
          if (productUpdateHost?.status().phase !== 'failed' && await productUpdateAdapter?.hasPending()) await reconcileProductActivation?.();
          return productUpdateHost?.status();
        },
        nimi_product_update_install: ({ payload, event }) => {
          if (!authorizeDesktopRendererSender(event) || Object.keys(payload).sort().join(',') !== 'consentApproved,releaseId'
            || payload.consentApproved !== true || typeof payload.releaseId !== 'string' || !productUpdateHost) throw new Error('desktop-product-update-request-rejected');
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
        ...menuBarHost.commandHandlers,
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
      if (menuBarHost.enabled) {
        await menuBarHost.initialize();
      }
      await createMainWindow();
    }

    app.on('activate', () => {
      if (AVATAR_ONLY_DEVELOPMENT_MODE) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
        return;
      }
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
    app.exit(1);
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
  app.quit();
});

app.on('before-quit', (event) => {
  if (productUpdateAdapter && !productUpdateAdapter.canSafelyReopen()) {
    event.preventDefault();
    dialog.showErrorBox('Nimi could not close safely', 'The canceled update helper has not stopped yet. Nimi remains open to prevent an unintended installation. Try closing Nimi again after it stops.');
    return;
  }
  if (quitCleanupComplete) return;
  event.preventDefault();
  quitCleanup ??= shutdownBeforeQuit()
    .then(async () => {
      quitCleanupComplete = true;
      await finishDesktopHomeProfileBeforeExit();
    })
    .catch(() => {
      quitCleanup = undefined;
      productUpdateHost?.start();
      // Home keeps its current profile; a later ordinary quit must not turn
      // into this relaunch, and a later check may request it again.
      homeRelaunchRequested = false;
      dialog.showErrorBox(
        'Nimi could not close safely',
        'A supervised App or critical resource did not close cleanly. Nimi remains open so you can retry. An update cannot install until these resources close safely.',
      );
    });
});

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
      app.exit(HOME_PROFILE_RELAUNCH_EXIT_CODE);
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
    app.exit(HOME_PROFILE_RELAUNCH_EXIT_CODE);
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
  const currentMenuBarHost = menuBarHost;
  const connectorAuthHost = connectorAuthAcquisitionHost;
  const runtimeBridge = registeredRuntimeBridge;
  const steps = [
    { operation: 'product-update-download', critical: true, abortRemainingOnFailure: false, timeoutMs: 30_000, run: () => productUpdateHost?.stop() },
    { operation: 'local-app-host', critical: true, timeoutMs: 30_000, run: () => localHost?.shutdown() },
    { operation: 'installed-app-host', critical: true, timeoutMs: 30_000, run: () => installedHost?.shutdown() },
    { operation: 'formal-app-resources', critical: true, abortRemainingOnFailure: false, timeoutMs: DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS, run: () => runtimeBridge?.disposeFormalAppResources?.() },
    { operation: 'avatar-host', critical: true, abortRemainingOnFailure: false, timeoutMs: 30_000, run: () => avatarHost?.shutdown() },
    { operation: 'chat-store', critical: true, abortRemainingOnFailure: false, timeoutMs: 30_000, run: () => chatStoreHost?.close() },
    { operation: 'open-intent', critical: false, timeoutMs: 5_000, run: () => openIntentHost?.shutdown() },
    { operation: 'connector-auth', critical: false, timeoutMs: 5_000, run: () => connectorAuthHost?.shutdown() },
    { operation: 'runtime-bridge', critical: false, timeoutMs: 5_000, run: () => runtimeBridge?.unregister() },
    { operation: 'menu-bar', critical: false, timeoutMs: 5_000, run: () => currentMenuBarHost?.dispose() },
  ];
  const report = await runDesktopShutdownSteps(forUpdate ? steps.filter((step) => step.critical) : steps);
  for (const failure of [...report.criticalFailures, ...report.diagnostics]) {
    writeDesktopStderr(`[desktop-shutdown] ${failure.operation}:${failure.reason}\n`);
  }
  if (forUpdate) return report;
  // Ordinary quit may finish with formal-resource diagnostics, as before.
  // CP-U2 installation must inspect criticalCleanupComplete independently of
  // this promise resolving or the process exiting. App stop failures still
  // retain their bridge and block ordinary quit to avoid orphan processes.
  if (report.criticalFailures.some((failure) => ['local-app-host', 'installed-app-host'].includes(failure.operation))) {
    throw new DesktopShutdownBlockedError(report);
  }
  if (localDevelopmentHost === localHost) localDevelopmentHost = undefined;
  if (installedAppHost === installedHost) installedAppHost = undefined;
  if (desktopOpenIntentHost === openIntentHost) desktopOpenIntentHost = undefined;
  if (bundledAvatarHost === avatarHost) bundledAvatarHost = undefined;
  if (chatAiStoreHost === chatStoreHost) chatAiStoreHost = undefined;
  if (menuBarHost === currentMenuBarHost) menuBarHost = undefined;
  if (connectorAuthAcquisitionHost === connectorAuthHost) connectorAuthAcquisitionHost = undefined;
  if (registeredRuntimeBridge === runtimeBridge) registeredRuntimeBridge = undefined;
  return report;
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-002
async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    width: 1440,
    height: 940,
    minWidth: 390,
    minHeight: 600,
    title: 'Nimi Home',
    icon: createDesktopIcon(),
    // Register Windows taskbar identity and icon before Explorer sees the window.
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
  if (process.platform === 'win32') {
    window.setAppDetails({
      appId: APP_ID,
      appIconPath: desktopIconPath(),
    });
  }
  window.on('close', (event) => {
    if (!quitCleanupComplete && menuBarHost?.hideMainWindowOnClose()) {
      event.preventDefault();
      return;
    }
    if (!quitCleanupComplete) {
      if (bundledAvatarHost?.hasActiveInstances()) {
        event.preventDefault();
        window.hide();
        return;
      }
      event.preventDefault();
      app.quit();
    }
  });
  window.on('show', () => menuBarHost?.setWindowVisible(true));
  window.on('hide', () => menuBarHost?.setWindowVisible(false));
  const invalidateDesktopSender = () => {
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
    menuBarHost?.setWindowVisible(false);
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
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window) {
    return;
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
  menuBarHost?.setWindowVisible(true);
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

function emitDesktopMenuBarEvent(
  eventName: typeof MENU_BAR_OPEN_TAB_EVENT,
  payload: MenuBarOpenTabPayload,
): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || window.webContents.isDestroyed()) {
    throw new Error('desktop-menu-bar-renderer-not-ready');
  }
  window.webContents.send(
    `${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${eventName}`,
    payload,
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
