import { homeShellPresence } from '../src/shell/renderer/app-shell/providers/home-shell-presence.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { openHomeSettings, subscribeSettingsEntry } from '../src/shell/renderer/features/settings/settings-entry.js';

test('normal support has exact Settings history while core domains stay independent', async () => {
  const nav = createHomeNavigation();
  await nav.push({ id: 'cloud', runtime: { connectorId: 'connection-1' } });
  await openHomeSettings(nav, 'troubleshooting');
  await openHomeSettings(nav, 'logs');
  await nav.back();
  assert.equal(nav.getSnapshot().current.destination.settingsSection, 'troubleshooting');
  await nav.back();
  assert.deepEqual(nav.getSnapshot().current.destination, { id: 'cloud', runtime: { connectorId: 'connection-1' } });
  for (const section of ['about-legal', 'privacy-policy', 'terms-of-service']) {
    assert.equal((await nav.push({ id: 'settings', settingsSection: section })).status, 'invalid');
  }
  assert.equal((await nav.push({ id: 'support' } as never)).status, 'invalid');
});

test('same Settings entry requests presentation without adding history, rejected leave does not present', async () => {
  const nav = createHomeNavigation();
  let presented = 0;
  const stop = subscribeSettingsEntry(nav, () => presented++);
  await openHomeSettings(nav, 'logs');
  const key = nav.getSnapshot().current.key;
  assert.equal((await openHomeSettings(nav, 'logs')).status, 'unchanged');
  assert.equal(nav.getSnapshot().current.key, key);
  assert.equal(presented, 2);
  const unregister = nav.registerLeaveGuard(() => 'cancel');
  assert.equal((await openHomeSettings(nav, 'appearance')).status, 'cancelled');
  assert.equal(presented, 2);
  unregister(); stop();
  await nav.back();
  assert.equal(nav.getSnapshot().current.destination.id, 'home');
});


test('normal Settings command availability follows the actual shell host, not bootstrap flags', () => {
  const nav = createHomeNavigation();
  const presence = homeShellPresence(nav);
  assert.equal(presence.getSnapshot(), false);
  const unmount = presence.mount();
  assert.equal(presence.getSnapshot(), true);
  unmount();
  assert.equal(presence.getSnapshot(), false);
  assert.equal(homeShellPresence(createHomeNavigation()).getSnapshot(), false);
});
