import assert from 'node:assert/strict';
import test from 'node:test';

import { WORLD_DATA_API_CAPABILITIES } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils';

test('world data capability registry exposes creator agent get/update operations', () => {
  assert.equal(WORLD_DATA_API_CAPABILITIES.creatorAgentsGet, 'data-api.creator.agents.get');
  assert.equal(WORLD_DATA_API_CAPABILITIES.creatorAgentsUpdate, 'data-api.creator.agents.update');
});
