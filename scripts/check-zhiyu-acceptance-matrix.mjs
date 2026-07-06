#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const matrixRel = '.nimi/spec/zhiyu/kernel/tables/implementation-acceptance-matrix.yaml';
const storyRel = '.nimi/spec/zhiyu/kernel/tables/storybook-trace.yaml';
const stateRel = '.nimi/spec/zhiyu/kernel/tables/product-state-machine.yaml';
const gatesRel = '.nimi/spec/zhiyu/kernel/tables/acceptance-gates.yaml';

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readYaml(rel) {
  return YAML.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

function idSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean));
}

function expectEqualSet(label, actual, expected) {
  for (const value of expected) {
    if (!actual.has(value)) {
      fail(`${label} missing ${value}`);
    }
  }
  for (const value of actual) {
    if (!expected.has(value)) {
      fail(`${label} has unexpected ${value}`);
    }
  }
}

function expectIncludes(label, actual, required) {
  for (const value of required) {
    if (!actual.has(value)) {
      fail(`${label} must include ${value}`);
    }
  }
}

const matrix = readYaml(matrixRel);
const storybook = readYaml(storyRel);
const stateMachine = readYaml(stateRel);
const gates = readYaml(gatesRel);

if (matrix.version !== 1) fail(`${matrixRel} must declare version: 1`);
if (matrix.table_family !== 'product_catalog') fail(`${matrixRel} must use table_family: product_catalog`);
if (matrix.owner !== 'zhiyu') fail(`${matrixRel} must declare owner: zhiyu`);
if (matrix.source_rule !== 'Z-GATE-005') fail(`${matrixRel} must use source_rule: Z-GATE-005`);
if (matrix.acceptance_mode?.e2e_during_zs4 !== 'forbidden') {
  fail(`${matrixRel} must forbid E2E during ZS4`);
}
if (matrix.acceptance_mode?.post_remediation !== 'real_app_shell_required') {
  fail(`${matrixRel} must require real app shell post-remediation acceptance`);
}

const requiredDimensions = new Set([
  'real_app_shell',
  'desktop_screenshot',
  'narrow_screenshot',
  'primary_user_path',
  'dom_cdp_state',
  'console_error_free',
  'accessibility_probe',
  'real_runtime_auth_sdk_connectivity',
  'failure_state',
  'disabled_state',
  'long_text_narrow_layout',
  'chinese_readability',
  'button_input_usability',
  'owner_boundary_trace',
  'visual_review',
]);
expectEqualSet('global_acceptance_dimensions', idSet(matrix.global_acceptance_dimensions), requiredDimensions);

const expectedStories = idSet(storybook.entries);
const actualStories = idSet((matrix.story_acceptance || []).map((row) => row?.story));
expectEqualSet('story_acceptance', actualStories, expectedStories);

const storyStates = new Map(
  (storybook.stories || []).map((row) => [String(row.id), idSet(row.states)]),
);
const sourceStories = new Set();
for (const row of storybook.stories || []) {
  const id = String(row?.id || '');
  const sourceStory = Number(row?.source_story);
  if (!Number.isInteger(sourceStory) || sourceStory < 1 || sourceStory > 11) {
    fail(`${id || '<unknown story>'} must declare source_story from 1 to 11`);
  } else if (sourceStories.has(sourceStory)) {
    fail(`source_story ${sourceStory} is mapped by more than one formal story`);
  } else {
    sourceStories.add(sourceStory);
  }
  if (!String(row?.intent || '').trim()) {
    fail(`${id || '<unknown story>'} must declare intent`);
  }
}
expectEqualSet('source_story mapping', sourceStories, new Set(Array.from({ length: 11 }, (_, index) => index + 1)));
for (const row of matrix.story_acceptance || []) {
  const story = String(row?.story || '');
  const expectedStates = storyStates.get(story);
  if (!expectedStates) continue;
  expectEqualSet(`${story}.states`, idSet(row.states), expectedStates);
  expectIncludes(`${story}.dimensions`, idSet(row.dimensions), new Set(['real_app_shell']));
  if (!Array.isArray(row.required_evidence) || row.required_evidence.length === 0) {
    fail(`${story} must declare required_evidence`);
  }
  if (!Array.isArray(row.gates) || row.gates.length === 0) {
    fail(`${story} must declare gates`);
  }
}

const expectedStates = idSet((stateMachine.states || []).map((row) => row?.id));
const actualStates = idSet((matrix.state_acceptance || []).map((row) => row?.state));
expectEqualSet('state_acceptance', actualStates, expectedStates);

const expectedDecisions = new Set(Array.from({ length: 12 }, (_, index) => `D${index + 1}`));
const actualDecisions = idSet((matrix.decision_acceptance || []).map((row) => row?.decision));
expectEqualSet('decision_acceptance', actualDecisions, expectedDecisions);
for (const row of matrix.decision_acceptance || []) {
  const decision = String(row?.decision || '');
  if (!Array.isArray(row.spec_refs) || row.spec_refs.length === 0) {
    fail(`${decision} must declare spec_refs`);
  }
  if (!Array.isArray(row.acceptance_rows) || row.acceptance_rows.length === 0) {
    fail(`${decision} must declare acceptance_rows`);
  }
}

const acceptedGateNames = idSet((gates.gates || []).map((row) => row?.id));
const matrixGateRefs = new Set();
for (const row of matrix.story_acceptance || []) {
  for (const gate of row.gates || []) matrixGateRefs.add(String(gate));
}
for (const row of matrix.blocking_gates || []) {
  matrixGateRefs.add(String(row?.gate || ''));
}
for (const gate of matrixGateRefs) {
  if (!acceptedGateNames.has(gate)) {
    fail(`${matrixRel} references unknown acceptance gate ${gate}`);
  }
}
expectIncludes('blocking_gates', idSet((matrix.blocking_gates || []).map((row) => row?.gate)), new Set([
  'config_boundary',
  'artifact_boundary',
  'local_persistence_boundary',
  'no_direct_ai_consumption',
  'no_duplicate_turn_reducer',
  'test_quarantine',
]));

if (failed) {
  process.exit(1);
}

console.log('zhiyu-acceptance-matrix: OK');
