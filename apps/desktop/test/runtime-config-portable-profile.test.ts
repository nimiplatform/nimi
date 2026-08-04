import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeDesktopPortableAIProfile } from '../src/shell/renderer/features/runtime-config/runtime-config-portable-profile.js';

test('Profiles projects canonical portable AIProfile intent without a Desktop library projection', () => {
  const summary = summarizeDesktopPortableAIProfile({
    profileId: 'profile.local-chat',
    title: 'Local Chat',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: ['tool.use'],
        defaults: { temperature: 0.3 },
      },
    },
  });

  assert.deepEqual(summary, {
    profileId: 'profile.local-chat',
    title: 'Local Chat',
    capabilities: [{
      capabilityContract: 'text.generate',
      route: 'local',
      requiredFeatures: ['tool.use'],
      hasDefaults: true,
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(summary),
    /model|binding|target|implementation|readiness|libraryRef|storage/i,
  );
});
