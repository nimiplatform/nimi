import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readTesterSettingsSurface } from './settings-surface-read.mjs';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readSettingsSurface() {
  return readTesterSettingsSurface(root);
}

test('tester settings production surface is live-only and does not package proof evidence rows', () => {
  const settings = readSettingsSurface();
  const route = read('src/shell/routes/settings-route.tsx');
  const view = read('src/shell/routes/settings/view.tsx');
  const settingsDir = path.join(root, 'src/shell/routes/settings');

  assert.doesNotMatch(settings, /\bevidenceMode\b/);
  assert.doesNotMatch(settings, /Evidence capture/);
  assert.doesNotMatch(settings, /data-settings-row-kind="proof"/);
  assert.doesNotMatch(settings, /before:content-\['Proof'\]/);
  assert.doesNotMatch(settings, /not_public_in_sdk_vnext/);
  assert.doesNotMatch(route, /src\/tester\/tester-.*projection/);
  assert.doesNotMatch(route, /useTypedProjection/);
  assert.doesNotMatch(view, /SettingsRuntimeRows|SettingsSdkRows/);
  for (const fileName of [
    'fixtures.ts',
    'runtime-projections.ts',
    'realm-kit-projections.ts',
    'runtime-rows.tsx',
    'sdk-rows.tsx',
  ]) {
    assert.equal(existsSync(path.join(settingsDir, fileName)), false, `${fileName} must not remain in the production settings module tree`);
  }
});

test('tester settings keeps real Realm live rows through SDK and Kit helpers', () => {
  const settings = readSettingsSurface();

  assert.match(settings, /data-settings-row-kind="live"[\s\S]*Realm notification projection/);
  assert.match(settings, /loadNimiRealmNotificationUnreadCount/);
  assert.match(settings, /loadNimiRealmNotifications/);
  assert.match(settings, /toNimiRealmNotificationListView/);
  assert.match(settings, /getNimiNotificationServerFilter/);
  assert.match(settings, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/core\/notifications'/);

  assert.match(settings, /data-settings-row-kind="live"[\s\S]*Realm account-data export projection/);
  assert.match(settings, /requestNimiRealmDataExport/);

  assert.match(settings, /data-settings-row-kind="live"[\s\S]*SDK Realm account settings projection/);
  assert.match(settings, /loadNimiRealmCreatorEligibility/);

  assert.match(settings, /data-settings-row-kind="live"[\s\S]*Kit Realm human chat projection/);
  assert.match(settings, /listRealmChats/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);

  assert.match(settings, /data-settings-row-kind="live"[\s\S]*SDK Realm group chat projection/);
  assert.match(settings, /listNimiRealmGroupChats/);
});

test('tester settings does not create local Runtime, Realm, admission, or permission truth', () => {
  const settings = readSettingsSurface();

  for (const forbidden of [
    /testerGiftTransactionProjectionService/,
    /testerRouteCapabilityRuntime/,
    /runtimeConnectorInventory/,
    /runtimeModelCatalogProjection/,
    /resolveTesterPermissionClientProjection/,
    /resolveTesterLocalRuntimeFacadeProjection/,
    /resolveTesterRealmDataSyncProjection/,
    /admissionStatus:\s*'admitted'/,
    /installState:\s*'installed'/,
    /ConnectorStatus\.ACTIVE/,
    /state:\s*'GRANTED'/,
  ]) {
    assert.doesNotMatch(settings, forbidden);
  }
});
