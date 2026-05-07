import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const giftsTabSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/profile/gifts-tab.tsx'),
  'utf8',
);

test('profile gifts tab does not render pseudo-real gift activity data', () => {
  assert.doesNotMatch(giftsTabSource, /MOCK_GIFT_FEED|MOCK_TOP_SUPPORTERS|MOCK_GEM_BALANCE/);
  assert.doesNotMatch(giftsTabSource, /Luna Star|CyberWolf|TechNinja|dicebear/);
  assert.doesNotMatch(giftsTabSource, /totalReceived|topGiversThisMonth|gemsValue/);
});

test('profile gifts tab declares unavailable gift data instead of mock state', () => {
  assert.match(giftsTabSource, /Profile\.Gifts\.unavailableTitle/);
  assert.match(giftsTabSource, /Profile\.Gifts\.unavailableDescription/);
  assert.match(giftsTabSource, /Profile\.Gifts\.requirementGiftFeed/);
  assert.match(giftsTabSource, /Profile\.Gifts\.requirementSupporters/);
  assert.match(giftsTabSource, /Profile\.Gifts\.requirementBalance/);
  assert.match(giftsTabSource, /dataTestId=\{E2E_IDS\.profileTopSupportersDialog\}/);
  assert.match(giftsTabSource, /<DesktopCardSurface kind="promoted-glass"/);
  assert.match(giftsTabSource, /<DesktopCompactAction[\s\S]*tone="primary"/);
});
