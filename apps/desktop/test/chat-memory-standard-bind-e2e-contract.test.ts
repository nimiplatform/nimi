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
const cognitionPanelSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx'),
  'utf8',
);
const kitCognitionSectionSource = fs.readFileSync(
  path.join(desktopRoot, '../../kit/features/agent-center/src/components/AgentCenterCognitionSection.tsx'),
  'utf8',
);
const memoryStandardBindSpecSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/specs/chat.memory-standard-bind.e2e.mjs'),
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

test('chat memory standard bind journey is registered in the desktop E2E registry', () => {
  assert.match(
    registrySource,
    /\['chat\.memory-standard-bind',\s*\{\s*bucket:\s*'journeys',\s*profile:\s*'chat\.memory-standard-bind\.json',\s*spec:\s*'apps\/desktop\/e2e\/specs\/chat\.memory-standard-bind\.e2e\.mjs'\s*\}\]/,
  );
});

test('chat memory standard bind journey fixture and spec files exist', () => {
  const fixturePath = path.join(desktopRoot, 'e2e/fixtures/profiles/chat.memory-standard-bind.json');
  const specPath = path.join(desktopRoot, 'e2e/specs/chat.memory-standard-bind.e2e.mjs');

  assert.equal(fs.existsSync(fixturePath), true, `missing fixture profile: ${fixturePath}`);
  assert.equal(fs.existsSync(specPath), true, `missing E2E spec: ${specPath}`);
});

test('chat memory standard bind fixture carries only confirm overrides', () => {
  const fixturePath = path.join(desktopRoot, 'e2e/fixtures/profiles/chat.memory-standard-bind.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    tauriFixture?: {
      confirmDialog?: { responses?: Array<{ confirmed?: boolean }> };
      [key: string]: unknown;
    };
  };
  const retiredMemoryFixtureKey = ['agentMemory', 'StandardFixture'].join('');

  assert.deepEqual(
    fixture.tauriFixture?.confirmDialog?.responses?.map((item) => Boolean(item.confirmed)),
    [false, true],
  );
  assert.equal(fixture.tauriFixture?.[retiredMemoryFixtureKey], undefined);
});

test('chat memory standard bind journey exposes stable Memory Mode test ids', () => {
  assert.match(e2eIdsSource, /chatSettingsToggle: 'chat-settings-toggle',/);
  assert.match(e2eIdsSource, /chatAgentCenterSection:\s*\(sectionId: string\) => `chat-agent-center-section:\$\{sectionId\}`/);
  assert.match(e2eIdsSource, /chatMemoryModeCard: 'chat-memory-mode-card',/);
  assert.match(e2eIdsSource, /chatMemoryModeStatus: 'chat-memory-mode-status',/);
  assert.match(e2eIdsSource, /chatMemoryModeUpgradeButton: 'chat-memory-mode-upgrade-button',/);

  assert.match(e2eSelectorsSource, /chatSettingsToggle: 'chat-settings-toggle',/);
  assert.match(e2eSelectorsSource, /chatAgentCenterSection:\s*\(sectionId\) => `chat-agent-center-section:\$\{sectionId\}`/);
  assert.match(e2eSelectorsSource, /chatMemoryModeCard: 'chat-memory-mode-card',/);
  assert.match(e2eSelectorsSource, /chatMemoryModeStatus: 'chat-memory-mode-status',/);
  assert.match(e2eSelectorsSource, /chatMemoryModeUpgradeButton: 'chat-memory-mode-upgrade-button',/);
  assert.match(cognitionPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeCard\}/);
  assert.match(cognitionPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeStatus\}/);
  assert.match(cognitionPanelSource, /data-memory-mode=\{memoryModeValue\}/);
  assert.match(cognitionPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeUpgradeButton\}/);
  assert.match(memoryStandardBindSpecSource, /getAttribute\('data-memory-mode'\)/);
  assert.match(memoryStandardBindSpecSource, /clickByTestIdAtStart\(E2E_IDS\.chatMemoryModeUpgradeButton\)/);
  assert.match(e2eAppHelperSource, /export async function clickByTestIdAtStart/);
});

test('RLA3 Agent Center memory projection is owned by Kit, not Desktop slots', () => {
  assert.match(agentCenterPlacementSource, /@nimiplatform\/kit\/features\/agent-center/);
  assert.doesNotMatch(agentShellAdapterSource, /ChatAgentCognitionPanel/);
  assert.match(kitCognitionSectionSource, /data-agent-center-cognition-memory="true"/);
  assert.match(kitCognitionSectionSource, /最近记忆/);
  assert.match(kitCognitionSectionSource, /cognition\.recentCanonicalMemories/);
});
