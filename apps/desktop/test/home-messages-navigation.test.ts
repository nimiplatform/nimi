import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

test('message center Back restores its filter while an ordinary bell entry starts at all sources', async () => {
  const navigation = createHomeNavigation();
  const filtered = { id: 'notification' as const, messageFilter: 'unread' as const, messageSource: 'realm' };
  await navigation.push(filtered);
  await navigation.push({ id: 'profile', profileId: 'person-a' });
  await navigation.back();
  assert.deepEqual(navigation.getSnapshot().current.destination, filtered);
  await navigation.push({ id: 'notification' });
  assert.deepEqual(navigation.getSnapshot().current.destination, { id: 'notification', messageFilter: 'all' });
  const entry = navigation.getSnapshot().current;
  await navigation.push({ id: 'notification', messageFilter: 'all' });
  assert.equal(navigation.getSnapshot().current, entry, 'bell and Home More do not add duplicate default positions');
  assert.throws(() => validateHomeDestination({ id: 'home', homeSection: 'center' }));
  assert.throws(() => validateHomeDestination({ id: 'notification', messageFilter: 'completed' }));
  navigation.dispose();
});
