import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mainLayoutSettingsMenuSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx'),
  'utf8',
);
const runtimeBootstrapSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts'),
  'utf8',
);
const runtimeBootstrapAccountProfileSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-account-profile.ts'),
  'utf8',
);

test('account menu renders only a real email and never synthesizes a nimi.app address', () => {
  assert.doesNotMatch(mainLayoutSettingsMenuSource, /@nimi\.app/);
  assert.doesNotMatch(mainLayoutSettingsMenuSource, /toLowerCase\(\)\.replace\(/);
  assert.match(
    mainLayoutSettingsMenuSource,
    /\{props\.userEmail \? <p className="truncate text-xs text-\[var\(--nimi-text-secondary\)\]">\{props\.userEmail\}<\/p> : null\}/,
  );
});

test('desktop bootstrap merges Realm profile fields without moving profile ownership into Runtime account projection', () => {
  assert.match(runtimeBootstrapSource, /hydrateDesktopAccountProfile/);
  assert.match(runtimeBootstrapAccountProfileSource, /function mergeRuntimeAccountProjectionWithRealmProfile/);
  assert.match(runtimeBootstrapAccountProfileSource, /const realmProfile: unknown = await realmSocialData\.loadCurrentUser\(\);/);
  assert.doesNotMatch(runtimeBootstrapAccountProfileSource, /isReauthenticationRequiredError/);
  assert.doesNotMatch(runtimeBootstrapAccountProfileSource, /onReauthenticationRequired/);
  assert.doesNotMatch(runtimeBootstrapSource, /desktop_bootstrap_reauth_required/);
  assert.match(runtimeBootstrapAccountProfileSource, /setAuthSession\(hydratedUser, '', undefined\)/);
  assert.match(runtimeBootstrapAccountProfileSource, /readNonEmptyString\(profile\.email\)|hasEmail: Boolean\(readNonEmptyString\(hydratedUser\.email\)\)/);
  assert.doesNotMatch(
    runtimeBootstrapAccountProfileSource,
    /accountProjection\.(email|avatarUrl|handle)/,
    'Runtime account projection may seed account custody only; Realm profile owns email/avatar/handle',
  );
});
