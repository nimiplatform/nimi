import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import {
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = `${pathToFileURL(path.join(root, 'dist', 'index.html')).toString()}?nimiElectronSdkAcceptance=1`;

test('Electron acceptance matrix maps every standard shell command to e2e or host-unit coverage', async () => {
  const acceptanceSource = await readFile(new URL('./electron-acceptance.mjs', import.meta.url), 'utf8');
  const mainSource = await readFile(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  const electronHostUnitFiles = [
    'electron-shell-bridge-core.test.ts',
    'electron-shell-bridge-guardrails.test.ts',
    'electron-shell-bridge-host-features.test.ts',
    'electron-shell-capabilities.test.ts',
    'electron-shell-file-surfaces.test.ts',
    'electron-shell-preload.test.ts',
    'electron-shell-runtime-hardening.test.ts',
    'electron-shell-source-boundaries.test.ts',
  ];
  const electronHostUnitSource = (await Promise.all(electronHostUnitFiles.map((file) =>
    readFile(path.join(repoRoot, 'kit', 'shell', 'electron', 'test', file), 'utf8')
  ))).join('\n');
  assert.doesNotMatch(mainSource, /local-agent:tester-electron-local/);
  const coverageSource = `${acceptanceSource}\n${electronHostUnitSource}`;
  for (const capability of NIMI_STANDARD_SHELL_CAPABILITIES) {
    for (const operation of capability.operations) {
      const key = `${capability.id}.${operation.id}`;
      assert.match(
        coverageSource,
        new RegExp(`NIMI_STANDARD_SHELL_COMMANDS\\[['"]${escapeRegExp(key)}['"]\\]`),
        `standard shell command ${key} must have Electron acceptance or host-unit coverage`,
      );
    }
  }
});

test('Electron acceptance host boots the tester renderer with the narrowed preload bridge', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
  const dataRoot = path.join(tmpRoot, 'data');
  const assetRoot = path.join(tmpRoot, 'assets');
  const openedUrlsPath = path.join(tmpRoot, 'opened-urls.txt');
  const assetPath = path.join(assetRoot, 'preview.txt');
  const runtimeConfigPath = path.join(dataRoot, 'runtime', 'config.json');
  await mkdir(dataRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(assetPath, 'tester asset preview', 'utf8');
  await mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  await writeFile(runtimeConfigPath, JSON.stringify({
    schemaVersion: 1,
    grpcAddr: '127.0.0.1:1',
    source: 'tester-electron-acceptance',
  }, null, 2), 'utf8');
  const canonicalDataRoot = await realpath(dataRoot);
  const canonicalAssetPath = await realpath(assetPath);
  const expectedProfilePath = path.join(canonicalDataRoot, 'settings', 'profile.json');

  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: '',
      NIMI_TESTER_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
      NIMI_TESTER_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
      NIMI_TESTER_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      NIMI_TESTER_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: assetRoot,
      NIMI_REALM_URL: 'http://localhost',
      NIMI_REALM_JWKS_URL: '',
      NIMI_REALM_REVOCATION_URL: '',
      NIMI_REALM_JWT_ISSUER: '',
      NIMI_REALM_JWT_AUDIENCE: '',
      NIMI_REALTIME_URL: 'ws://localhost:3003',
      NIMI_ACCESS_TOKEN: 'acceptance-token',
      NIMI_TARGET_TYPE: 'local',
      NIMI_TARGET_ACCOUNT_ID: 'acceptance-account',
      NIMI_AGENT_ID: 'acceptance-agent',
      NIMI_WORLD_ID: 'acceptance-world',
      NIMI_USER_CONFIRMED_UPLOAD: '1',
      NIMI_TESTER_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: 'acceptance-owner',
      NIMI_TESTER_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: 'acceptance-runtime',
      NIMI_TESTER_ELECTRON_LOCAL_AGENT_REF: 'local-agent:acceptance-agent',
      NIMI_TESTER_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE: 'local-developer-app',
      NIMI_TESTER_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: openedUrlsPath,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    const hookKeys = await page.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort());
    assert.deepEqual(hookKeys, ['invoke', 'listen']);
    const rawApiPresence = await page.evaluate(() => ({
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

    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__));
    const sdkRuntimeReady = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.runtimeReady(),
    );
    assert.equal(sdkRuntimeReady.transport, 'electron-ipc');
    assert.equal(sdkRuntimeReady.ok, false);
    assert.equal(sdkRuntimeReady.code, 'external-daemon-required');
    assert.equal(sdkRuntimeReady.reasonCode, 'electron-runtime-endpoint-unavailable');
    assert.equal(sdkRuntimeReady.actionHint, 'start_external_runtime_daemon');

    const statusError = await captureInvokeError(
      page,
      NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
      {},
    );
    assert.equal(statusError.code, 'external-daemon-required');
    assert.equal(statusError.reasonCode, 'electron-runtime-endpoint-unavailable');
    assert.equal(statusError.actionHint, 'start_external_runtime_daemon');

    const diagnosticsProbe = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { stage: 'acceptance-bootstrap' }),
      NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
    );
    assert.equal(diagnosticsProbe.ok, true);
    assert.equal(diagnosticsProbe.source, 'electron');
    assert.equal(diagnosticsProbe.appId, 'nimi.tester');
    assert.equal(diagnosticsProbe.stage, 'acceptance-bootstrap');
    assert.equal(diagnosticsProbe.origin, 'file://');
    assert.match(String(diagnosticsProbe.url || ''), /dist\/index\.html|dist\\index\.html/);
    assert.equal(diagnosticsProbe.hasSender, true);

    const localAgentIdentity = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
      NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
    );
    assert.deepEqual(localAgentIdentity, {
      ownerUserId: 'acceptance-owner',
      runtimeSourceRef: 'acceptance-runtime',
      localAgentRef: 'local-agent:acceptance-agent',
    });

    const trustedCaller = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
      NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
    );
    assert.deepEqual(trustedCaller, {
      appId: 'nimi.tester',
      appInstanceId: 'nimi.tester.local-developer',
      deviceId: 'local-developer-device',
      mode: 7,
      scopes: [],
    });

    const trustedCallerSpoof = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'], {
      appId: 'renderer-spoof',
    });
    assert.equal(trustedCallerSpoof.code, 'forbidden-renderer-access');
    assert.equal(trustedCallerSpoof.reasonCode, 'electron-renderer-local-agent-caller-field-forbidden');

    const oauthOpen = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        payload: { url: 'https://auth.example.test/authorize' },
      }),
      NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
    );
    assert.deepEqual(oauthOpen, { opened: true });
    assert.equal(await readFile(openedUrlsPath, 'utf8'), 'https://auth.example.test/authorize\n');

    const oauthForbidden = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'], {
      payload: { url: 'http://evil.example.test/authorize' },
    });
    assert.equal(oauthForbidden.code, 'forbidden-renderer-access');
    assert.equal(oauthForbidden.reasonCode, 'electron-oauth-external-url-not-allowed');

    const oauthTokenProviderForbidden = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'], {
      payload: {
        provider: 'https://evil.example.test/token',
        clientId: 'client-1',
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'http://127.0.0.1:4100/oauth/callback',
      },
    });
    assert.equal(oauthTokenProviderForbidden.code, 'invalid-payload');
    assert.equal(oauthTokenProviderForbidden.reasonCode, 'electron-oauth-token-provider-not-admitted');

    const oauthPort = await findFreePort();
    const oauthListenPromise = page.evaluate(
      ({ command, port }) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
        timeoutMs: 5_000,
      }),
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'],
        port: oauthPort,
      },
    );
    await waitForFetchOk(`http://127.0.0.1:${oauthPort}/oauth/callback?code=acceptance-code&state=acceptance-state`);
    assert.deepEqual(await oauthListenPromise, {
      callbackUrl: `http://localhost:${oauthPort}/oauth/callback?code=acceptance-code&state=acceptance-state`,
      code: 'acceptance-code',
      state: 'acceptance-state',
    });

    const runtimeDefaults = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
      NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'],
    );
    assert.deepEqual(runtimeDefaults, {
      realm: {
        realmBaseUrl: 'http://localhost:3002',
        realtimeUrl: 'ws://localhost:3003',
        accessToken: 'acceptance-token',
        jwksUrl: 'http://localhost:3002/api/auth/jwks',
        revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
        jwtIssuer: 'http://localhost:3002',
        jwtAudience: 'nimi-runtime',
      },
      runtime: {
        targetType: 'local',
        targetAccountId: 'acceptance-account',
        agentId: 'acceptance-agent',
        worldId: 'acceptance-world',
        userConfirmedUpload: true,
      },
    });

    const runtimeConfig = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
      NIMI_STANDARD_SHELL_COMMANDS['config.get'],
    );
    assert.deepEqual(runtimeConfig, {
      path: runtimeConfigPath,
      config: {
        schemaVersion: 1,
        grpcAddr: '127.0.0.1:1',
        source: 'tester-electron-acceptance',
      },
    });

    const dataPath = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        relativePath: 'settings/profile.json',
      }),
      NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'],
    );
    assert.equal(dataPath.path, expectedProfilePath);

    const storageWrite = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        relativePath: 'settings/profile.json',
        value: { schemaVersion: 1, host: 'electron' },
      }),
      NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
    );
    assert.equal(storageWrite.path, expectedProfilePath);
    assert.deepEqual(storageWrite.value, { schemaVersion: 1, host: 'electron' });
    assert.deepEqual(JSON.parse(await readFile(storageWrite.path, 'utf8')), { schemaVersion: 1, host: 'electron' });

    const storageRead = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        relativePath: 'settings/profile.json',
      }),
      NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
    );
    assert.deepEqual(storageRead, {
      path: expectedProfilePath,
      value: { schemaVersion: 1, host: 'electron' },
    });

    const assetResult = await page.evaluate(async ({ command, assetPath: inputPath }) => {
      const result = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { path: inputPath });
      const response = await fetch(result.url);
      return {
        path: result.path,
        url: result.url,
        fetchOk: response.ok,
        body: await response.text(),
      };
    }, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
      assetPath,
    });
    assert.equal(assetResult.path, canonicalAssetPath);
    assert.match(assetResult.url, /^nimi-shell-file:\//);
    assert.equal(assetResult.fetchOk, true);
    assert.equal(assetResult.body, 'tester asset preview');

    const avatarAssetResult = await page.evaluate(async ({ command, assetPath: inputPath }) => {
      const result = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { path: inputPath });
      const response = await fetch(result.url);
      return {
        path: result.path,
        url: result.url,
        fetchOk: response.ok,
        body: await response.text(),
      };
    }, {
      command: NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve'],
      assetPath,
    });
    assert.equal(avatarAssetResult.path, canonicalAssetPath);
    assert.deepEqual(avatarAssetResult, assetResult);

    const aiProfile = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { alias: 'local-gpu' }),
      NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get'],
    );
    assert.equal(aiProfile.alias, 'local-gpu');
    assert.equal(aiProfile.computePosture, 'cuda-capable');
    assert.equal(aiProfile.routingPolicy, 'local-first');
    assert.equal(aiProfile.materializationConfirmationRequired, true);
    assert.ok(aiProfile.capabilitySet.includes('image.generate'));

    const aiProfileMissing = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get'], {
      alias: 'missing',
    });
    assert.equal(aiProfileMissing.code, 'not-found');
    assert.equal(aiProfileMissing.reasonCode, 'electron-ai-profile-alias-not-found');

    const factoryProjection = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { projectionId: 'factory-profile-index' }),
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    );
    assert.equal(factoryProjection.projectionId, 'factory-profile-index');
    assert.ok(factoryProjection.record.profiles.some((profile) => profile.alias === 'local-gpu'));

    const appsRegistryProjection = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { projectionId: 'apps-registry' }),
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    );
    assert.equal(appsRegistryProjection.projectionId, 'apps-registry');
    assert.equal(appsRegistryProjection.record.catalogId, 'platform_nimi_app_registry');
    assert.ok(appsRegistryProjection.record.apps.some((appRow) => appRow.appId === 'nimi.avatar'));

    const appsBridgeProjection = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { projectionId: 'apps-bridge' }),
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    );
    assert.equal(appsBridgeProjection.projectionId, 'apps-bridge');
    assert.ok(appsBridgeProjection.record.registryRows.some((appRow) => appRow.appId === 'nimi.avatar'));
    assert.ok(appsBridgeProjection.record.releaseDescriptors.some((descriptor) => descriptor.descriptorId === 'nimi.avatar.bundled-with-nimi'));

    const appsPackagesProjection = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { projectionId: 'apps-packages' }),
      NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    );
    assert.deepEqual(appsPackagesProjection, {
      projectionId: 'apps-packages',
      record: {
        schemaVersion: 2,
        updatedAt: appsPackagesProjection.record.updatedAt,
        packages: [],
      },
    });

    const missingProjection = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'], {
      projectionId: 'missing',
    });
    assert.equal(missingProjection.code, 'not-found');
    assert.equal(missingProjection.reasonCode, 'electron-platform-projection-not-found');

    const missingAiConfig = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'], {
      scopeRef: 'tester.scope.chat',
    });
    assert.equal(missingAiConfig.code, 'not-found');
    assert.equal(missingAiConfig.reasonCode, 'electron-ai-config-scope-not-found');

    const aiConfig = {
      schemaVersion: 1,
      scopeRef: 'tester.scope.chat',
      profileOrigin: { kind: 'factory-profile', alias: 'local-gpu' },
      capabilities: {
        targetRefs: {
          'text.generate': { kind: 'local-runtime', readinessRef: 'execution:e2e' },
        },
      },
    };
    const aiConfigSet = await page.evaluate(
      ({ command, config }) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        scopeRef: 'tester.scope.chat',
        config,
      }),
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
        config: aiConfig,
      },
    );
    assert.deepEqual(aiConfigSet, {
      scopeRef: 'tester.scope.chat',
      config: aiConfig,
    });
    const aiConfigGet = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        scopeRef: 'tester.scope.chat',
      }),
      NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
    );
    assert.deepEqual(aiConfigGet, {
      scopeRef: 'tester.scope.chat',
      config: aiConfig,
    });

    const pathEscape = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve'], {
      relativePath: '../escape.json',
    });
    assert.equal(pathEscape.code, 'invalid-path');
    assert.equal(pathEscape.reasonCode, 'electron-standard-path-escapes-root');

    for (const commandKey of [
      'runtime-lifecycle.start',
      'runtime-lifecycle.stop',
      'runtime-lifecycle.restart',
    ]) {
      const lifecycleError = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS[commandKey], {});
      assert.equal(lifecycleError.code, 'external-daemon-required', commandKey);
      assert.match(
        `${lifecycleError.reasonCode || ''} ${lifecycleError.message || ''}`,
        /electron-runtime-daemon-managed-externally|requires an external daemon/,
        commandKey,
      );
    }

    const configSetError = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['config.set'], {
      configJson: '{"schemaVersion":1}',
    });
    assert.equal(configSetError.code, 'external-daemon-required');
    assert.equal(configSetError.reasonCode, 'electron-runtime-daemon-managed-externally');

    const unaryUnavailable = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'], {
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
        requestBytesBase64: '',
        timeoutMs: 200,
      },
    });
    assert.equal(unaryUnavailable.code, 'external-daemon-required');
    assert.match(
      `${unaryUnavailable.reasonCode || ''} ${unaryUnavailable.message || ''}`,
      /electron-runtime-endpoint-unavailable|unavailable/,
    );

    const streamUnavailable = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen'], {
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
        streamId: 'acceptance-stream-unavailable',
        requestBytesBase64: '',
        timeoutMs: 200,
      },
    });
    assert.equal(streamUnavailable.code, 'external-daemon-required');
    assert.equal(streamUnavailable.reasonCode, 'electron-runtime-endpoint-unavailable');

    const streamCloseResult = await page.evaluate(
      (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {
        streamId: 'acceptance-stream-unavailable',
      }),
      NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
    );
    assert.deepEqual(streamCloseResult, {});

    for (const commandKey of [
      'auth.sessionLoad',
      'auth.sessionSave',
      'auth.sessionClear',
    ]) {
      const unavailableCapability = await captureInvokeError(page, NIMI_STANDARD_SHELL_COMMANDS[commandKey], {});
      assert.equal(unavailableCapability.code, 'external-daemon-required', commandKey);
      assert.equal(unavailableCapability.reasonCode, 'electron-runtime-account-custody-external', commandKey);
      assert.equal(unavailableCapability.source, 'electron', commandKey);
      assert.equal(unavailableCapability.envelope?.code, 'external-daemon-required', commandKey);
      assert.equal(unavailableCapability.envelope?.source, 'electron', commandKey);
    }
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

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('missing free port address'));
      });
    });
  });
}

async function waitForFetchOk(url) {
  const deadline = Date.now() + 2_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('fetch failed');
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-tester-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
