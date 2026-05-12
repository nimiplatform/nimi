import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeConfigDir = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config',
);

function readRuntimeConfigFile(fileName: string): string {
  return readFileSync(path.join(runtimeConfigDir, fileName), 'utf8');
}

test('runtime config hard-cuts the retired knowledge management page', () => {
  const stateTypes = readRuntimeConfigFile('runtime-config-state-types.ts');
  const sidebar = readRuntimeConfigFile('runtime-config-sidebar.tsx');
  const panel = readRuntimeConfigFile('runtime-config-panel-view.tsx');
  const meta = readRuntimeConfigFile('runtime-config-meta-v11.ts');

  assert.doesNotMatch(stateTypes, /'knowledge'/);
  assert.doesNotMatch(sidebar, /id:\s*'knowledge'/);
  assert.doesNotMatch(sidebar, /runtimeConfig\.sidebar\.knowledge/);
  assert.doesNotMatch(panel, /KnowledgePage|runtimePageRoot\('knowledge'\)/);
  assert.doesNotMatch(meta, /knowledge:\s*{/);

  const retiredFiles = [
    'runtime-config-knowledge-sdk-service.ts',
    'runtime-config-page-knowledge.tsx',
    'runtime-config-page-knowledge-management.tsx',
    'runtime-config-page-knowledge-discovery.tsx',
    'runtime-config-page-knowledge-discovery-actions.ts',
    'runtime-config-page-knowledge-helpers.ts',
    'runtime-config-page-knowledge-ui.tsx',
  ];

  for (const fileName of retiredFiles) {
    assert.equal(
      existsSync(path.join(runtimeConfigDir, fileName)),
      false,
      `${fileName} must stay retired`,
    );
  }
});

test('runtime knowledge SDK methods remain absorbed by cognition service ids', () => {
  const methodIds = readFileSync(
    path.join(import.meta.dirname, '../../../sdk/src/runtime/method-ids.ts'),
    'utf8',
  );
  const retiredServiceName = ['Runtime', 'Knowledge', 'Service'].join('');

  assert.match(methodIds, /knowledge:\s*{[\s\S]*RuntimeCognitionService\/CreateKnowledgeBank/);
  assert.match(methodIds, /knowledge:\s*{[\s\S]*RuntimeCognitionService\/SearchKeyword/);
  assert.equal(methodIds.includes(retiredServiceName), false);
});
