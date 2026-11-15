import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

test('partner activity keeps its exact source and filter through an appearance detour', async () => {
  const navigation = createHomeNavigation();
  const activity = { id: 'partners', partner: { localAgentRef: 'local-agent:a', activity: { sourceRef: 'source-1', pendingOnly: true } } } as const;
  await navigation.push(activity);
  await navigation.push({ id: 'partners', partner: { localAgentRef: 'local-agent:a', settingsSection: 'appearance' } });
  await navigation.back();
  assert.deepEqual(navigation.getSnapshot().current.destination, activity);
  await navigation.push({ id: 'partners', partner: { localAgentRef: 'local-agent:b', activity: {} } });
  assert.deepEqual(navigation.getSnapshot().current.destination.partner?.activity, {});
  navigation.dispose();
});

test('partner positions reject mixed management and activity state and unknown filter inputs', () => {
  for (const partner of [
    { localAgentRef: 'a', settingsSection: 'appearance', activity: {} },
    { localAgentRef: 'a', activity: { pendingOnly: 'yes' } },
    { localAgentRef: 'a', activity: { appPrivatePath: '/work' } },
    { localAgentRef: 'a', activity: { sourceRef: '' } },
  ]) assert.throws(() => validateHomeDestination({ id: 'partners', partner }));
});
