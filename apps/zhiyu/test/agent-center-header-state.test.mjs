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

test('Agent Center header places the Chinese Runtime pill in the chrome row above the enlarged avatar profile row', async () => {
  const source = await readFile(path.join(appRoot, 'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx'), 'utf8');

  assert.match(
    source,
    /className="zhiyu-agent-center__chrome-row[^"]*gap-2[^"]*"[\s\S]{0,700}data-zhiyu-agent-center-eyebrow="agent-center"[\s\S]{0,120}智能体中心[\s\S]{0,700}data-zhiyu-agent-center-runtime-pill=\{runtimeState\}[\s\S]{0,120}运行时[\s\S]{0,700}className="zhiyu-agent-center__profile-row/,
    '运行时 pill must sit with the Chinese Agent Center eyebrow above the avatar/profile row',
  );
  assert.doesNotMatch(
    source,
    /className="zhiyu-agent-center__profile-row[^"]*"[\s\S]{0,700}data-zhiyu-agent-center-runtime-pill=\{runtimeState\}/,
    'Runtime pill must not move into the avatar/name/status profile row',
  );
  assert.match(
    source,
    /data-zhiyu-agent-center-eyebrow="agent-center"[\s\S]{0,180}text-\[12px\]/,
    'Agent Center eyebrow should use the larger 12px label size',
  );
  assert.match(
    source,
    /zhiyu-agent-center__avatar[^"]*h-\[52px\][^"]*w-\[52px\][^"]*text-\[18px\]/,
    'Agent Center avatar should use the enlarged 52px side-sheet avatar size',
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
