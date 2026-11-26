import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Harness parallel workspace drawer uses group/disclosure semantics without conflicting ARIA tab/tabpanel roles', async () => {
  const src = await readFile(new URL('../src/product/conversations.tsx', import.meta.url), 'utf8');

  // Topbar view switch must not declare role="tablist" or role="tab" while keeping the transcript always visible alongside the complementary drawer
  const switchStart = src.indexOf('data-testid="harness-view-switch"');
  const switchBlock = src.slice(
    switchStart - 200,
    src.indexOf('</div>', switchStart) + 6,
  );
  assert.match(switchBlock, /role="group"/);
  assert.doesNotMatch(switchBlock, /role="tablist"/);
  assert.doesNotMatch(switchBlock, /role="tab"/);
  assert.match(switchBlock, /aria-expanded=\{inspectorOpen\}/);
  assert.match(switchBlock, /aria-controls="harness-inspector-drawer"/);

  // Always-visible transcript panel must not claim role="tabpanel"
  const mattersBlock = src.slice(
    src.indexOf('id="harness-view-panel-matters"') - 40,
    src.indexOf('id="harness-view-panel-matters"') + 220,
  );
  assert.doesNotMatch(mattersBlock, /role="tabpanel"/);
});
