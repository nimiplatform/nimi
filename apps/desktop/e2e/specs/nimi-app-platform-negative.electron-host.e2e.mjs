import assert from 'node:assert/strict';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  DESKTOP_INSTALLED_APP_LAUNCH_COMMAND,
  PLATFORM_FIXTURE_DESCRIPTOR_REF,
  captureElectronShellError,
  launchDesktopElectronForPlatformE2E,
  launchInstalledFixtureWindow,
  platformFixtureProjection,
} from '../helpers/nimi-app-platform.mjs';

export async function runElectronHostScenario(context) {
  assert.equal(context.scenarioId, 'nimi-app-platform.negative.electron-host');
  const launched = await launchDesktopElectronForPlatformE2E(context);
  try {
    const attestationError = await captureElectronShellError(
      launched.page,
      DESKTOP_INSTALLED_APP_LAUNCH_COMMAND,
      {
        projection: platformFixtureProjection(context),
        override: { releaseDescriptorRef: `${PLATFORM_FIXTURE_DESCRIPTOR_REF}.tampered` },
      },
    );
    assert.equal(attestationError.reasonCode, 'DESKTOP_INSTALLED_APP_LAUNCH_ATTESTATION_MISMATCH');

    const blockedProjectionError = await captureElectronShellError(
      launched.page,
      DESKTOP_INSTALLED_APP_LAUNCH_COMMAND,
      {
        projection: platformFixtureProjection({
          ...context,
          overrides: {
            state: 'blocked',
            reachedStep: 'verify_permissions',
            launched: false,
            reasonCode: 'APP_OPEN_PERMISSION_NOT_GRANTED',
          },
        }),
      },
    );
    assert.equal(blockedProjectionError.reasonCode, 'DESKTOP_INSTALLED_APP_OPEN_PROJECTION_BLOCKED');
    assert.equal(launched.app.windows().some((candidate) =>
      candidate.url().startsWith('nimi-installed-app://'),
    ), false);

    const { installedWindow } = await launchInstalledFixtureWindow({
      ...context,
      app: launched.app,
      page: launched.page,
    });
    await installedWindow.locator('[data-testid="platform-fixture-proof"]').waitFor({ state: 'visible', timeout: 30_000 });

    for (const command of [
      'nimi.shell.auth.session.load',
      'nimi.shell.auth.session.save',
      'nimi.shell.auth.session.clear',
    ]) {
      const error = await installedWindow.evaluate(async ({ command: commandName }) => {
        try {
          await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, {});
          return null;
        } catch (caught) {
          return {
            code: caught?.code,
            reasonCode: caught?.reasonCode,
            source: caught?.source,
          };
        }
      }, { command });
      assert.deepEqual(error, {
        code: 'external-daemon-required',
        reasonCode: 'electron-runtime-account-custody-external',
        source: 'electron',
      });
    }

    for (const command of [
      NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    ]) {
      const error = await installedWindow.evaluate(async ({ command: commandName }) => {
        try {
          await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, {});
          return null;
        } catch (caught) {
          return {
            code: caught?.code,
            reasonCode: caught?.reasonCode,
            source: caught?.source,
            details: caught?.details,
          };
        }
      }, { command });
      assert.deepEqual(error, {
        code: 'capability-unavailable',
        reasonCode: 'electron-standard-capability-not-in-host-set',
        source: 'electron',
        details: {
          command,
          capabilitySetRef: 'installed-nimi-app-standard-shell-v1',
        },
      });
    }
  } finally {
    await launched.app.close();
  }
}
