import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).toString();

test('Avatar owns a sandboxed Electron standard shell proof host', () => {
  for (const relativePath of [
    'src-electron/main.ts',
    'src-electron/preload.cts',
    'tsconfig.electron.json',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
  }
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['build:electron'], /tsconfig\.electron\.json/);
  assert.match(packageJson.scripts['test:e2e:electron'], /electron-acceptance/);
  const mainSource = readFileSync(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  const bootstrapSource = readFileSync(
    path.join(root, 'src', 'shell', 'renderer', 'app-shell', 'app-bootstrap.ts'),
    'utf8',
  );
  const preloadSource = readFileSync(path.join(root, 'src-electron', 'preload.cts'), 'utf8');
  assert.match(mainSource, /registerNimiElectronRuntimeBridge/);
  assert.match(mainSource, /registerAvatarElectronProductCommands/);
  assert.doesNotMatch(mainSource, /local-agent:avatar-electron-local/);
  assert.match(preloadSource, /__NIMI_AVATAR_ELECTRON__/);
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.doesNotMatch(mainSource, /desktop_product_control|updater|tray/i);
  assert.doesNotMatch(mainSource, /trustedRuntimeMetadataProvider|runtime-auth\.js/);
  assert.doesNotMatch(mainSource, /nimi_avatar_probe_raw_access_posture|\.account\.getAccessToken\(/);
  assert.doesNotMatch(bootstrapSource, /\.account\.|\.grants\.|createAvatarRuntimeClient|createNimiRuntimeAgent/);
  assert.match(bootstrapSource, /protected_launch_session_required/);

  for (const rendererFile of [
    'src/shell/renderer/bridge/launch-context.ts',
    'src/shell/renderer/app-shell/avatar-evidence.ts',
    'src/shell/renderer/app-shell/tauri-commands.ts',
  ]) {
    const source = readFileSync(path.join(root, rendererFile), 'utf8');
    assert.match(source, /invokeAvatarHostCommand/, `${rendererFile} should route product commands through the Avatar host bridge`);
  }
});

test('Avatar Electron host boots renderer and exposes standard shell capability proof', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
    const dataRoot = path.join(tmpRoot, 'data');
    const assetRoot = path.join(tmpRoot, 'assets');
    const outsideRoot = path.join(tmpRoot, 'outside');
    const assetPath = path.join(assetRoot, 'avatar-preview.txt');
    await mkdir(dataRoot, { recursive: true });
    await mkdir(assetRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(assetPath, 'avatar asset preview', 'utf8');
    const outsidePath = path.join(outsideRoot, 'escape.txt');
    await writeFile(outsidePath, 'outside asset', 'utf8');

    const app = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        NIMI_RUNTIME_GRPC_ADDR: '',
        NIMI_AVATAR_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
        NIMI_AVATAR_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
        NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
        NIMI_AVATAR_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: assetRoot,
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: 'avatar-owner',
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: 'avatar-runtime',
        NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF: 'local-agent:avatar-acceptance-agent',
        NIMI_AVATAR_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE: 'local-first-party-app',
      },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
      const hookKeys = await page.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort());
      assert.deepEqual(hookKeys, ['invoke', 'listen']);
      const avatarHookKeys = await page.evaluate(() => Object.keys(globalThis.window.__NIMI_AVATAR_ELECTRON__).sort());
      assert.deepEqual(avatarHookKeys, ['invoke']);
      const rendererEntryLoaded = await page.waitForFunction(
        () => globalThis.window.__NIMI_AVATAR_RENDERER_MODULE_ENTRY__ === true,
        null,
        { timeout: 10_000 },
      ).then(() => true, () => false);
      assert.equal(rendererEntryLoaded, true, 'Avatar renderer module entry should run in Electron');

      const identity = await page.evaluate(
        (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
        NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
      );
      assert.deepEqual(identity, {
        ownerUserId: 'avatar-owner',
        runtimeSourceRef: 'avatar-runtime',
        localAgentRef: 'local-agent:avatar-acceptance-agent',
      });
      const launchContext = await page.evaluate(() =>
        globalThis.window.__NIMI_AVATAR_ELECTRON__.invoke('nimi_avatar_get_launch_context', {}),
      );
      assert.deepEqual(launchContext, {
        agentId: 'local-agent:avatar-acceptance-agent',
        ownerUserId: 'avatar-owner',
        runtimeSourceRef: 'avatar-runtime',
        localAgentRef: 'local-agent:avatar-acceptance-agent',
        avatarInstanceId: null,
        launchSource: 'electron',
      });
      const retiredLocalAssetResolver = await captureAvatarInvokeError(page, 'nimi_avatar_resolve_local_avatar_asset', {
        payload: {
          accountId: 'avatar-account',
          ownerUserId: 'avatar-owner',
          runtimeSourceRef: 'avatar-runtime',
          localAgentRef: 'local-agent:avatar-acceptance-agent',
        },
      });
      assert.match(retiredLocalAssetResolver.message, /Unsupported Avatar Electron product command/);
      const boundIdentity = await page.evaluate((identityPayload) =>
        globalThis.window.__NIMI_AVATAR_ELECTRON__.invoke('nimi_avatar_bind_runtime_identity', { payload: identityPayload }),
        {
          avatarInstanceId: 'avatar-proof-instance',
          ownerUserId: 'avatar-owner',
          runtimeSourceRef: 'avatar-runtime',
          localAgentRef: 'local-agent:avatar-acceptance-agent',
          launchSource: 'electron-acceptance',
        },
      );
      assert.deepEqual(boundIdentity, { bound: true });
      const evidence = await page.evaluate(() =>
        globalThis.window.__NIMI_AVATAR_ELECTRON__.invoke('nimi_avatar_record_evidence', {
          payload: {
            kind: 'avatar.renderer.entry-loaded',
            recordedAt: '2026-06-27T00:00:00.000Z',
            detail: { source: 'electron-acceptance' },
          },
        }),
      );
      assert.match(evidence.artifactPath, /avatar-electron-evidence\.jsonl$/);
      const artifact = await page.evaluate(() =>
        globalThis.window.__NIMI_AVATAR_ELECTRON__.invoke('nimi_avatar_write_evidence_artifact', {
          payload: {
            artifactId: 'electron-proof.txt',
            dataUrl: 'data:text/plain;base64,ZWxlY3Ryb24tcHJvb2Y=',
          },
        }),
      );
      assert.equal(artifact.artifactMimeType, 'text/plain');
      assert.equal(artifact.artifactByteLength, 14);

      const avatarAsset = await page.evaluate(
        ({ command, assetPath: inputPath }) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
          path: inputPath,
        }),
        {
          command: NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve'],
          assetPath,
        },
      );
      assert.equal(avatarAsset.path, assetPath);
      assert.match(avatarAsset.url, /^nimi-shell-file:\//);
      const fetchedAssetBody = await page.evaluate(async (url) => {
        const response = await fetch(url);
        return response.ok ? response.text() : `HTTP ${response.status}`;
      }, avatarAsset.url);
      assert.equal(fetchedAssetBody, 'avatar asset preview');

      const pathEscape = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'], {
        path: outsidePath,
      });
      assert.equal(pathEscape.code, 'invalid-path');
      assert.equal(pathEscape.reasonCode, 'electron-standard-local-asset-outside-root');
    } finally {
      await app.close();
    }
  });
});

async function captureInvokeError(page, command, payload) {
  const errorPayload = await page.evaluate(async ({ command: commandName, payload: commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload);
      return null;
    } catch (error) {
      return {
        code: error?.code,
        reasonCode: error?.reasonCode,
        actionHint: error?.actionHint,
        source: error?.source,
        envelope: error?.envelope,
        message: String(error?.message || error || ''),
      };
    }
  }, { command, payload });
  assert.notEqual(errorPayload, null);
  return errorPayload;
}

async function captureAvatarInvokeError(page, command, payload) {
  const errorPayload = await page.evaluate(async ({ command: commandName, payload: commandPayload }) => {
    try {
      await globalThis.window.__NIMI_AVATAR_ELECTRON__.invoke(commandName, commandPayload);
      return null;
    } catch (error) {
      return {
        code: error?.code,
        reasonCode: error?.reasonCode,
        actionHint: error?.actionHint,
        source: error?.source,
        envelope: error?.envelope,
        message: String(error?.message || error || ''),
      };
    }
  }, { command, payload });
  assert.notEqual(errorPayload, null);
  return errorPayload;
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-avatar-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
