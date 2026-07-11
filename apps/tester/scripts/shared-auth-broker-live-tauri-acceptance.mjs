#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withRuntimeDaemon } from '../../../sdks/typescript/runtime/live-runtime-daemon.test-helper.ts';
import { withRealmFixtureServer } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-server.test-helper.ts';
import {
  admitDeveloperRegisteredRuntimeAccountCaller,
  completeRuntimeAccountLogin,
  createRuntimeForEndpoint,
  desktopAccountCaller,
  logoutRuntimeAccount,
  registerRuntimeApp,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  RUNTIME_ACCOUNT_ACCESS_TOKEN,
  RUNTIME_ACCOUNT_REFRESH_TOKEN,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-shared.test-helper.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'runtime-shared-auth-broker');
const reportPath = path.join(evidenceRoot, 'tester-tauri.json');
const desktopScreenshotPath = path.join(evidenceRoot, 'tester-tauri-desktop.png');
const narrowScreenshotPath = path.join(evidenceRoot, 'tester-tauri-narrow.png');
const failureScreenshotPath = path.join(evidenceRoot, 'tester-tauri-failure.png');
const applicationPath = path.join(appRoot, 'src-tauri', 'target', 'release', 'nimiapp-tester-shell.exe');
const appId = 'nimi.tester';
const appInstanceId = 'nimi.tester.local-developer';
const deviceId = 'nimi-tester-local-developer-device';
const capabilities = ['account.session.read', 'data.scope.read#realm.worlds.read-probe', 'ai.spend.meter'];

await mkdir(evidenceRoot, { recursive: true });
await withRealmFixtureServer({
  run: async ({ baseUrl, requests }) => {
    await withRuntimeDaemon({
      appId: DESKTOP_APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: baseUrl,
        NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${baseUrl}/api/auth/oauth/authorize`,
        NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${baseUrl}/api/auth/oauth/token`,
        NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `tester-tauri-live-${randomUUID()}`,
        NIMI_RUNTIME_APP_REGISTRY_PATH: path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml'),
      },
      run: async ({ endpoint }) => {
        const desktopRuntime = createRuntimeForEndpoint(endpoint, DESKTOP_APP_ID);
        const desktopCaller = desktopAccountCaller();
        await registerRuntimeApp(desktopRuntime, DESKTOP_APP_ID, DESKTOP_APP_INSTANCE_ID, DESKTOP_DEVICE_ID);
        await completeRuntimeAccountLogin(desktopRuntime, desktopCaller);
        await admitDeveloperRegisteredRuntimeAccountCaller(
          createRuntimeForEndpoint(endpoint, appId),
          { appId, appInstanceId, deviceId, capabilities },
        );
        try {
          const report = await runTauriAcceptance({ endpoint, requests, desktopRuntime, desktopCaller });
          await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
          process.stdout.write(`[shared-auth-live] tester-tauri passed\n${reportPath}\n`);
        } finally {
          await logoutRuntimeAccount(desktopRuntime, desktopCaller).catch(() => undefined);
        }
      },
    });
  },
});

async function runTauriAcceptance({ endpoint, requests, desktopRuntime, desktopCaller }) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'nimi-tester-tauri-shared-auth-'));
  const probePath = path.join(tempRoot, 'shared-auth-probe.json');
  const appOutput = [];
  const app = spawn(applicationPath, [], {
    cwd: appRoot,
    env: {
      ...process.env,
      HOME: tempRoot,
      USERPROFILE: tempRoot,
      NIMI_RUNTIME_GRPC_ADDR: endpoint,
      NIMI_RUNTIME_BRIDGE_MODE: 'RELEASE',
      NIMI_TESTER_TAURI_ACCEPTANCE_PROBE_PATH: probePath,
      NIMI_TESTER_TAURI_ACCEPTANCE_SCENARIO_ID: 'tester.tauri.shared-auth-broker',
      NIMI_TESTER_TAURI_ACCEPTANCE_STORAGE_ROOT: tempRoot,
      NIMI_TESTER_TAURI_SHARED_AUTH_ACCEPTANCE: '1',
      WEBVIEW2_USER_DATA_FOLDER: path.join(tempRoot, 'webview2'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (chunk) => appOutput.push(chunk.toString()));
  app.stderr.on('data', (chunk) => appOutput.push(chunk.toString()));
  let desktopCaptured = false;
  let narrowCaptured = false;
  let logoutTriggered = false;
  try {
    const deadline = Date.now() + 90_000;
    let finalRecord = null;
    while (Date.now() < deadline) {
      if (app.exitCode !== null) throw new Error(`Tester Tauri exited with code ${app.exitCode}`);
      const record = readProbe(probePath);
      const stage = record?.payload?.stage;
      if (record?.kind === 'ping' && stage === 'shared-auth-desktop-ready' && !desktopCaptured) {
        await captureNativeWindow(app.pid, desktopScreenshotPath);
        desktopCaptured = true;
      }
      if (record?.kind === 'ping' && stage === 'shared-auth-narrow-ready' && !narrowCaptured) {
        await captureNativeWindow(app.pid, narrowScreenshotPath);
        narrowCaptured = true;
        if (!logoutTriggered) {
          await logoutRuntimeAccount(desktopRuntime, desktopCaller);
          logoutTriggered = true;
        }
      }
      if (record?.kind === 'report' && stage === 'shared-auth-complete') {
        finalRecord = record;
        break;
      }
      await delay(100);
    }
    assert.ok(finalRecord, 'Tester Tauri shared-auth renderer probe timed out');
    const payload = finalRecord.payload;
    assert.equal(payload.ok, true, `Tester Tauri probe failed: ${JSON.stringify(payload.error)}`);
    assert.equal(payload.runtimeReady?.ok, true, `Tester Tauri Runtime not ready: ${JSON.stringify(payload.runtimeReady)}`);
    assert.equal(payload.accountProjection?.ok, true, 'Tester Tauri account projection failed');
    assert.equal(payload.sharedAuthBroker?.ok, true, `Tester Tauri broker failed: ${JSON.stringify(payload.sharedAuthBroker)}`);
    assert.ok(payload.sessionCommands.every((row) => row.denied), 'Tester Tauri auth.session commands must be denied');
    assert.equal(payload.desktopOwnedAccountControlDisabled, true, 'Tester account action must remain Desktop-owned and disabled');
    assertInspection(payload.accessibility.desktop, 'desktop');
    assertInspection(payload.accessibility.narrow, 'narrow');
    assert.equal(payload.failure?.observed, true, 'Tester Tauri failure state missing');
    assert.equal(payload.failure?.accountProjection?.ok, true, 'Tester Tauri post-logout projection must remain readable');
    assert.notEqual(Number(payload.failure?.accountProjection?.status), Number(payload.accountProjection?.status), 'Tester Tauri logout must change account state');
    assert.equal(payload.failure?.sharedAuthBroker?.ok, false, 'Tester Tauri broker must fail closed after logout');
    assert.equal(payload.tokenLeak?.passed, true, `Tester Tauri credential-shaped leak: ${JSON.stringify(payload.tokenLeak?.findings)}`);
    assert.deepEqual(payload.consoleErrors, [], `Tester Tauri console errors: ${JSON.stringify(payload.consoleErrors)}`);
    assert.deepEqual(payload.pageErrors, [], `Tester Tauri page errors: ${JSON.stringify(payload.pageErrors)}`);
    assert.equal(desktopCaptured && existsSync(desktopScreenshotPath), true, 'Tester Tauri desktop screenshot missing');
    assert.equal(narrowCaptured && existsSync(narrowScreenshotPath), true, 'Tester Tauri narrow screenshot missing');
    const brokerRequests = requests.filter((request) => request.path === '/api/world');
    assert.ok(brokerRequests.length > 0, 'Tester Tauri broker did not reach Realm fixture');
    const rendererEvidenceRaw = JSON.stringify(payload);
    for (const secret of [RUNTIME_ACCOUNT_ACCESS_TOKEN, RUNTIME_ACCOUNT_REFRESH_TOKEN]) {
      assert.equal(rendererEvidenceRaw.includes(secret), false, `Tester Tauri renderer leaked fixture credential ${secret}`);
    }

    return {
      schemaVersion: 1,
      appId,
      shell: 'tauri',
      endpoint,
      success: {
        runtimeReady: payload.runtimeReady,
        accountProjection: payload.accountProjection,
        sharedAuthBroker: payload.sharedAuthBroker,
        brokerRequests: brokerRequests.map((request) => ({
          method: request.method,
          path: request.path,
          authorizationPresent: /^Bearer\s+/u.test(String(request.authorization || '')),
        })),
      },
      failure: payload.failure,
      denied: { sessionCommands: payload.sessionCommands },
      disabled: {
        visibleDisabledControls: payload.accessibility.desktop.disabledControlCount,
        desktopOwnedAccountControlDisabled: payload.desktopOwnedAccountControlDisabled,
      },
      interaction: payload.interaction,
      accessibility: payload.accessibility,
      tokenLeak: payload.tokenLeak,
      consoleErrors: payload.consoleErrors,
      pageErrors: payload.pageErrors,
      automation: {
        transport: 'tauri-renderer-entry-probe',
        visualCapture: 'win32-window-pixels',
        cdpAttempt: 'blocked-webview2-150-no-debug-endpoint',
      },
      screenshots: { desktop: relativeToRepo(desktopScreenshotPath), narrow: relativeToRepo(narrowScreenshotPath) },
    };
  } catch (error) {
    if (app.exitCode === null) {
      await captureNativeWindow(app.pid, failureScreenshotPath).catch(() => undefined);
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nlastProbe=${JSON.stringify(readProbe(probePath), null, 2)}\nTauri output:\n${appOutput.join('').slice(-8000)}`);
  } finally {
    terminateProcessTree(app);
    await delay(1000);
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function readProbe(probePath) {
  if (!existsSync(probePath)) return null;
  try {
    return JSON.parse(readFileSync(probePath, 'utf8'));
  } catch {
    return null;
  }
}

function assertInspection(inspection, viewport) {
  assert.equal(inspection.horizontalOverflow, false, `${viewport} Tauri layout overflow`);
  assert.equal(inspection.chineseVisible, true, `${viewport} Tauri Chinese copy missing`);
  assert.equal(inspection.longTextVisible, true, `${viewport} Tauri long text missing`);
  assert.deepEqual(inspection.unlabeledControls, [], `${viewport} Tauri controls require accessible names`);
  assert.deepEqual(inspection.smallControls, [], `${viewport} Tauri controls are too small`);
  assert.ok(inspection.landmarkCount > 0, `${viewport} Tauri landmark missing`);
}

async function captureNativeWindow(pid, destination) {
  const command = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NimiWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@
[void][NimiWindowCapture]::SetProcessDpiAwarenessContext([IntPtr](-4))
$process = Get-Process -Id ([int]$env:NIMI_CAPTURE_PID)
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ($process.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100; $process.Refresh() }
$handle = $process.MainWindowHandle
if ($handle -eq 0) { throw 'Tester Tauri main window handle unavailable' }
$rect = New-Object NimiWindowCapture+RECT
if (-not [NimiWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
try {
  if (-not [NimiWindowCapture]::PrintWindow($handle, $hdc, 2)) { throw 'PrintWindow failed' }
} finally {
  $graphics.ReleaseHdc($hdc)
}
$bitmap.Save($env:NIMI_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, NIMI_CAPTURE_PID: String(pid), NIMI_CAPTURE_PATH: destination },
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new Error(`capture Tester Tauri window failed: ${result.stderr || result.stdout}`);
  }
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
