#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const momentRoot = 'apps/moment/spec';
const kernelRoot = `${momentRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${momentRoot}/AGENTS.md`,
  `${momentRoot}/INDEX.md`,
  `${momentRoot}/moment.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/boundary-contract.md`,
  `${kernelRoot}/library-contract.md`,
  `${kernelRoot}/moment-generation-contract.md`,
  `${kernelRoot}/moment-play-contract.md`,
  `${tablesRoot}/feature-matrix.yaml`,
  `${tablesRoot}/moment-model.yaml`,
  `${tablesRoot}/relation-state-machine.yaml`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/surface-map.yaml`,
];

const contractFilesByPrefix = new Map([
  ['MM-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['MM-BND', `${kernelRoot}/boundary-contract.md`],
  ['MM-LIB', `${kernelRoot}/library-contract.md`],
  ['MM-GEN', `${kernelRoot}/moment-generation-contract.md`],
  ['MM-PLAY', `${kernelRoot}/moment-play-contract.md`],
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

function ids(rows) {
  return new Set(asList(rows).map((row) => String(row?.id || '').trim()).filter(Boolean));
}

for (const rel of [momentRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Moment spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Moment spec file: ${rel}`);
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

const routes = readYaml(`${tablesRoot}/routes.yaml`);
const routeRows = asList(routes?.routes);
const defaultRoutes = routeRows.filter((route) => route?.is_default === true);
if (defaultRoutes.length !== 1) {
  fail('routes.yaml must define exactly one default route');
}
for (const route of routeRows) {
  const routePath = String(route?.path || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (!String(route?.purpose || '').trim()) {
    fail(`routes.yaml ${routePath || '<empty>'}: purpose is required`);
  }
}

const surfaceMap = readYaml(`${tablesRoot}/surface-map.yaml`);
const surfaces = asList(surfaceMap?.surfaces);
const surfaceIds = ids(surfaces);
for (const requiredSurface of ['seed_input', 'threshold_stage', 'play_timeline', 'local_library']) {
  if (!surfaceIds.has(requiredSurface)) {
    fail(`surface-map.yaml missing required surface: ${requiredSurface}`);
  }
}
const protagonistSurfaces = surfaces.filter((surface) => surface?.prominence === 'protagonist');
if (protagonistSurfaces.length !== 1 || protagonistSurfaces[0]?.id !== 'threshold_stage') {
  fail('surface-map.yaml must make threshold_stage the only protagonist surface');
}

const featureMatrix = readYaml(`${tablesRoot}/feature-matrix.yaml`);
const features = asList(featureMatrix?.features);
for (const feature of features) {
  if (!String(feature?.id || '').trim()) {
    fail('feature-matrix.yaml entry missing id');
  }
  if (!String(feature?.phase || '').trim()) {
    fail(`feature-matrix.yaml ${feature?.id || '<unknown>'}: phase is required`);
  }
  if (!String(feature?.dependency_posture || '').trim()) {
    fail(`feature-matrix.yaml ${feature?.id || '<unknown>'}: dependency_posture is required`);
  }
}

const featureIds = ids(features);
for (const requiredFeature of ['front_door_home', 'image_seed', 'phrase_seed', 'threshold_generation', 'short_play_loop', 'local_shelf']) {
  if (!featureIds.has(requiredFeature)) {
    fail(`feature-matrix.yaml missing required feature: ${requiredFeature}`);
  }
}

const model = readYaml(`${tablesRoot}/moment-model.yaml`);
const ownedObjects = asList(model?.owned_objects);
const ownedObjectIds = ids(ownedObjects);
for (const requiredObject of ['moment_threshold', 'moment_session', 'saved_moment']) {
  if (!ownedObjectIds.has(requiredObject)) {
    fail(`moment-model.yaml missing owned object: ${requiredObject}`);
  }
}
for (const object of ownedObjects) {
  if (object?.ownership !== 'app_local') {
    fail(`moment-model.yaml ${object?.id || '<unknown>'}: ownership must be app_local`);
  }
  if (object?.canonical_status !== 'non_canonical') {
    fail(`moment-model.yaml ${object?.id || '<unknown>'}: canonical_status must be non_canonical`);
  }
  if (asList(object?.required_fields).length === 0) {
    fail(`moment-model.yaml ${object?.id || '<unknown>'}: required_fields must be non-empty`);
  }
}
const inputModes = new Set(asList(model?.input_modes).map(String));
for (const requiredMode of ['image', 'phrase']) {
  if (!inputModes.has(requiredMode)) {
    fail(`moment-model.yaml missing input mode: ${requiredMode}`);
  }
}
if (model?.action_shape?.min_actions !== 3 || model?.action_shape?.max_actions !== 3) {
  fail('moment-model.yaml action_shape must require exactly 3 actions');
}
if (model?.play_window?.min_beats !== 2 || model?.play_window?.max_beats !== 4) {
  fail('moment-model.yaml play_window must stay at 2 to 4 beats');
}

const relationMachine = readYaml(`${tablesRoot}/relation-state-machine.yaml`);
const relationStates = ids(relationMachine?.relation_states);
for (const transition of asList(relationMachine?.transitions)) {
  const from = String(transition?.from || '').trim();
  const to = String(transition?.to || '').trim();
  if (!relationStates.has(from) || !relationStates.has(to)) {
    fail(`relation-state-machine.yaml transition references unknown state: ${from || '<empty>'} -> ${to || '<empty>'}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('Moment spec kernel consistency check passed');
