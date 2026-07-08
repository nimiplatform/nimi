import assert from 'node:assert/strict';
import test from 'node:test';

import { loadNimiRealmWorldIdentityById } from './index';

test('Realm public world helper loads a normalized world identity by id', async () => {
  const calls: string[] = [];
  const errors: string[] = [];
  const realm = {
    worldPublic: {
      async worldPublicControllerGetWorld(request: { readonly path: { readonly worldId: string } }) {
        calls.push(request.path.worldId);
        return {
          id: request.path.worldId,
          name: ' 唐代文人世界 ',
        };
      },
    },
  };

  const identity = await loadNimiRealmWorldIdentityById(
    realm,
    (action) => errors.push(action),
    ' world-1 ',
  );

  assert.deepEqual(identity, { id: 'world-1', name: '唐代文人世界' });
  assert.deepEqual(calls, ['world-1']);
  assert.deepEqual(errors, []);
});

test('Realm public world helper fails closed on invalid world identities', async () => {
  const realm = {
    worldPublic: {
      async worldPublicControllerGetWorld() {
        return { id: 'world-1', name: ' ' };
      },
    },
  };

  await assert.rejects(
    () => loadNimiRealmWorldIdentityById(realm, () => {}, ''),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_WORLD_ID_REQUIRED',
  );
  await assert.rejects(
    () => loadNimiRealmWorldIdentityById(realm, () => {}, 'world-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_REALM_WORLD_NAME_REQUIRED',
  );
});
