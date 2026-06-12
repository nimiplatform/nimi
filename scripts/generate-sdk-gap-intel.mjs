#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = path.join(repoRoot, '.nimi/spec/sdks/kernel/tables/typescript-adapter-capability-ledger.yaml');
const MAP_PATH = path.join(repoRoot, '.nimi/spec/sdks/kernel/tables/framework-api-capability-map.yaml');

// Stem groups are lexical hints, not semantic clustering: a theme recurring
// across adapters is the demand signal Runtime roadmap consumes.
const THEME_STEMS = [
  ['memory', ['memory']],
  ['knowledge', ['knowledge']],
  ['workflow-checkpoint', ['workflow', 'checkpoint']],
  ['voice-realtime', ['voice', 'realtime', 'speech']],
  ['approval-suspension', ['approval', 'suspend']],
  ['agent-network', ['agentnetwork', 'network']],
  ['structured-output-repair', ['repair']],
  ['multimodal', ['multimodal']],
  ['provider-passthrough', ['providermetadata', 'provideroptions', 'reasoning', 'usagetokendetails']],
  ['traces-telemetry', ['trace', 'telemetry']],
  ['openai-api-breadth', ['responsesapi', 'completionsapi', 'embeddingsapi', 'logprobs', 'multichoice', 'storedchat', 'builtintools']],
  ['mcp-depth', ['mcp.', 'externalexecution', 'resources']],
  ['graph-retrieval-depth', ['node.', 'query.', 'indexmutation', 'toolcalling', 'retrieval']],
  ['app-framework-depth', ['hooks', 'renderer', 'route.', 'middleware', 'serveractions']],
];

export function collectGapIntel({ ledgerText, mapText }) {
  const ledger = YAML.parse(ledgerText);
  const map = YAML.parse(mapText);
  const adapters = ledger.entries ?? ledger.surfaces ?? [];

  const gaps = [];
  for (const adapter of adapters) {
    for (const claim of adapter.capability_claims ?? []) {
      if (claim.support === 'partial' || claim.support === 'unsupported') {
        gaps.push({
          adapter: adapter.id,
          capability: claim.capability,
          support: claim.support,
          mode: claim.mode,
          theme: themeOf(claim.capability),
        });
      }
    }
  }

  const themes = new Map();
  for (const gap of gaps) {
    const existing = themes.get(gap.theme) ?? { theme: gap.theme, adapters: new Set(), gaps: [] };
    existing.adapters.add(gap.adapter);
    existing.gaps.push(gap);
    themes.set(gap.theme, existing);
  }
  const rankedThemes = [...themes.values()]
    .map((entry) => ({
      theme: entry.theme,
      adapterCount: entry.adapters.size,
      adapters: [...entry.adapters].sort(),
      gapCount: entry.gaps.length,
      gaps: entry.gaps,
    }))
    .sort((a, b) => b.adapterCount - a.adapterCount || b.gapCount - a.gapCount);

  const pendingFrameworks = (map.frameworks ?? [])
    .filter((framework) => framework.status === 'pending-upstream-binding')
    .map((framework) => ({
      id: framework.id,
      upstreamPackage: framework.upstream_package,
      note: framework.note?.trim(),
    }));

  const partialClusterNotes = adapters
    .filter((adapter) => /partial|pending/i.test(String(adapter.production_core_binding ?? '')))
    .map((adapter) => ({ adapter: adapter.id, binding: String(adapter.production_core_binding) }));

  return { gaps, rankedThemes, pendingFrameworks, partialClusterNotes };
}

function themeOf(capability) {
  const lower = capability.toLowerCase();
  for (const [theme, stems] of THEME_STEMS) {
    if (stems.some((stem) => lower.includes(stem))) {
      return theme;
    }
  }
  return 'other';
}

export function renderGapIntel(intel) {
  const lines = [];
  lines.push('nimi sdk gap intelligence — adapter partial/unsupported demand map');
  lines.push('(stem-grouped lexical themes over ledger claims; not semantic clustering)');
  lines.push('');
  lines.push(`Total gap claims: ${intel.gaps.length} across ${new Set(intel.gaps.map((gap) => gap.adapter)).size} adapters`);
  lines.push('');
  lines.push('Themes by cross-adapter recurrence (strongest demand signal first):');
  for (const theme of intel.rankedThemes) {
    lines.push(`  ${theme.theme} — ${theme.adapterCount} adapter(s), ${theme.gapCount} claim(s) [${theme.adapters.join(', ')}]`);
    for (const gap of theme.gaps) {
      const mode = gap.mode ? ` (${gap.mode})` : '';
      lines.push(`    - ${gap.adapter}: ${gap.capability} = ${gap.support}${mode}`);
    }
  }
  lines.push('');
  if (intel.pendingFrameworks.length > 0) {
    lines.push('Frameworks detectable but not assessable (mapping debt):');
    for (const pending of intel.pendingFrameworks) {
      lines.push(`  - ${pending.id} (${pending.upstreamPackage})${pending.note ? `: ${pending.note.replace(/\s+/g, ' ')}` : ''}`);
    }
    lines.push('');
  }
  lines.push('Partial-cluster narratives (verbatim from ledger production_core_binding):');
  for (const note of intel.partialClusterNotes) {
    lines.push(`  [${note.adapter}]`);
    const sentences = note.binding.split(/(?<=\.)\s+/).filter((sentence) => /partial|pending|compatibility-only|until/i.test(sentence));
    for (const sentence of sentences) {
      lines.push(`    ${sentence.replace(/\s+/g, ' ').trim()}`);
    }
  }
  lines.push('');
  lines.push('Reading guide: a theme spanning multiple adapters is framework-ecosystem');
  lines.push('demand for a Runtime-owned surface; single-adapter gaps may be framework');
  lines.push('design preferences. Filter out-of-domain claims before roadmap use.');
  return lines.join('\n');
}

const isDirectInvocation = (() => {
  const entry = process.argv[1];
  return entry ? path.resolve(entry) === fileURLToPath(import.meta.url) : false;
})();

if (isDirectInvocation) {
  const intel = collectGapIntel({
    ledgerText: readFileSync(LEDGER_PATH, 'utf8'),
    mapText: readFileSync(MAP_PATH, 'utf8'),
  });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(intel, null, 2));
  } else {
    console.log(renderGapIntel(intel));
  }
}
