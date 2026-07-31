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

test('Zhiyu conversation home asks Runtime for the canonical Desktop-parity anchor on every probe', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = undefined;
  const opened = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: 'agent_anchor_runtime_owned',
      },
    };
  };

  const first = await module.probeZhiyuRuntimeConversationHome(localAgentReady());
  const second = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(first.conversationAnchorId, 'agent_anchor_runtime_owned');
  assert.equal(second.conversationAnchorId, 'agent_anchor_runtime_owned');
  assert.equal(first.threadId, 'runtime-thread:agent_anchor_runtime_owned');
  assert.equal(second.threadId, 'runtime-thread:agent_anchor_runtime_owned');
  assert.equal(opened.length, 2);
});

test('Zhiyu conversation home delegates resume selection to the admitted localApp open operation', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return { anchor: { conversationAnchorId: 'agent_anchor_resumed' } };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async () => ({
    threadId: 'agent-thread:runtime-owned',
  });

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(result.ready, true);
  assert.equal(result.conversationAnchorId, 'agent_anchor_resumed');
  assert.equal(result.threadId, 'agent-thread:runtime-owned');
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0], { agentHandle: 'opaque-owner-agent-handle' });
});

test('Zhiyu conversation home never calls account-wide conversation inventory', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  let listed = false;
  globalThis.__zhiyuConversationHomeTestListSummaries = async () => {
    listed = true;
    throw new Error('forbidden inventory wire');
  };
  globalThis.__zhiyuConversationHomeTestOpenConversation = async () => ({
    anchor: { conversationAnchorId: 'agent_anchor_local_app' },
  });

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(result.ready, true);
  assert.equal(result.conversationAnchorId, 'agent_anchor_local_app');
  assert.equal(listed, false);
});

test('Zhiyu conversation home treats materialized inventory identity as terminal before opening an anchor', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: 'agent_anchor_lifecycle',
      },
    };
  };

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(result.ready, true);
  assert.equal(result.conversationAnchorId, 'agent_anchor_lifecycle');
  assert.equal(opened.length, 1);
});

test('Zhiyu conversation home ignores a stale renderer anchor and opens the Runtime-owned anchor', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = {
    version: 3,
    bindings: [{
      agentHandle: 'opaque-stale-agent-handle',
      conversationAnchorId: 'agent_anchor_from_previous_runtime',
      threadId: 'agent_thread_from_previous_runtime',
      updatedAtMs: 1,
    }],
  };
  const opened = [];
  const snapshots = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: 'agent_anchor_runtime_owned',
      },
    };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async (request) => {
    snapshots.push(request);
    return { threadId: `runtime-thread:${request.conversationAnchorId}` };
  };

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady('opaque-stale-agent-handle'));

  assert.equal(result.conversationAnchorId, 'agent_anchor_runtime_owned');
  assert.equal(opened.length, 1);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.conversationAnchorId), ['agent_anchor_runtime_owned']);
});

test('Zhiyu conversation home revalidates the Runtime-owned anchor after renderer restart', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  const snapshots = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: 'agent_anchor_runtime_owned',
      },
    };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async (request) => {
    snapshots.push(request);
    return { threadId: `runtime-thread:${request.conversationAnchorId}`, transcript: [] };
  };

  const first = await module.probeZhiyuRuntimeConversationHome(localAgentReady('opaque-persisted-agent-handle'));
  const restartedModule = await importConversationHome();
  const restored = await restartedModule.probeZhiyuRuntimeConversationHome(localAgentReady('opaque-persisted-agent-handle'));

  assert.equal(first.ready, true);
  assert.equal(restored.ready, true);
  assert.equal(first.conversationAnchorId, 'agent_anchor_runtime_owned');
  assert.equal(restored.conversationAnchorId, 'agent_anchor_runtime_owned');
  assert.equal(opened.length, 2, 'each renderer must revalidate the canonical anchor with Runtime');
  assert.deepEqual(snapshots.map((snapshot) => snapshot.conversationAnchorId), [
    'agent_anchor_runtime_owned',
    'agent_anchor_runtime_owned',
  ]);
});

async function importConversationHome() {
  globalThis.__zhiyuConversationHomeTestListSummaries = undefined;
  const outputPath = path.join(await buildConversationHome(), 'conversation-home.mjs');
  return import(`${pathToFileURL(outputPath).href}?test=${Date.now()}`);
}

async function buildConversationHome() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-conversation-home-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent/conversation-home.ts')],
    outfile: path.join(buildDir, 'conversation-home.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [
      workspaceKitSourceAliasPlugin(),
      workspaceSdkSourceAliasPlugin(),
      zhiyuRuntimePlatformStubPlugin(),
    ],
  });
  return buildDir;
}

function zhiyuRuntimePlatformStubPlugin() {
  return {
    name: 'zhiyu-runtime-platform-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /auth\/runtime-platform(?:\.js)?$/ }, () => ({
        path: 'zhiyu-runtime-platform-stub',
        namespace: 'zhiyu-runtime-platform-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'zhiyu-runtime-platform-stub' }, () => ({
        loader: 'js',
        contents: `
          export function getZhiyuLocalAppClient() {
            return {
              conversation: {
                async open(request) {
                  if (typeof globalThis.__zhiyuConversationHomeTestOpenConversation !== 'function') {
                    throw new Error('missing open test hook');
                  }
                  const result = await globalThis.__zhiyuConversationHomeTestOpenConversation(request);
                  return { conversationAnchorId: result.conversationAnchorId || result.anchor?.conversationAnchorId };
                },
                async snapshot(request) {
                  if (typeof globalThis.__zhiyuConversationHomeTestGetSessionSnapshot === 'function') {
                    return globalThis.__zhiyuConversationHomeTestGetSessionSnapshot(request);
                  }
                  return { threadId: 'runtime-thread:' + request.conversationAnchorId };
                },
              },
            };
          }
        `,
      }));
    },
  };
}

function workspaceKitSourceAliasPlugin() {
  return {
    name: 'workspace-kit-source-alias',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
        path: 'workspace-kit-bridge-stub',
        namespace: 'workspace-kit-bridge-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-bridge-stub' }, () => ({
        loader: 'js',
        contents: `
          export function hasElectronRuntime() { return true; }
          export function hasShellHostInvoke() { return true; }
          export function createNimiLocalAppStandardShellSurface() {
            return {
              session: { async status() { return { state: 'ready', reasonCode: 'session-bound', retryable: false }; } },
              permission: {
                async status(input) { return { state: 'unavailable', ...input, canRequest: false, reasonCode: 'permission-not-admitted' }; },
                async request(input) { return { state: 'unavailable', ...input, canRequest: false, reasonCode: 'permission-not-admitted' }; },
              },
              conversation: {
                async open() { throw new Error('not used by storage client'); },
                async send() { throw new Error('not used by storage client'); },
                async subscribe() { throw new Error('not used by storage client'); },
                async snapshot() { throw new Error('not used by storage client'); },
              },
              storage: {
                async readJson() {
                  if (globalThis.__zhiyuConversationAnchorStorageValue == null) {
                    const error = new Error('not found');
                    error.code = 'not-found';
                    throw error;
                  }
                  const value = globalThis.__zhiyuConversationAnchorStorageValue;
                  return { value, sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength };
                },
                async writeJson(_relativePath, value) {
                  globalThis.__zhiyuConversationAnchorStorageValue = value;
                  return { value, sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength };
                },
                async removeJson() { return { removed: true }; },
              },
            };
          }
          export async function invokeChecked(command, payload, parse) {
            if (command === 'nimi.shell.storage.readJson') {
              if (globalThis.__zhiyuConversationAnchorStorageValue === null) {
                const error = new Error('not found');
                error.code = 'not-found';
                throw error;
              }
              return parse({ value: globalThis.__zhiyuConversationAnchorStorageValue });
            }
            if (command === 'nimi.shell.storage.writeJson') {
              globalThis.__zhiyuConversationAnchorStorageValue = payload.value;
              return parse({ value: globalThis.__zhiyuConversationAnchorStorageValue });
            }
            throw new Error('unexpected shell command: ' + command);
          }
        `,
      }));
    },
  };
}

function workspaceSdkSourceAliasPlugin() {
  return {
    name: 'workspace-sdk-runtime-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime$/ }, () => ({
        path: 'workspace-sdk-runtime-stub',
        namespace: 'workspace-sdk-runtime-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-sdk-runtime-stub' }, () => ({
        loader: 'js',
        contents: `
          export class Runtime {
            constructor(options = {}) {
              this.options = options;
            }
          }
          export function createNimiRuntimeAgentClient() {
            return {
              async listConversationSummaries(request) {
                if (typeof globalThis.__zhiyuConversationHomeTestListSummaries === 'function') {
                  return globalThis.__zhiyuConversationHomeTestListSummaries(request);
                }
                return { summaries: [] };
              },
              async openConversation(request) {
                if (typeof globalThis.__zhiyuConversationHomeTestOpenConversation !== 'function') {
                  throw new Error('missing openConversation test hook');
                }
                return globalThis.__zhiyuConversationHomeTestOpenConversation(request);
              },
              async getSessionSnapshot(request) {
                if (typeof globalThis.__zhiyuConversationHomeTestGetSessionSnapshot === 'function') {
                  return globalThis.__zhiyuConversationHomeTestGetSessionSnapshot(request);
                }
                return { threadId: 'runtime-thread:' + request.conversationAnchorId };
              },
            };
          }
          export function projectRuntimeLocalAgentIdentity(input) {
            if (typeof input.localAgentRef !== 'string' || !input.localAgentRef.startsWith('local-agent:')) {
              throw Object.assign(new Error('runtime local agent identity localAgentRef is malformed'), {
                reasonCode: 'AI_INPUT_INVALID',
              });
            }
            return input;
          }
        `,
      }));
    },
  };
}

function localAgentReady(agentHandle = 'opaque-owner-agent-handle') {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-selected',
    actionHint: 'open_runtime_conversation_anchor',
    source: 'runtime',
    message: 'Runtime account-covered Agent handle is selected.',
    agentHandle,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}
