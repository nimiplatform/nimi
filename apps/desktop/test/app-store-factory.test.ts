import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  createEmptyNimiAIConfig,
  createNimiBuiltInChatAIScopeRef,
  type NimiAIConfig,
} from '@nimiplatform/sdk/ai';

import {
  createAppStore,
  type AppStoreDependencies,
} from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import {
  AppStoreProvider,
  useAppStore,
} from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createDesktopQueryClient } from '../src/shell/renderer/infra/query-client/query-client.js';
import { refreshAgentEffectiveCapabilityResolution } from '../src/shell/renderer/features/chat/conversation-capability-projection.js';
import { createDesktopI18n } from '../src/shell/renderer/i18n/desktop-i18n.js';
import { AppProviders } from '../src/shell/renderer/app-shell/providers/app-providers.js';
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

function createDependencies(input: {
  readonly commits: NimiAIConfig[];
  readonly preferences: string[];
  readonly modes: string[];
  readonly initialSurface?: 'nimi' | 'agent';
}): AppStoreDependencies {
  return {
    initialAIConfig: createEmptyNimiAIConfig(
      createNimiBuiltInChatAIScopeRef(input.initialSurface ?? 'nimi'),
    ),
    commitAIConfig(config) {
      input.commits.push(config);
    },
    initialChatThinkingPreference: 'off',
    persistChatThinkingPreference(preference) {
      input.preferences.push(preference);
    },
    setActiveScopeForMode(mode) {
      input.modes.push(mode);
    },
  };
}

test('createAppStore owns independent state and injected effects per renderer instance', () => {
  const firstEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const secondEffects = {
    commits: [] as NimiAIConfig[],
    preferences: [] as string[],
    modes: [] as string[],
    initialSurface: 'agent' as const,
  };
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
  assert.deepEqual(firstEffects.modes, ['agent']);
  assert.deepEqual(secondEffects.modes, []);
});

test('createAppStore commits AIConfig through only the owning instance dependency', () => {
  const firstEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const secondEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const first = createAppStore(createDependencies(firstEffects));
  const second = createAppStore(createDependencies(secondEffects));
  const nextConfig = createEmptyNimiAIConfig(createNimiBuiltInChatAIScopeRef('agent'));

  first.getState().setAIConfig(nextConfig);

  assert.equal(first.getState().aiConfig, nextConfig);
  assert.notEqual(second.getState().aiConfig, nextConfig);
  assert.deepEqual(firstEffects.commits, [nextConfig]);
  assert.deepEqual(secondEffects.commits, []);
});

test('AppStoreProvider resolves the store belonging to the current renderer tree', () => {
  const firstEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const secondEffects = {
    commits: [] as NimiAIConfig[],
    preferences: [] as string[],
    modes: [] as string[],
    initialSurface: 'agent' as const,
  };
  const first = createAppStore(createDependencies(firstEffects));
  const second = createAppStore(createDependencies(secondEffects));
  function ActiveScope() {
    return createElement('span', null, useAppStore((state) => state.aiConfig.scopeRef.surfaceId));
  }
  const render = (store: typeof first) => renderToStaticMarkup(
    createElement(AppStoreProvider, { store }, createElement(ActiveScope)),
  );

  assert.equal(render(first), '<span>nimi</span>');
  assert.equal(render(second), '<span>agent</span>');
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

test('capability projection refresh mutates only the owning renderer store', () => {
  const firstEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const secondEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const first = createAppStore(createDependencies(firstEffects));
  const second = createAppStore(createDependencies(secondEffects));

  refreshAgentEffectiveCapabilityResolution(first);

  assert.equal(first.getState().agentEffectiveCapabilityResolution?.reason, 'projection_unavailable');
  assert.equal(second.getState().agentEffectiveCapabilityResolution, null);
});

test('AppProviders owns independent route, store, query, and i18n resources', async () => {
  const firstEffects = { commits: [] as NimiAIConfig[], preferences: [] as string[], modes: [] as string[] };
  const secondEffects = {
    commits: [] as NimiAIConfig[],
    preferences: [] as string[],
    modes: [] as string[],
    initialSurface: 'agent' as const,
  };
  const firstStore = createAppStore(createDependencies(firstEffects));
  const secondStore = createAppStore(createDependencies(secondEffects));
  const firstQueryClient = createDesktopQueryClient();
  const secondQueryClient = createDesktopQueryClient();
  const firstI18n = createDesktopI18n({ initialLocale: 'en', development: false, now: () => 1 });
  const secondI18n = createDesktopI18n({ initialLocale: 'zh', development: false, now: () => 2 });
  await Promise.all([firstI18n.init(), secondI18n.init()]);

  function InstanceSnapshot() {
    const location = useLocation();
    const { i18n } = useTranslation();
    const surfaceId = useAppStore((state) => state.aiConfig.scopeRef.surfaceId);
    return createElement(
      'span',
      null,
      `${location.pathname}|${surfaceId}|${i18n.language}`,
    );
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
      attention: {
        getSnapshot: createIdleAppAttentionState,
        subscribe: () => () => undefined,
      },
      i18n,
      queryClient,
      Router: createRouter(entry),
      store,
    },
    createElement(InstanceSnapshot),
  ));

  assert.match(render('/first', firstStore, firstQueryClient, firstI18n), /\/first\|nimi\|en/);
  assert.match(render('/second', secondStore, secondQueryClient, secondI18n), /\/second\|agent\|zh/);
  firstQueryClient.clear();
  secondQueryClient.clear();
});

function createCanonicalBindings(input: {
  readonly prefix: string;
  readonly locale: 'en' | 'zh';
  readonly surface: 'nimi' | 'agent';
}): DesktopCanonicalRendererBindings {
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
    sdk: Object.freeze({}),
    app: {
      projection: Object.freeze({
        initialState: () => ({
          aiConfig: createEmptyNimiAIConfig(createNimiBuiltInChatAIScopeRef(input.surface)),
          bootstrapError: null,
          bootstrapReady: true,
          chatThinkingPreference: 'off' as const,
          development: false,
        }),
        attention: createIdleAppAttentionState,
        localDevelopmentAvailable: () => false,
      }),
      commands: Object.freeze({
        commitAIConfig() {},
        persistChatThinkingPreference() {},
        setActiveScopeForMode() {},
        applyLocale() {},
        async checkDesktopUpdate() {},
        async installDesktopUpdate() {},
        async restartDesktopUpdate() {},
        async startWindowDrag() {},
        async listLocalDevelopmentApprovals() { return []; },
        async decideLocalDevelopmentApproval() {},
      }),
      events: Object.freeze({
        subscribeAttention: () => () => undefined,
        async subscribeLocalDevelopmentApprovals() { return () => undefined; },
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
    clock: Object.freeze({ now: () => 1_000 }),
    surfaceLifecycle: host.facade.surfaceLifecycle,
  });
}

test('canonical Desktop resources are fresh for every factory invocation', async () => {
  const firstBindings = createCanonicalBindings({ prefix: 'desktop-first', locale: 'en', surface: 'nimi' });
  const secondBindings = createCanonicalBindings({ prefix: 'desktop-second', locale: 'zh', surface: 'agent' });
  const first = createDesktopRendererResources(firstBindings);
  const second = createDesktopRendererResources(secondBindings);
  await Promise.all([first.i18n.init(), second.i18n.init()]);

  first.store.getState().setActiveTab('explore');
  first.queryClient.setQueryData(['instance'], 'first');

  assert.notEqual(first.store, second.store);
  assert.notEqual(first.queryClient, second.queryClient);
  assert.notEqual(first.i18n.instance, second.i18n.instance);
  assert.notEqual(first.Router, second.Router);
  assert.equal(first.store.getState().activeTab, 'explore');
  assert.equal(second.store.getState().activeTab, 'chat');
  assert.equal(first.queryClient.getQueryData(['instance']), 'first');
  assert.equal(second.queryClient.getQueryData(['instance']), undefined);
  assert.equal(first.i18n.getCurrentLocale(), 'en');
  assert.equal(second.i18n.getCurrentLocale(), 'zh');

  first.dispose();
  second.dispose();
});
