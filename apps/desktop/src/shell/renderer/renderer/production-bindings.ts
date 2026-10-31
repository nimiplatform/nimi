import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';

import { createProductionAppStoreDependencies } from '../app-shell/providers/production-app-store-dependencies.js';
import { createBrowserAppAttentionSource } from '../app-shell/providers/production-app-attention-source.js';
import { LOCALE_STORAGE_KEY } from '../i18n/desktop-i18n.js';
import type { DesktopCanonicalRendererBindings } from './contract.js';
import {
  connectRuntimeHealthCoordinator,
  createRuntimeHealthCoordinator,
} from '../features/runtime-config/runtime-health-coordinator.js';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import { connectProductionBootstrap } from './production-bootstrap.js';
import { desktopBridge } from '@renderer/bridge';
import {
  listLocalDevelopmentRegistrations,
  listLocalDevelopmentRuns,
  removeLocalDevelopmentRegistration,
  startLocalDevelopmentRegistration,
  stopLocalDevelopmentRun,
  localDevelopmentBridgeAvailable,
} from '../features/local-development/local-development-bridge.js';
import {
  createDesktopRuntimeAgentDiscoverySurface,
  getDesktopAccountRuntime,
  getDesktopAccountProductClient,
  resolveDesktopAgentReference,
  getDesktopAppId,
  getDesktopAuditAdminClient,
  getDesktopConnectorAdminClient,
  getDesktopConversationClient,
  getDesktopExternalAgentClient,
  getDesktopFormalAppClient,
  getDesktopHostRuntimeAgentClient,
  getDesktopLocalEnvironmentRpc,
  getDesktopLocalAuditClient,
  getDesktopMachineProductClient,
  getDesktopRealm,
  getDesktopRuntimeAccountCaller,
  isDesktopNimiClientSessionReady,
  isDesktopRuntimeAccountSessionReady,
  withDesktopRuntimeProtectedScopes,
} from '../infra/sdk/desktop-nimi-client-session.js';
import { connectDesktopOpenIntentListener } from '../infra/desktop-open/desktop-open-intent-listener.js';
import {
  isDeveloperModeEnabled,
  refreshDeveloperMode,
  setDeveloperMode,
  subscribeDeveloperMode,
} from '../features/developer/developer-mode.js';
import { connectProductionChatRealtimeSync } from '../infra/realtime/production-chat-realtime-sync.js';
import { createDesktopProductionFirstRunPort } from './production-first-run-port.js';
import { createDesktopProductionSettingsPort } from '../features/settings/settings-storage.js';
import { createDesktopProductionAuthPort } from '@renderer/features/auth/desktop-browser-auth.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';
import { callRealmApi, emitRealmDataError } from '../infra/realm/realm-api.js';
import { getOfflineCoordinator } from '../infra/offline/coordinator.js';
import { createDesktopProductionOfflinePort } from '../infra/offline/production-offline-port.js';
import { deletedOfflineAccount } from '../infra/offline/account-cleanup.js';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  revealLocalRuntimeAssetsRootFolder,
} from '../bridge/runtime-bridge/local-runtime-os-helpers.js';
import { createDesktopProductionWorldFollowPort } from '../features/world/production-world-follow-port.js';
import { createDesktopProductionVoiceCapturePort } from '../features/chat/production-agent-voice-capture.js';
import { createDesktopProductionLocalModelProgressPort } from '../features/runtime-config/production-local-model-progress-port.js';
import { createDesktopProductionVirtualizationPort } from './production-virtualization-port.js';
import { launchDesktopAvatarHandoff } from '../bridge/runtime-bridge/chat-agent-avatar-launcher.js';
import { requestDesktopAvatarPreviewProjection } from '../bridge/runtime-bridge/chat-agent-avatar-preview-projection.js';
import { createDesktopBrowserRoutePort } from './browser-route-port.js';
import { resolveAccountManagementUrl } from '../features/settings/account-management-url.js';
import { createDesktopProductUpdatePort } from './product-update-port.js';

export function createDesktopProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): DesktopCanonicalRendererBindings {
  const dependencies = createProductionAppStoreDependencies();
  const attention = createBrowserAppAttentionSource();
  const runtimeConfigNavigation = createDesktopRendererRuntimeConfigNavigationPort(() => {
    if (!connectedLifecycle) throw new Error('Home navigation owner is not connected.');
    return connectedLifecycle.navigation;
  });
  let connectedLifecycle: DesktopRendererLifecyclePort | null = null;
  const offline = createDesktopProductionOfflinePort(getOfflineCoordinator(), {
    readScope: () => {
      const auth = connectedLifecycle?.auth();
      if (!auth || (auth.status !== 'authenticated' && auth.status !== 'refresh-pending')) return null;
      const accountId = typeof auth.user?.id === 'string' ? auth.user.id : '';
      const realmEnvironmentId = typeof auth.user?.realmEnvironmentId === 'string' ? auth.user.realmEnvironmentId : '';
      return accountId && realmEnvironmentId ? { accountId, realmEnvironmentId, generation: connectedLifecycle!.navigation.getSnapshot().generation } : null;
    },
  });
  const runtimeHealthCoordinator = createRuntimeHealthCoordinator(
    getDesktopAuditAdminClient,
    {
      setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      clearInterval: (handle) => window.clearInterval(handle as number),
    },
  );
  const socialOffline = (port: typeof offline): import('../features/social/data/social-offline-port.js').RealmSocialOfflinePort => Object.freeze({
    capture: () => socialOffline(port.capture()),
    syncProfileMetadata: port.syncProfileMetadata,
    loadProfileMetadata: port.getCachedProfileMetadata,
    removeProfileMetadata: port.removeProfileMetadata,
    markCacheFallbackUsed: port.markCacheFallbackUsed,
    markRealmUnreachable: port.markRealmUnreachable,
  });
  return createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({
      isSessionReady: isDesktopNimiClientSessionReady,
      isRuntimeAccountSessionReady: isDesktopRuntimeAccountSessionReady,
      appId: getDesktopAppId,
      machineProduct: getDesktopMachineProductClient,
      accountProduct: getDesktopAccountProductClient,
      resolveDesktopAgentReference,
      connectorAdmin: getDesktopConnectorAdminClient,
      localEnvironmentRpc: getDesktopLocalEnvironmentRpc,
      localAudit: getDesktopLocalAuditClient,
      auditAdmin: getDesktopAuditAdminClient,
      appProduct: getDesktopFormalAppClient,
      externalAgent: getDesktopExternalAgentClient,
      runtimeAgentDiscovery: createDesktopRuntimeAgentDiscoverySurface,
      conversation: getDesktopConversationClient,
      hostRuntimeAgent: getDesktopHostRuntimeAgentClient,
      accountRuntime: getDesktopAccountRuntime,
      runtimeHealthCoordinator: () => runtimeHealthCoordinator,
      realm: getDesktopRealm,
      offline,
      socialData: Object.freeze({
        callApi: callRealmApi,
        emitDataError: emitRealmDataError,
        offline: socialOffline(offline),
      }),
      accountCaller: getDesktopRuntimeAccountCaller,
      withRuntimeProtectedScopes: withDesktopRuntimeProtectedScopes,
    }),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          bootstrapError: null,
          bootstrapReady: false,
          chatThinkingPreference: dependencies.initialChatThinkingPreference,
          development: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
        }),
        attention: attention.getSnapshot,
        localDevelopmentAvailable: localDevelopmentBridgeAvailable,
        developerModeEnabled: isDeveloperModeEnabled,
        viewportWidth: () => window.innerWidth || document.documentElement.clientWidth,
        viewportHeight: () => window.innerHeight || document.documentElement.clientHeight,
        documentVisible: () => document.visibilityState !== 'hidden',
        windowFocused: () => document.hasFocus(),
        titlebarDragEnabled: () => getShellFeatureFlags().enableTitlebarDrag,
        menuBarShellEnabled: () => getShellFeatureFlags().enableMenuBarShell,
        resourceBaseUrl: () => window.location.href,
        walletCheckoutBaseUrl() {
          const configured = String(
            (import.meta as { env?: { NIMI_WEB_URL?: string } }).env?.NIMI_WEB_URL || '',
          ).trim();
          return configured || window.location.origin;
        },
      }),
      commands: Object.freeze({
        productUpdate: createDesktopProductUpdatePort(),
        auth: createDesktopProductionAuthPort(),
        firstRun: createDesktopProductionFirstRunPort(),
        runtimeConfigNavigation,
        settings: createDesktopProductionSettingsPort(),
        worldFollow: createDesktopProductionWorldFollowPort(),
        voiceCapture: createDesktopProductionVoiceCapturePort(),
        localModelProgress: createDesktopProductionLocalModelProgressPort(),
        virtualization: createDesktopProductionVirtualizationPort(),
        avatarHandoff: Object.freeze({
          available: hasElectronInvoke,
          preview: requestDesktopAvatarPreviewProjection,
          launch: launchDesktopAvatarHandoff,
        }),
        systemResources: Object.freeze({
          load: () => desktopBridge.getSystemResourceSnapshot(),
        }),
        supportLogs: Object.freeze({
          loadStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
          exportLogs: () => desktopBridge.exportDesktopLogs(),
        }),
        supportRepair: Object.freeze({
          loadProductControlRecord: () => desktopBridge.getProductControlRecord(),
          loadStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
          planDataCleanup: (directory: string) => desktopBridge.planNimiDataCleanup(directory),
          executeDataCleanup: (directory: string, confirmation?: string) => (
            desktopBridge.executeNimiDataCleanup(directory, confirmation)
          ),
          planAppHostCacheCleanup: () => desktopBridge.planNimiAppHostCacheCleanup(),
          executeAppHostCacheCleanup: () => desktopBridge.executeNimiAppHostCacheCleanup(),
        }),
        connectorAuth: Object.freeze({
          acquireManagedConnectorCredential: (
            input: Parameters<DesktopCanonicalRendererBindings[
              'app'
            ]['commands']['connectorAuth']['acquireManagedConnectorCredential']>[0],
          ) => desktopBridge.desktopManagedConnectorCredentialAcquisitionHost
            .acquireManagedConnectorCredential(input),
        }),
        runtimeDaemon: Object.freeze({
          available: hasElectronInvoke,
          status: () => desktopBridge.getRuntimeBridgeStatus(),
          start: () => desktopBridge.startRuntimeBridge(),
          restart: () => desktopBridge.restartRuntimeBridge(),
        }),
        persistChatThinkingPreference: dependencies.persistChatThinkingPreference,
        async reportAuthEntryAction() {
          return Object.freeze({ ok: false as const, disposition: 'unsupported' as const });
        },
        applyLocale({ locale, lang, title }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['applyLocale']
        >[0]) {
          writeStorageTextTo(resolveBrowserStorage('local'), LOCALE_STORAGE_KEY, locale);
          document.documentElement.lang = lang;
          document.title = title;
        },
        async openAccountManagement() {
          const configured = String(
            (import.meta as { env?: { NIMI_WEB_URL?: string } }).env?.NIMI_WEB_URL || '',
          );
          const result = await desktopBridge.openExternalUrl(resolveAccountManagementUrl(configured));
          if (!result.opened) throw new Error('Nimi Web account management could not be opened.');
        },
        openWalletCheckout: (url: string) => desktopBridge.openExternalUrl(url),
        async writeClipboardText(value: string) {
          if (!navigator.clipboard?.writeText) {
            throw new Error('DESKTOP_CLIPBOARD_WRITE_UNAVAILABLE');
          }
          await navigator.clipboard.writeText(value);
        },
        exportRuntimeAuditJson({ filename, content }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['exportRuntimeAuditJson']
        >[0]) {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
          URL.revokeObjectURL(url);
        },
        pickLocalRuntimeAssetFile,
        pickLocalRuntimeAssetDirectory,
        revealLocalRuntimeAssetsRootFolder,
        async reconcileLoginState({ authStatus }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['reconcileLoginState']
        >[0]) {
          void authStatus;
          return Object.freeze({ clearAuthSession: false });
        },
        reloadApplication() {
          window.location.reload();
        },
        async startWindowDrag() {
          if (!getShellFeatureFlags().enableTitlebarDrag) {
            throw new Error('DESKTOP_WINDOW_DRAG_UNAVAILABLE');
          }
          await desktopBridge.startWindowDrag();
        },
        listLocalDevelopmentRegistrations,
        listLocalDevelopmentRuns,
        startLocalDevelopmentRegistration,
        stopLocalDevelopmentRun,
        removeLocalDevelopmentRegistration,
        refreshDeveloperMode,
        setDeveloperMode,
      }),
      events: Object.freeze({
        connectChatRealtimeSync: connectProductionChatRealtimeSync,
        subscribeWindowFocus(listener: (focused: boolean) => void) {
          const onFocus = () => listener(true);
          const onBlur = () => listener(false);
          window.addEventListener('focus', onFocus);
          window.addEventListener('blur', onBlur);
          return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
          };
        },
        subscribeDocumentVisibility(listener: (visible: boolean) => void) {
          const onVisibility = () => listener(document.visibilityState !== 'hidden');
          document.addEventListener('visibilitychange', onVisibility);
          return () => document.removeEventListener('visibilitychange', onVisibility);
        },
        subscribeWindowResize(listener: () => void) {
          window.addEventListener('resize', listener);
          return () => window.removeEventListener('resize', listener);
        },
        subscribeWindowKeyDown(listener: (event: KeyboardEvent) => void) {
          window.addEventListener('keydown', listener);
          return () => window.removeEventListener('keydown', listener);
        },
        subscribeDocumentMouseDown(listener: (event: MouseEvent) => void) {
          document.addEventListener('mousedown', listener);
          return () => document.removeEventListener('mousedown', listener);
        },
        subscribeDocumentClick(listener: (event: MouseEvent) => void) {
          document.addEventListener('click', listener);
          return () => document.removeEventListener('click', listener);
        },
        subscribeDocumentPointerDown(listener: (event: PointerEvent) => void, capture = false) {
          document.addEventListener('pointerdown', listener, capture);
          return () => document.removeEventListener('pointerdown', listener, capture);
        },
        observeIntersection(
          target: Element,
          options: IntersectionObserverInit,
          listener: (isIntersecting: boolean) => void,
        ) {
          const observer = new IntersectionObserver(
            ([entry]) => listener(entry?.isIntersecting === true),
            options,
          );
          observer.observe(target);
          return () => observer.disconnect();
        },
        subscribeAttention: attention.subscribe,
        subscribeDeveloperMode,
        subscribeProductControlRecord(listener: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['subscribeProductControlRecord']
        >[0]) {
          let active = true;
          let refreshInFlight = false;
          const refresh = async () => {
            if (!active || refreshInFlight) return;
            refreshInFlight = true;
            try {
              const projection = await desktopBridge.getProductControlRecord();
              if (active) listener({ ok: true, projection });
            } catch (error) {
              if (active) listener({
                ok: false,
                error: error instanceof Error ? error.message : String(error || 'product control record unavailable'),
              });
            } finally {
              refreshInFlight = false;
            }
          };
          const interval = window.setInterval(refresh, 3_000);
          window.addEventListener('focus', refresh);
          void refresh();
          return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
          };
        },
        connectDesktopOpenIntents: (
          store: Parameters<
            DesktopCanonicalRendererBindings['app']['events']['connectDesktopOpenIntents']
          >[0],
        ) => connectDesktopOpenIntentListener(runtimeConfigNavigation, store),
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          if (connectedLifecycle) {
            throw new Error('DESKTOP_PRODUCTION_LIFECYCLE_ALREADY_CONNECTED');
          }
          connectedLifecycle = lifecycle;
          const disconnectAccountCleanup = lifecycle.subscribeAccount((current, previous) => {
            const deleted = deletedOfflineAccount(previous, current);
            if (deleted) void offline.purgeAccount(deleted).catch(() => lifecycle.setStatusBanner({
              kind: 'error', message: lifecycle.translate('TurnInput.accountDataCleanupFailed'),
            }));
          });
          let active = true;
          const disconnectRuntimeHealth = connectRuntimeHealthCoordinator(
            runtimeHealthCoordinator,
            lifecycle,
            getShellFeatureFlags().mode === 'desktop',
          );
          const disconnectBootstrap = connectProductionBootstrap(lifecycle);
          return () => {
            if (!active) return;
            active = false;
            disconnectAccountCleanup();
            connectedLifecycle = null;
            disconnectRuntimeHealth();
            disconnectBootstrap();
          };
        },
      }),
    },
    route: createDesktopBrowserRoutePort(),
    clock: Object.freeze({
      now: Date.now,
      schedule(delayMs: number, listener: Parameters<DesktopCanonicalRendererBindings['clock']['schedule']>[1]) {
        const timer = window.setTimeout(() => listener({ ok: true }), delayMs);
        return () => window.clearTimeout(timer);
      },
      animationFrame(listener: Parameters<DesktopCanonicalRendererBindings['clock']['animationFrame']>[0]) {
        const frame = window.requestAnimationFrame(() => listener({ ok: true }));
        return () => window.cancelAnimationFrame(frame);
      },
    }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
