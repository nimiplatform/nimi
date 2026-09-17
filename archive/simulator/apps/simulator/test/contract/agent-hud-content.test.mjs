import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const simulatorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const agentHudSource = readFileSync(
  path.join(simulatorRoot, 'src/shell/chrome/agent-hud.tsx'),
  'utf8',
);

test('agent HUD omits the removed identity and demo content', () => {
  assert.doesNotMatch(agentHudSource, /agentPersona\.kind/u);
  assert.doesNotMatch(agentHudSource, /你最近在做/u);
  assert.doesNotMatch(agentHudSource, /你在优化世界入口与 Agent 呈现方式/u);
  assert.doesNotMatch(agentHudSource, /模拟演示 · 以上动态为演示投影，不是真实记忆。/u);
});
