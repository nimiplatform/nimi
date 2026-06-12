import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreClient } from '../core-client';
import { RealmGeneratedClient } from '../core-generated/realm-client';
import * as realmGenerated from './generated';

test('realm generated public barrel does not expose raw descriptor client surface', () => {
  assert.equal('RealmGeneratedClient' in realmGenerated, false);
  assert.equal('REALM_OPERATIONS' in realmGenerated, false);
  assert.equal('REALM_OPERATION_BY_ID' in realmGenerated, false);
  assert.equal('RealmTypedClient' in realmGenerated, true);
});

test('realm raw descriptor client rejects typed-facade-only group candidate operation', async () => {
  let unaryCalled = false;
  const client = new RealmGeneratedClient(new CoreClient({
    transport: {
      async unary() {
        unaryCalled = true;
        return {};
      },
      async *serverStream() {
        yield {};
      },
    },
  }));

  await assert.rejects(
    () => client.operation('commitRealmGroupMessageCandidate', {}),
    { code: 'SDK_REALM_OPERATION_TYPED_FACADE_REQUIRED' },
  );
  assert.equal(unaryCalled, false);
});
