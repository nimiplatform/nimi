import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';

async function reserveCallbackServer() {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
    close: () => new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed())),
  };
}

test('Realm fixture completes the real desktop OAuth browser redirect without exposing tokens', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'nimi-desktop-oauth-fixture-'));
  const manifestPath = resolve(tempDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ realmFixture: { restOnline: true } }), 'utf8');
  const fixture = await startRealmFixtureServer({ manifestPath });
  const callback = await reserveCallbackServer();

  try {
    const authorize = new URL('/api/auth/oauth/authorize', fixture.origin);
    authorize.searchParams.set('client_id', 'nimi.desktop');
    authorize.searchParams.set('redirect_uri', callback.redirectUri);
    authorize.searchParams.set('state', 'state-123');
    authorize.searchParams.set('code_challenge', 'challenge-123');
    const response = await fetch(authorize, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location') || '');
    assert.equal(location.origin + location.pathname, callback.redirectUri);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.equal(location.searchParams.get('code'), 'nimi-dev-kernel-fixture-code');
    assert.equal(response.headers.get('authorization'), null);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      realmFixture?: { runtimeAccountAuthorizationRequests?: Array<Record<string, unknown>> };
    };
    assert.deepEqual(manifest.realmFixture?.runtimeAccountAuthorizationRequests, [{
      clientId: 'nimi.desktop',
      redirectUri: callback.redirectUri,
      statePresent: true,
      codeChallengePresent: true,
    }]);
  } finally {
    await callback.close();
    await fixture.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Realm fixture rejects non-loopback desktop OAuth redirects', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'nimi-desktop-oauth-negative-'));
  const manifestPath = resolve(tempDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ realmFixture: { restOnline: true } }), 'utf8');
  const fixture = await startRealmFixtureServer({ manifestPath });
  try {
    const authorize = new URL('/api/auth/oauth/authorize', fixture.origin);
    authorize.searchParams.set('client_id', 'nimi.desktop');
    authorize.searchParams.set('redirect_uri', 'https://attacker.example/oauth/callback');
    authorize.searchParams.set('state', 'state-123');
    authorize.searchParams.set('code_challenge', 'challenge-123');
    const response = await fetch(authorize, { redirect: 'manual' });
    assert.equal(response.status, 400);
  } finally {
    await fixture.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Realm fixture switches only between candidate-declared checkpoint accounts', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'nimi-desktop-account-switch-'));
  const manifestPath = resolve(tempDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    devKernelCheckpoint: {
      allowedAccountIds: ['dev-kernel-account-primary', 'dev-kernel-account-secondary'],
    },
    realmFixture: {
      restOnline: true,
      currentUser: { id: 'dev-kernel-account-primary' },
    },
  }), 'utf8');
  const fixture = await startRealmFixtureServer({ manifestPath });
  try {
    const accepted = await fetch(`${fixture.origin}/__fixture/control/current-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'dev-kernel-account-secondary',
        displayName: '开发内核第二账号',
      }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as { accountId: string }).accountId, 'dev-kernel-account-secondary');

    const rejected = await fetch(`${fixture.origin}/__fixture/control/current-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'forged-account' }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { error: string }).error, 'dev_kernel_account_not_allowed');
  } finally {
    await fixture.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
