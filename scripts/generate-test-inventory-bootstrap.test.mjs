import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import {
  auditInventoryClassifications,
  buildBootstrapInventory,
  checkInventories,
  parseCliArgs,
  writeBootstrapInventory,
} from './lib/test-inventory-governance.mjs';

function createRepoWithRuntimeTests(testCount) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-inventory-bootstrap-'));
  fs.mkdirSync(path.join(repoRoot, '.nimi/spec/platform/kernel/tables'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.nimi/spec/platform/kernel'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'runtime'), { recursive: true });

  fs.writeFileSync(
    path.join(repoRoot, '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml'),
    [
      'classification_vocabulary:',
      '  - classification: quarantine_unreviewed',
      '    tier: null',
      'gate_eligibility_enum:',
      '  values:',
      '    - never',
      'module_owner_map:',
      '  - domain: runtime',
      '    owner: runtime',
      '    root: runtime',
      '    inventory: config/runtime-test-inventory.yaml',
      'census:',
      '  include_globs:',
      '    - "**/*.test.mjs"',
      '  helper_globs: []',
      '  exclude_dirs: []',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoRoot, '.nimi/spec/platform/kernel/test-governance.md'),
    ['# Test Governance', '', '## P-TEST-001', '', 'Synthetic rule for inventory tests.', ''].join('\n'),
    'utf8',
  );

  for (let index = 1; index <= testCount; index += 1) {
    const name = String(index).padStart(2, '0');
    fs.writeFileSync(path.join(repoRoot, 'runtime', `case-${name}.test.mjs`), 'test file\n', 'utf8');
  }

  return repoRoot;
}

test('parseCliArgs accepts a positive --shard-size override', () => {
  const args = parseCliArgs(['--domain', 'runtime', '--shard-size', '2']);
  assert.equal(args.domain, 'runtime');
  assert.equal(args.shardSize, 2);
  assert.throws(
    () => parseCliArgs(['--domain', 'runtime', '--shard-size', '0']),
    /--shard-size must be a positive integer/u,
  );
});

test('buildBootstrapInventory keeps flat inventory when test count fits shard size', () => {
  const repoRoot = createRepoWithRuntimeTests(2);
  const result = buildBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });
  assert.equal(result.testCount, 2);
  assert.equal(result.shards.length, 0);
  assert.equal(result.inventory.shards, undefined);
  assert.equal(result.inventory.tests.length, 2);
});

test('buildBootstrapInventory emits top-level shard pointers and shard envelopes when over shard size', () => {
  const repoRoot = createRepoWithRuntimeTests(5);
  const result = buildBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  assert.equal(result.testCount, 5);
  assert.deepEqual(result.inventory, {
    version: 1,
    inventory_id: 'runtime_test_inventory',
    owner: 'runtime',
    authority_class: 'non_authoritative_inventory',
    spec_policy_ref: '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml',
    shards: [
      'config/test-inventories/runtime/shard-01.yaml',
      'config/test-inventories/runtime/shard-02.yaml',
      'config/test-inventories/runtime/shard-03.yaml',
    ],
  });
  assert.deepEqual(
    result.shards.map((shard) => [shard.rel, shard.inventory.shard_id, shard.inventory.tests.length]),
    [
      ['config/test-inventories/runtime/shard-01.yaml', 'runtime_test_inventory_shard_01', 2],
      ['config/test-inventories/runtime/shard-02.yaml', 'runtime_test_inventory_shard_02', 2],
      ['config/test-inventories/runtime/shard-03.yaml', 'runtime_test_inventory_shard_03', 1],
    ],
  );
  for (const shard of result.shards) {
    assert.equal(shard.inventory.version, result.inventory.version);
    assert.equal(shard.inventory.inventory_id, result.inventory.inventory_id);
    assert.equal(shard.inventory.owner, result.inventory.owner);
    assert.equal(shard.inventory.authority_class, result.inventory.authority_class);
    assert.equal(shard.inventory.spec_policy_ref, result.inventory.spec_policy_ref);
    assert.equal(shard.inventory.shards, undefined);
  }
  assert.equal(YAML.parse(result.yaml).tests, undefined);
});

test('writeBootstrapInventory writes shard files consumable by checkInventories', () => {
  const repoRoot = createRepoWithRuntimeTests(5);
  const result = writeBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  assert.equal(result.outputRel, 'config/runtime-test-inventory.yaml');
  assert.equal(result.testCount, 5);
  assert.ok(fs.existsSync(path.join(repoRoot, 'config/runtime-test-inventory.yaml')));
  for (const shard of result.shards) {
    assert.ok(fs.existsSync(path.join(repoRoot, shard.rel)), `${shard.rel} should exist`);
  }

  const check = checkInventories({ repoRoot, domain: 'runtime' });
  assert.equal(check.ok, true, check.errors.join('\n'));
  assert.equal(check.totalFiles, 5);
  assert.equal(check.totalBacklog, 5);
});

test('checkInventories rejects mixed top-level rows and shard pointers', () => {
  const repoRoot = createRepoWithRuntimeTests(5);
  writeBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  const inventoryRel = 'config/runtime-test-inventory.yaml';
  const inventoryAbs = path.join(repoRoot, inventoryRel);
  const inventory = YAML.parse(fs.readFileSync(inventoryAbs, 'utf8'));
  inventory.tests = [];
  fs.writeFileSync(inventoryAbs, YAML.stringify(inventory, { lineWidth: 0 }), 'utf8');

  const check = checkInventories({ repoRoot, domain: 'runtime' });
  assert.equal(check.ok, false);
  assert.match(check.errors.join('\n'), /must not declare top-level tests when using shards/u);
});

test('auditInventoryClassifications ignores non-source artifact assertions', () => {
  const repoRoot = createRepoWithRuntimeTests(1);
  writeBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  const inventoryRel = 'config/runtime-test-inventory.yaml';
  const inventoryAbs = path.join(repoRoot, inventoryRel);
  const inventory = YAML.parse(fs.readFileSync(inventoryAbs, 'utf8'));
  inventory.tests[0].classification = 'behavior_unit';
  fs.writeFileSync(inventoryAbs, YAML.stringify(inventory, { lineWidth: 0 }), 'utf8');
  fs.writeFileSync(
    path.join(repoRoot, 'runtime/case-01.test.mjs'),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import fs from 'node:fs';",
      '',
      "test('checks generated inventory error text', () => {",
      "  const inventory = fs.readFileSync('config/runtime-test-inventory.yaml', 'utf8');",
      '  assert.match(inventory, /runtime_test_inventory/u);',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const audit = auditInventoryClassifications({ repoRoot, domain: 'runtime' });
  assert.deepEqual(audit.suspects, []);
});

test('auditInventoryClassifications ignores source assertions embedded in fixture strings', () => {
  const repoRoot = createRepoWithRuntimeTests(1);
  writeBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  const inventoryRel = 'config/runtime-test-inventory.yaml';
  const inventoryAbs = path.join(repoRoot, inventoryRel);
  const inventory = YAML.parse(fs.readFileSync(inventoryAbs, 'utf8'));
  inventory.tests[0].classification = 'behavior_unit';
  fs.writeFileSync(inventoryAbs, YAML.stringify(inventory, { lineWidth: 0 }), 'utf8');
  fs.writeFileSync(
    path.join(repoRoot, 'runtime/case-01.test.mjs'),
    [
      "import test from 'node:test';",
      "import fs from 'node:fs';",
      '',
      "test('writes a source-regex fixture', () => {",
      "  const inventory = fs.readFileSync('config/runtime-test-inventory.yaml', 'utf8');",
      '  fs.writeFileSync(',
      "    'fixture.test.mjs',",
      '    "const source = fs.readFileSync(\'apps/tester/src/example.ts\', \'utf8\');\\nassert.doesNotMatch(source, /runtime\\\\/internal/u);\\n",',
      '    inventory.includes("runtime_test_inventory") ? "utf8" : "utf8",',
      '  );',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const audit = auditInventoryClassifications({ repoRoot, domain: 'runtime' });
  assert.deepEqual(audit.suspects, []);
});

test('auditInventoryClassifications reports presence assertions over source reads', () => {
  const repoRoot = createRepoWithRuntimeTests(1);
  writeBootstrapInventory({ repoRoot, domain: 'runtime', shardSize: 2 });

  const inventoryRel = 'config/runtime-test-inventory.yaml';
  const inventoryAbs = path.join(repoRoot, inventoryRel);
  const inventory = YAML.parse(fs.readFileSync(inventoryAbs, 'utf8'));
  inventory.tests[0].classification = 'behavior_unit';
  fs.writeFileSync(inventoryAbs, YAML.stringify(inventory, { lineWidth: 0 }), 'utf8');
  fs.writeFileSync(
    path.join(repoRoot, 'runtime/case-01.test.mjs'),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import fs from 'node:fs';",
      '',
      "test('forbids private runtime import from app code', () => {",
      "  const runtimeSource = fs.readFileSync('apps/tester/src/example.ts', 'utf8');",
      '  assert.doesNotMatch(runtimeSource, /runtime\\/internal/u);',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const audit = auditInventoryClassifications({ repoRoot, domain: 'runtime' });
  assert.deepEqual(
    audit.suspects.map(({ path: suspectPath, classification, reason }) => ({ path: suspectPath, classification, reason })),
    [
      {
        path: 'runtime/case-01.test.mjs',
        classification: 'behavior_unit',
        reason: 'reads source files and asserts source-pattern presence or absence',
      },
    ],
  );
});
