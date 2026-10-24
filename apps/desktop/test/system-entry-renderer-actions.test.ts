import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiRuntimeAgentSourceContextStatus } from '@nimiplatform/sdk/runtime';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { SystemEntryProjection } from '../src/shell/shared/system-entry-types.js';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { executeSystemEntryRendererAction } from '../src/shell/renderer/features/system-entry/system-entry-renderer-actions.js';
import { characterSourceRefKey } from '../src/shell/renderer/features/realm-source/realm-source-identity.js';

function setup() {
  const navigation = createHomeNavigation();
  const section = { status: 'available' as const, observedAt: null, total: 0, items: [] };
  const projection: SystemEntryProjection = { generation: 'account-a', revision: 1, locale: 'en', colorScheme: 'light', observedAt: '2026-10-23T03:00:00.000Z', service: 'running',
    attention: section, work: section, recent: section, apps: section, downloads: section,
    usage: { status: 'available', observedAt: null, periodLabel: 'Today', attempts: '0', localAttempts: '0', cloudAttempts: '0', costs: [], partial: false, note: '' },
    notificationsEnabled: false, notificationsPausedUntil: 0 };
  let pause = 0, opened = 0;
  const input: Parameters<typeof executeSystemEntryRendererAction>[1] = {
    context: () => ({ generation: 'account-a', state: 'ready', homeVisible: true }),
    readCurrentContext: async () => ({ generation: 'account-a', state: 'ready', homeVisible: true }),
    published: () => projection, navigation, sdk: {} as DesktopRendererSdkPort, ownerUserId: 'user-a', appEntries: [], agents: [], activityRecords: [],
    openActivity: async () => { opened += 1; throw new Error('unexpected-open'); },
    notifications: { enabled: false, pausedUntil: 0, pause: async () => { pause += 1; }, resume: async () => { pause += 1; } },
    reading: { openUsage: async () => {}, openCurrentWork: async () => {} },
    setAgentConversationTargetSnapshot: () => {}, refresh: async () => {},
  };
  return { input, projection, counts: () => ({ pause, opened }) };
}

test('old generation action is rejected before navigation or source effects', async () => {
  const value = setup();
  await assert.rejects(executeSystemEntryRendererAction({ requestId: 'request-a', generation: 'old-account', revision: 1, action: { kind: 'downloads' } }, value.input), /system-entry-view-stale/);
  assert.equal(value.input.navigation.getSnapshot().current.destination.id, 'home');
  assert.deepEqual(value.counts(), { pause: 0, opened: 0 });
});

test('permanently disabled notifications route to Settings and cannot be enabled by resume', async () => {
  const value = setup();
  await assert.rejects(executeSystemEntryRendererAction({ requestId: 'request-a', generation: 'account-a', revision: 1, action: { kind: 'resume-notifications' } }, value.input), /system-entry-notifications-disabled/);
  await executeSystemEntryRendererAction({ requestId: 'request-b', generation: 'account-a', revision: 1, action: { kind: 'notification-settings' } }, value.input);
  assert.deepEqual(value.input.navigation.getSnapshot().current.destination, { id: 'settings', settingsSection: 'notifications' });
  assert.equal(value.counts().pause, 0);
});

test('Runtime Agent activity never becomes an App object-open or Conversation action', async () => {
  const value = setup();
  const action = { kind: 'open-activity' as const, activityId: 'runtime-activity' };
  const projection: SystemEntryProjection = { ...value.projection, attention: { status: 'available', observedAt: null, total: 1, items: [{ id: 'runtime-activity', title: 'New reply', detail: '', action }] } };
  const input = { ...value.input, published: () => projection,
    activityRecords: [{ activityId: 'runtime-activity', source: { kind: 'runtime-agent' }, objectRef: null }] as unknown as NimiAppActivityRecord[] };
  await assert.rejects(executeSystemEntryRendererAction({ requestId: 'request-a', generation: 'account-a', revision: 1, action }, input), /system-entry-activity-unavailable/);
  assert.equal(value.counts().opened, 0);
});

test('focus forwards its original request and generation only for the exact published source', async () => {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals.__NIMI_ELECTRON_RUNTIME__;
  const previousWindow = globals.window;
  globals.window = { __NIMI_HTML_BOOT_ID__: 'focus-scope-test' };
  const calls: Array<{ command: string; payload: unknown }> = [];
  globals.__NIMI_ELECTRON_RUNTIME__ = { invoke: async (command: string, payload: unknown) => {
    if (command === 'log_renderer_event') return {};
    calls.push({ command, payload });
    return command === 'installed_app_focus' ? { state: 'running', launchSelector: [1, 2] } : { state: 'running', selector: 'dev-project-one' };
  } };
  try {
    for (const source of [{ kind: 'local-development' as const, selector: 'dev-project-one' }, { kind: 'installed' as const, launchSelector: [1, 2] }]) {
      const value = setup();
      const action = { kind: 'focus-app' as const, entryKey: 'exact-source', source };
      const entry = { identity: { entryKey: action.entryKey }, run: { state: 'running' },
        localDevelopment: source.kind === 'local-development' ? { selector: source.selector } : null,
        committedRelease: source.kind === 'installed' ? { launchSelector: Uint8Array.from(source.launchSelector) } : null };
      const input = { ...value.input, appEntries: [entry] as unknown as typeof value.input.appEntries,
        published: () => ({ ...value.projection, apps: { ...value.projection.apps, total: 1, items: [{ id: 'app', title: 'App', detail: '', action }] } }) };
      const request = { requestId: 'native-request', generation: 'account-a', revision: 1, action };
      await executeSystemEntryRendererAction(request, input);
      assert.deepEqual(calls.at(-1), { command: source.kind === 'installed' ? 'installed_app_focus' : 'local_development_registration_focus', payload: { payload: {
        ...(source.kind === 'installed' ? { launchSelector: [1, 2] } : { selector: 'dev-project-one' }), generation: 'account-a', requestId: 'native-request',
      } } });
      const count = calls.length;
      if (entry.localDevelopment) entry.localDevelopment.selector = 'dev-project-other';
      else entry.committedRelease!.launchSelector = Uint8Array.from([1, 3]);
      await assert.rejects(executeSystemEntryRendererAction(request, input), /system-entry-view-stale/);
      assert.equal(calls.length, count);
    }
  } finally {
    if (previous === undefined) delete globals.__NIMI_ELECTRON_RUNTIME__;
    else globals.__NIMI_ELECTRON_RUNTIME__ = previous;
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
  }
});

function chatSetup(deferredReference = false) {
  const base = setup();
  const sourceRef = { kind: 'worldCharacter' as const, id: 'same-character', worldId: 'world-1',
    worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world-1', entityId: 'same-character' }, sourceHash: 'a'.repeat(64) };
  const records = ['a', 'b'].map(id => ({ localAgentRef: `local-agent:agent-${id}`, ownerUserId: 'user-a',
    runtimeSourceRef: `runtime-source:agent-${id}`, displayName: `Agent ${id}`,
    sourceContextStatus: { schemaVersion: 'v2', ready: true, state: 'ready', reasonCode: 'none',
      localAgentRef: `local-agent:agent-${id}`, sourceRef, sourceSchemaVersion: 'realm.world-character-core/v1',
      snapshotSchemaVersion: 'v3', snapshotHash: 'a'.repeat(64), capturedAt: '2026-10-23T03:00:00.000Z',
      worldContentHash: 'b'.repeat(64), materializationContextHash: 'c'.repeat(64), coverageSections: [],
      lorebookReady: true, lorebookItemCount: 0, lorebookEstimatedTokens: '0' } satisfies NimiRuntimeAgentSourceContextStatus }));
  const agents = records.map(record => ({ localAgentRef: record.localAgentRef, ownerUserId: record.ownerUserId,
    runtimeSourceRef: record.runtimeSourceRef, displayName: record.displayName, sourceRef, sourceKey: characterSourceRefKey(sourceRef) }));
  const reference = { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Agent b' };
  const opened: string[] = [], resolved: string[] = [];
  let generation = 'account-a', now = 1_000;
  let finishReference!: () => void, referenceStarted!: () => void;
  const started = new Promise<void>(resolve => { referenceStarted = resolve; });
  const sdk = {
    runtimeAgentDiscovery: () => ({ listLocalAgents: async () => records }),
    resolveDesktopAgentReference: async ({ localAgentRef }: { localAgentRef: string }) => {
      resolved.push(localAgentRef); referenceStarted();
      if (deferredReference) await new Promise<void>(resolve => { finishReference = resolve; });
      return { reference };
    },
    conversation: () => ({ open: async ({ agentHandle }: { agentHandle: string }) => {
      opened.push(agentHandle); return { conversationAnchorId: 'anchor-b', activeTurnId: null };
    } }),
  } as unknown as DesktopRendererSdkPort;
  const action = { kind: 'continue-chat' as const, localAgentRef: agents[1]!.localAgentRef };
  const projection: SystemEntryProjection = { ...base.projection, recent: { status: 'available', observedAt: null, total: 1,
    items: [{ id: action.localAgentRef, title: 'Agent b', detail: '', action }] } };
  const context = () => ({ generation, state: 'ready' as const, homeVisible: true });
  return {
    input: { ...base.input, sdk, agents, context, readCurrentContext: async () => context(), published: () => projection, now: () => now },
    request: { requestId: 'continue-request', generation: 'account-a', revision: 1, action },
    opened, resolved, started,
    invalidate: () => { generation = 'new-activation'; },
    expire: () => { now = 15_001; },
    finish: () => finishReference(),
  };
}

test('continue chat does not open after its generation changes during reference resolution', async () => {
  const value = chatSetup(true);
  const pending = executeSystemEntryRendererAction(value.request, value.input);
  await value.started;
  value.invalidate(); value.finish();
  await assert.rejects(pending, /system-entry-view-stale/);
  assert.deepEqual(value.opened, []);
  assert.equal(value.input.navigation.getSnapshot().current.destination.id, 'home');
});

test('continue chat does not open after its deadline expires during reference resolution', async () => {
  const value = chatSetup(true);
  const pending = executeSystemEntryRendererAction(value.request, value.input);
  await value.started;
  value.expire(); value.finish();
  await assert.rejects(pending, /system-entry-action-expired/);
  assert.deepEqual(value.opened, []);
  assert.equal(value.input.navigation.getSnapshot().current.destination.id, 'home');
});

test('continue chat resolves only the selected LocalAgent when two share a character source', async () => {
  const value = chatSetup();
  await executeSystemEntryRendererAction(value.request, value.input);
  assert.deepEqual(value.resolved, ['local-agent:agent-b']);
  assert.deepEqual(value.opened, ['agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB']);
  assert.equal(value.input.navigation.getSnapshot().current.destination.id, 'chat');
});
