#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const forgeRoot = 'apps/forge/spec';
const kernelRoot = `${forgeRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${forgeRoot}/AGENTS.md`,
  `${forgeRoot}/forge.md`,
  `${forgeRoot}/execution-plan.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/world-migration-contract.md`,
  `${kernelRoot}/agent-management-contract.md`,
  `${kernelRoot}/content-creation-contract.md`,
  `${kernelRoot}/copyright-contract.md`,
  `${kernelRoot}/revenue-contract.md`,
  `${kernelRoot}/template-market-contract.md`,
  `${kernelRoot}/ai-advisor-contract.md`,
  `${kernelRoot}/analytics-contract.md`,
  `${kernelRoot}/import-contract.md`,
  `${kernelRoot}/route-authority-contract.md`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/api-surface.yaml`,
  `${tablesRoot}/feature-matrix.yaml`,
];

const contractFilesByPrefix = new Map([
  ['FG-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['FG-WORLD', `${kernelRoot}/world-migration-contract.md`],
  ['FG-AGENT', `${kernelRoot}/agent-management-contract.md`],
  ['FG-CONTENT', `${kernelRoot}/content-creation-contract.md`],
  ['FG-IP', `${kernelRoot}/copyright-contract.md`],
  ['FG-REV', `${kernelRoot}/revenue-contract.md`],
  ['FG-TPL', `${kernelRoot}/template-market-contract.md`],
  ['FG-ADV', `${kernelRoot}/ai-advisor-contract.md`],
  ['FG-ANA', `${kernelRoot}/analytics-contract.md`],
  ['FG-IMPORT', `${kernelRoot}/import-contract.md`],
  ['FG-ROUTE', `${kernelRoot}/route-authority-contract.md`],
]);

const expectedCapabilities = [
  { label: 'Chat Model', capability: 'text.generate' },
  { label: 'Image Model', capability: 'image.generate' },
  { label: 'Music Model', capability: 'music.generate' },
  { label: 'Speech Model', capability: 'audio.synthesize' },
  { label: 'Voice Design Model', capability: 'voice_workflow.voice_design' },
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function abs(rel) {
  return path.join(cwd, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function readYaml(rel) {
  try {
    return YAML.parse(read(rel));
  } catch (error) {
    fail(`${rel} must parse as YAML: ${error.message}`);
    return null;
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function splitFeatureRefs(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function contractPrefixes(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().match(/^(FG-[A-Z]+)-(\*|\d{3}[A-Z]?)$/u)?.[1] || '')
    .filter(Boolean);
}

for (const rel of [forgeRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Forge spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Forge spec file: ${rel}`);
  }
}

for (const rel of requiredFiles.filter((file) => file.endsWith('.yaml'))) {
  readYaml(rel);
}

for (const [prefix, rel] of contractFilesByPrefix.entries()) {
  if (!exists(rel)) continue;
  const content = read(rel);
  if (!content.includes(`${prefix}-`)) {
    fail(`${rel} must contain rule ids for ${prefix}`);
  }
}

const featureMatrixRel = `${tablesRoot}/feature-matrix.yaml`;
const featureMatrixText = read(featureMatrixRel);
const featureMatrix = readYaml(featureMatrixRel);
const routeTable = readYaml(`${tablesRoot}/routes.yaml`);
const apiSurface = readYaml(`${tablesRoot}/api-surface.yaml`);
const featureRows = asList(featureMatrix?.features);
const features = new Set();
const featureCountByPhase = new Map();
const featureBackendCounts = {
  noBackend: 0,
  currentScopeBackend: 0,
  deferredExtension: 0,
};

for (const row of featureRows) {
  const feature = String(row?.feature || '').trim();
  if (!feature) {
    fail('feature-matrix.yaml entry missing feature');
    continue;
  }
  if (features.has(feature)) {
    fail(`feature-matrix.yaml duplicate feature: ${feature}`);
  }
  features.add(feature);
  if (!String(row?.description || '').trim()) {
    fail(`feature-matrix.yaml ${feature}: description is required`);
  }
  const prefixes = contractPrefixes(row?.contract);
  if (prefixes.length === 0) {
    fail(`feature-matrix.yaml ${feature}: contract must reference FG-* rule ids`);
  }
  for (const prefix of prefixes) {
    if (!contractFilesByPrefix.has(prefix)) {
      fail(`feature-matrix.yaml ${feature}: unsupported contract prefix ${prefix}`);
    }
  }
  const phase = Number(row?.phase);
  if (!Number.isInteger(phase) || phase <= 0) {
    fail(`feature-matrix.yaml ${feature}: phase must be a positive integer`);
  } else {
    featureCountByPhase.set(phase, (featureCountByPhase.get(phase) || 0) + 1);
  }
  const backendDependency = String(row?.['backend-dependency'] || '').toLowerCase();
  if (backendDependency.includes('deferred extension')) {
    featureBackendCounts.deferredExtension += 1;
  } else if (backendDependency.includes('none')) {
    featureBackendCounts.noBackend += 1;
  } else {
    featureBackendCounts.currentScopeBackend += 1;
  }
}

const summaryPhaseCounts = new Map(
  [...featureMatrixText.matchAll(/^# Phase (\d+): (\d+) features\b/gmu)]
    .map((match) => [Number(match[1]), Number(match[2])]),
);
for (const [phase, count] of featureCountByPhase.entries()) {
  const summaryCount = summaryPhaseCounts.get(phase);
  if (summaryCount === undefined) {
    fail(`feature-matrix.yaml summary missing Phase ${phase} feature count`);
  } else if (summaryCount !== count) {
    fail(`feature-matrix.yaml summary Phase ${phase} count ${summaryCount} does not match ${count} feature rows`);
  }
}
const totalSummaryMatch = featureMatrixText.match(/^# Total: (\d+) features\b/mu);
if (!totalSummaryMatch) {
  fail('feature-matrix.yaml summary missing Total feature count');
} else if (Number(totalSummaryMatch[1]) !== featureRows.length) {
  fail(`feature-matrix.yaml summary Total count ${totalSummaryMatch[1]} does not match ${featureRows.length} feature rows`);
}
const noBackendSummaryMatch = featureMatrixText.match(/^#   No backend: (\d+)\b/mu);
if (!noBackendSummaryMatch) {
  fail('feature-matrix.yaml summary missing No backend count');
} else if (Number(noBackendSummaryMatch[1]) !== featureBackendCounts.noBackend) {
  fail(`feature-matrix.yaml summary No backend count ${noBackendSummaryMatch[1]} does not match ${featureBackendCounts.noBackend} feature rows`);
}
const currentBackendSummaryMatch = featureMatrixText.match(/^#   Current-scope backend extensions: (\d+) feature/mu);
if (!currentBackendSummaryMatch) {
  fail('feature-matrix.yaml summary missing Current-scope backend extensions count');
} else if (Number(currentBackendSummaryMatch[1]) !== featureBackendCounts.currentScopeBackend) {
  fail(`feature-matrix.yaml summary Current-scope backend extensions count ${currentBackendSummaryMatch[1]} does not match ${featureBackendCounts.currentScopeBackend} feature rows`);
}
const deferredSummaryMatch = featureMatrixText.match(/^#   Deferred extension: (\d+)\b/mu);
if (!deferredSummaryMatch) {
  fail('feature-matrix.yaml summary missing Deferred extension count');
} else if (Number(deferredSummaryMatch[1]) !== featureBackendCounts.deferredExtension) {
  fail(`feature-matrix.yaml summary Deferred extension count ${deferredSummaryMatch[1]} does not match ${featureBackendCounts.deferredExtension} feature rows`);
}

for (const route of asList(routeTable?.routes)) {
  const routePath = String(route?.path || '').trim();
  const feature = String(route?.feature || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (!features.has(feature)) {
    fail(`routes.yaml ${routePath}: feature ${feature || '<empty>'} is not in feature-matrix.yaml`);
  }
  if (!String(route?.component || '').trim()) {
    fail(`routes.yaml ${routePath}: component is required`);
  }
}

for (const [group, endpoints] of Object.entries(apiSurface || {})) {
  if (!Array.isArray(endpoints)) continue;
  for (const endpoint of endpoints) {
    const method = String(endpoint?.method || '').trim();
    const endpointPath = String(endpoint?.path || '').trim();
    if (!/^(GET|POST|PATCH|PUT|DELETE)$/u.test(method)) {
      fail(`api-surface.yaml ${group}: invalid method ${method || '<empty>'}`);
    }
    if (!endpointPath.startsWith('/api/')) {
      fail(`api-surface.yaml ${group}: endpoint path must start with /api/: ${endpointPath || '<empty>'}`);
    }
    for (const feature of splitFeatureRefs(endpoint?.feature)) {
      if (!features.has(feature)) {
        fail(`api-surface.yaml ${method} ${endpointPath}: feature ${feature} is not in feature-matrix.yaml`);
      }
    }
  }
}

const routeAuthority = exists(`${kernelRoot}/route-authority-contract.md`)
  ? read(`${kernelRoot}/route-authority-contract.md`)
  : '';
const aiConfigSection = exists('apps/forge/src/shell/renderer/pages/settings/ai-config-section.tsx')
  ? read('apps/forge/src/shell/renderer/pages/settings/ai-config-section.tsx')
  : '';

for (const { label, capability } of expectedCapabilities) {
  if (!routeAuthority.includes(label) || !routeAuthority.includes(capability)) {
    fail(`route-authority-contract.md must declare ${label} -> ${capability}`);
  }
  if (!aiConfigSection.includes(`fallback: '${label}'`) || !aiConfigSection.includes(`runtimeCapability: '${capability}'`)) {
    fail(`ai-config-section.tsx must expose ${label} via ${capability}`);
  }
}

if (routeAuthority.includes('TTS Model')) {
  fail('route-authority-contract.md must use Speech Model, not stale TTS Model label');
}

if (routeAuthority.includes('voice_workflow.tts_t2v') || aiConfigSection.includes('voice_workflow.tts_t2v')) {
  fail('Forge route authority and AI config must use voice_workflow.voice_design, not voice_workflow.tts_t2v');
}

if (failed) {
  process.exit(1);
}

console.log('forge-spec-kernel-consistency: OK');
