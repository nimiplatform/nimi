#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixtureRoot = path.join(repoRoot, '.tmp', 'zhiyu-spec-negative-fixture');
const sourceSpecRoot = path.join(repoRoot, '.nimi', 'spec', 'zhiyu');

const fixtures = [
  {
    name: 'missing runtime_ai_model_config',
    expectedOutput: 'runtime_ai_model_config',
    mutate(root) {
      const rel = path.join(root, 'kernel', 'tables', 'config-consumption-surface.yaml');
      replaceInFile(rel, 'runtime_ai_model_config', 'runtime_ai_model_config_REMOVED');
    },
  },
  {
    name: 'missing forbidden direct AI helper',
    expectedOutput: 'runNimiTextGenerate',
    mutate(root) {
      const rel = path.join(root, 'kernel', 'tables', 'sdk-kit-consumption-surface.yaml');
      replaceInFile(rel, /  - kind: forbidden_surface\n    symbol: runNimiTextGenerate\n    reason: direct_text_generate_bypasses_runtime_agent\n    source_rule: Z-CHAT-003\n/u, '');
    },
  },
  {
    name: 'voice posture admitted by mistake',
    expectedOutput: 'voice posture',
    mutate(root) {
      const rel = path.join(root, 'kernel', 'tables', 'capability-posture.yaml');
      replaceInFile(rel, '  voice:\n    posture: deferred_v1_out_of_scope', '  voice:\n    posture: v1_admitted');
    },
  },
  {
    name: 'duplicate rule id',
    expectedOutput: 'duplicate Zhiyu rule definition',
    mutate(root) {
      const rel = path.join(root, 'kernel', 'product-authority-contract.md');
      fs.appendFileSync(rel, '\n## Z-PROD-001 Duplicate Fixture\n\nThis fixture must fail.\n');
    },
  },
  {
    name: 'acceptance gate id missing',
    expectedOutput: 'gates.id must include test_quarantine',
    mutate(root) {
      const rel = path.join(root, 'kernel', 'tables', 'acceptance-gates.yaml');
      replaceInFile(rel, '  - id: test_quarantine\n', '  - id: fixture_gate\n');
    },
  },
];

function replaceInFile(filePath, needle, replacement) {
  const original = fs.readFileSync(filePath, 'utf8');
  const next = original.replace(needle, replacement);
  if (next === original) {
    throw new Error(`fixture mutation did not change ${filePath}`);
  }
  fs.writeFileSync(filePath, next);
}

function rmFixture() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

function runFixture(fixture) {
  const fixtureSpecRoot = path.join(fixtureRoot, fixture.name.replace(/[^a-z0-9]+/giu, '-').toLowerCase());
  fs.mkdirSync(path.dirname(fixtureSpecRoot), { recursive: true });
  fs.cpSync(sourceSpecRoot, fixtureSpecRoot, { recursive: true });
  fixture.mutate(fixtureSpecRoot);

  const relFixtureSpecRoot = path.relative(repoRoot, fixtureSpecRoot).replaceAll(path.sep, '/');
  const result = spawnSync(
    process.execPath,
    ['scripts/check-zhiyu-spec-kernel-consistency.mjs', '--zhiyu-root', relFixtureSpecRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    throw new Error(`${fixture.name} unexpectedly passed`);
  }
  if (!output.includes(fixture.expectedOutput)) {
    throw new Error(`${fixture.name} failed for the wrong reason\n${output}`);
  }
}

try {
  rmFixture();
  for (const fixture of fixtures) {
    runFixture(fixture);
  }
  rmFixture();
  process.stdout.write(`zhiyu-spec-negative-fixtures: OK (${fixtures.length} fail-closed fixtures)\n`);
} catch (error) {
  rmFixture();
  process.stderr.write(`ERROR: ${error.stack || error.message}\n`);
  process.exit(1);
}
