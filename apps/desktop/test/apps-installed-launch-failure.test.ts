// A confirmed absent Catalog row and a Registry read failure are explained
// separately at launch; neither reads as retirement of the installed copy.
import assert from 'node:assert/strict';
import test from 'node:test';
import { changeLocale, i18n, initI18n } from '../src/shell/renderer/i18n';
import { installedLaunchFailureMessage } from '../src/shell/renderer/features/apps/apps-panel-controller';

test('installed launch failures distinguish an absent Catalog row from a Registry read failure', async () => {
  await initI18n();
  await changeLocale('en');
  const t = i18n.t.bind(i18n) as Parameters<typeof installedLaunchFailureMessage>[1];
  assert.equal(installedLaunchFailureMessage({ message: 'LOCAL_APP_OPERATION_UNAVAILABLE · runtime_reason_code=APP_CATALOG_ROW_ABSENT', reasonCode: 'installed-app-launch-failed' }, t), 'The current Catalog no longer lists this App. Your installed copy stays as it is.');
  assert.equal(installedLaunchFailureMessage({ message: '', reasonCode: 'APP_CATALOG_UNAVAILABLE' }, t), 'The App Catalog could not be read right now. Try again later.');
  assert.equal(installedLaunchFailureMessage({ message: 'native launch failed', reasonCode: 'installed-app-launch-failed' }, t), 'native launch failed', 'other failures keep the owner message');
  await changeLocale('zh');
});
