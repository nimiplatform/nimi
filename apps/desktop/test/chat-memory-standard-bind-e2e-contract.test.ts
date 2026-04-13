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
const historyPanelSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-agent-history-panel.tsx'),
  'utf8',
);
const rightPanelSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/features/chat/chat-right-panel-character-rail.tsx'),
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

test('chat memory standard bind fixture carries tauri bind and confirm overrides', () => {
  const fixturePath = path.join(desktopRoot, 'e2e/fixtures/profiles/chat.memory-standard-bind.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    tauriFixture?: {
      confirmDialog?: { responses?: Array<{ confirmed?: boolean }> };
      agentMemoryBindStandard?: { embeddingProfileModelId?: string };
    };
  };

  assert.deepEqual(
    fixture.tauriFixture?.confirmDialog?.responses?.map((item) => Boolean(item.confirmed)),
    [false, true],
  );
  assert.equal(
    fixture.tauriFixture?.agentMemoryBindStandard?.embeddingProfileModelId,
    'local/embed-e2e-alpha',
  );
});

test('chat memory standard bind journey exposes stable Memory Mode test ids', () => {
  assert.match(e2eIdsSource, /chatSettingsToggle: 'chat-settings-toggle',/);
  assert.match(e2eIdsSource, /chatMemoryModeCard: 'chat-memory-mode-card',/);
  assert.match(e2eIdsSource, /chatMemoryModeStatus: 'chat-memory-mode-status',/);
  assert.match(e2eIdsSource, /chatMemoryModeUpgradeButton: 'chat-memory-mode-upgrade-button',/);

  assert.match(e2eSelectorsSource, /chatSettingsToggle: 'chat-settings-toggle',/);
  assert.match(e2eSelectorsSource, /chatMemoryModeCard: 'chat-memory-mode-card',/);
  assert.match(e2eSelectorsSource, /chatMemoryModeStatus: 'chat-memory-mode-status',/);
  assert.match(e2eSelectorsSource, /chatMemoryModeUpgradeButton: 'chat-memory-mode-upgrade-button',/);
  assert.match(rightPanelSource, /data-testid=\{E2E_IDS\.chatSettingsToggle\}/);
  assert.match(historyPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeCard\}/);
  assert.match(historyPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeStatus\}/);
  assert.match(historyPanelSource, /data-memory-mode=\{memoryModeValue\}/);
  assert.match(historyPanelSource, /data-testid=\{E2E_IDS\.chatMemoryModeUpgradeButton\}/);
});
