import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  createAppStore,
  type AppStoreDependencies,
} from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import {
  AppStoreProvider,
  useAppStore,
} from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createDesktopQueryClient } from '../src/shell/renderer/infra/query-client/query-client.js';
import { createDesktopI18n } from '../src/shell/renderer/i18n/desktop-i18n.js';
import { AppProviders } from '../src/shell/renderer/app-shell/providers/app-providers.js';
import { createAgentConversationAnchorBindingStore } from '../src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage.js';
import { createIdleAppAttentionState } from '../src/shell/renderer/app-shell/providers/app-attention-state.js';
import {
  createNimiCanonicalRendererHostBindings,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { createDesktopRendererResources } from '../src/shell/renderer/renderer/resources.js';
import type {
  DesktopCanonicalRendererBindings,
  DesktopRendererRouteView,
} from '../src/shell/renderer/renderer/contract.js';
import { createUnavailableDesktopFirstRunPort } from '../src/shell/renderer/renderer/first-run-port.js';
import {
  createMemoryDesktopRendererSettingsPort,
} from '../src/shell/renderer/renderer/settings-port.js';
import type { AppearancePreferences } from '../src/shell/renderer/features/settings/settings-device-preferences.js';
import { createTestStreamController } from './helpers/test-stream-controller.js';
import { createScenarioJobController } from '../src/shell/renderer/features/turns/scenario-job-controller.js';
import { createUnavailableDesktopRendererAuthPort } from '../src/shell/renderer/renderer/auth-port.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from '../src/shell/renderer/renderer/runtime-config-navigation-port.js';
import { createUnavailableDesktopRendererOfflinePort } from '../src/shell/renderer/renderer/offline-port.js';
import { createUnavailableDesktopRendererWorldFollowPort } from '../src/shell/renderer/renderer/world-follow-port.js';
import { createUnavailableDesktopRendererSupportRepairPort } from '../src/shell/renderer/renderer/support-repair-port.js';
import { createUnavailableDesktopRendererSystemResourcesPort } from '../src/shell/renderer/renderer/system-resources-port.js';
import { createUnavailableDesktopRendererVoiceCapturePort } from '../src/shell/renderer/renderer/voice-capture-port.js';
import { createUnavailableDesktopRendererSupportLogsPort } from '../src/shell/renderer/renderer/support-logs-port.js';
import { createMemoryDesktopRendererLocalModelProgressPort } from '../src/shell/renderer/renderer/local-model-progress-port.js';
import { createUnavailableDesktopRendererAvatarHandoffPort } from '../src/shell/renderer/renderer/avatar-handoff-port.js';
import { createDeterministicDesktopVirtualizationPort } from '../src/shell/renderer/renderer/virtualization-port.js';
import { createWorldFollowStore } from '../src/shell/renderer/features/world/world-follow-store.js';
import { createAgentVisibleProjectionStore } from '../src/shell/renderer/features/chat/chat-agent-visible-projection-store.js';
import { createChatUploadPlaceholderStore } from '../src/shell/renderer/features/turns/chat-upload-placeholder-store.js';
import { createLocalModelCenterProgressCache } from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-progress-cache.js';
import { createRealmSocialData } from '../src/shell/renderer/features/social/data/realm-social-data.js';
import type { RealmGroupChatData } from '../src/shell/renderer/features/chat/data/realm-group-chat-data.js';
import type { RealmHumanChatData } from '../src/shell/renderer/features/chat/data/realm-human-chat-data.js';
import { createRuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';

function createDependencies(input: {
  readonly preferences: string[];
  readonly initialChatThinkingPreference?: 'off' | 'on';
}): AppStoreDependencies {
  return {
    initialChatThinkingPreference: input.initialChatThinkingPreference ?? 'off',
    persistChatThinkingPreference(preference) {
      input.preferences.push(preference);
    },
  };
}

test('createAppStore owns independent state and injected effects per renderer instance', () => {
  const firstEffects = { preferences: [] as string[] };
  const secondEffects = { preferences: [] as string[] };
  const first = createAppStore(createDependencies(firstEffects));
  const second = createAppStore(createDependencies(secondEffects));

  assert.notEqual(first, second);
  first.getState().setActiveTab('explore');
  first.getState().setChatThinkingPreference('on');
  first.getState().setChatMode('agent');

  assert.equal(first.getState().activeTab, 'explore');
  assert.equal(second.getState().activeTab, 'chat');
  assert.equal(first.getState().chatThinkingPreference, 'on');
  assert.equal(second.getState().chatThinkingPreference, 'off');
  assert.deepEqual(firstEffects.preferences, ['on']);
  assert.deepEqual(secondEffects.preferences, []);
});

test('AppStoreProvider resolves the store belonging to the current renderer tree', () => {
  const first = createAppStore(createDependencies({
    preferences: [],
    initialChatThinkingPreference: 'on',
  }));
  const second = createAppStore(createDependencies({ preferences: [] }));
  function ThinkingPreference() {
    return createElement('span', null, useAppStore((state) => state.chatThinkingPreference));
  }
  const render = (store: typeof first) => renderToStaticMarkup(
    createElement(AppStoreProvider, { store }, createElement(ThinkingPreference)),
  );

  assert.equal(render(first), '<span>on</span>');
  assert.equal(render(second), '<span>off</span>');
});

test('createDesktopQueryClient owns an independent cache per renderer instance', () => {
  const first = createDesktopQueryClient();
  const second = createDesktopQueryClient();

  first.setQueryData(['renderer-instance'], { value: 'first' });

  assert.deepEqual(first.getQueryData(['renderer-instance']), { value: 'first' });
  assert.equal(second.getQueryData(['renderer-instance']), undefined);
  first.clear();
  second.clear();
});

test('AppProviders owns independent route, store, query, and i18n resources', async () => {
  const firstStore = createAppStore(createDependencies({ preferences: [] }));
  const secondStore = createAppStore(createDependencies({ preferences: [] }));
  const firstQueryClient = createDesktopQueryClient();
  const secondQueryClient = createDesktopQueryClient();
  const firstI18n = createDesktopI18n({ initialLocale: 'en', development: false, now: () => 1 });
  const secondI18n = createDesktopI18n({ initialLocale: 'zh', development: false, now: () => 2 });
  await Promise.all([firstI18n.init(), secondI18n.init()]);

  function InstanceSnapshot() {
    const location = useLocation();
    const { i18n } = useTranslation();
    const activeTab = useAppStore((state) => state.activeTab);
    return createElement('span', null, `${location.pathname}|${activeTab}|${i18n.language}`);
  }
  const createRouter = (entry: string) => function InstanceRouter(props: PropsWithChildren) {
    return createElement(MemoryRouter, { initialEntries: [entry] }, props.children);
  };
  const render = (
    entry: string,
    store: typeof firstStore,
    queryClient: typeof firstQueryClient,
    i18n: typeof firstI18n,
  ) => renderToStaticMarkup(createElement(
    AppProviders,
    {
      agentVisibleProjections: createAgentVisibleProjectionStore(),
      anchorBindings: createAgentConversationAnchorBindingStore(() => 1),
      chatUploadPlaceholders: createChatUploadPlaceholderStore(() => 1),
      attention: {
        getSnapshot: createIdleAppAttentionState,
        subscribe: () => () => undefined,
      },
      i18n,
      localModelCenterProgress: createLocalModelCenterProgressCache(
        createMemoryDesktopRendererLocalModelProgressPort(),
      ),
      queryClient,
      realmGroupChatData: {} as RealmGroupChatData,
      realmHumanChatData: {} as RealmHumanChatData,
      realmSocialData: createRealmSocialData({
        callApi: async () => {
          throw new Error('TEST_REALM_API_NOT_AVAILABLE');
        },
        emitDataError: () => undefined,
        now: () => 1,
        offline: Object.freeze({
          async syncProfileMetadata() {},
          async loadProfileMetadata() { return null; },
          markCacheFallbackUsed() {},
          markRealmUnreachable() {},
          async queueSocialMutation() {},
        }),
      }),
      runtimeConnectorSdk: createRuntimeConfigConnectorSdkService(() => {
        throw new Error('TEST_RUNTIME_UNAVAILABLE');
      }),
      Router: createRouter(entry),
      scenarioJobController: createScenarioJobController({
        now: () => 1,
        schedule: () => () => undefined,
        animationFrame: () => () => undefined,
      }),
      store,
      streamController: createTestStreamController(),
      worldFollowStore: createWorldFollowStore(
        createUnavailableDesktopRendererWorldFollowPort('TEST_WORLD_FOLLOW_UNAVAILABLE'),
      ),
    },
    createElement(InstanceSnapshot),
  ));

  assert.match(render('/first', firstStore, firstQueryClient, firstI18n), /\/first\|chat\|en/);
  assert.match(render('/second', secondStore, secondQueryClient, secondI18n), /\/second\|chat\|zh/);
  firstQueryClient.clear();
  secondQueryClient.clear();
});

function createCanonicalBindings(input: {
  readonly prefix: string;
  readonly locale: 'en' | 'zh';
}): DesktopCanonicalRendererBindings {
  const sdkUnavailable = (): never => {
    throw new Error('TEST_DESKTOP_SDK_UNAVAILABLE');
  };
  const element = () => ({
    nodeType: 1,
    setAttribute() {},
    removeAttribute() {},
    contains() { return false; },
  }) as unknown as HTMLElement;
  const renderer = element();
  const overlay = element();
  const host = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
    opaqueScopePrefix: input.prefix,
    declaredMethods: [],
    capabilities: [],
    localization: {
      locale: input.locale === 'zh' ? 'zh-CN' : 'en-US',
      language: input.locale,
      direction: 'ltr',
    },
    targets: { renderer, overlay },
    theme: createNimiRendererThemeController({
      scheme: 'light',
      accentPack: 'nimi-accent',
      density: 'compact',
    }),
    operations: {
      invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    },
    overlays: {
      target: overlay,
      acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
    },
    surfaceLifecycle: { reportReadyCandidate() {} },
  });
  let route: DesktopRendererRouteView = Object.freeze({
    pathname: `/${input.prefix}`,
    search: '',
    hash: '',
    state: null,
    key: input.prefix,
  });
  return createNimiCanonicalRendererHostBindings({
    scope: host.facade.scope,
    capabilities: host.facade.capabilities,
    localization: host.facade.localization,
    kit: host.facade,
    sdk: Object.freeze({
      isSessionReady: () => false,
      isRuntimeAccountSessionReady: () => false,
      appId: sdkUnavailable,
      machineProduct: sdkUnavailable,
      accountProduct: sdkUnavailable,
      connectorAdmin: sdkUnavailable,
      localEnvironmentRpc: sdkUnavailable,
      localAudit: sdkUnavailable,
      auditAdmin: sdkUnavailable,
      aiExecution: sdkUnavailable,
      externalAgent: sdkUnavailable,
      runtimeAgentOwner: sdkUnavailable,
      runtimeAgentDiscovery: sdkUnavailable,
      runtimeAgentTurns: sdkUnavailable,
      hostRuntimeAgent: sdkUnavailable,
      accountRuntime: sdkUnavailable,
      runtimeHealthCoordinator: sdkUnavailable,
      realm: sdkUnavailable,
      offline: createUnavailableDesktopRendererOfflinePort('TEST_OFFLINE_UNAVAILABLE'),
      socialData: Object.freeze({
        callApi: async () => {
          throw new Error('TEST_REALM_API_NOT_AVAILABLE');
        },
        emitDataError: () => undefined,
        offline: Object.freeze({
          async syncProfileMetadata() {},
          async loadProfileMetadata() { return null; },
          markCacheFallbackUsed() {},
          markRealmUnreachable() {},
          async queueSocialMutation() {},
        }),
      }),
      accountCaller: sdkUnavailable,
      withRuntimeProtectedScopes: sdkUnavailable,
    }),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          bootstrapError: null,
          bootstrapReady: true,
          chatThinkingPreference: 'off' as const,
          development: false,
        }),
        attention: createIdleAppAttentionState,
        localDevelopmentAvailable: () => false,
        loginMode: () => 'embedded',
        developerModeEnabled: () => false,
        viewportWidth: () => 1_280,
        viewportHeight: () => 800,
        documentVisible: () => true,
        windowFocused: () => true,
        titlebarDragEnabled: () => false,
        menuBarShellEnabled: () => false,
        resourceBaseUrl: () => 'https://simulator.invalid/',
        walletCheckoutBaseUrl: () => 'https://simulator.invalid/',
      }),
      commands: Object.freeze({
        auth: createUnavailableDesktopRendererAuthPort(),
        firstRun: createUnavailableDesktopFirstRunPort('TEST_FIRST_RUN_UNADMITTED'),
        runtimeConfigNavigation: createDesktopRendererRuntimeConfigNavigationPort(),
        settings: createMemoryDesktopRendererSettingsPort(),
        worldFollow: createUnavailableDesktopRendererWorldFollowPort('TEST_WORLD_FOLLOW_UNAVAILABLE'),
        supportRepair: createUnavailableDesktopRendererSupportRepairPort('TEST_SUPPORT_REPAIR_UNAVAILABLE'),
        supportLogs: createUnavailableDesktopRendererSupportLogsPort('TEST_SUPPORT_LOGS_UNAVAILABLE'),
        systemResources: createUnavailableDesktopRendererSystemResourcesPort('TEST_SYSTEM_RESOURCES_UNAVAILABLE'),
        voiceCapture: createUnavailableDesktopRendererVoiceCapturePort('TEST_VOICE_CAPTURE_UNAVAILABLE'),
        localModelProgress: createMemoryDesktopRendererLocalModelProgressPort(),
        virtualization: createDeterministicDesktopVirtualizationPort(),
        avatarHandoff: createUnavailableDesktopRendererAvatarHandoffPort('TEST_AVATAR_HANDOFF_UNAVAILABLE'),
        connectorAuth: Object.freeze({
          async acquireManagedConnectorCredential() {
            throw new Error('TEST_CONNECTOR_AUTH_UNADMITTED');
          },
        }),
        runtimeDaemon: Object.freeze({
          available: () => false,
          async status() { throw new Error('TEST_RUNTIME_DAEMON_UNADMITTED'); },
          async start() { throw new Error('TEST_RUNTIME_DAEMON_UNADMITTED'); },
          async restart() { throw new Error('TEST_RUNTIME_DAEMON_UNADMITTED'); },
        }),
        persistChatThinkingPreference() {},
        async reportAuthEntryAction() { return { ok: false as const, disposition: 'unsupported' as const }; },
        applyLocale() {},
        async openWalletCheckout() { return { opened: false }; },
        async openAccountManagement() { throw new Error('unavailable'); },
        async writeClipboardText() {},
        exportRuntimeAuditJson() {},
        confirmRuntimeProfileInstall() { return false; },
        async pickLocalRuntimeAssetFile() { return null; },
        async pickLocalRuntimeAssetDirectory() { return null; },
        async revealLocalRuntimeAssetsRootFolder() {},
        async reconcileLoginState() { return { clearAuthSession: false }; },
        reloadApplication() {},
        async startWindowDrag() {},
        async listLocalDevelopmentRegistrations() { return []; },
        async listLocalDevelopmentRuns() { return []; },
        async removeLocalDevelopmentRegistration() { throw new Error('TEST_UNAVAILABLE'); },
        async refreshDeveloperMode() { throw new Error('TEST_DEVELOPER_MODE_UNADMITTED'); },
        async setDeveloperMode() { throw new Error('TEST_DEVELOPER_MODE_UNADMITTED'); },
      }),
      events: Object.freeze({
        connectChatRealtimeSync: () => () => undefined,
        subscribeWindowFocus: () => () => undefined,
        subscribeDocumentVisibility: () => () => undefined,
        subscribeWindowResize: () => () => undefined,
        subscribeWindowKeyDown: () => () => undefined,
        subscribeDocumentMouseDown: () => () => undefined,
        subscribeDocumentClick: () => () => undefined,
        subscribeDocumentPointerDown: () => () => undefined,
        observeIntersection: () => () => undefined,
        subscribeAttention: () => () => undefined,
        subscribeDeveloperMode: () => () => undefined,
        subscribeProductControlRecord: () => () => undefined,
        connectDesktopOpenIntents: () => () => undefined,
        connectLifecycle(lifecycle: Parameters<
          DesktopCanonicalRendererBindings['app']['events']['connectLifecycle']
        >[0]) {
          lifecycle.setBootstrapError(null);
          lifecycle.setBootstrapReady(true);
          return () => undefined;
        },
      }),
    },
    route: Object.freeze({
      get: () => route,
      subscribe: () => () => undefined,
      navigate(next: { readonly to: string; readonly replace: boolean; readonly state?: unknown }) {
        route = Object.freeze({ ...route, pathname: next.to, state: next.state ?? null });
      },
      go() {},
    }),
    clock: Object.freeze({
      now: () => 1_000,
      schedule() {
        return () => undefined;
      },
      animationFrame() {
        return () => undefined;
      },
    }),
    surfaceLifecycle: host.facade.surfaceLifecycle,
  });
}

test('canonical Desktop resources are fresh for every factory invocation', async () => {
  const firstBindings = createCanonicalBindings({ prefix: 'desktop-first', locale: 'en' });
  const secondBindings = createCanonicalBindings({ prefix: 'desktop-second', locale: 'zh' });
  const first = createDesktopRendererResources(firstBindings);
  const second = createDesktopRendererResources(secondBindings);
  await Promise.all([first.i18n.init(), second.i18n.init()]);

  first.store.getState().setActiveTab('explore');
  first.queryClient.setQueryData(['instance'], 'first');
  const firstAbortController = first.streamController.startStream('shared-chat');
  first.scenarioJobController.startJobTracking('shared-job');

  assert.notEqual(first.store, second.store);
  assert.notEqual(first.queryClient, second.queryClient);
  assert.notEqual(first.i18n.instance, second.i18n.instance);
  assert.notEqual(first.Router, second.Router);
  assert.notEqual(first.streamController, second.streamController);
  assert.equal(first.store.getState().activeTab, 'explore');
  assert.equal(second.store.getState().activeTab, 'chat');
  assert.equal(first.queryClient.getQueryData(['instance']), 'first');
  assert.equal(second.queryClient.getQueryData(['instance']), undefined);
  assert.equal(first.streamController.getStreamState('shared-chat').phase, 'waiting');
  assert.equal(second.streamController.getStreamState('shared-chat').phase, 'idle');
  assert.equal(first.scenarioJobController.getJobState('shared-job').phase, 'subscribing');
  assert.equal(second.scenarioJobController.getJobState('shared-job').phase, 'idle');
  assert.equal(first.i18n.getCurrentLocale(), 'en');
  assert.equal(second.i18n.getCurrentLocale(), 'zh');

  first.dispose();
  assert.equal(firstAbortController.signal.aborted, true);
  second.dispose();
});

test('renderer settings ports isolate selection, subscriptions, and preferences per instance', () => {
  const first = createMemoryDesktopRendererSettingsPort();
  const second = createMemoryDesktopRendererSettingsPort();
  const opened: string[] = [];
  const unsubscribe = first.subscribeOpenSection((id) => opened.push(id));
  const firstPreferences: AppearancePreferences = {
    theme: 'dark',
    reduceMotion: true,
  };

  first.openSection('developer');
  first.persistAppearancePreferences(firstPreferences);

  assert.equal(first.loadSelected('profile'), 'developer');
  assert.equal(second.loadSelected('profile'), 'profile');
  assert.deepEqual(opened, ['developer']);
  assert.deepEqual(first.loadAppearancePreferences(), firstPreferences);
  assert.deepEqual(second.loadAppearancePreferences(), {
    theme: 'system',
    reduceMotion: false,
  });

  unsubscribe();
  first.openSection('profile');
  assert.deepEqual(opened, ['developer']);
});

test('runtime config navigation retains pre-subscription intent and isolates renderer instances', () => {
  const first = createDesktopRendererRuntimeConfigNavigationPort();
  const second = createDesktopRendererRuntimeConfigNavigationPort();
  const revisions: number[] = [];

  first.openPage('profiles');
  const unsubscribe = first.subscribe(() => revisions.push(first.get().revision));
  first.focusAction({
    page: 'cloud',
    action: 'add-connector',
    focus: 'runtime-config-action-focus.cloud-connector-draft',
  });

  assert.deepEqual(first.get(), {
    revision: 2,
    intent: {
      kind: 'focus-action',
      actionFocus: {
        page: 'cloud',
        action: 'add-connector',
        focus: 'runtime-config-action-focus.cloud-connector-draft',
      },
    },
  });
  assert.deepEqual(second.get(), {
    revision: 0,
    intent: null,
  });
  assert.deepEqual(revisions, [2]);

  unsubscribe();
  first.openPage('localModels');
  assert.deepEqual(revisions, [2]);
});
