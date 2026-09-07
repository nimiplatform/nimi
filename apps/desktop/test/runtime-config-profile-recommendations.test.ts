import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiAppAIProfileFactoryRow } from '@nimiplatform/sdk/app';
import type { NimiRuntimeFactoryProfileRecommendation } from '@nimiplatform/sdk/runtime';

import { joinFactoryRecommendations } from '../src/shell/renderer/features/runtime-config/runtime-config-profile-recommendations.js';

test('factory Profile projection preserves Runtime order and only joins canonical aliases', () => {
  const rows = [
    { alias: 'profile-a', capabilitySet: ['text.generate'] },
    { alias: 'profile-b', capabilitySet: ['image.generate'] },
  ] as unknown as readonly NimiAppAIProfileFactoryRow[];
  const recommendations = [
    { profileAlias: 'profile-b', capabilities: [] },
    { profileAlias: 'unknown-profile', capabilities: [] },
    { profileAlias: 'profile-a', capabilities: [] },
  ] as readonly NimiRuntimeFactoryProfileRecommendation[];

  assert.deepEqual(
    joinFactoryRecommendations(rows, recommendations).map((item) => item.row.alias),
    ['profile-b', 'profile-a'],
  );
});
