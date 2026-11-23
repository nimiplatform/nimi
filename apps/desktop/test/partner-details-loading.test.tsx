import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { CharacterSourceRefV3 } from '../src/shell/renderer/features/realm-source/realm-source-identity.js';
import type { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';

const worldSourceRef: CharacterSourceRefV3 = {
  kind: 'worldCharacter',
  id: 'char-gan',
  worldId: 'world-market',
  worldEntityRef: { kind: 'worldEntity', worldId: 'world-market', entityId: 'entity-gan' },
  sourceHash: 'a'.repeat(64),
};

const cachedPartnerSource = {
  sourceRef: worldSourceRef,
  displayName: '甘老杓',
  worldName: '鲤灯夜游：星河渡水上夜市',
  summary: '笑眯眯缺颗门牙的拱桥糖画爷爷',
  updated: false,
  preview: { role: '糖画艺人', species: null, topics: [], voice: null },
  media: {
    assets: { avatar: null, portrait: null, profileCover: null, referenceImage: null, voiceSample: null },
    external: { avatarUrl: null, portraitUrl: null, profileCoverUrl: null, referenceImageUrl: null, voiceSampleUrl: null },
    unavailableResourceRefs: [],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function partnerAgentRecord(withSource = true) {
  return {
    localAgentRef: 'local-agent:gan',
    ownerUserId: 'account-a',
    runtimeSourceRef: 'source-gan',
    displayName: '甘老杓',
    lifecycleStatus: AgentLifecycleStatus.ACTIVE,
    createdAt: { seconds: BigInt(1795168441), nanos: 0 },
    ...(withSource ? {
      sourceContextStatus: {
        schemaVersion: 2,
        ready: false,
        state: 2,
        reasonCode: 3,
        localAgentRef: 'local-agent:gan',
        sourceSchemaVersion: 'realm.world-character-core/v1',
        sourceRef: {
          worldCharacter: {
            kind: 1,
            id: worldSourceRef.id,
            worldId: worldSourceRef.worldId,
            sourceHash: worldSourceRef.sourceHash,
            worldEntityRef: { kind: 1, worldId: worldSourceRef.worldId, entityId: worldSourceRef.worldEntityRef.entityId },
          },
        },
      },
    } : {}),
  };
}

async function fullWorldCharacterProfile() {
  const { liBaiRaw, toSourceDetailData } = await import('./source-detail-world-character-test-utils.js');
  const sample = toSourceDetailData(liBaiRaw, 'local_agent_available');
  return {
    source: {
      ...sample,
      displayName: '甘老杓',
      worldId: worldSourceRef.worldId,
      worldName: '鲤灯夜游：星河渡水上夜市',
      sourceId: worldSourceRef.id,
      sourceHash: worldSourceRef.sourceHash,
      sourceRef: worldSourceRef,
    },
    stats: null,
  };
}

async function withDomHarness(run: (ctx: {
  document: Document;
  store: ReturnType<typeof createAppStore>;
  mount: (
    client: QueryClient,
    bindings: DesktopCanonicalRendererBindings,
    destination?: { id: 'contacts'; contactView: 'partners'; partner: { localAgentRef: string; settingsSection?: 'overview' } },
  ) => Promise<void>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    PointerEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: class ResizeObserver { observe() {} unobserve() {} disconnect() {} },
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in globals)) {
      globals[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { changeLocale, initI18n, i18n } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n();
  await changeLocale('zh');
  const { createRoot } = await import('react-dom/client');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { PartnerDetails } = await import('../src/shell/renderer/features/agents/partner-details.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'account-a' });
  const clients: QueryClient[] = [];
  try {
    await run({
      document: dom.window.document,
      store,
      mount: async (client, bindings, destination) => {
        clients.push(client);
        await store.navigation.push(destination ?? {
          id: 'contacts',
          contactView: 'partners',
          partner: { localAgentRef: 'local-agent:gan' },
        });
        await act(async () => {
          root.render(
            <I18nextProvider i18n={i18n}>
              <QueryClientProvider client={client}>
                <AppStoreProvider store={store}>
                  <DesktopRendererBindingProvider bindings={bindings}>
                    <PartnerDetails localAgentRef="local-agent:gan" accountId="account-a" scopeKey="realm:1" />
                  </DesktopRendererBindingProvider>
                </AppStoreProvider>
              </QueryClientProvider>
            </I18nextProvider>,
          );
        });
      },
    });
  } finally {
    await act(async () => root.unmount());
    for (const client of clients) client.clear();
    store.navigation.dispose();
    await new Promise(resolve => setTimeout(resolve, 25));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function makeBindings({
  getAgent,
  getWorldCharacter,
  getWorldEntity,
}: {
  getAgent: () => Promise<{ agent: ReturnType<typeof partnerAgentRecord> }>;
  getWorldCharacter?: () => Promise<unknown>;
  getWorldEntity?: () => Promise<unknown>;
}) {
  return {
    sdk: {
      appId: () => 'nimi.desktop',
      withRuntimeProtectedScopes: async (_scopes: unknown, call: (options: object) => unknown) => call({}),
      accountProduct: () => ({ agents: { getAgent } }),
      resolveDesktopAgentReference: async () => ({
        reference: { agentHandle: 'agent_gan', displayName: '甘老杓', avatarUrl: 'https://cdn.example.test/gan.png' },
      }),
      appProduct: () => ({
        agentConfigure: {
          presentation: {
            snapshot: async () => ({
              profile: null,
              previousProfile: null,
              defaultVoiceReference: '',
              avatarAutoplay: false,
              presentationRevision: '0',
              resourcePackSelection: null,
            }),
          },
        },
        agent: {
          getAutonomy: async () => ({ enabled: false, freeContactEnabled: false }),
          getMemory: async () => ({ enabled: true, state: 'empty' }),
          getAppearance: async () => ({ status: 'unconfigured' }),
        },
      }),
      realm: () => ({
        worldCore: {
          worldCoreControllerGetWorldCharacter: getWorldCharacter ?? (async () => { throw new Error('world character fetch failed'); }),
          worldCoreControllerGetWorldEntity: getWorldEntity ?? (async () => { throw new Error('entity fetch failed'); }),
          worldCoreControllerListWorldRelationships: async () => [],
          worldCoreControllerGetRelationshipTargets: async () => [],
        },
        worldPublic: {
          worldPublicControllerGetCharacterSource: async () => { throw new Error('source fetch failed'); },
          worldPublicControllerGetWorldCatalogByIds: async () => [],
        },
      }),
    },
    app: {
      commands: {
        avatarHandoff: { available: () => false },
        runtimeConfigNavigation: { openSetupTask: () => {}, openPage: () => {} },
      },
    },
  } as unknown as DesktopCanonicalRendererBindings;
}

test('PartnerDetails uses partner skeleton while agent loads and isomorphic loading view while public profile loads', async () => {
  await withDomHarness(async ({ document, mount }) => {
    const agentRead = deferred<{ agent: ReturnType<typeof partnerAgentRecord> }>();
    const profileRead = deferred<unknown>();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    // Sidebar row already warms the partner-current-source cache.
    client.setQueryData(['partner-current-source', 'account-a', 'realm:1', 'local-agent:gan', worldSourceRef], cachedPartnerSource);

    await mount(client, makeBindings({
      getAgent: () => agentRead.promise,
      getWorldCharacter: () => profileRead.promise,
    }));

    // 1. Initial local agent read uses partner-shaped SourceDetailSkeleton, never a fallback card.
    const initialSkeleton = document.querySelector('[data-testid="source-detail-skeleton"]');
    assert.ok(initialSkeleton, 'expected partner SourceDetailSkeleton while selected agent is pending');
    assert.equal(initialSkeleton?.getAttribute('data-skeleton-variant'), 'partner');
    assert.equal(document.querySelector('[data-testid="partner-fallback-header"]'), null);

    // 2. Once agent resolves, profile is still pending: render isomorphic PartnerProfileLoading, NOT fallback white card.
    await act(async () => {
      agentRead.resolve({ agent: partnerAgentRecord(true) });
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    assert.ok(document.querySelector('[data-testid="partner-character-profile-loading"]'));
    assert.equal(document.querySelector('[data-testid="partner-fallback-header"]'), null);
    assert.ok(document.querySelector('[data-testid="world-character-hero-banner"]'));
    assert.ok(document.querySelector('[data-testid="world-character-world-pill"]')?.textContent?.includes('鲤灯夜游：星河渡水上夜市'));
    assert.ok(document.querySelector('[data-testid="world-character-dossier-column"]'));
    assert.ok(document.body.textContent?.includes('正在读取来源资料'));

    // 3. Once profile lands in cache, transition cleanly to CharacterSourceDetailPage.
    const profileData = await fullWorldCharacterProfile();
    await act(async () => {
      client.setQueryData(
        ['source-display-detail', `worldCharacter:${worldSourceRef.worldId}:${worldSourceRef.id}:${worldSourceRef.worldEntityRef.entityId}:${worldSourceRef.sourceHash}`, 'account-a', 'realm:1'],
        profileData,
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.ok(document.querySelector('[data-testid="character-source-detail-page"]'));
    assert.equal(document.querySelector('[data-testid="partner-character-profile-loading"]'), null);
    assert.equal(document.querySelector('[data-testid="partner-fallback-header"]'), null);
  });
});

test('PartnerDetails falls back cleanly without duplicating creation time when profile fails or partner has no sourceRef', async () => {
  await withDomHarness(async ({ document, mount }) => {
    // Case A: partner with sourceRef whose profile fetch fails -> degraded fallback card + warning + single "创建于".
    const failedClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    failedClient.setQueryData(['partner-current-source', 'account-a', 'realm:1', 'local-agent:gan', worldSourceRef], cachedPartnerSource);
    await mount(failedClient, makeBindings({
      getAgent: async () => ({ agent: partnerAgentRecord(true) }),
    }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    assert.ok(document.querySelector('[data-testid="partner-fallback-header"]'));
    assert.equal(document.querySelector('[data-testid="partner-character-profile-loading"]'), null);
    assert.ok(document.body.textContent?.includes('来源资料暂不可用'));
    const createdMatches = document.body.textContent?.match(/创建于/g) ?? [];
    assert.equal(createdMatches.length, 1, 'fallback view must not duplicate the partner creation timestamp');

    // Case B: partner without sourceRef -> fallback card without error alert or loading skeleton.
    const noSourceClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    await mount(noSourceClient, makeBindings({
      getAgent: async () => ({ agent: partnerAgentRecord(false) }),
    }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    assert.ok(document.querySelector('[data-testid="partner-fallback-header"]'));
    assert.equal(document.querySelector('[data-testid="partner-character-profile-loading"]'), null);
    assert.equal((document.body.textContent?.match(/创建于/g) ?? []).length, 1);
  });
});

test('PartnerDetails places manage partner and desktop avatar actions inside the overflow menu', async () => {
  await withDomHarness(async ({ document, store, mount }) => {
    store.getState().applyRuntimeAccountProjection({
      status: 'authenticated',
      user: { id: 'account-a', realmEnvironmentId: 'realm:1' },
      sequence: '1',
      reasonCode: '',
      accountReasonCode: '',
      deletedOwner: null,
      authorizationRevision: 'rev-1',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(['partner-current-source', 'account-a', 'realm:1', 'local-agent:gan', worldSourceRef], cachedPartnerSource);
    client.setQueryData(
      ['source-display-detail', `worldCharacter:${worldSourceRef.worldId}:${worldSourceRef.id}:${worldSourceRef.worldEntityRef.entityId}:${worldSourceRef.sourceHash}`, 'account-a', 'realm:1'],
      await fullWorldCharacterProfile(),
    );
    const bindings = makeBindings({ getAgent: async () => ({ agent: partnerAgentRecord(true) }) });
    (bindings.app.commands.avatarHandoff as { available: () => boolean }).available = () => true;

    await mount(client, bindings);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });

    // Top bar shows only the primary conversation button and the overflow trigger, not standalone manage/avatar buttons.
    const visibleButtons = [...document.querySelectorAll('button')].map(button => button.textContent?.trim() ?? '');
    assert.ok(visibleButtons.some(text => text.includes('打开会话')));
    assert.equal(visibleButtons.some(text => text.includes('管理伙伴')), false, 'manage button should be inside the overflow menu');
    assert.equal(visibleButtons.some(text => text.includes('设置桌面形象')), false, 'avatar button should be inside the overflow menu');

    const moreTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="更多伙伴操作"]');
    assert.ok(moreTrigger, 'overflow menu trigger should exist');
    await act(async () => { moreTrigger.click(); });

    const menuItems = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const manageItem = menuItems.find(item => item.textContent?.includes('管理伙伴'));
    const avatarItem = menuItems.find(item => item.textContent?.includes('设置桌面形象'));
    assert.ok(manageItem, 'overflow menu should contain 管理伙伴');
    assert.ok(avatarItem, 'overflow menu should contain 设置桌面形象');
    assert.equal(manageItem.disabled, false);
    assert.equal(avatarItem.disabled, false);

    await act(async () => { avatarItem.click(); });
    assert.equal(store.navigation.getSnapshot().current.destination.partner?.settingsSection, 'appearance');

    // Re-open menu and verify 管理伙伴 routes to overview.
    await act(async () => {
      await store.navigation.push({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: 'local-agent:gan' } });
    });
    const moreTriggerAgain = document.querySelector<HTMLButtonElement>('button[aria-label="更多伙伴操作"]');
    assert.ok(moreTriggerAgain);
    await act(async () => { moreTriggerAgain.click(); });
    const manageItemAgain = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes('管理伙伴'));
    assert.ok(manageItemAgain);
    await act(async () => { manageItemAgain.click(); });
    assert.equal(store.navigation.getSnapshot().current.destination.partner?.settingsSection, 'overview');
  });
});
