import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const releaseInputs = {
  NIMI_ANDROID_RELEASE: '1',
  NIMI_ANDROID_PACKAGE_NAME: 'ai.nimi.apps.zhiyu.acceptance',
  NIMI_ANDROID_CLIENT_ID: 'zhiyu.android.acceptance',
  NIMI_ANDROID_REALM_ENVIRONMENT_ID: 'acceptance',
  NIMI_ANDROID_REALM_URL: 'https://realm.example.com',
  NIMI_ANDROID_OFFICIAL_WEB_URL: 'https://nimi.example.com',
  NIMI_ANDROID_REDIRECT_URI: 'https://zhiyu.example.com/nimi/android/callback',
};

function loadConfig(inputs = {}) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.startsWith('NIMI_ANDROID_')));
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
    "import config, { mobileAccess } from './capacitor.config.ts'; console.log(JSON.stringify({ config, mobileAccess }));",
  ], { cwd: appRoot, env: { ...env, ...inputs }, encoding: 'utf8' });
}

test('Android debug keeps its own package, callback and output', () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
  const { config, mobileAccess } = JSON.parse(result.stdout);
  assert.equal(config.appId, 'ai.nimi.apps.zhiyu.dev');
  assert.equal(config.webDir, 'dist-mobile');
  assert.equal(mobileAccess.redirectUri, 'ai.nimi.apps.zhiyu.dev:/oauth/callback');
});

test('Android release uses the supplied identity in both native and renderer inputs', () => {
  const result = loadConfig(releaseInputs);
  assert.equal(result.status, 0, result.stderr);
  const { config, mobileAccess } = JSON.parse(result.stdout);
  assert.equal(config.appId, releaseInputs.NIMI_ANDROID_PACKAGE_NAME);
  assert.equal(config.webDir, 'dist-mobile-release');
  assert.equal(config.loggingBehavior, 'none');
  assert.deepEqual(mobileAccess, {
    appId: 'nimi.zhiyu',
    clientId: releaseInputs.NIMI_ANDROID_CLIENT_ID,
    realmEnvironmentId: releaseInputs.NIMI_ANDROID_REALM_ENVIRONMENT_ID,
    realmBaseUrl: releaseInputs.NIMI_ANDROID_REALM_URL,
    officialWebBaseUrl: releaseInputs.NIMI_ANDROID_OFFICIAL_WEB_URL,
    redirectUri: releaseInputs.NIMI_ANDROID_REDIRECT_URI,
  });
  assert.deepEqual(config.plugins.NimiAppAccess, {
    realmBaseUrl: mobileAccess.realmBaseUrl,
    clientId: mobileAccess.clientId,
    redirectUri: mobileAccess.redirectUri,
  });
});

test('Android release refuses missing identity and development endpoints', () => {
  for (const [name, value] of [
    ['NIMI_ANDROID_CLIENT_ID', ''],
    ['NIMI_ANDROID_PACKAGE_NAME', 'ai.nimi.apps.zhiyu.dev'],
    ['NIMI_ANDROID_REALM_URL', 'http://realm.example.com'],
    ['NIMI_ANDROID_REALM_URL', 'https://localhost'],
    ['NIMI_ANDROID_REDIRECT_URI', 'ai.nimi.apps.zhiyu.dev:/oauth/callback'],
  ]) {
    const result = loadConfig({ ...releaseInputs, [name]: value });
    assert.notEqual(result.status, 0, `${name}=${value} must fail`);
    assert.match(result.stderr, new RegExp(name));
  }
});
