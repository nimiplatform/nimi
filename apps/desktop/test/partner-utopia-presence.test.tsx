import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import {
  PartnerUtopiaPresence,
  openOrFocusUtopiaFromHome,
  projectPartnerUtopiaPresence,
} from '../src/shell/renderer/features/agents/partner-utopia-presence.js';
import { sessionFor, TEST_AGENT_HANDLE } from '../../../kit/features/agent-center/test/session-fixture.js';

const PEER_HANDLE = 'agent_peer_handle_002' as NimiUtopiaSnapshot['residents'][number]['agentHandle'];

function makeUtopiaSnapshot(overrides: Partial<NimiUtopiaSnapshot> = {}): NimiUtopiaSnapshot {
  return {
    revision: 'rev-1',
    observedAt: { seconds: String(Math.floor(Date.parse('2026-11-16T02:00:00Z') / 1000)), nanos: 0 },
    habitatActivationId: 'act-sea-1',
    contentDigest: 'digest-sea-1',
    timezone: 'Asia/Shanghai',
    publicParticipation: true,
    parameterValues: { weather: 'clear' },
    openPlaceIds: ['tea-pavilion'],
    activeEvents: [],
    relocation: null,
    occupancy: [{ placeId: 'tea-pavilion', agentHandles: [TEST_AGENT_HANDLE, PEER_HANDLE] }],
    sharedActivities: [
      {
        activityRef: 'shared-1',
        state: 'active',
        habitatActivationId: 'act-sea-1',
        habitatId: 'builtin.seaside-island',
        habitatTitle: '海风渔岛',
        placeId: 'tea-pavilion',
        placeLabel: '潮声茶棚',
        activityId: 'brew-tea',
        activityLabel: '听潮煮茶',
        initiatorHandle: TEST_AGENT_HANDLE,
        recipientHandle: PEER_HANDLE,
        windowStartsAt: { iso: '2026-11-16T01:50:00Z', epochMs: Date.parse('2026-11-16T01:50:00Z') },
        windowEndsAt: { iso: '2026-11-16T02:30:00Z', epochMs: Date.parse('2026-11-16T02:30:00Z') },
        confirmedStartAt: { iso: '2026-11-16T01:52:00Z', epochMs: Date.parse('2026-11-16T01:52:00Z') },
        settledOverlapSec: 480,
      },
    ],
    residents: [
      {
        agentHandle: TEST_AGENT_HANDLE,
        displayName: '阿青',
        solitary: false,
        current: {
          activityId: 'brew-tea',
          title: '听潮煮茶',
          habitatActivationId: 'act-sea-1',
          habitatId: 'builtin.seaside-island',
          habitatTitle: '海风渔岛',
          placeId: 'tea-pavilion',
          placeLabel: '潮声茶棚',
          startsAt: { iso: '2026-11-16T01:52:00Z', epochMs: Date.parse('2026-11-16T01:52:00Z') },
          endsAt: { iso: '2026-11-16T02:30:00Z', epochMs: Date.parse('2026-11-16T02:30:00Z') },
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: PEER_HANDLE,
        displayName: '阿禾',
        solitary: false,
        current: null,
        recent: null,
        next: null,
      },
    ],
    habitat: {
      schemaVersion: 1,
      habitatId: 'builtin.seaside-island',
      title: '海风渔岛',
      summary: '海风住地',
      themeTag: 'seaside',
      personalQuarter: { name: '听涛木屋', sensoryTraits: '安静木屋' },
      parameters: [],
      places: [
        {
          id: 'tea-pavilion',
          name: '潮声茶棚',
          archetype: 'waterside',
          indoor: true,
          sensoryTraits: '茶香',
          openWhen: [],
        },
      ],
      activities: [],
      presetEvents: [],
    },
    ...overrides,
  } as NimiUtopiaSnapshot;
}

test('projectPartnerUtopiaPresence projects shared, located, interacting, resting, and absent states accurately', () => {
  const sharedSnap = makeUtopiaSnapshot();
  assert.deepEqual(projectPartnerUtopiaPresence(sharedSnap, TEST_AGENT_HANDLE), {
    kind: 'shared',
    habitatTitle: '海风渔岛',
    placeLabel: '潮声茶棚',
    activityLabel: '听潮煮茶',
    partnerName: '阿禾',
  });

  const locatedSnap = makeUtopiaSnapshot({
    sharedActivities: [],
    residents: [
      {
        ...sharedSnap.residents[0]!,
        solitary: true,
        current: {
          ...sharedSnap.residents[0]!.current!,
          placeId: 'personal-quarter',
          placeLabel: '',
          title: 'Activity',
        },
      },
    ],
  });
  assert.deepEqual(projectPartnerUtopiaPresence(locatedSnap, TEST_AGENT_HANDLE), {
    kind: 'located',
    habitatTitle: '海风渔岛',
    placeLabel: '听涛木屋',
    activityTitle: null,
    solitary: true,
  });

  const staleActivationSnap = makeUtopiaSnapshot({
    sharedActivities: [],
    residents: [
      {
        ...sharedSnap.residents[0]!,
        current: {
          ...sharedSnap.residents[0]!.current!,
          habitatActivationId: 'old-activation',
        },
      },
    ],
  });
  assert.deepEqual(projectPartnerUtopiaPresence(staleActivationSnap, TEST_AGENT_HANDLE), {
    kind: 'resting',
    habitatTitle: '海风渔岛',
    solitary: false,
  });

  assert.equal(projectPartnerUtopiaPresence(sharedSnap, 'unknown_handle'), null);
});

test('openOrFocusUtopiaFromHome launches local-dev or installed nimi.utopia and opens Apps when absent', async () => {
  const devStarted: string[] = [];
  const installedLaunched: Uint8Array[] = [];
  const pushedDestinations: unknown[] = [];

  // 1. Local-development registration takes precedence when present
  const devOutcome = await openOrFocusUtopiaFromHome({
    sdk: {
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, releases: [] }),
        },
      }),
    } as never,
    commands: {
      listLocalDevelopmentRegistrations: async () => [
        { selector: 'sel-utopia-dev', appId: 'nimi.utopia' } as never,
      ],
      startLocalDevelopmentRegistration: async (sel) => {
        devStarted.push(sel);
        return { state: 'running', message: '' } as never;
      },
    },
    navigation: { push: async (dest) => { pushedDestinations.push(dest); return {} as never; } },
    isCurrent: () => true,
  });
  assert.equal(devOutcome, 'launched-dev');
  assert.deepEqual(devStarted, ['sel-utopia-dev']);

  // 2. Committed installed release launches via launchInstalled
  const selectorBytes = new Uint8Array([9, 8, 7]);
  const installedOutcome = await openOrFocusUtopiaFromHome({
    sdk: {
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({
            reasonCode: ReasonCode.ACTION_EXECUTED,
            releases: [{ appId: 'nimi.utopia', launchSelector: selectorBytes }],
          }),
        },
      }),
    } as never,
    commands: {
      listLocalDevelopmentRegistrations: async () => [],
      startLocalDevelopmentRegistration: async () => ({ state: 'stopped', message: '' } as never),
    },
    navigation: { push: async (dest) => { pushedDestinations.push(dest); return {} as never; } },
    launchInstalled: async (sel) => {
      installedLaunched.push(sel);
      return { launchSelector: [...sel], state: 'running', accessAvailable: true, accessReasonCode: '', message: '' };
    },
    isCurrent: () => true,
  });
  assert.equal(installedOutcome, 'launched-installed');
  assert.deepEqual([...installedLaunched[0]!], [9, 8, 7]);

  // 3. Neither registered nor installed -> navigates to Apps for nimi.utopia
  const fallbackOutcome = await openOrFocusUtopiaFromHome({
    sdk: {
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, releases: [] }),
        },
      }),
    } as never,
    commands: {
      listLocalDevelopmentRegistrations: async () => [],
      startLocalDevelopmentRegistration: async () => ({ state: 'stopped', message: '' } as never),
    },
    navigation: { push: async (dest) => { pushedDestinations.push(dest); return {} as never; } },
    isCurrent: () => true,
  });
  assert.equal(fallbackOutcome, 'opened-apps');
  assert.deepEqual(pushedDestinations, [{ id: 'apps', appId: 'nimi.utopia' }]);

  // 4. Multiple candidate registrations (or dev + installed) open Apps for disambiguation without guessing
  const ambiguousOutcome = await openOrFocusUtopiaFromHome({
    sdk: {
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({
            reasonCode: ReasonCode.ACTION_EXECUTED,
            releases: [{ appId: 'nimi.utopia', launchSelector: new Uint8Array([1, 2]) }],
          }),
        },
      }),
    } as never,
    commands: {
      listLocalDevelopmentRegistrations: async () => [
        { selector: 'sel-utopia-dev-a', appId: 'nimi.utopia' } as never,
      ],
      startLocalDevelopmentRegistration: async () => {
        throw new Error('must not auto-launch ambiguous candidate');
      },
    },
    navigation: { push: async (dest) => { pushedDestinations.push(dest); return {} as never; } },
    launchInstalled: async () => {
      throw new Error('must not auto-launch ambiguous installed candidate');
    },
    isCurrent: () => true,
  });
  assert.equal(ambiguousOutcome, 'opened-apps-ambiguous');
  assert.equal(pushedDestinations.length, 2);

  // 5. Departed scope while listing candidates aborts without launching or navigating
  let scopeAlive = true;
  let staleStartCalls = 0;
  let stalePushCalls = 0;
  const abortedOutcome = await openOrFocusUtopiaFromHome({
    sdk: {
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, releases: [] }),
        },
      }),
    } as never,
    commands: {
      listLocalDevelopmentRegistrations: async () => {
        scopeAlive = false;
        return [{ selector: 'sel-utopia-stale', appId: 'nimi.utopia' } as never];
      },
      startLocalDevelopmentRegistration: async () => {
        staleStartCalls += 1;
        return { state: 'running', message: '' } as never;
      },
    },
    navigation: { push: async () => { stalePushCalls += 1; return {} as never; } },
    isCurrent: () => scopeAlive,
  });
  assert.equal(abortedOutcome, 'aborted');
  assert.equal(staleStartCalls, 0, 'departed scope must not start Utopia');
  assert.equal(stalePushCalls, 0, 'departed scope must not navigate');

  // 6. Host `denied` / `stopped` / `build-failed` run states reject rather than reporting `launched-dev`
  for (const badState of ['denied', 'stopped', 'build-failed'] as const) {
    await assert.rejects(
      openOrFocusUtopiaFromHome({
        sdk: {
          machineProduct: () => ({
            apps: {
              listCommittedAppReleases: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, releases: [] }),
            },
          }),
        } as never,
        commands: {
          listLocalDevelopmentRegistrations: async () => [
            { selector: 'sel-utopia-denied', appId: 'nimi.utopia' } as never,
          ],
          startLocalDevelopmentRegistration: async () => ({ state: badState, message: `run-${badState}` } as never),
        },
        navigation: { push: async () => ({} as never) },
        isCurrent: () => true,
      }),
      new RegExp(`run-${badState}`),
    );
  }
});

test('PartnerUtopiaPresence stays hidden when life is off and renders habitat summary when life is enabled', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    CustomEvent: dom.window.CustomEvent,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'account-a' });
  await store.navigation.push({ id: 'partners', partner: { localAgentRef: 'local-agent:a' } });

  const lifeOffSession = await sessionFor({ autonomy: { revision: 'r1', enabled: false } });
  const lifeOnSession = await sessionFor({ autonomy: { revision: 'r2', enabled: true } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = createInstance();
  await i18n.init({
    lng: 'zh',
    resources: {
      zh: {
        translation: {
          runtimeConfig: {
            partners: {
              utopia: {
                habitat: '当前栖居 · {{habitat}}',
                sharedWith: '在{{place}}与{{partner}}{{activity}}',
                visit: '去洞天看望',
                observedAt: '观测于 {{time}}',
                staleNotice: '刷新未成功，当前显示上次记录',
                retryRefresh: '刷新',
              },
            },
          },
        },
      },
    },
    initImmediate: false,
  });

  let snapshotReads = 0;
  let failSubsequentReads = false;
  const bindings = {
    sdk: {
      appProduct: () => ({
        utopia: {
          snapshot: async () => {
            snapshotReads += 1;
            if (failSubsequentReads) {
              throw new Error('runtime-temporarily-unreachable');
            }
            return makeUtopiaSnapshot();
          },
        },
      }),
      machineProduct: () => ({
        apps: {
          listCommittedAppReleases: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, releases: [] }),
        },
      }),
    },
    app: {
      commands: {
        listLocalDevelopmentRegistrations: async () => [],
        startLocalDevelopmentRegistration: async () => ({ state: 'stopped', message: '' }),
      },
    },
  } as unknown as DesktopCanonicalRendererBindings;

  const render = (session: typeof lifeOnSession) => root.render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <AppStoreProvider store={store}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <PartnerUtopiaPresence
              session={session}
              agentHandle={TEST_AGENT_HANDLE}
              accountId="account-a"
              scopeKey="scope-1"
            />
          </DesktopRendererBindingProvider>
        </AppStoreProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );

  try {
    await act(async () => { render(lifeOffSession); });
    assert.equal(snapshotReads, 0, 'life-disabled partner must not poll utopia.snapshot');
    assert.equal(document.querySelector('[data-testid="partner-utopia-presence"]'), null);

    await act(async () => { render(lifeOnSession); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    assert.equal(snapshotReads, 1);
    const card = document.querySelector('[data-testid="partner-utopia-presence"]');
    assert.ok(card);
    assert.match(card.textContent ?? '', /当前栖居 · 海风渔岛/);
    assert.match(card.textContent ?? '', /观测于/);
    assert.match(card.textContent ?? '', /在潮声茶棚与阿禾听潮煮茶/);
    assert.match(card.textContent ?? '', /去洞天看望/);

    // Failed background refetch keeps last observed state visible with an explicit stale notice + retry trigger
    failSubsequentReads = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['home-utopia-snapshot', 'account-a', 'scope-1'] });
      await new Promise(resolve => setTimeout(resolve, 15));
    });
    assert.equal(snapshotReads, 2);
    assert.match(card.textContent ?? '', /刷新未成功，当前显示上次记录/);

    failSubsequentReads = false;
    const retryBtn = Array.from(card.querySelectorAll('button')).find(btn => btn.textContent === '刷新');
    assert.ok(retryBtn);
    await act(async () => {
      retryBtn.click();
      await new Promise(resolve => setTimeout(resolve, 15));
    });
    assert.equal(snapshotReads, 3);
    assert.doesNotMatch(card.textContent ?? '', /刷新未成功，当前显示上次记录/);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    lifeOffSession.dispose();
    lifeOnSession.dispose();
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
