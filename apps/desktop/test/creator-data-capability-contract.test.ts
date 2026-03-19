import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_DATA_API_CAPABILITIES } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(testDir, '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('world data capability registry exposes creator agent get/update operations', () => {
  assert.equal(WORLD_DATA_API_CAPABILITIES.creatorAgentsGet, 'data-api.creator.agents.get');
  assert.equal(WORLD_DATA_API_CAPABILITIES.creatorAgentsUpdate, 'data-api.creator.agents.update');
});

test('creator bootstrap registers creator agent get/update against creator detail endpoints', () => {
  const source = readDesktopFile('src/shell/renderer/infra/bootstrap/creator-capabilities.ts');
  assert.match(source, /creatorAgentsGet/);
  assert.match(source, /creatorAgentsUpdate/);
  assert.match(source, /CreatorService\.creatorControllerGetAgent/);
  assert.match(source, /CreatorService\.creatorControllerUpdateAgent/);
});
