import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAccountManagementUrl } from '../src/shell/renderer/features/settings/account-management-url.js';

test('account management opens the canonical Web account path', () => {
  assert.equal(resolveAccountManagementUrl('https://nimi.example/path?ignored=1'), 'https://nimi.example/account');
  assert.equal(resolveAccountManagementUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/account');
});

test('account management rejects credentials, fragments, and insecure remote origins', () => {
  const credentialUrl = new URL('https://nimi.example');
  credentialUrl.username = 'test-user';
  credentialUrl.password = 'test-password';

  assert.throws(() => resolveAccountManagementUrl(credentialUrl.href), /invalid/);
  assert.throws(() => resolveAccountManagementUrl('https://nimi.example/#token'), /invalid/);
  assert.throws(() => resolveAccountManagementUrl('http://nimi.example'), /requires HTTPS/);
});
