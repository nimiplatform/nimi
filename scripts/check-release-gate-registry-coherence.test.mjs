// Tests for release gate registry coherence checker.
//
// Owner: scripts; authority is the release-gate registry and its P-RELG rules.
//
// Strategy: load the canonical valid fixture in-memory, then mutate the
// parsed object to produce each broken case and assert validateRegistry
// rejects with an expected token. This is preferred over many on-disk
// broken fixture files because:
// - mutation lets each test name the specific schema rule
// - the canonical fixture stays the authoritative shape reference
// - test fixtures dir stays bounded (one valid fixture + one
//   intentionally-malformed-yaml file for the parse-error path)
//
// Negative test names mirror the registry's declared failure classes so
// failures remain traceable to the static gate contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  loadRegistry,
  validateRegistry,
  loadKnownPRelgIds,
  loadKnownPGovIds,
} from './lib/release-gate/registry-loader.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(
  __dirname,
  'test',
  'release-gate-registry-fixtures'
);

function loadValidFixture() {
  const fixturePath = path.join(FIXTURES_DIR, 'valid-minimal.yaml');
  const result = loadRegistry(fixturePath);
  assert.equal(result.ok, true, `valid fixture must parse, got: ${JSON.stringify(result.errors ?? [])}`);
  return JSON.parse(JSON.stringify(result.registry)); // deep clone
}

function expectFail(registry, tokenSubstring, contextOverride = {}) {
  const result = validateRegistry(registry, contextOverride);
  assert.equal(result.ok, false, 'expected validation to fail');
  const matched = result.errors.some((e) => e.includes(tokenSubstring));
  assert.equal(
    matched,
    true,
    `expected error containing "${tokenSubstring}", got: ${JSON.stringify(result.errors)}`
  );
}

test('valid registry passes validation (no anchor resolution)', () => {
  const registry = loadValidFixture();
  const result = validateRegistry(registry, {});
  assert.equal(result.ok, true, `valid fixture must pass: ${JSON.stringify(result.errors ?? [])}`);
});

test('valid registry passes validation with synthetic anchor sets', () => {
  const registry = loadValidFixture();
  const result = validateRegistry(registry, {
    knownPRelgIds: new Set(['P-RELG-001']),
    knownPGovIds: new Set(['P-GOV-003']),
  });
  assert.equal(result.ok, true, `valid fixture must pass: ${JSON.stringify(result.errors ?? [])}`);
});

test('malformed yaml file: loadRegistry rejects with parse error', () => {
  const malformedPath = path.join(FIXTURES_DIR, 'broken-malformed-yaml.txt');
  // The file MUST exist for the test to be meaningful
  assert.equal(fs.existsSync(malformedPath), true);
  const result = loadRegistry(malformedPath);
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((e) => e.includes('parse failed')),
    true,
    `expected parse error, got: ${JSON.stringify(result.errors)}`
  );
});

test('missing schema_version: rejected', () => {
  const registry = loadValidFixture();
  delete registry.schema_version;
  expectFail(registry, 'schema_version');
});

test('wrong schema_version: rejected', () => {
  const registry = loadValidFixture();
  registry.schema_version = 'release-gate-registry/v0';
  expectFail(registry, 'schema_version');
});

test('missing registry_version: rejected', () => {
  const registry = loadValidFixture();
  delete registry.registry_version;
  expectFail(registry, 'registry_version');
});

test('malformed registry_version: rejected', () => {
  const registry = loadValidFixture();
  registry.registry_version = 'v1';
  expectFail(registry, 'registry_version');
});

test('duplicate gate id: rejected', () => {
  const registry = loadValidFixture();
  registry.gates.push(JSON.parse(JSON.stringify(registry.gates[0])));
  expectFail(registry, 'gate id duplicate');
});

test('gate id with owner outside allowlist: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].id = 'gate.bogus-owner.something';
  expectFail(registry, 'owner segment "bogus-owner" not in allow-list');
});

test('gate id pattern violation (uppercase): rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].id = 'gate.runtime.UPPERCASE';
  expectFail(registry, 'pattern violation');
});

test('gate id pattern violation (only two segments): rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].id = 'gate.runtime';
  expectFail(registry, 'pattern violation');
});

test('unknown tier reference: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].tiers = ['fast', 'undefined-tier'];
  expectFail(registry, 'unknown tier reference');
});

test('unknown target reference: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].targets = ['undefined-target'];
  expectFail(registry, 'unknown target reference');
});

test('release-target tier without release tier (P-RELG-012): rejected', () => {
  const registry = loadValidFixture();
  // Add release-target:sdk to tiers but remove release
  registry.tiers.push({ id: 'release-target:sdk', semantic: 'sdk_subset' });
  registry.gates[0].tiers = ['release-target:sdk']; // no 'release'
  expectFail(registry, "tier release-target:sdk requires also being in 'release' tier");
});

test('live tier without release tier (P-RELG-012): rejected', () => {
  const registry = loadValidFixture();
  registry.tiers.push({ id: 'live', semantic: 'live' });
  registry.gates[0].tiers = ['live']; // no 'release'
  expectFail(registry, "tier 'live' requires also being in 'release' tier");
});

test('prerequisite cycle: rejected', () => {
  const registry = loadValidFixture();
  // Add a second gate that creates a cycle
  registry.gates.push({
    id: 'gate.runtime.gate-b',
    description: 'cyclic dep',
    command: 'echo b',
    runner: 'shell',
    tiers: ['fast', 'release'],
    targets: ['any'],
    timeout_seconds: 60,
    prerequisites: ['gate.runtime.go-build'],
    evidence: { shape: 'command_exit' },
    p_relg_anchors: ['P-RELG-001'],
    parent_p_gov_anchors: ['P-GOV-003'],
    experimental: false,
  });
  registry.gates[0].prerequisites = ['gate.runtime.gate-b'];
  expectFail(registry, 'prerequisite cycle');
});

test('prerequisite pointing at nonexistent gate: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].prerequisites = ['gate.runtime.does-not-exist'];
  expectFail(registry, 'does not resolve');
});

test('prerequisite self-reference: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].prerequisites = [registry.gates[0].id];
  expectFail(registry, 'cannot reference self');
});

test('p_relg_anchor not in known set: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].p_relg_anchors = ['P-RELG-999'];
  expectFail(registry, 'p_relg_anchor not resolvable', {
    knownPRelgIds: new Set(['P-RELG-001']),
    knownPGovIds: new Set(['P-GOV-003']),
  });
});

test('parent_p_gov_anchor not in known set: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].parent_p_gov_anchors = ['P-GOV-999'];
  expectFail(registry, 'parent_p_gov_anchor not resolvable', {
    knownPRelgIds: new Set(['P-RELG-001']),
    knownPGovIds: new Set(['P-GOV-003']),
  });
});

test('missing p_relg_anchors: rejected', () => {
  const registry = loadValidFixture();
  delete registry.gates[0].p_relg_anchors;
  expectFail(registry, 'p_relg_anchors required');
});

test('missing parent_p_gov_anchors: rejected', () => {
  const registry = loadValidFixture();
  delete registry.gates[0].parent_p_gov_anchors;
  expectFail(registry, 'parent_p_gov_anchors required');
});

test('empty registry (zero gates): rejected', () => {
  const registry = loadValidFixture();
  registry.gates = [];
  expectFail(registry, 'gates array must not be empty');
});

test('invalid evidence shape: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].evidence = { shape: 'totally_invalid' };
  expectFail(registry, 'evidence.shape must be one of');
});

test('json_file evidence without json_file_path: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].evidence = { shape: 'json_file' };
  expectFail(registry, 'evidence.json_file_path');
});

test('requires_secrets non-uppercase: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].requires_secrets = ['lowercase_secret'];
  expectFail(registry, 'UPPER_SNAKE');
});

test('requires_env non-uppercase: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].requires_env = ['lowercase_env'];
  expectFail(registry, 'UPPER_SNAKE');
});

test('skip_when unknown condition: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].skip_when = {
    condition: 'darwin',
    reason_code: 'PRECONDITION_NOT_MET',
  };
  expectFail(registry, 'skip_when.condition');
});

test('blocker_semantics with invalid policy: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].blocker_semantics = { on_secrets_missing: 'warn' };
  expectFail(registry, 'blocker_semantics');
});

test('invalid runner: rejected', () => {
  const registry = loadValidFixture();
  registry.gates[0].runner = 'bash';
  expectFail(registry, 'runner must be one of');
});

test('missing command: rejected', () => {
  const registry = loadValidFixture();
  delete registry.gates[0].command;
  expectFail(registry, 'command must be a non-empty string');
});

test('actual on-disk registry passes coherence (E2E)', () => {
  // The real registry under .nimi/spec/platform/kernel/tables/
  // must always pass coherence on a clean checkout. This is the
  // "registry remains coherent" gate; its existence here couples
  // CI behaviour to test runs.
  const result = loadRegistry();
  assert.equal(result.ok, true, `registry yaml must parse: ${JSON.stringify(result.errors ?? [])}`);
  const validation = validateRegistry(result.registry, {
    knownPRelgIds: loadKnownPRelgIds(),
    knownPGovIds: loadKnownPGovIds(),
  });
  assert.equal(
    validation.ok,
    true,
    `registry yaml must pass coherence: ${JSON.stringify(validation.errors ?? [])}`
  );
});
