import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { resolveBrowserStorage, writeStorageTextTo } from '@nimiplatform/kit/core/storage-json';

import { createProductionAppStoreDependencies } from '../app-shell/providers/production-app-store-dependencies.js';
import { createBrowserAppAttentionSource } from '../app-shell/providers/production-app-attention-source.js';
import { LOCALE_STORAGE_KEY } from '../i18n/desktop-i18n.js';
import type {
  DesktopCanonicalRendererBindings,
  DesktopRendererRoutePort,
  DesktopRendererRouteView,
} from './contract.js';
import { connectMenuBarNavigation } from '../infra/menu-bar/menu-bar-navigation-listener.js';
import { connectMenuBarRuntimeSync } from '../infra/menu-bar/menu-bar-runtime-sync.js';
import {
  connectRuntimeHealthCoordinator,
  createRuntimeHealthCoordinator,
} from '../features/runtime-config/runtime-health-coordinator.js';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import { connectProductionBootstrap } from './production-bootstrap.js';
import { desktopBridge } from '@renderer/bridge';
import {
  decideLocalDevelopmentApproval,
  listLocalDevelopmentAuthorizations,
  listLocalDevelopmentRuns,
  listPendingLocalDevelopmentApprovals,
  revokeLocalDevelopmentAuthorization,
  localDevelopmentBridgeAvailable,
  subscribeLocalDevelopmentApprovals,
} from '../features/local-development/local-development-bridge.js';
import {
  continueOauthNextIfPresent,
  freshOauthLoginGateStorageKey,
  readFreshOauthLoginState,
} from '../features/auth/oauth-next-continuation.js';
import {
  createDesktopRuntimeAgentDiscoverySurface,
  getDesktopAccountRuntime,
  getDesktopAccountProductClient,
  getDesktopAiExecutionClient,
  getDesktopAppId,
  getDesktopAuditAdminClient,
  getDesktopConnectorAdminClient,
  getDesktopExternalAgentClient,
  getDesktopHostRuntimeAgentClient,
  getDesktopLocalAssetAdminClient,
  getDesktopLocalAuditClient,
  getDesktopMachineProductClient,
  getDesktopPermissionOwnerClient,
  getDesktopRealm,
  getDesktopRouteHostAccessClient,
  getDesktopRouteOptionsClient,
  getDesktopRuntimeAccountCaller,
  getDesktopRuntimeAgentOwnerClient,
  getDesktopRuntimeAgentTurnsRuntime,
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
import { createDesktopProductionAuthPort } from '@renderer/features/auth/desktop-auth-adapter.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';
import { callRealmApi, emitRealmDataError } from '../infra/realm/realm-api.js';
import { getOfflineCoordinator } from '../infra/offline/coordinator.js';
import { createDesktopProductionOfflinePort } from '../infra/offline/production-offline-port.js';
import { createDesktopRuntimeRouteAccess } from '../infra/runtime-route-host-access.js';
import { loadRuntimeRouteOptions } from '../infra/bootstrap/runtime-bootstrap-route-options.js';
import { createNimiClientId } from '@nimiplatform/sdk';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetManifestPath,
  revealLocalRuntimeAssetsRootFolder,
} from '../bridge/runtime-bridge/local-runtime-os-helpers.js';
import { createDesktopProductionWorldFollowPort } from '../features/world/production-world-follow-port.js';
import { createDesktopProductionVoiceCapturePort } from '../features/chat/production-agent-voice-capture.js';
import { createDesktopProductionLocalModelProgressPort } from '../features/runtime-config/production-local-model-progress-port.js';
import { createDesktopProductionVirtualizationPort } from './production-virtualization-port.js';
import {
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
} from '../bridge/runtime-bridge/chat-agent-avatar-launcher.js';
import { listDesktopAvatarLiveInstances } from '../bridge/runtime-bridge/chat-agent-avatar-instance-registry.js';
import { getDesktopAIConfigService } from '../app-shell/providers/desktop-ai-config-service.js';
import { getProductionConversationCapabilityRouteRuntime } from '../features/chat/production-conversation-route-runtime-state.js';
import {
  ensureProductAccountDefaultProfile,
  getAccountDefaultProfileForScopeInit,
} from '../bridge/runtime-bridge/product-control.js';
import { createDesktopLocalAppPermissionOwnerPort } from '../features/apps/local-app-permission-owner.js';
import {
  createAccountProfileLibraryProfile,
  deleteAccountProfileLibraryProfile,
  editAccountProfileLibraryProfile,
  exportAccountProfileLibraryProfiles,
  importAccountProfileLibraryProfiles,
  listAccountProfileLibrary,
} from '../bridge/runtime-bridge/account-profile-library.js';

export function createDesktopBrowserRoutePort(): DesktopRendererRoutePort {
  function read(): DesktopRendererRouteView {
    const fragment = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const route = fragment.startsWith('/')
      ? new URL(fragment, window.location.origin)
      : new URL(window.location.href);
    return Object.freeze({
      pathname: route.pathname || '/',
      search: route.search,
      hash: route.hash,
      state: window.history.state,
      key: String(window.history.state?.key || 'production'),
    });
  }
  let snapshot = read();
  return Object.freeze({
    get: () => snapshot,
    subscribe(listener: () => void) {
      const onRoute = () => {
        snapshot = read();
        listener();
      };
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('popstate', onRoute);
      return () => {
        window.removeEventListener('hashchange', onRoute);
        window.removeEventListener('popstate', onRoute);
      };
    },
    navigate({ to, replace, state }: Parameters<DesktopRendererRoutePort['navigate']>[0]) {
      const href = `#${to.startsWith('/') ? to : `/${to}`}`;
      if (replace) {
        window.history.replaceState(state ?? null, '', href);
      } else {
        window.history.pushState(state ?? null, '', href);
      }
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    go: (delta: number) => window.history.go(delta),
  });
}

export function createDesktopProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): DesktopCanonicalRendererBindings {
  const dependencies = createProductionAppStoreDependencies();
  const attention = createBrowserAppAttentionSource();
  const runtimeConfigNavigation = createDesktopRendererRuntimeConfigNavigationPort();
  const runtimeRouteAccess = createDesktopRuntimeRouteAccess(getDesktopRouteHostAccessClient);
  const offline = createDesktopProductionOfflinePort(getOfflineCoordinator());
  const localAppPermissions = createDesktopLocalAppPermissionOwnerPort({
    runtime: getDesktopPermissionOwnerClient,
    caller: getDesktopRuntimeAccountCaller,
  });
  const runtimeHealthCoordinator = createRuntimeHealthCoordinator(
    getDesktopAuditAdminClient,
    {
      setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      clearInterval: (handle) => window.clearInterval(handle as number),
    },
  );
  let connectedLifecycle: DesktopRendererLifecyclePort | null = null;
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
      connectorAdmin: getDesktopConnectorAdminClient,
      localAssetAdmin: getDesktopLocalAssetAdminClient,
      localAudit: getDesktopLocalAuditClient,
      auditAdmin: getDesktopAuditAdminClient,
      aiExecution: getDesktopAiExecutionClient,
      routeHostAccessClient: getDesktopRouteHostAccessClient,
      routeOptionsClient: getDesktopRouteOptionsClient,
      externalAgent: getDesktopExternalAgentClient,
      runtimeAgentOwner: getDesktopRuntimeAgentOwnerClient,
      runtimeAgentDiscovery: createDesktopRuntimeAgentDiscoverySurface,
      runtimeAgentTurns: getDesktopRuntimeAgentTurnsRuntime,
      hostRuntimeAgent: getDesktopHostRuntimeAgentClient,
      accountRuntime: getDesktopAccountRuntime,
      runtimeRouteAccess: () => runtimeRouteAccess,
      loadRouteOptions: (
        capability: Parameters<DesktopCanonicalRendererBindings['sdk']['loadRouteOptions']>[0],
        targetId?: string,
      ) => loadRuntimeRouteOptions(
        { capability, targetId },
        { runtime: getDesktopRouteOptionsClient() },
      ),
      conversationCapabilityRuntime: getProductionConversationCapabilityRouteRuntime,
      runtimeHealthCoordinator: () => runtimeHealthCoordinator,
      aiConfig: getDesktopAIConfigService,
      realm: getDesktopRealm,
      offline,
      socialData: Object.freeze({
        callApi: callRealmApi,
        emitDataError: emitRealmDataError,
        offline: Object.freeze({
          syncProfileMetadata: offline.syncProfileMetadata,
          loadProfileMetadata: offline.getCachedProfileMetadata,
          markCacheFallbackUsed: offline.markCacheFallbackUsed,
          markRealmUnreachable: offline.markRealmUnreachable,
          queueSocialMutation: offline.queueSocialMutation,
        }),
      }),
      accountCaller: getDesktopRuntimeAccountCaller,
      withRuntimeProtectedScopes: withDesktopRuntimeProtectedScopes,
    }),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          aiConfig: dependencies.initialAIConfig,
          bootstrapError: null,
          bootstrapReady: false,
          chatThinkingPreference: dependencies.initialChatThinkingPreference,
          development: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
        }),
        attention: attention.getSnapshot,
        localDevelopmentAvailable: localDevelopmentBridgeAvailable,
        loginMode: () => getShellFeatureFlags().mode === 'web' ? 'embedded' : 'desktop-browser',
        developerModeEnabled: isDeveloperModeEnabled,
        viewportWidth: () => window.innerWidth || document.documentElement.clientWidth,
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
        auth: createDesktopProductionAuthPort(),
        firstRun: createDesktopProductionFirstRunPort(),
        runtimeConfigNavigation,
        settings: createDesktopProductionSettingsPort(),
        worldFollow: createDesktopProductionWorldFollowPort(),
        voiceCapture: createDesktopProductionVoiceCapturePort(),
        localModelProgress: createDesktopProductionLocalModelProgressPort(),
        virtualization: createDesktopProductionVirtualizationPort(),
        localAppPermissions: Object.freeze({
          listPending: localAppPermissions.listPending,
          approve: localAppPermissions.approve,
          deny: localAppPermissions.deny,
          revoke: localAppPermissions.revoke,
          getProjection: localAppPermissions.getProjection,
          listProjections: localAppPermissions.listProjections,
        }),
        avatarHandoff: Object.freeze({
          available: hasElectronInvoke,
          list: (agentId: string) => listDesktopAvatarLiveInstances({ agentId }),
          launch: launchDesktopAvatarHandoff,
          close: closeDesktopAvatarHandoff,
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
        }),
        profileLibrary: Object.freeze({
          available: hasElectronInvoke,
          createId: () => createNimiClientId('user'),
          load: listAccountProfileLibrary,
          ensureAccountDefault: async () => { await ensureProductAccountDefaultProfile(); },
          loadAccountDefault: getAccountDefaultProfileForScopeInit,
          create: createAccountProfileLibraryProfile,
          edit: editAccountProfileLibraryProfile,
          import: importAccountProfileLibraryProfiles,
          export: exportAccountProfileLibraryProfiles,
          delete: deleteAccountProfileLibraryProfile,
        }),
        connectorAuth: Object.freeze({
          proxyHttp: async (request: Parameters<
            DesktopCanonicalRendererBindings['app']['commands']['connectorAuth']['proxyHttp']
          >[0]) => desktopBridge.proxyHttp({
            url: request.url,
            method: request.method,
            headers: request.headers,
            body: request.body,
            connectorAuthProfileId: request.profileId,
            connectorAuthPurpose: request.purpose,
          }),
          oauthTokenExchange: async (input: Parameters<
            DesktopCanonicalRendererBindings['app']['commands']['connectorAuth']['oauthTokenExchange']
          >[0]) => {
            const result = await desktopBridge.oauthTokenExchange({
              provider: input.provider as Parameters<typeof desktopBridge.oauthTokenExchange>[0]['provider'],
              clientId: input.clientId,
              code: input.code,
              codeVerifier: input.codeVerifier,
              redirectUri: input.redirectUri,
            });
            return { ...result, raw: result.raw as import('@nimiplatform/sdk/types').JsonObject };
          },
        }),
        runtimeDaemon: Object.freeze({
          available: hasElectronInvoke,
          status: () => desktopBridge.getRuntimeBridgeStatus(),
          start: () => desktopBridge.startRuntimeBridge(),
          restart: () => desktopBridge.restartRuntimeBridge(),
        }),
        commitAIConfig: dependencies.commitAIConfig,
        persistChatThinkingPreference: dependencies.persistChatThinkingPreference,
        setActiveScopeForMode: dependencies.setActiveScopeForMode,
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
        openWalletCheckout: (url: string) => desktopBridge.openExternalUrl(url),
        async writeClipboardText(value: string) {
          if (!navigator.clipboard?.writeText) {
            throw new Error('DESKTOP_CLIPBOARD_WRITE_UNAVAILABLE');
          }
          await navigator.clipboard.writeText(value);
        },
        exportProfileLibraryJson({ filename, content }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['exportProfileLibraryJson']
        >[0]) {
          const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
          URL.revokeObjectURL(url);
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
        confirmRuntimeProfileInstall: (message: string) => window.confirm(message),
        pickLocalRuntimeAssetManifestPath,
        pickLocalRuntimeAssetFile,
        pickLocalRuntimeAssetDirectory,
        revealLocalRuntimeAssetsRootFolder,
        async reconcileLoginState({ authStatus }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['reconcileLoginState']
        >[0]) {
          if (getShellFeatureFlags().mode !== 'web') {
            return Object.freeze({ clearAuthSession: false });
          }
          const freshOauthState = readFreshOauthLoginState(window.location.search);
          if (freshOauthState && authStatus === 'anonymous') {
            const key = freshOauthLoginGateStorageKey(freshOauthState);
            if (!window.sessionStorage.getItem(key)) {
              window.sessionStorage.setItem(key, 'started');
            }
          }
          if (authStatus === 'authenticated') {
            if (freshOauthState) {
              const key = freshOauthLoginGateStorageKey(freshOauthState);
              const marker = window.sessionStorage.getItem(key);
              if (!marker) {
                window.sessionStorage.setItem(key, 'cleared');
                return Object.freeze({ clearAuthSession: true });
              }
            }
            continueOauthNextIfPresent(window.location.search);
          }
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
        listLocalDevelopmentApprovals: listPendingLocalDevelopmentApprovals,
        listLocalDevelopmentAuthorizations,
        listLocalDevelopmentRuns,
        revokeLocalDevelopmentAuthorization,
        decideLocalDevelopmentApproval: ({
          requestId,
          decision,
          riskDisclosureAcknowledged,
        }: Parameters<
          DesktopCanonicalRendererBindings['app']['commands']['decideLocalDevelopmentApproval']
        >[0]) => decideLocalDevelopmentApproval(
          requestId,
          decision,
          riskDisclosureAcknowledged,
        ),
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
        subscribeLocalDevelopmentApprovals,
        subscribeLocalAppPermissionRequests: localAppPermissions.subscribePending,
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
        connectDesktopOpenIntents: () => connectDesktopOpenIntentListener(runtimeConfigNavigation),
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          if (connectedLifecycle) {
            throw new Error('DESKTOP_PRODUCTION_LIFECYCLE_ALREADY_CONNECTED');
          }
          connectedLifecycle = lifecycle;
          let active = true;
          const disconnectMenuBarNavigation = connectMenuBarNavigation(
            lifecycle,
            runtimeConfigNavigation,
          );
          const disconnectRuntimeHealth = connectRuntimeHealthCoordinator(
            runtimeHealthCoordinator,
            lifecycle,
            getShellFeatureFlags().mode === 'desktop',
          );
          const disconnectMenuBarRuntimeSync = connectMenuBarRuntimeSync(
            lifecycle,
            runtimeHealthCoordinator,
          );
          const disconnectBootstrap = connectProductionBootstrap(lifecycle);
          return () => {
            if (!active) return;
            active = false;
            connectedLifecycle = null;
            disconnectMenuBarRuntimeSync();
            disconnectRuntimeHealth();
            disconnectMenuBarNavigation();
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
