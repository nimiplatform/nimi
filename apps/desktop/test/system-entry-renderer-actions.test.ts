import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { SystemEntryProjection } from '../src/shell/shared/system-entry-types.js';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { executeSystemEntryRendererAction } from '../src/shell/renderer/features/system-entry/system-entry-renderer-actions.js';

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
    reading: { openAIActivity: async () => { await navigation.push({ id: 'home', homeSection: 'ai-activity' }); } },
    refresh: async () => {},
  };
  return { input, projection, counts: () => ({ pause, opened }) };
}

test('activity and usage actions share one Home destination and history entry', async () => {
  const value = setup();
  for (const kind of ['activity', 'usage'] as const) {
    await executeSystemEntryRendererAction({ requestId: kind, generation: 'account-a', revision: 1, action: { kind } }, value.input);
    assert.deepEqual(value.input.navigation.getSnapshot().current.destination, { id: 'home', homeSection: 'ai-activity' });
  }
  await value.input.navigation.back();
  assert.notEqual(value.input.navigation.getSnapshot().current.destination.homeSection, 'ai-activity');
  for (const homeSection of ['work', 'usage']) assert.throws(() => validateHomeDestination({ id: 'home', homeSection }), /Invalid Home homeSection/);
});

test('system-entry messages uses the same global message center as the bell', async () => {
  const value = setup();
  await executeSystemEntryRendererAction({ requestId: 'messages', generation: 'account-a', revision: 1, action: { kind: 'messages' } }, value.input);
  assert.deepEqual(value.input.navigation.getSnapshot().current.destination, { id: 'notification', messageFilter: 'all' });
  value.input.navigation.dispose();
});

test('system-entry Contacts opens conversations and preserves an active thread', async () => {
  const { input } = setup();
  const request = { requestId: 'favorites', generation: 'account-a', revision: 1, action: { kind: 'friends' } } as const;
  await executeSystemEntryRendererAction(request, input);
  assert.equal(input.navigation.getSnapshot().current.destination.chat?.contactsSection, 'conversations');
  await input.navigation.push({ id: 'contacts', chat: { mode: 'human', threadId: 'chat-eric' } });
  const activeThread = input.navigation.getSnapshot().current;
  await executeSystemEntryRendererAction(request, input);
  assert.equal(input.navigation.getSnapshot().current, activeThread);
  input.navigation.dispose();
});

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

test('the recent partner action opens the exact stable Home target', async () => {
  const { input, projection } = setup();
  const localAgentRef = 'local-agent:agent-b';
  const action = { kind: 'continue-chat' as const, localAgentRef };
  const amended = { ...input,
    agents: [{ localAgentRef, ownerUserId: input.ownerUserId, displayName: 'Partner B', runtimeSourceRef: 'runtime-source:b', sourceRef: { kind: 'worldCharacter' as const, id: 'partner-b', worldId: 'world-1', worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world-1', entityId: 'partner-b' }, sourceHash: 'a'.repeat(64) }, sourceKey: 'partner-b' }],
    published: () => ({ ...projection, recent: { ...projection.recent, total: 1, items: [{ id: localAgentRef, title: 'Partner B', detail: '', action }] } }),
  };
  const request = { requestId: 'continue-chat', generation: 'account-a', revision: 1, action };
  await executeSystemEntryRendererAction(request, amended);
  assert.deepEqual(input.navigation.getSnapshot().current.destination, { id: 'contacts', partnerChat: { localAgentRef } });
  input.navigation.dispose();
});
