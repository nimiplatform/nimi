import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NIMI_REALM_OAUTH_PROVIDER,
} from '@nimiplatform/sdk/realm';
import {
  PROFILE_OAUTH_UNAVAILABLE_REASON_KEY,
  profileOauthPlatform,
} from '../src/shell/renderer/features/settings/profile-oauth-platform.js';

test('Desktop profile OAuth seam fails closed until RuntimeAccountService exposes account linking', async () => {
  assert.deepEqual(profileOauthPlatform.availability(NIMI_REALM_OAUTH_PROVIDER.GOOGLE), {
    enabled: false,
    disabledReason: PROFILE_OAUTH_UNAVAILABLE_REASON_KEY,
  });
  await assert.rejects(
    () => profileOauthPlatform.linkProvider(NIMI_REALM_OAUTH_PROVIDER.GOOGLE),
    new Error(PROFILE_OAUTH_UNAVAILABLE_REASON_KEY),
  );
  await assert.rejects(
    () => profileOauthPlatform.unlinkProvider(NIMI_REALM_OAUTH_PROVIDER.GOOGLE),
    new Error(PROFILE_OAUTH_UNAVAILABLE_REASON_KEY),
  );
});
