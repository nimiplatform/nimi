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

  assert.equal(labels.agentCenterHeaderStateLabel('focused'), 'focused');
  assert.equal(labels.agentCenterHeaderStateLabel('chat-active'), 'chat-active');
});

test('Agent Center header places Runtime pill beside the Agent Center eyebrow', async () => {
  const source = await readFile(path.join(appRoot, 'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx'), 'utf8');

  assert.match(
    source,
    /className="zhiyu-agent-center__eyebrow-row[^"]*gap-3[^"]*"[\s\S]{0,700}data-zhiyu-agent-center-eyebrow="AGENT CENTER"[\s\S]{0,700}data-zhiyu-agent-center-runtime-pill=\{runtimeState\}/,
    'Runtime pill must sit on the same row as the AGENT CENTER eyebrow with a small gap',
  );
  assert.doesNotMatch(
    source,
    /className="flex min-w-0 items-center gap-2"[\s\S]{0,500}data-zhiyu-agent-center-runtime-pill=\{runtimeState\}/,
    'Runtime pill must not remain on the partner display-name row',
  );
});

test('Agent Center header hides Runtime LocalAgent refs from user-facing metadata', async () => {
  const source = await readFile(path.join(appRoot, 'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx'), 'utf8');

  assert.doesNotMatch(
    source,
    /data-zhiyu-agent-center-local-agent-ref/,
    'Runtime LocalAgent refs are internal opaque identifiers and must not render in the user-facing header',
  );
  assert.doesNotMatch(
    source,
    /\bagentCenterLocalAgentRef\b/,
    'The Agent Center header must not derive a user-facing label from the opaque Runtime LocalAgent ref',
  );
});

test('Agent Center world metadata renders the Runtime-projected world name, not the world role tag', async () => {
  const labels = await importTypescriptModule('src/shell/agent-chat/ZhiyuAgentChatLabels.ts');
  const evidence = {
    localAgent: {
      localAgentRef: 'local-agent:world-character',
    },
    inventory: {
      localAgents: [{
        localAgentRef: 'local-agent:world-character',
        sourceKind: 'worldCharacter',
        sourceWorldName: '唐代文人世界',
      }],
    },
  };

  assert.equal(labels.agentCenterWorldLabel(evidence), '唐代文人世界');
  assert.notEqual(labels.agentCenterWorldLabel(evidence), '世界角色');
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
