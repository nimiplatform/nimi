#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const polyinfoRoot = 'apps/polyinfo/spec';
const kernelRoot = `${polyinfoRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${polyinfoRoot}/AGENTS.md`,
  `${polyinfoRoot}/polyinfo.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/taxonomy-contract.md`,
  `${kernelRoot}/market-data-contract.md`,
  `${kernelRoot}/signal-contract.md`,
  `${kernelRoot}/discussion-contract.md`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/feature-matrix.yaml`,
  `${tablesRoot}/object-model.yaml`,
  `${tablesRoot}/external-api-surface.yaml`,
  `${tablesRoot}/signal-model.yaml`,
];

const contractFilesByPrefix = new Map([
  ['PI-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['PI-TAX', `${kernelRoot}/taxonomy-contract.md`],
  ['PI-DATA', `${kernelRoot}/market-data-contract.md`],
  ['PI-SIGNAL', `${kernelRoot}/signal-contract.md`],
  ['PI-DISCUSS', `${kernelRoot}/discussion-contract.md`],
]);

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

function contractPrefixes(value) {
  return String(value || '')
    .split(',')
    .flatMap((entry) => entry.trim().split(/\.\./u))
    .map((entry) => entry.trim().match(/^(PI-[A-Z]+)-(\*|\d{3})$/u)?.[1] || '')
    .filter(Boolean);
}

for (const rel of [polyinfoRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Polyinfo spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Polyinfo spec file: ${rel}`);
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

const featureMatrix = readYaml(`${tablesRoot}/feature-matrix.yaml`);
const features = asList(featureMatrix?.features);
const featureIds = new Set();
for (const row of features) {
  const feature = String(row?.feature || '').trim();
  if (!feature) {
    fail('feature-matrix.yaml entry missing feature');
    continue;
  }
  if (featureIds.has(feature)) {
    fail(`feature-matrix.yaml duplicate feature: ${feature}`);
  }
  featureIds.add(feature);
  if (!String(row?.description || '').trim()) {
    fail(`feature-matrix.yaml ${feature}: description is required`);
  }
  if (!Number.isInteger(Number(row?.phase)) || Number(row?.phase) <= 0) {
    fail(`feature-matrix.yaml ${feature}: phase must be a positive integer`);
  }
  if (!String(row?.priority || '').trim()) {
    fail(`feature-matrix.yaml ${feature}: priority is required`);
  }
  const prefixes = contractPrefixes(row?.contract);
  if (prefixes.length === 0) {
    fail(`feature-matrix.yaml ${feature}: contract must reference PI-* rule ids`);
  }
  for (const prefix of prefixes) {
    if (!contractFilesByPrefix.has(prefix)) {
      fail(`feature-matrix.yaml ${feature}: unsupported contract prefix ${prefix}`);
    }
  }
}

for (const requiredFeature of ['app-shell', 'sector-catalog', 'workspace-market-state', 'sector-analyst-session', 'runtime-routing']) {
  if (!featureIds.has(requiredFeature)) {
    fail(`feature-matrix.yaml missing required feature: ${requiredFeature}`);
  }
}

const routes = readYaml(`${tablesRoot}/routes.yaml`);
const routePaths = new Set();
for (const route of asList(routes?.routes)) {
  const routePath = String(route?.path || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (routePaths.has(routePath)) {
    fail(`routes.yaml duplicate route path: ${routePath}`);
  }
  routePaths.add(routePath);
  if (!String(route?.feature || '').trim()) {
    fail(`routes.yaml ${routePath}: feature is required`);
  }
  if (!String(route?.component || '').trim()) {
    fail(`routes.yaml ${routePath}: component is required`);
  }
  if (!String(route?.description || '').trim()) {
    fail(`routes.yaml ${routePath}: description is required`);
  }
}

for (const requiredRoute of ['/', '/sectors/:sectorId', '/signals', '/runtime', '/settings']) {
  if (!routePaths.has(requiredRoute)) {
    fail(`routes.yaml missing required route: ${requiredRoute}`);
  }
}

const objectModel = readYaml(`${tablesRoot}/object-model.yaml`);
const activeObjects = asList(objectModel?.object_model?.current_active_objects);
for (const requiredObject of ['OfficialSectorTag', 'CustomSectorRecord', 'AnalysisSnapshot', 'SectorChatState']) {
  if (!activeObjects.includes(requiredObject)) {
    fail(`object-model.yaml missing active object: ${requiredObject}`);
  }
}
for (const [key, value] of Object.entries(objectModel?.object_model || {})) {
  if (!key.endsWith('_record') && !key.endsWith('_state') && key !== 'official_sector_tag' && key !== 'analysis_snapshot') continue;
  if (asList(value?.required_fields).length === 0) {
    fail(`object-model.yaml ${key}: required_fields must be non-empty`);
  }
  if (asList(value?.invariants).length === 0) {
    fail(`object-model.yaml ${key}: invariants must be non-empty`);
  }
}

const externalApiSurface = readYaml(`${tablesRoot}/external-api-surface.yaml`);
for (const surface of asList(externalApiSurface?.surfaces)) {
  const name = String(surface?.name || '').trim();
  const kind = String(surface?.kind || '').trim();
  const provider = String(surface?.provider || '').trim();
  const endpoint = String(surface?.endpoint || '').trim();
  if (!name || !provider || !endpoint) {
    fail(`external-api-surface.yaml ${name || '<unknown>'}: name, provider, and endpoint are required`);
  }
  if (!['rest', 'websocket'].includes(kind)) {
    fail(`external-api-surface.yaml ${name || '<unknown>'}: unsupported kind ${kind || '<empty>'}`);
  }
}

const signalModel = readYaml(`${tablesRoot}/signal-model.yaml`);
const signalWindows = new Set(asList(signalModel?.signal_model?.windows).map((window) => String(window?.id || '').trim()));
for (const requiredWindow of ['24h', '48h', '7d']) {
  if (!signalWindows.has(requiredWindow)) {
    fail(`signal-model.yaml missing window: ${requiredWindow}`);
  }
}
if (asList(signalModel?.signal_model?.weighting_factors).length === 0) {
  fail('signal-model.yaml weighting_factors must be non-empty');
}
if (asList(signalModel?.signal_model?.conclusion_tones).length === 0) {
  fail('signal-model.yaml conclusion_tones must be non-empty');
}

if (failed) {
  process.exit(1);
}

console.log('Polyinfo spec kernel consistency check passed');
