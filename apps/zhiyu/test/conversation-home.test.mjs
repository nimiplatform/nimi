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

test('Zhiyu conversation home reuses the Desktop-parity anchor binding for the same Runtime LocalAgent', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = undefined;
  const opened = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: `agent_anchor_${opened.length}`,
      },
    };
  };

  const first = await module.probeZhiyuRuntimeConversationHome(localAgentReady());
  const second = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(first.conversationAnchorId, 'agent_anchor_1');
  assert.equal(second.conversationAnchorId, 'agent_anchor_1');
  assert.equal(first.threadId, 'runtime-thread:agent_anchor_1');
  assert.equal(second.threadId, 'runtime-thread:agent_anchor_1');
  assert.equal(opened.length, 1);
});

test('Zhiyu conversation home adopts the sole active Runtime anchor created on Desktop', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  const listed = [];
  globalThis.__zhiyuConversationHomeTestListSummaries = async (request) => {
    listed.push(request);
    return {
      summaries: [{
        anchor: {
          conversationAnchorId: 'agent_anchor_desktop',
          ownerUserId: request.ownerUserId,
          runtimeSourceRef: request.runtimeSourceRef,
          localAgentRef: request.localAgentRef,
          agentId: request.localAgentRef,
        },
        transcriptMessageCount: 8,
      }],
    };
  };
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return { anchor: { conversationAnchorId: 'agent_anchor_replacement' } };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async () => ({
    threadId: 'agent-thread:desktop-owned-runtime-thread',
  });

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(result.ready, true);
  assert.equal(result.conversationAnchorId, 'agent_anchor_desktop');
  assert.equal(result.threadId, 'agent-thread:desktop-owned-runtime-thread');
  assert.equal(opened.length, 0, 'Zhiyu must not replace the sole Runtime-owned Desktop anchor');
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].statusFilter, ['active']);
  assert.equal(listed[0].pageSize, 2);
});

test('Zhiyu conversation home fails closed instead of guessing between active Runtime anchors', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  globalThis.__zhiyuConversationHomeTestListSummaries = async (request) => ({
    summaries: ['one', 'two'].map((suffix) => ({
      anchor: {
        conversationAnchorId: `agent_anchor_${suffix}`,
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
        localAgentRef: request.localAgentRef,
        agentId: request.localAgentRef,
      },
      transcriptMessageCount: 2,
    })),
  });
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return { anchor: { conversationAnchorId: 'agent_anchor_replacement' } };
  };

  const result = await module.probeZhiyuRuntimeConversationHome(localAgentReady());

  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'zhiyu-conversation-anchor-ambiguous');
  assert.equal(opened.length, 0);
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

test('Zhiyu conversation home clears a stale anchor binding before opening a replacement', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  const opened = [];
  const snapshots = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: `agent_anchor_${opened.length}`,
      },
    };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async (request) => {
    snapshots.push(request);
    if (snapshots.length === 2) {
      throw Object.assign(new Error('conversation anchor not found'), {
        reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      });
    }
    return { threadId: `runtime-thread:${request.conversationAnchorId}` };
  };

  const first = await module.probeZhiyuRuntimeConversationHome(localAgentReady({
    localAgentRef: 'runtime-local-agent:stale',
  }));
  const second = await module.probeZhiyuRuntimeConversationHome(localAgentReady({
    localAgentRef: 'runtime-local-agent:stale',
  }));

  assert.equal(first.conversationAnchorId, 'agent_anchor_1');
  assert.equal(second.conversationAnchorId, 'agent_anchor_2');
  assert.equal(opened.length, 2);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.conversationAnchorId), [
    'agent_anchor_1',
    'agent_anchor_1',
    'agent_anchor_2',
  ]);
});

test('Zhiyu conversation home restores anchor binding from standard shell storage after renderer restart', async () => {
  const module = await importConversationHome();
  globalThis.window = {};
  globalThis.__zhiyuConversationAnchorStorageValue = null;
  const opened = [];
  const snapshots = [];
  globalThis.__zhiyuConversationHomeTestOpenConversation = async (request) => {
    opened.push(request);
    return {
      anchor: {
        conversationAnchorId: `agent_anchor_${opened.length}`,
      },
    };
  };
  globalThis.__zhiyuConversationHomeTestGetSessionSnapshot = async (request) => {
    snapshots.push(request);
    return { threadId: `runtime-thread:${request.conversationAnchorId}`, transcript: [] };
  };

  const first = await module.probeZhiyuRuntimeConversationHome(localAgentReady({
    localAgentRef: 'runtime-local-agent:persisted',
  }));
  const restartedModule = await importConversationHome();
  const restored = await restartedModule.probeZhiyuRuntimeConversationHome(localAgentReady({
    localAgentRef: 'runtime-local-agent:persisted',
  }));

  assert.equal(first.ready, true);
  assert.equal(restored.ready, true);
  assert.equal(first.conversationAnchorId, 'agent_anchor_1');
  assert.equal(restored.conversationAnchorId, 'agent_anchor_1');
  assert.equal(opened.length, 1, 'restored anchor binding must avoid opening a replacement conversation');
  assert.deepEqual(snapshots.map((snapshot) => snapshot.conversationAnchorId), ['agent_anchor_1', 'agent_anchor_1']);
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
      workspaceKitCapabilitiesAliasPlugin(),
      workspaceSdkSourceAliasPlugin(),
    ],
  });
  return buildDir;
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

function workspaceKitCapabilitiesAliasPlugin() {
  return {
    name: 'workspace-kit-capabilities-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/capabilities$/ }, () => ({
        path: 'workspace-kit-capabilities-stub',
        namespace: 'workspace-kit-capabilities-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-capabilities-stub' }, () => ({
        loader: 'js',
        contents: `
          export const NIMI_STANDARD_SHELL_COMMANDS = {
            'storage.readJson': 'nimi.shell.storage.readJson',
            'storage.writeJson': 'nimi.shell.storage.writeJson',
          };
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
            return input;
          }
        `,
      }));
    },
  };
}

function localAgentReady(overrides = {}) {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-selected',
    actionHint: 'open_runtime_conversation_anchor',
    source: 'runtime',
    message: 'Runtime LocalAgent is selected.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    ...overrides,
  };
}
