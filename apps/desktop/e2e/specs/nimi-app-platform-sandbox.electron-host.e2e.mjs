import assert from 'node:assert/strict';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  PLATFORM_FIXTURE_APP_ID,
  launchDesktopElectronForPlatformE2E,
  launchInstalledFixtureWindow,
} from '../helpers/nimi-app-platform.mjs';

export async function runElectronHostScenario(context) {
  assert.equal(context.scenarioId, 'nimi-app-platform.sandbox.electron-host');
  const launched = await launchDesktopElectronForPlatformE2E(context);
  try {
    const { installedWindow } = await launchInstalledFixtureWindow({
      ...context,
      app: launched.app,
      page: launched.page,
    });
    await installedWindow.locator('[data-testid="platform-fixture-proof"]').waitFor({ state: 'visible', timeout: 30_000 });

    const hookKeys = await installedWindow.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort());
    assert.deepEqual(hookKeys, ['invoke', 'listen']);
    const rawApiPresence = await installedWindow.evaluate(() => ({
      ipcRenderer: 'ipcRenderer' in globalThis.window,
      electron: 'electron' in globalThis.window,
      require: 'require' in globalThis.window,
      process: 'process' in globalThis.window,
    }));
    assert.deepEqual(rawApiPresence, {
      ipcRenderer: false,
      electron: false,
      require: false,
      process: false,
    });

    const proof = JSON.parse(await installedWindow.locator('[data-testid="platform-fixture-proof-json"]').innerText());
    assert.equal(proof.appId, PLATFORM_FIXTURE_APP_ID);
    assert.equal(proof.admissionTrack, 'admission-sandbox-ci');
    assert.equal(proof.productReadinessClaimAllowed, false);
    assert.equal(proof.localAdoption, false);

    const storageWrite = await installedWindow.evaluate(async ({ command }) =>
      globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        relativePath: 'proof/e2e.json',
        value: { scenario: 'sandbox-electron-host', ok: true },
      }),
    { command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'] });
    assert.equal(storageWrite.value.ok, true);
  } finally {
    await launched.app.close();
  }
}
