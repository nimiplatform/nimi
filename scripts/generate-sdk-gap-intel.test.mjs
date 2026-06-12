import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectGapIntel, renderGapIntel } from './generate-sdk-gap-intel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerText = readFileSync(path.join(repoRoot, '.nimi/spec/sdks/kernel/tables/typescript-adapter-capability-ledger.yaml'), 'utf8');
const mapText = readFileSync(path.join(repoRoot, '.nimi/spec/sdks/kernel/tables/framework-api-capability-map.yaml'), 'utf8');

test('gap intel aggregates ledger partial/unsupported claims into themed demand signals', () => {
  const intel = collectGapIntel({ ledgerText, mapText });

  assert.ok(intel.gaps.length >= 30, `expected the known gap surface, got ${intel.gaps.length}`);
  for (const gap of intel.gaps) {
    assert.ok(['partial', 'unsupported'].includes(gap.support));
    assert.ok(gap.adapter && gap.capability && gap.theme);
  }

  const themeNames = intel.rankedThemes.map((theme) => theme.theme);
  assert.ok(themeNames.includes('memory'), 'mastra memory partial cluster must surface as a theme');
  assert.ok(themeNames.includes('workflow-checkpoint'));

  const ranked = intel.rankedThemes;
  for (let index = 1; index < ranked.length; index += 1) {
    assert.ok(
      ranked[index - 1].adapterCount >= ranked[index].adapterCount,
      'themes must be sorted by cross-adapter recurrence',
    );
  }

  const pendingIds = intel.pendingFrameworks.map((framework) => framework.id).sort();
  assert.deepEqual(pendingIds, ['langgraph', 'llamaindex', 'mcp']);
  assert.ok(
    intel.pendingFrameworks.find((framework) => framework.id === 'mcp')?.note?.includes('delegated MCP gateway'),
    'mcp pending note must carry the delegated-gateway direction',
  );

  assert.ok(intel.partialClusterNotes.some((note) => note.adapter === 'mastra'));
});

test('gap intel renders a readable report with totals and reading guide', () => {
  const intel = collectGapIntel({ ledgerText, mapText });
  const rendered = renderGapIntel(intel);
  assert.match(rendered, /Total gap claims: \d+ across \d+ adapters/);
  assert.match(rendered, /Themes by cross-adapter recurrence/);
  assert.match(rendered, /mapping debt/);
  assert.match(rendered, /not semantic clustering/);
  assert.match(rendered, /Filter out-of-domain claims/);
});
