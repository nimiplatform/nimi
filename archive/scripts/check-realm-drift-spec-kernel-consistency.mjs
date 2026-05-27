#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const specRoot = 'apps/realm-drift/spec';
const kernelRoot = `${specRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${specRoot}/AGENTS.md`,
  `${specRoot}/realm-drift.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/world-exploration-contract.md`,
  `${kernelRoot}/marble-integration-contract.md`,
  `${kernelRoot}/agent-chat-contract.md`,
  `${kernelRoot}/human-chat-contract.md`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/feature-matrix.yaml`,
  `${tablesRoot}/external-api-surface.yaml`,
];

const contractFilesByPrefix = new Map([
  ['RD-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['RD-EXPLORE', `${kernelRoot}/world-exploration-contract.md`],
  ['RD-MARBLE', `${kernelRoot}/marble-integration-contract.md`],
  ['RD-CHAT', `${kernelRoot}/agent-chat-contract.md`],
  ['RD-HCHAT', `${kernelRoot}/human-chat-contract.md`],
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
    .map((entry) => entry.trim().match(/^(RD-[A-Z]+)-(\*|\d{3})$/u)?.[1] || '')
    .filter(Boolean);
}

for (const rel of [specRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Realm Drift spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Realm Drift spec file: ${rel}`);
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
const features = new Set();
for (const row of asList(featureMatrix?.features)) {
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
  if (!Number.isInteger(Number(row?.phase)) || Number(row?.phase) <= 0) {
    fail(`feature-matrix.yaml ${feature}: phase must be a positive integer`);
  }
  if (!String(row?.priority || '').trim()) {
    fail(`feature-matrix.yaml ${feature}: priority is required`);
  }
  const prefixes = contractPrefixes(row?.contract);
  if (prefixes.length === 0) {
    fail(`feature-matrix.yaml ${feature}: contract must reference RD-* rule ids`);
  }
  for (const prefix of prefixes) {
    if (!contractFilesByPrefix.has(prefix)) {
      fail(`feature-matrix.yaml ${feature}: unsupported contract prefix ${prefix}`);
    }
  }
}

for (const requiredFeature of ['app-shell', 'world-browser', 'world-viewer', 'chat-streaming', 'chat-panel-ui']) {
  if (!features.has(requiredFeature)) {
    fail(`feature-matrix.yaml missing required feature: ${requiredFeature}`);
  }
}

const routes = readYaml(`${tablesRoot}/routes.yaml`);
const routePaths = new Set();
for (const route of asList(routes?.routes)) {
  const routePath = String(route?.path || '').trim();
  const feature = String(route?.feature || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (routePaths.has(routePath)) {
    fail(`routes.yaml duplicate route path: ${routePath}`);
  }
  routePaths.add(routePath);
  if (!features.has(feature)) {
    fail(`routes.yaml ${routePath}: feature ${feature || '<empty>'} is not in feature-matrix.yaml`);
  }
  if (!String(route?.component || '').trim()) {
    fail(`routes.yaml ${routePath}: component is required`);
  }
  if (!String(route?.description || '').trim()) {
    fail(`routes.yaml ${routePath}: description is required`);
  }
}

for (const requiredRoute of ['/', '/world/:worldId']) {
  if (!routePaths.has(requiredRoute)) {
    fail(`routes.yaml missing required route: ${requiredRoute}`);
  }
}

const externalApiSurface = readYaml(`${tablesRoot}/external-api-surface.yaml`);
for (const endpoint of asList(externalApiSurface?.endpoints)) {
  const method = String(endpoint?.method || '').trim();
  const endpointPath = String(endpoint?.path || '').trim();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    fail(`external-api-surface.yaml ${endpointPath || '<unknown>'}: unsupported method ${method || '<empty>'}`);
  }
  if (!endpointPath.startsWith('/')) {
    fail(`external-api-surface.yaml endpoint has invalid path: ${endpointPath || '<empty>'}`);
  }
  if (!String(endpoint?.description || '').trim()) {
    fail(`external-api-surface.yaml ${endpointPath}: description is required`);
  }
}

const defaultModels = asList(externalApiSurface?.models)
  .filter((model) => model?.['realm-drift-default'] === true);
if (defaultModels.length !== 1) {
  fail('external-api-surface.yaml must mark exactly one realm-drift-default model');
}

if (failed) {
  process.exit(1);
}

console.log('Realm Drift spec kernel consistency check passed');
