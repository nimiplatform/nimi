import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveRequirementSummary } from '../src/shell/renderer/features/apps/apps-card-fields.js';
import { inventoryEntry } from './apps-read-only-fixtures.js';

describe('Desktop Apps requirement authority', () => {
  it('keeps platform capabilities separate from user permissions', () => {
    const requirements = deriveRequirementSummary(inventoryEntry({
      capabilitySet: ['runtime.agent.turn'],
    }));

    assert.equal(requirements.platformFeatures, true);
    assert.equal('permissions' in requirements, false);
  });
});
