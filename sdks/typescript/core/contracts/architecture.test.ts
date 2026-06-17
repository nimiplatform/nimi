import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_ADAPTER_CAPABILITY_LEVELS,
  NIMI_ADAPTER_SOURCE_ROOTS,
  NIMI_CONTRACT_INVENTORY,
  NIMI_MIGRATION_TARGETS,
  NIMI_OWNER_DECISION_GATES,
  NIMI_TYPESCRIPT_TARGET_EXPORTS,
  findNimiAdapterSourceRoot,
} from './architecture';

test('TypeScript target exports keep core contracts as the implementation owner', () => {
  assert.equal(
    NIMI_TYPESCRIPT_TARGET_EXPORTS.find((entry) => entry.id === 'contracts')?.owner,
    'sdks/typescript/core/contracts',
  );
  assert.equal(
    NIMI_TYPESCRIPT_TARGET_EXPORTS.find((entry) => entry.id === 'testing')?.owner,
    'sdks/typescript/core/testing',
  );
});

test('contract inventory covers the shared adapter contract vocabulary', () => {
  const ids = new Set(NIMI_CONTRACT_INVENTORY.map((entry) => entry.id));
  for (const id of [
    'NimiModelRef',
    'NimiMessage',
    'NimiTool',
    'NimiRunEvent',
    'NimiAiTrace',
    'NimiCapabilityManifest',
  ] as const) {
    assert.equal(ids.has(id), true, `missing contract inventory entry ${id}`);
  }
});

test('adapter capability levels are ordered from discovery to workflow', () => {
  assert.deepEqual(
    NIMI_ADAPTER_CAPABILITY_LEVELS.map((entry) => entry.id),
    ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'],
  );
});

test('adapter source roots stay source-root scoped until public package names are decided', () => {
  for (const adapter of NIMI_ADAPTER_SOURCE_ROOTS) {
    assert.match(adapter.owner, /^sdks\/typescript\/adapters\//);
    assert.doesNotMatch(adapter.owner, /^@nimiplatform\//);
  }
  assert.equal(findNimiAdapterSourceRoot('openai-compatible').owner, 'sdks/typescript/adapters/openai-compatible');
});

test('migration targets preserve Vercel-first and OpenAI-compatible bridge priority', () => {
  assert.deepEqual(
    NIMI_MIGRATION_TARGETS.slice(0, 3).map((entry) => entry.id),
    ['vercel-ai', 'openai-compatible', 'mcp'],
  );
});

test('owner decision gates keep hard-to-change public choices explicit', () => {
  const ids = new Set(NIMI_OWNER_DECISION_GATES.map((entry) => entry.id));
  assert.equal(ids.has('adapter-public-package-names'), true);
  assert.equal(ids.has('core-ai-substrate-dependency'), true);
  assert.equal(ids.has('public-interface-uncertainty'), true);
});
