import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu desktop_open_select_partner sends the standard DesktopOpenIntent', async () => {
  const module = await importDesktopOpenActionModule();
  const calls = [];

  const result = await module.requestZhiyuDesktopOpenSelectPartner(async (request) => {
    calls.push(request);
    return {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: 'desktop-open-20260708-bridge',
      requestId: 'desktop-open-20260708-zhiyu',
      appliedTarget: 'open-explore',
    };
  });

  assert.deepEqual(calls, [{
    intent: {
      kind: 'open-explore',
      section: 'personas',
      productIntent: 'select-partner',
    },
  }]);
  assert.equal(module.ZHIYU_DESKTOP_OPEN_SELECT_PARTNER_ACTION, 'desktop_open_select_partner');
  assert.equal(result.state, 'accepted');
  assert.equal(result.reasonCode, 'desktop-open-accepted');
});

test('Zhiyu desktop_open_select_partner reports running-only not-running honestly', async () => {
  const module = await importDesktopOpenActionModule();

  const result = await module.requestZhiyuDesktopOpenSelectPartner(async () => ({
    status: 'rejected',
    reasonCode: 'desktop-open-desktop-not-running',
    actionHint: 'open_desktop_first',
  }));

  assert.equal(result.state, 'rejected');
  assert.equal(result.reasonCode, 'desktop-open-desktop-not-running');
  assert.equal(result.actionHint, 'open_desktop_first');
  assert.match(result.message, /不会代替你启动桌面端/);
});

test('Zhiyu desktop_open_select_partner keeps host exception details in diagnostics only', async () => {
  const module = await importDesktopOpenActionModule();
  const failure = Object.assign(
    new Error('Electron standard shell does not admit command: nimi.shell.desktopOpen.openIntent'),
    {
      reasonCode: 'renderer-standard-shell-host-unavailable',
      actionHint: 'open_desktop_manually',
    },
  );

  const result = await module.requestZhiyuDesktopOpenSelectPartner(async () => {
    throw failure;
  });

  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'renderer-standard-shell-host-unavailable');
  assert.equal(result.actionHint, 'open_desktop_manually');
  assert.match(result.message, /手动打开桌面端「探索」页/);
  assert.doesNotMatch(result.message, /Electron|standard shell|command|nimi\.shell/u);
});

test('Zhiyu desktop-open mapping covers partner, connector, and model gaps', async () => {
  const module = await importDesktopOpenActionModule();

  assert.deepEqual(module.zhiyuDesktopOpenIntentForProductGap({
    stage: 'source-required',
  }), {
    kind: 'open-explore',
    section: 'personas',
    productIntent: 'select-partner',
  });
  assert.deepEqual(module.zhiyuDesktopOpenIntentForProductGap({
    stage: 'agent-required',
  }), {
    kind: 'open-explore',
    section: 'personas',
    productIntent: 'select-partner',
  });
  assert.deepEqual(module.zhiyuDesktopOpenIntentForProductGap({
    capabilityReasonCode: 'connector_missing',
  }), {
    kind: 'open-runtime-config',
    page: 'cloud',
    action: 'add-connector',
  });
  assert.deepEqual(module.zhiyuDesktopOpenIntentForProductGap({
    stage: 'route-required',
    reasonCode: 'model_missing',
  }), {
    kind: 'open-runtime-config',
    page: 'models',
    action: 'install-model',
  });
});

test('Zhiyu desktop-open mapping does not fabricate an intent for unrelated gaps', async () => {
  const module = await importDesktopOpenActionModule();

  assert.equal(module.zhiyuDesktopOpenIntentForProductGap({
    stage: 'ready',
    reasonCode: 'runtime-agent-ai-config-ready',
    actionHint: 'send_runtime_agent_turn',
  }), null);
});

async function importDesktopOpenActionModule() {
  if (!buildDir) {
    mkdirSync(path.join(root, '.tmp'), { recursive: true });
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-desktop-open-action-'));
    await build({
      entryPoints: [path.join(root, 'src/shell/desktop-open/desktop-open-action.ts')],
      outdir: buildDir,
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      logLevel: 'silent',
      plugins: [workspaceBridgeStubPlugin()],
    });
  }
  return import(pathToFileURL(path.join(buildDir, 'desktop-open-action.mjs')).href);
}

function workspaceBridgeStubPlugin() {
  return {
    name: 'workspace-bridge-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
        path: 'workspace-kit-bridge-stub',
        namespace: 'workspace-kit-bridge-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-bridge-stub' }, () => ({
        loader: 'js',
        contents: 'export async function openDesktopIntent() { throw new Error("test must inject Desktop Open invoker"); }',
      }));
    },
  };
}
