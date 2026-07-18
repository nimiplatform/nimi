import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSdkLocalAppAuthority } from './lib/sdk-local-app-authority-check.mjs';

function positiveFixture() {
  return {
    appClient: 'local-app standardShell base entitlements public-permission',
    runtime: 'LOCAL_APP principal',
    transport: 'host-injected request-empty',
    index: 'nimi-app-client-contract.md',
    methodGroups: {
      groups: [
        { group: 'auth_service_projection', methods: ['OpenLocalAppSession'] },
        {
          group: 'account_service_projection',
          methods: ['GetLocalAppPermissionStatus', 'RequestLocalAppPermission'],
        },
        {
          group: 'local_development_service_projection',
          methods: ['GetDeveloperModeStatus', 'SetDeveloperMode', 'EvaluateLocalDevelopmentProject', 'DecideLocalDevelopmentProject', 'ListLocalDevelopmentAuthorizations', 'ReactivateLocalDevelopmentProject', 'RevokeLocalDevelopmentAuthorization', 'EndLocalDevelopmentRun'],
        },
        { group: 'app_lifecycle_service_projection', methods: ['PrepareLocalAppLaunch', 'BindLocalAppProcess'] },
      ],
    },
    evidence: {
      rules: Array.from({ length: 7 }, (_, index) => ({
        rule_id: `S-APP-${String(index + 16).padStart(3, '0')}`,
        evidence_requirement: 'required',
        evidence_refs: ['sdk_kernel_consistency'],
      })),
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

test('rejects a carrier that omits base entitlement posture or lacks rule evidence', () => {
  const fixture = positiveFixture();
  fixture.appClient = fixture.appClient.replace('base entitlements', 'authenticated');
  fixture.evidence.rules = fixture.evidence.rules.filter((row) => row.rule_id !== 'S-APP-022');
  const errors = validateSdkLocalAppAuthority(fixture);
  assert.ok(errors.some((error) => error.includes('base entitlements')));
  assert.ok(errors.some((error) => error.includes('S-APP-022')));
});
