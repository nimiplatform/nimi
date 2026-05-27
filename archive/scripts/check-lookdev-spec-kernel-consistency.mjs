#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const lookdevRoot = 'apps/lookdev/spec';
const kernelRoot = `${lookdevRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;

const requiredFiles = [
  `${lookdevRoot}/AGENTS.md`,
  `${lookdevRoot}/INDEX.md`,
  `${lookdevRoot}/lookdev.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/batch-contract.md`,
  `${kernelRoot}/capability-contract.md`,
  `${kernelRoot}/evaluation-contract.md`,
  `${kernelRoot}/pipeline-contract.md`,
  `${kernelRoot}/writeback-contract.md`,
  `${tablesRoot}/batch-model.yaml`,
  `${tablesRoot}/evaluation-rubric.yaml`,
  `${tablesRoot}/routes.yaml`,
  `${tablesRoot}/writeback-policy.yaml`,
];

const contractFilesByPrefix = new Map([
  ['LD-SHELL', `${kernelRoot}/app-shell-contract.md`],
  ['LD-BATCH', `${kernelRoot}/batch-contract.md`],
  ['LD-CAP', `${kernelRoot}/capability-contract.md`],
  ['LD-EVAL', `${kernelRoot}/evaluation-contract.md`],
  ['LD-PIPE', `${kernelRoot}/pipeline-contract.md`],
  ['LD-WRITE', `${kernelRoot}/writeback-contract.md`],
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

for (const rel of [lookdevRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(abs(rel)).isDirectory()) {
    fail(`missing Lookdev spec directory: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Lookdev spec file: ${rel}`);
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
const surfaces = new Set();
for (const route of asList(routes?.routes)) {
  const routePath = String(route?.path || '').trim();
  const surface = String(route?.surface || '').trim();
  if (!routePath.startsWith('/')) {
    fail(`routes.yaml entry has invalid path: ${routePath || '<empty>'}`);
  }
  if (!surface) {
    fail(`routes.yaml ${routePath || '<empty>'}: surface is required`);
  }
  surfaces.add(surface);
}
for (const surface of Object.keys(routes?.surface_map || {})) {
  if (!surfaces.has(surface)) {
    fail(`routes.yaml surface_map ${surface} is not referenced by a route`);
  }
}

const batchModel = readYaml(`${tablesRoot}/batch-model.yaml`);
for (const [key, value] of Object.entries(batchModel?.batch_model?.working_assets || {})) {
  if (asList(value?.required_fields).length === 0) {
    fail(`batch-model.yaml working asset ${key} must define required_fields`);
  }
}

const evaluationRubric = readYaml(`${tablesRoot}/evaluation-rubric.yaml`);
if (asList(evaluationRubric?.evaluation_rubric?.hard_gates).length === 0) {
  fail('evaluation-rubric.yaml must define hard_gates');
}

const writebackPolicy = readYaml(`${tablesRoot}/writeback-policy.yaml`);
if (asList(writebackPolicy?.writeback_policy?.commit_set?.include_states).length === 0) {
  fail('writeback-policy.yaml must define commit_set.include_states');
}

if (failed) {
  process.exit(1);
}

console.log('Lookdev spec kernel consistency check passed');
