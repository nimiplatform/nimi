// Web bridge adapter — uses kit for shared functions, desktop types via alias
// for type compatibility with the desktop App that web still renders.
//
// Residual desktop type coupling tracked as F-011. Full decoupling requires
// a web-specific app shell that does not render desktop App.

import {
  hasShellHostInvoke,
  getDaemonStatus,
  startDaemon,
  restartDaemon,
  openExternalUrl,
  focusMainWindow,
  oauthListenForCode,
  oauthTokenExchange,
} from '@nimiplatform/kit/shell/renderer/bridge';

// Desktop public boundary — types and functions imported via the admitted
// public-for-web surface instead of reaching into desktop bridge internals.
import {
  logRendererEvent,
  toRendererLogMessage,
  proxyHttp,
  getSystemResourceSnapshot,
  startWindowDrag,
} from '@desktop-public/bridge';
import type {
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  DesktopStorageDirs,
  SystemResourceSnapshot,
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
  LogsExportResult,
  NimiProductControlState,
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
  DesktopAccountSessionSubscriptionHandlers,
} from '@desktop-public/bridge';

export type {
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  DesktopStorageDirs,
  SystemResourceSnapshot,
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
  LogsExportResult,
  NimiProductControlState,
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
  DesktopAccountSessionSubscriptionHandlers,
};

export { logRendererEvent, toRendererLogMessage };

function unsupportedDesktopRuntime(message: string): never {
  throw new Error(message);
}

function normalizeHttpOrigin(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveWebRuntimeOrigin(): string {
  const locationOrigin = normalizeHttpOrigin(String(globalThis.location?.origin || ''));
  if (locationOrigin) {
    return locationOrigin;
  }
  return 'http://localhost';
}

function resolveWebRuntimeUrl(origin: string, pathname: string): string {
  return new URL(pathname, `${origin}/`).toString();
}

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  const realmBaseUrl = resolveWebRuntimeOrigin();
  return {
    realm: {
      realmBaseUrl,
      realtimeUrl: '',
      jwksUrl: resolveWebRuntimeUrl(realmBaseUrl, '/api/auth/jwks'),
      revocationUrl: resolveWebRuntimeUrl(realmBaseUrl, '/api/auth/sessions/introspect'),
      jwtIssuer: realmBaseUrl,
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      targetType: '',
      targetAccountId: '',
      agentId: '',
      worldId: '',
      userConfirmedUpload: false,
    },
  };
}

export async function getRuntimeAccountSessionStatus(): Promise<DesktopAccountSessionStatus> {
  unsupportedDesktopRuntime('Runtime account projection is only available in desktop runtime');
}

export async function subscribeRuntimeAccountSessionEvents(
  _afterSequence: string,
  _handlers: DesktopAccountSessionSubscriptionHandlers,
): Promise<() => void> {
  unsupportedDesktopRuntime('Runtime account event stream is only available in desktop runtime');
}

export async function getDesktopStorageDirs(): Promise<DesktopStorageDirs> {
  unsupportedDesktopRuntime('Desktop storage directories are only available in desktop runtime');
}

// The `nimi_data` directory cleanup surface (P-MIG-006/008) is a desktop
// host-only capability: it plans and executes filesystem cleanup through
// the governed owner matrix. The web shell has no nimi_data root, so cleanup
// fails closed rather than synthesizing a fake outcome.
export async function planNimiDataCleanup(_directory: string): Promise<NimiDataCleanupPlan> {
  throw new Error('nimi_data cleanup is only available in desktop runtime');
}

export async function executeNimiDataCleanup(
  _directory: string,
  _confirmation?: string,
): Promise<NimiDataCleanupOutcome> {
  throw new Error('nimi_data cleanup is only available in desktop runtime');
}

// The Support `logs` export (`rule.nimi.desktop.product-surfaces.r027`) bundles the on-disk `<nimi_data>/logs/`
// directory into a user-locatable archive — a desktop host-only capability.
// The web shell has no nimi_data root, so the export fails closed rather than
// synthesizing a fake artifact.
export async function exportDesktopLogs(): Promise<LogsExportResult> {
  unsupportedDesktopRuntime('Log export is only available in desktop runtime');
}

// The product-control record (`P-COLD-001`/`P-COLD-015/016`) is the durable
// first-run / cold-start authority projection rooted in the desktop-local
// `~/.nimi` control directory and admitted by the Desktop host. The web shell
// has no `~/.nimi` control root, so every
// product-control read and mutation fails closed rather than synthesizing a
// projection. Support / first-run consumers already treat a thrown read as a
// fail-closed `repair_required` projection.
export async function getProductControlRecord(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('The product control record is only available in desktop runtime');
}

export async function ensureProductControlRecordCreated(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('The product control record is only available in desktop runtime');
}

export async function selectProductDataRoot(_dataRoot: string): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('nimi_data root selection is only available in desktop runtime');
}

export async function pickProductDataRootDirectory(): Promise<string | null> {
  unsupportedDesktopRuntime('The nimi_data folder picker is only available in desktop runtime');
}

export async function setProductFirstRunInstallLevel(_input: {
  installLevel: 'minimal' | 'recommended';
  aiProfileAlias?: string | null;
}): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('First-run install level is only available in desktop runtime');
}

export async function prepareProductFirstRunLocalAiReady(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('First-run local AI readiness preparation is only available in desktop runtime');
}

export async function reconcileProductFirstRunSetupState(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('First-run setup reconciliation is only available in desktop runtime');
}

export async function completeProductFirstRunDeviceEnvironmentScan(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('First-run device environment scan completion is only available in desktop runtime');
}

export async function admitProductReadyForUse(): Promise<NimiProductControlRecordProjection> {
  unsupportedDesktopRuntime('First-run readiness admission is only available in desktop runtime');
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return getDaemonStatus();
}

export async function getRuntimeBridgeConfig(): Promise<string> {
  unsupportedDesktopRuntime('Runtime bridge config is only available in desktop runtime');
}

export async function setRuntimeBridgeConfig(_configJson: string): Promise<void> {
  unsupportedDesktopRuntime('Runtime bridge config updates are only available in desktop runtime');
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return startDaemon();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return restartDaemon();
}

export { oauthListenForCode, oauthTokenExchange, openExternalUrl, focusMainWindow };
export { proxyHttp, getSystemResourceSnapshot, startWindowDrag };

export const desktopBridge = {
  hasShellHostInvoke,
  getRuntimeBridgeStatus,
  getRuntimeBridgeConfig,
  setRuntimeBridgeConfig,
  getRuntimeAccountSessionStatus,
  subscribeRuntimeAccountSessionEvents,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  restartRuntimeBridge,
  getRuntimeDefaults,
  getProductControlRecord,
  ensureProductControlRecordCreated,
  getDesktopStorageDirs,
  pickProductDataRootDirectory,
  selectProductDataRoot,
  setProductFirstRunInstallLevel,
  prepareProductFirstRunLocalAiReady,
  reconcileProductFirstRunSetupState,
  completeProductFirstRunDeviceEnvironmentScan,
  admitProductReadyForUse,
  proxyHttp,
  openExternalUrl,
  oauthTokenExchange,
  oauthListenForCode,
  focusMainWindow,
  planNimiDataCleanup,
  executeNimiDataCleanup,
  exportDesktopLogs,
  startWindowDrag,
  logRendererEvent,
};
