import { expect, test } from 'vitest';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import { capabilityIcon } from '../src/capability-icon.js';

test('every catalog capability has a distinct default glyph', () => {
  const icons = CANONICAL_CAPABILITY_IDS.map(capabilityIcon);
  expect(icons).not.toContain(capabilityIcon('unknown'));
  expect(new Set(icons).size).toBe(CANONICAL_CAPABILITY_IDS.length);
});
