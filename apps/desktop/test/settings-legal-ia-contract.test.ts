import assert from 'node:assert/strict';
import test from 'node:test';

import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

test('settings positions admit About & Legal and reject documents as sections', async () => {
  const navigation = createHomeNavigation();
  await navigation.push({ id: 'settings', settingsSection: 'about-legal' });
  for (const settingsSection of ['privacy-policy', 'terms-of-service']) {
    assert.equal((await navigation.push({ id: 'settings', settingsSection })).status, 'invalid');
    assert.equal(navigation.getSnapshot().current.destination.settingsSection, 'about-legal');
  }
  await navigation.push({ id: 'privacy-policy' });
  await navigation.back();
  assert.equal(navigation.getSnapshot().current.destination.settingsSection, 'about-legal');
});
