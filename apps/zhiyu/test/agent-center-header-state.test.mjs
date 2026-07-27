import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { transform } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

test('Agent Center header state chips hide unconfigured and missing projections', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');

  assert.equal(typeof labels.agentCenterHeaderStateLabel, 'function');

  for (const missingValue of [
    null,
    undefined,
    '',
    '   ',
    'not_projected',
    'not_projected_in_rla0b_harness',
    'not_configured',
    'unknown',
    'ready',
  ]) {
    assert.equal(labels.agentCenterHeaderStateLabel(missingValue), null, `${String(missingValue)} must not render a header chip`);
  }

  assert.equal(labels.agentCenterHeaderStateLabel('focused'), '专注');
  assert.equal(labels.agentCenterHeaderStateLabel('chat-active'), '对话中');
});

test('Agent Center world metadata stays absent from the bounded local-app inventory projection', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');
  const evidence = {
    localAgent: {
      localAgentRef: 'local-agent:world-character',
    },
    inventory: {
      localAgents: [{
        localAgentRef: 'local-agent:world-character',
        displayName: '颜真卿',
        ownerUserId: 'user-a',
        runtimeSourceRef: 'source-a',
        sourceReady: true,
      }],
    },
  };

  assert.equal(labels.agentCenterWorldLabel(evidence), null);
});

test('Agent Center world metadata fails closed when Runtime does not project a world name', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');
  const evidence = {
    localAgent: {
      localAgentRef: 'local-agent:world-character',
    },
    inventory: {
      localAgents: [{
        localAgentRef: 'local-agent:world-character',
        sourceKind: 'worldCharacter',
        sourceWorldName: null,
      }],
    },
  };

  assert.equal(labels.agentCenterWorldLabel(evidence), null);
});

async function importTypescriptModule(relativePath) {
  const source = await readFile(path.join(appRoot, relativePath), 'utf8');
  const result = await transform(source, {
    format: 'esm',
    loader: 'ts',
    sourcemap: false,
    target: 'es2022',
  });
  const encoded = Buffer.from(result.code, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}
