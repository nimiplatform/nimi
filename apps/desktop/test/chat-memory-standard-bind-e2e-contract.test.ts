import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const registrySource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/registry.mjs'),
  'utf8',
);
const e2eIdsSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts'),
  'utf8',
);
const e2eSelectorsSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/selectors.mjs'),
  'utf8',
);
const e2eAppHelperSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/app.mjs'),
  'utf8',
);
const kitCognitionSectionSource = fs.readFileSync(
  path.join(desktopRoot, '../../kit/features/agent-center/src/components/AgentCenterCognitionSection.tsx'),
  'utf8',
);
const agentShellAdapterSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx'),
  'utf8',
);
const agentCenterPlacementSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
  'utf8',
);
const retiredCognitionPanelPath = path.join(
  desktopRoot,
  'src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx',
);
const retiredMemoryStandardBindSpecPath = path.join(
  desktopRoot,
  'e2e/specs/chat.memory-standard-bind.e2e.mjs',
);
const retiredMemoryStandardBindFixturePath = path.join(
  desktopRoot,
  'e2e/fixtures/profiles/chat.memory-standard-bind.json',
);

test('RLA3 hard-cuts retired Desktop memory-mode journey and panel', () => {
  assert.equal(fs.existsSync(retiredCognitionPanelPath), false);
  assert.equal(fs.existsSync(retiredMemoryStandardBindSpecPath), false);
  assert.equal(fs.existsSync(retiredMemoryStandardBindFixturePath), false);
  assert.doesNotMatch(registrySource, /chat\.memory-standard-bind/);
  assert.doesNotMatch(e2eIdsSource, /chatMemoryMode/);
  assert.doesNotMatch(e2eSelectorsSource, /chatMemoryMode/);
  assert.match(e2eAppHelperSource, /export async function clickByTestIdAtStart/);
});

test('RLA3 Agent Center memory projection is owned by Kit, not Desktop slots', () => {
  assert.match(agentCenterPlacementSource, /@nimiplatform\/kit\/features\/agent-center/);
  assert.doesNotMatch(agentShellAdapterSource, /ChatAgentCognitionPanel/);
  assert.match(kitCognitionSectionSource, /data-agent-center-cognition-memory="true"/);
  assert.match(kitCognitionSectionSource, /cognition\.recentCanonicalMemories/);
});
