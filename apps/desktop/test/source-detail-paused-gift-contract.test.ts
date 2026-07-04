import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceDetailPanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/source-detail-panel.tsx'),
  'utf8',
);
const sourceDetailViewSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/source-detail-view.tsx'),
  'utf8',
);
const worldCharacterViewSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/source-detail/source-detail-world-character-view.tsx'),
  'utf8',
);

test('source detail keeps gift sending unmounted while gifting is paused', () => {
  assert.doesNotMatch(sourceDetailPanelSource, /SendGiftModal|setGiftModalOpen/);
  assert.doesNotMatch(sourceDetailPanelSource, /onSendGift/);
  assert.doesNotMatch(sourceDetailViewSource, /onSendGift/);
  assert.doesNotMatch(worldCharacterViewSource, /onSendGift/);
});
