#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const shijiRoot = 'apps/shiji/spec';
const kernelRoot = `${shijiRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${shijiRoot}/AGENTS.md`,
  `${shijiRoot}/INDEX.md`,
  `${shijiRoot}/shiji.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/dialogue-contract.md`,
  `${kernelRoot}/explore-contract.md`,
  `${kernelRoot}/knowledge-contract.md`,
  `${kernelRoot}/map-contract.md`,
  `${kernelRoot}/progress-contract.md`,
  `${tablesRoot}/api-surface.yaml`,
  `${tablesRoot}/content-classification.yaml`,
  `${tablesRoot}/feature-matrix.yaml`,
  `${tablesRoot}/local-storage.yaml`,
  `${tablesRoot}/map-surface.yaml`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/world-catalog.yaml`,
];

const contractFilesByPrefix = new Map([
  ['SJ-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['SJ-EXPL', `${kernelRoot}/explore-contract.md`],
  ['SJ-MAP', `${kernelRoot}/map-contract.md`],
  ['SJ-DIAL', `${kernelRoot}/dialogue-contract.md`],
  ['SJ-KNOW', `${kernelRoot}/knowledge-contract.md`],
  ['SJ-PROG', `${kernelRoot}/progress-contract.md`],
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

function ids(rows, key = 'id') {
  return new Set(asList(rows).map((row) => String(row?.[key] || '').trim()).filter(Boolean));
}

function contractPrefixes(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().match(/^(SJ-[A-Z]+)-(\*|\d{3}[A-Z]?)(?:\s*~\s*\d{3}[A-Z]?)?$/u)?.[1] || '')
    .filter(Boolean);
}

for (const rel of [shijiRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing ShiJi spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing ShiJi spec file: ${rel}`);
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
const featureIds = ids(features);
for (const feature of features) {
  const id = String(feature?.id || '').trim();
  if (!id) {
    fail('feature-matrix.yaml entry missing id');
    continue;
  }
  if (!Number.isInteger(Number(feature?.phase)) || Number(feature?.phase) <= 0) {
    fail(`feature-matrix.yaml ${id}: phase must be a positive integer`);
  }
  if (!String(feature?.priority || '').trim()) {
    fail(`feature-matrix.yaml ${id}: priority is required`);
  }
  if (!String(feature?.description || '').trim()) {
    fail(`feature-matrix.yaml ${id}: description is required`);
  }
  for (const prefix of contractPrefixes(feature?.contract)) {
    if (!contractFilesByPrefix.has(prefix)) {
      fail(`feature-matrix.yaml ${id}: unsupported contract prefix ${prefix}`);
    }
  }
}

for (const requiredFeature of [
  'app-shell',
  'explore-home',
  'explore-world-detail',
  'explore-agent-detail',
  'dialogue-session',
  'knowledge-graph',
  'progress-overview',
  'settings',
]) {
  if (!featureIds.has(requiredFeature)) {
    fail(`feature-matrix.yaml missing required feature: ${requiredFeature}`);
  }
}

const routes = readYaml(`${tablesRoot}/routes.yaml`);
const routeRows = asList(routes?.routes);
for (const route of routeRows) {
  const routePath = String(route?.path || '').trim();
  const feature = String(route?.feature || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (!featureIds.has(feature)) {
    fail(`routes.yaml ${routePath}: feature ${feature || '<empty>'} is not in feature-matrix.yaml`);
  }
  if (!String(route?.component || '').trim()) {
    fail(`routes.yaml ${routePath}: component is required`);
  }
}

const apiSurface = readYaml(`${tablesRoot}/api-surface.yaml`);
for (const endpoint of asList(apiSurface?.endpoints)) {
  const method = String(endpoint?.method || '').trim();
  const endpointPath = String(endpoint?.path || '').trim();
  const feature = String(endpoint?.feature || '').trim();
  if (!/^(GET|POST|PATCH|PUT|DELETE)$/u.test(method)) {
    fail(`api-surface.yaml invalid method ${method || '<empty>'}`);
  }
  if (!endpointPath.startsWith('/api/')) {
    fail(`api-surface.yaml endpoint path must start with /api/: ${endpointPath || '<empty>'}`);
  }
  if (!featureIds.has(feature)) {
    fail(`api-surface.yaml ${method} ${endpointPath}: feature ${feature || '<empty>'} is not in feature-matrix.yaml`);
  }
  if (!['existing', 'proposed'].includes(String(endpoint?.status || '').trim())) {
    fail(`api-surface.yaml ${method} ${endpointPath}: status must be existing or proposed`);
  }
  if (
    asList(endpoint?.required_fields).length === 0
    && !String(endpoint?.request || '').trim()
    && !String(endpoint?.response || '').trim()
  ) {
    fail(`api-surface.yaml ${method} ${endpointPath}: required_fields, request, or response is required`);
  }
}

const classification = readYaml(`${tablesRoot}/content-classification.yaml`);
const contentTypes = ids(classification?.content_types, 'key');
const truthModes = ids(classification?.truth_modes, 'key');
const allowedPairs = new Set(asList(classification?.allowed_pairs).map((pair) => `${pair?.contentType}:${pair?.truthMode}`));
if (contentTypes.size === 0) fail('content-classification.yaml must define content_types');
if (truthModes.size === 0) fail('content-classification.yaml must define truth_modes');
if (allowedPairs.size === 0) fail('content-classification.yaml must define allowed_pairs');

const mapSurface = readYaml(`${tablesRoot}/map-surface.yaml`);
const enabledMapProfiles = new Set(asList(mapSurface?.profiles).filter((profile) => profile?.enabled === true).map((profile) => String(profile?.worldId || '').trim()));
const catalog = readYaml(`${tablesRoot}/world-catalog.yaml`);
const catalogWorldIds = new Set();
const sortOrders = new Set();
for (const entry of asList(catalog?.entries)) {
  const worldId = String(entry?.worldId || '').trim();
  const sortOrder = Number(entry?.sortOrder);
  const contentType = String(entry?.contentType || '').trim();
  const truthMode = String(entry?.truthMode || '').trim();
  if (!worldId) {
    fail('world-catalog.yaml entry missing worldId');
  } else if (catalogWorldIds.has(worldId)) {
    fail(`world-catalog.yaml duplicate worldId: ${worldId}`);
  }
  catalogWorldIds.add(worldId);
  if (!Number.isInteger(sortOrder)) {
    fail(`world-catalog.yaml ${worldId || '<empty>'}: sortOrder must be an integer`);
  } else if (sortOrders.has(sortOrder)) {
    fail(`world-catalog.yaml duplicate sortOrder: ${sortOrder}`);
  }
  sortOrders.add(sortOrder);
  if (!contentTypes.has(contentType) || !truthModes.has(truthMode) || !allowedPairs.has(`${contentType}:${truthMode}`)) {
    fail(`world-catalog.yaml ${worldId || '<empty>'}: contentType/truthMode pair is not allowed`);
  }
  if (!['ACTIVE', 'PLANNED', 'RETIRED'].includes(String(entry?.status || '').trim())) {
    fail(`world-catalog.yaml ${worldId || '<empty>'}: status must be ACTIVE, PLANNED, or RETIRED`);
  }
  if (entry?.mapAvailability === true && !enabledMapProfiles.has(worldId)) {
    fail(`world-catalog.yaml ${worldId || '<empty>'}: mapAvailability requires an enabled map profile`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('ShiJi spec kernel consistency check passed');
