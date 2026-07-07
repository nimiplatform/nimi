import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const FORBIDDEN_RUNTIME_CONFIG_KEY = ['execution', 'config'].join('_');
const FORBIDDEN_RUNTIME_CONFIG_FIELD = `config.${FORBIDDEN_RUNTIME_CONFIG_KEY}`;

let buildDir = null;
let importCounter = 0;
const builtEntries = new Set();

test.afterEach(() => {
  delete globalThis.window;
});

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu Electron main registers local asset files before resolving shell URLs', () => {
  const source = readFileSync(path.join(root, 'src-electron/main.ts'), 'utf8');
  assert.match(source, /resolveLocalAssetUrl:\s*resolveZhiyuLocalAssetUrl/u);
  assert.match(source, /async function resolveZhiyuLocalAssetUrl/u);
  assert.match(source, /localAssetProtocolHost\.registerReadableFile/u);
});

test('Zhiyu Agent Center local config renderer parser accepts admitted local ownership modules', async () => {
  const renderer = await importRendererConfig();
  const result = renderer.validateZhiyuAgentCenterLocalConfig(validConfig());

  assert.equal(result.ok, true);
  assert.equal(result.config.modules.appearance.background_asset_id, null);
  assert.equal(result.config.modules.avatar_asset.local_avatar_asset_ref, null);
  assert.equal(result.config.modules.local_history.last_cleared_at, null);
  assert.equal(result.config.modules.voice.avatar_autoplay, false);
  assert.equal(result.config.modules.ui.last_section, 'overview');
});

test('Zhiyu Agent Center local config renderer parser rejects Runtime execution truth and arbitrary key growth', async () => {
  const renderer = await importRendererConfig();
  const config = validConfig();
  config[FORBIDDEN_RUNTIME_CONFIG_KEY] = { revision: 'runtime-config-revision-1' };
  config.provider = 'runtime-provider';
  config.model = 'runtime-model';
  config.memory = { records: [] };
  config.transcript = [{ role: 'assistant', content: 'not local config truth' }];
  config.runtime_snapshot = { ready: true };
  config.modules.memory = { schema_version: 1 };
  config.modules.appearance.provider_route = { provider: 'runtime-provider' };
  config.modules.avatar_asset.model_config = { text: { provider: 'runtime-provider', model: 'runtime-model' } };
  config.modules.local_history.session_snapshot = { sessionId: 'session-1' };
  config.modules.voice.audio_synthesize = { route: 'runtime-audio' };
  config.modules.ui.runtime_snapshot = { acceptedTurn: 'turn-1' };

  const result = renderer.validateZhiyuAgentCenterLocalConfig(config);

  assert.equal(result.ok, false);
  const errors = result.errors.join('\n');
  for (const field of [
    FORBIDDEN_RUNTIME_CONFIG_FIELD,
    'config.provider',
    'config.model',
    'config.memory',
    'config.transcript',
    'config.runtime_snapshot',
    'config.modules.memory',
    'modules.appearance.provider_route',
    'modules.avatar_asset.model_config',
    'modules.local_history.session_snapshot',
    'modules.voice.audio_synthesize',
    'modules.ui.runtime_snapshot',
  ]) {
    assert.match(errors, new RegExp(escapeRegExp(`${field}: unknown field`), 'u'));
  }
});

test('Zhiyu Agent Center local config renderer bridge rejects invalid config responses', async () => {
  const renderer = await importRendererConfig();
  globalThis.window = {
    __nimiZhiyuAgentCenterLocalConfig: {
      async invoke() {
        const config = validConfig();
        config.modules.local_history.transcript = [{ role: 'user', content: 'owned by Runtime session' }];
        return config;
      },
    },
  };

  await assert.rejects(
    () => renderer.getZhiyuAgentCenterLocalConfig(scope()),
    /modules\.local_history\.transcript: unknown field/u,
  );
});

test('Zhiyu Electron Agent Center local config bridge rejects Runtime truth on persisted writes', async () => {
  await withTempDir(async (dataRoot) => {
    const electronBridge = await importElectronBridge();
    const handler = registerBridgeForTest(electronBridge, dataRoot);
    const config = validConfig();
    config[FORBIDDEN_RUNTIME_CONFIG_KEY] = { revision: 'runtime-config-revision-1' };
    config.provider_route = { provider: 'runtime-provider', model: 'runtime-model' };
    config.runtime_snapshot = { ready: true };
    config.modules.avatar_asset.memory = { records: [] };
    config.modules.local_history.transcript = [{ role: 'assistant', content: 'not local config truth' }];
    config.modules.voice.route = 'runtime-audio';
    config.modules.ui.model = 'runtime-model';

    await assert.rejects(
      () => handler(allowedEvent(), {
        command: 'config.put',
        payload: { config },
      }),
      new RegExp(`${escapeRegExp(FORBIDDEN_RUNTIME_CONFIG_FIELD)} is not admitted|config\\.provider_route is not admitted|config\\.runtime_snapshot is not admitted`, 'u'),
    );
  });
});

test('Zhiyu Electron Agent Center local config bridge creates only admitted default modules', async () => {
  await withTempDir(async (dataRoot) => {
    const electronBridge = await importElectronBridge();
    const handler = registerBridgeForTest(electronBridge, dataRoot);
    const config = await handler(allowedEvent(), {
      command: 'config.get',
      payload: scope(),
    });

    assert.deepEqual(Object.keys(config.modules).sort(), ['appearance', 'avatar_asset', 'local_history', 'ui', 'voice']);
    assert.equal(config.modules.appearance.background_asset_id, null);
    assert.equal(config.modules.avatar_asset.local_avatar_asset_ref, null);
    assert.equal(config.modules.local_history.last_cleared_at, null);
    assert.equal(config.modules.voice.avatar_autoplay, false);
    assert.equal(config.modules.ui.last_section, 'overview');
    assert.equal(FORBIDDEN_RUNTIME_CONFIG_KEY in config, false);
    assert.equal('memory' in config.modules, false);
  });
});

async function importRendererConfig() {
  const outputPath = await buildEntrypoint(
    'zhiyu-agent-center-local-config-renderer',
    path.join(root, 'src/shell/agent-chat/zhiyu-agent-center-local-config.ts'),
    {},
  );
  importCounter += 1;
  return import(`${pathToFileURL(outputPath).href}?case=${importCounter}`);
}

async function importElectronBridge() {
  const outputPath = await buildEntrypoint(
    'zhiyu-agent-center-local-config-electron',
    path.join(root, 'src-electron/agent-center-local-config.ts'),
    {
      plugins: [electronStubPlugin()],
    },
  );
  importCounter += 1;
  return import(`${pathToFileURL(outputPath).href}?case=${importCounter}`);
}

async function buildEntrypoint(name, entryPoint, options) {
  if (!buildDir) {
    mkdirSync(path.join(root, '.tmp'), { recursive: true });
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-agent-center-local-config-'));
  }
  const outputPath = path.join(buildDir, `${name}.mjs`);
  if (builtEntries.has(name)) {
    return outputPath;
  }
  await build({
    entryPoints: [entryPoint],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    ...(options || {}),
  });
  builtEntries.add(name);
  return outputPath;
}

function electronStubPlugin() {
  return {
    name: 'electron-stub',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^electron$/ }, () => ({
        path: 'electron-stub',
        namespace: 'electron-stub',
      }));
      buildContext.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
        loader: 'js',
        contents: 'export const dialog = { async showOpenDialog() { return { canceled: true, filePaths: [] }; } };',
      }));
    },
  };
}

function registerBridgeForTest(electronBridge, dataRoot) {
  let handler = null;
  electronBridge.registerZhiyuAgentCenterLocalConfigBridge({
    ipcMain: {
      handle(channel, nextHandler) {
        assert.equal(channel, 'zhiyu:agent-center-local-config');
        handler = nextHandler;
      },
    },
    dataRoot,
    isAllowedRendererUrl(url) {
      return url === 'file:///zhiyu-test.html';
    },
    mainWindow() {
      return undefined;
    },
  });
  assert.equal(typeof handler, 'function');
  return handler;
}

function allowedEvent() {
  return {
    senderFrame: { url: 'file:///zhiyu-test.html' },
    sender: { getURL: () => 'file:///zhiyu-test.html' },
  };
}

function validConfig() {
  return {
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: 'account_1',
    owner_user_id: 'owner_1',
    runtime_source_ref: 'runtime-source:ren',
    local_agent_ref: 'local-agent:ren',
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        live2d_calibration_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'live2d',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'standard',
        updated_at: '2026-07-07T00:00:00Z',
        provenance: {
          source: 'runtime_projection',
          evidence_ref: 'zhiyu-agent-center-avatar-config-default',
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  };
}

function scope() {
  return {
    accountId: 'account_1',
    ownerUserId: 'owner_1',
    runtimeSourceRef: 'runtime-source:ren',
    localAgentRef: 'local-agent:ren',
  };
}

async function withTempDir(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-agent-center-local-config-data-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
