import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSdkLocalAppAuthority } from './lib/sdk-local-app-authority-check.mjs';

function positiveFixture() {
  return {
    appClient: [
      'id: rule.nimi.sdks.feature-clients.r034',
      'local-app maps only to the Runtime LOCAL_APP caller where the SDK receives a host-injected typed standard-shell carrier',
      'a valid session projects as session-bound independently of every permission so base entitlements may work while protected permissions remain unavailable',
      'id: rule.nimi.sdks.feature-clients.r040',
      'permissions.status and permissions.request map only to Runtime GetLocalAppPermissionStatus and RequestLocalAppPermission',
    ].join('\n'),
    runtime: [
      'id: rule.nimi.sdks.client-core.r041',
      'app-private storage is a base entitlement succeeding for a live principal, session, and account partition without a user permission',
    ].join('\n'),
    transport: [
      'The SDK local-development transport is host-injected by Kit and never renderer-constructed',
      'request-empty OpenLocalAppSession',
      'missing operation families remain typed unavailable',
    ].join('\n'),
    methodGroups: {
      groups: [
        { group: 'auth_service_projection', methods: ['OpenLocalAppSession'] },
        {
          group: 'account_service_projection',
          methods: ['GetLocalAppPermissionStatus', 'RequestLocalAppPermission'],
        },
        {
          group: 'local_development_service_projection',
          methods: ['GetDeveloperModeStatus', 'SetDeveloperMode', 'EvaluateLocalDevelopmentProject', 'DecideLocalDevelopmentProject', 'ListLocalDevelopmentAuthorizations', 'RevokeLocalDevelopmentAuthorization', 'EndLocalDevelopmentRun'],
        },
        { group: 'app_lifecycle_service_projection', methods: ['PrepareLocalAppLaunch', 'BindLocalAppProcess'] },
      ],
    },
  };
}

test('accepts the final SDK local-app authority carrier', () => {
  assert.deepEqual(validateSdkLocalAppAuthority(positiveFixture()), []);
});

test('rejects retired session vocabulary and an incomplete final method group', () => {
  const fixture = positiveFixture();
  fixture.appClient += ' OpenDesktopLaunchedAppSession';
  fixture.methodGroups.groups.find((row) => row.group === 'account_service_projection').methods.pop();
  const errors = validateSdkLocalAppAuthority(fixture);
  assert.ok(errors.some((error) => error.includes('OpenDesktopLaunchedAppSession')));
  assert.ok(errors.some((error) => error.includes('RequestLocalAppPermission')));
});

test('rejects a carrier that omits base entitlement posture', () => {
  const fixture = positiveFixture();
  fixture.appClient = fixture.appClient.replace('base entitlements may work', 'authenticated operations may work');
  const errors = validateSdkLocalAppAuthority(fixture);
  assert.ok(errors.some((error) => error.includes('base entitlements')));
});
