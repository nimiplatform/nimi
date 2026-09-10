import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadNimiAppAIProfileFactoryRows, type NimiAppAIProfileFactoryRow } from '@nimiplatform/sdk/app';
import type { NimiRuntimeFactoryProfileRecommendation } from '@nimiplatform/sdk/runtime';

import { joinFactoryRecommendations, ProfileRecommendationCardView } from '../src/shell/renderer/features/runtime-config/runtime-config-profile-recommendations.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

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

test('factory recommendations offer the settings entry appropriate to their execution intent', async () => {
  await initI18n();
  const rows = loadNimiAppAIProfileFactoryRows();
  assert.ok(rows.some((row) => row.computePosture === 'cloud-only'));
  assert.ok(rows.some((row) => row.routingPolicy === 'local-first'));
  assert.ok(rows.some((row) => row.routingPolicy === 'hybrid-explicit'));

  for (const row of rows) {
    const markup = renderToStaticMarkup(React.createElement(ProfileRecommendationCardView, {
      card: {
        row,
        recommendation: {
          profileAlias: row.alias,
          capabilities: row.capabilitySet.map((capabilityContract) => ({ capabilityContract, applicability: 'unknown' as const, reasons: ['LOCAL_HOST_PROFILE_UNKNOWN'] })),
        },
      },
      onOpenLoadouts: () => {},
      onOpenCloudConnectors: () => {},
    }));
    assert.equal(markup.includes('data-testid="profile-local-plans:'), row.computePosture !== 'cloud-only');
    assert.equal(markup.includes('data-testid="profile-cloud-setup:'), row.routingPolicy !== 'local-first');
    assert.ok(markup.includes(row.privacyPosture));
    assert.ok(markup.includes(row.computePosture));
    assert.ok(markup.includes(row.routingPolicy));
    assert.ok(markup.includes('LOCAL_HOST_PROFILE_UNKNOWN'));
  }
});
