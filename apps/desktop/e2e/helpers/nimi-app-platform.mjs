import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { _electron as electron } from 'playwright';

export const PLATFORM_FIXTURE_APP_ID = 'community.nimi.fixture.platform-proof';
export const PLATFORM_FIXTURE_DESCRIPTOR_REF = 'community.nimi.fixture.platform-proof.0.1.0-sandbox';
export const PLATFORM_FIXTURE_VERSION = '0.1.0-sandbox';
export const PLATFORM_FIXTURE_SHA256 = '2e8527a892b227a0d0ea5038f6f375b13c6ba2649ba4c06d96ae539ec9105863';
export const PLATFORM_FIXTURE_ENTRY_REF = 'dist/index.html';
export const PLATFORM_FIXTURE_SHELL_CAPABILITY_SET_REF = 'installed-nimi-app-standard-shell-v1';
export const PLATFORM_FIXTURE_CALLER_MODE = 'desktop-launched-nimi-app';
export const DESKTOP_INSTALLED_APP_LAUNCH_COMMAND = 'desktop.installedApp.launch';
export const DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID = 'desktop-electron-installed-app-host';

const require = createRequire(import.meta.url);
const electronExecutablePath = require('electron');

export function platformFixtureProjection(input) {
  const appRoot = path.join(input.artifactsDir, 'electron-installed-app-data', PLATFORM_FIXTURE_APP_ID);
  const releaseRoot = path.join(input.repoRoot, 'apps', 'nimi-app-platform-fixture');
  return {
    appId: PLATFORM_FIXTURE_APP_ID,
    state: 'launched',
    reachedStep: 'launch',
    launched: true,
    activeVersion: PLATFORM_FIXTURE_VERSION,
    scope: { kind: 'app', ownerId: PLATFORM_FIXTURE_APP_ID },
    reasonCode: ReasonCode.ACTION_EXECUTED,
    releaseDescriptorRef: PLATFORM_FIXTURE_DESCRIPTOR_REF,
    descriptorClass: 'external-immutable-artifact',
    admissionTrack: 'admission-sandbox-ci',
    sourceKind: 'admission-sandbox-https-artifact',
    ordinaryVisibility: 'developer-only',
    digestVerificationState: 'digest-verified',
    runtimeEntryRef: PLATFORM_FIXTURE_ENTRY_REF,
    activeReleaseRoot: releaseRoot,
    storage: {
      appRoot,
      releaseRoot,
      durableDataRoot: path.join(appRoot, 'data'),
      cacheRoot: path.join(appRoot, 'cache'),
      tempRoot: path.join(appRoot, 'tmp'),
    },
    shellCapabilitySetRef: PLATFORM_FIXTURE_SHELL_CAPABILITY_SET_REF,
    callerMode: PLATFORM_FIXTURE_CALLER_MODE,
    launchNonce: 'electron-host-e2e-launch-nonce',
    productReadinessClaimAllowed: false,
    ...input.overrides,
  };
}

export async function launchDesktopElectronForPlatformE2E(input) {
  const dataRoot = path.join(input.artifactsDir, 'electron-main-data');
  const runtimeConfigPath = path.join(dataRoot, 'runtime', 'config.json');
  await mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  await writeFile(runtimeConfigPath, JSON.stringify({
    schemaVersion: 1,
    grpcAddr: '127.0.0.1:1',
    source: input.scenarioId,
  }, null, 2), 'utf8');

  const mainEntry = path.join(input.desktopRoot, 'dist-electron', 'main.js');
  const rendererUrl = `${pathToFileURL(path.join(input.desktopRoot, 'dist', 'index.html')).toString()}?nimiAppPlatformE2E=1`;
  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [mainEntry],
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: '',
      NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererUrl,
      NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
      NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: path.join(input.repoRoot, 'apps', 'nimi-app-platform-fixture'),
      NIMI_REALM_URL: 'http://localhost',
      NIMI_REALM_JWKS_URL: '',
      NIMI_REALM_REVOCATION_URL: '',
      NIMI_REALM_JWT_ISSUER: '',
      NIMI_REALM_JWT_AUDIENCE: '',
      NIMI_REALTIME_URL: 'ws://localhost:3003',
      NIMI_ACCESS_TOKEN: 'desktop-app-platform-e2e-token',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  return { app, page };
}

export async function invokeElectronShell(page, command, payload) {
  return page.evaluate(async ({ command: commandName, payload: commandPayload }) =>
    globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload),
  { command, payload });
}

export async function captureElectronShellError(page, command, payload) {
  const error = await page.evaluate(async ({ command: commandName, payload: commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload);
      return null;
    } catch (caught) {
      return {
        code: caught?.code,
        reasonCode: caught?.reasonCode,
        actionHint: caught?.actionHint,
        source: caught?.source,
        details: caught?.details,
        envelope: caught?.envelope,
        message: String(caught?.message || caught || ''),
      };
    }
  }, { command, payload });
  assert.notEqual(error, null);
  return error;
}

export async function launchInstalledFixtureWindow(input) {
  const projection = platformFixtureProjection(input);
  const result = await invokeElectronShell(input.page, DESKTOP_INSTALLED_APP_LAUNCH_COMMAND, { projection });
  assert.equal(result.appId, PLATFORM_FIXTURE_APP_ID);
  assert.equal(result.state, 'launched');
  assert.equal(result.launchHostId, DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID);
  assert.equal(result.releaseDescriptorRef, PLATFORM_FIXTURE_DESCRIPTOR_REF);
  assert.match(String(result.entryUrl || ''), /^nimi-installed-app:\/\/community\.nimi\.fixture\.platform-proof\/dist\/index\.html$/);

  let installedWindow = input.app.windows().find((candidate) =>
    candidate.url().startsWith(`nimi-installed-app://${PLATFORM_FIXTURE_APP_ID}/`),
  );
  if (!installedWindow) {
    installedWindow = await input.app.waitForEvent('window', {
      predicate: (candidate) => candidate.url().startsWith(`nimi-installed-app://${PLATFORM_FIXTURE_APP_ID}/`),
      timeout: 30_000,
    });
  }
  await installedWindow.waitForLoadState('domcontentloaded');
  await installedWindow.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  return { projection, result, installedWindow };
}
