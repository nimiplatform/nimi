import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/avatar/avatar-presence.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function localAgentReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'local-agent-discovered',
    actionHint: 'open_runtime_agent_home',
    source: 'runtime',
    message: 'Runtime-owned LocalAgent was discovered.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  };
}

function localAgentUnavailable() {
  return {
    ...localAgentReady(),
    ready: false,
    reasonCode: 'zhiyu-runtime-source-required',
    actionHint: 'provide_admitted_runtime_source_projection',
    source: 'renderer',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  };
}

test('projects admitted Avatar facade presence without taking visual asset ownership', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const calls = [];
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readAvatarPresence: async (input) => {
      calls.push(input);
      return {
        configurationRef: 'avatar-config-evidence:agent-1',
        launchAvailable: true,
        manageAvailable: true,
        reasonCode: 'avatar-facade-projected',
        actionHint: 'open_avatar_through_admitted_facade',
        source: 'sdk',
        message: 'Avatar facade projection is available.',
      };
    },
  });

  assert.deepEqual(calls, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'local-agent:opaque',
  }]);
  assert.equal(avatar.ready, true);
  assert.equal(avatar.state, 'projected');
  assert.equal(avatar.reasonCode, 'avatar-facade-projected');
  assert.equal(avatar.actionHint, 'open_avatar_through_admitted_facade');
  assert.equal(avatar.source, 'sdk');
  assert.equal(avatar.configurationRef, 'avatar-config-evidence:agent-1');
  assert.equal(avatar.launchAvailable, true);
  assert.equal(avatar.manageAvailable, true);
});

test('fails closed before Avatar facade read when LocalAgent is unavailable', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  let called = false;
  const avatar = await probeZhiyuAvatarPresence(localAgentUnavailable(), {
    readAvatarPresence: async () => {
      called = true;
      throw new Error('not expected');
    },
  });

  assert.equal(called, false);
  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'zhiyu-local-agent-required');
  assert.equal(avatar.actionHint, 'select_runtime_owned_partner');
  assert.equal(avatar.configurationRef, null);
  assert.equal(avatar.launchAvailable, false);
  assert.equal(avatar.manageAvailable, false);
});

test('fails closed when Avatar presence is not admitted on the local-app carrier', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const avatar = await probeZhiyuAvatarPresence(localAgentReady());

  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'zhiyu-avatar-presence-capability-not-admitted');
  assert.equal(avatar.actionHint, 'admit_zhiyu_avatar_presence_capability');
  assert.equal(avatar.source, 'sdk');
});

test('normalizes Avatar facade read failures without pseudo presence', async () => {
  const { probeZhiyuAvatarPresence } = await loadModule();
  const error = Object.assign(new Error('Avatar facade read failed.'), {
    reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
    actionHint: 'check_avatar_facade_projection',
    source: 'sdk',
  });
  const avatar = await probeZhiyuAvatarPresence(localAgentReady(), {
    readAvatarPresence: async () => {
      throw error;
    },
  });

  assert.equal(avatar.ready, false);
  assert.equal(avatar.state, 'blocked');
  assert.equal(avatar.reasonCode, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
  assert.equal(avatar.actionHint, 'check_avatar_facade_projection');
  assert.equal(avatar.source, 'sdk');
  assert.equal(avatar.configurationRef, null);
});
