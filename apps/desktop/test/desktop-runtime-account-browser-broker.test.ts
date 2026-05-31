import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRuntimeOAuthAuthorizationUrl } from '@nimiplatform/kit/auth';

test('desktop runtime account authorize URL validator uses Kit OAuth helper', () => {
  const accepted = validateRuntimeOAuthAuthorizationUrl(
    'https://realm.nimi.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop',
  );
  assert.equal(
    accepted,
    'https://realm.nimi.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop',
  );
});

test('Kit runtime account authorize URL validator rejects missing and invalid runtime URLs cleanly', () => {
  for (const value of [
    '',
    'not a url',
    'file:///tmp/login',
    'https://auth.nimi.invalid/oauth/authorize?state=s&challenge=c',
    'https://realm.nimi.test/api/auth/oauth/token',
    'https://realm.nimi.test/api/auth/oauth/authorize#/login',
    'https://realm.nimi.test/api/auth/oauth/authorize?desktop_callback=http%3A%2F%2Flocalhost',
    'https://realm.nimi.test/api/auth/oauth/authorize?desktop_state=state',
  ]) {
    assert.throws(
      () => validateRuntimeOAuthAuthorizationUrl(value),
      /Runtime account login returned|Runtime account login did not return/,
      String(value),
    );
  }
});
