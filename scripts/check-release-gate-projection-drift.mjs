#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { loadRegistry } from './lib/release-gate/registry-loader.mjs';
import { projectLintChain } from './lib/release-gate/projector-lint.mjs';
import {
  isKnownProjectionKey,
  projectCiStepBlock,
} from './lib/release-gate/projector-ci-step-block.mjs';
import {
  findDuplicateRegisteredLeaves,
  loadPackageScriptCatalog,
} from './lib/release-gate/command-expander.mjs';
import { checkPlatformSpecificGateConsumers } from './lib/release-gate/workflow-platform-gates.mjs';

const REQUIRED_WORKFLOW_PROJECTION_KEYS = {
  'ci.yml': ['core-static-checks', 'workspace-regression-checks'],
  'assurance.yml': [
    'release-target-sdk-static-checks',
    'release-target-proto-checks',
    'release-target-runtime-static-checks',
    'release-target-desktop-static-checks',
  ],
  'live-smoke-matrix.yml': ['live-smoke-checks'],
  'release-runtime.yml': [
    'live-smoke-checks',
    'release-target-runtime-preconditions',
    'release-target-runtime-static-checks',
  ],
  'release.yml': [
    'live-smoke-checks',
    'release-target-sdk-static-checks',
    'release-target-proto-checks',
    'release-target-desktop-release-checks',
  ],
};

const FENCE_HEAD_RE = /^(\s*)#\s*>>>\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*>>>\s*$/iu;
const FENCE_TAIL_RE = /^(\s*)#\s*<<<\s*nimi-release-gate-projection:\s*([a-z0-9-]+(?::[a-z0-9-]+)?)\s*<<<\s*$/iu;

const USAGE = [
  'Usage: node scripts/check-release-gate-projection-drift.mjs [options]',
  '',
  'Options:',
  '  --registry-path <path>    Override the release-gate registry',
  '  --workflows-dir <dir>     Override .github/workflows',
  '  --package-json <path>     Override package.json',
  '  --help                    Print this help and exit',
].join('\n');

function parseArgs(argv) {
  const options = {
    registryPath: undefined,
    workflowsDir: '.github/workflows',
    packageJsonPath: 'package.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--registry-path') options.registryPath = argv[++index];
    else if (arg === '--workflows-dir') options.workflowsDir = argv[++index];
    else if (arg === '--package-json') options.packageJsonPath = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  return options;
}

function checkLintChainDrift(registry, packageJsonPath) {
  const errors = [];
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    return [`unable to read ${packageJsonPath}: ${String(error?.message ?? error)}`];
  }
  if (typeof pkg?.scripts?.lint !== 'string') {
    return [`${packageJsonPath}: scripts.lint missing or not a string`];
  }

  let projected;
  try {
    projected = projectLintChain(registry);
  } catch (error) {
    return [`lint chain projection failed: ${String(error?.message ?? error)}`];
  }
  if (projected.body !== pkg.scripts.lint) {
    errors.push(
      `package.json scripts.lint drifted from registry projection (PROJECTION_DRIFT); `
      + 'run: pnpm generate:lint-chain',
    );
  }
  return errors;
}

function extractFences(text, fileName, errors) {
  const lines = text.split('\n');
  const fences = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const head = line.match(FENCE_HEAD_RE);
    const tail = line.match(FENCE_TAIL_RE);
    if (head) {
      if (open) {
        errors.push(`${fileName}:${index + 1}: nested fence before ${open.key} was closed`);
        continue;
      }
      open = {
        key: head[2],
        headLine: index + 1,
        indent: head[1].length,
        bodyLines: [],
      };
      continue;
    }
    if (tail) {
      if (!open) {
        errors.push(`${fileName}:${index + 1}: unexpected fence footer ${tail[2]}`);
        continue;
      }
      if (open.key !== tail[2]) {
        errors.push(`${fileName}:${index + 1}: mismatched fence footer ${tail[2]} for ${open.key}`);
        open = null;
        continue;
      }
      fences.push(open);
      open = null;
      continue;
    }
    if (open) open.bodyLines.push(line);
  }
  if (open) errors.push(`${fileName}:${open.headLine}: unclosed fence ${open.key}`);

  const seen = new Set();
  for (const fence of fences) {
    if (seen.has(fence.key)) errors.push(`${fileName}:${fence.headLine}: duplicate fence ${fence.key}`);
    seen.add(fence.key);
  }
  return fences;
}

function checkDuplicateJobCommands(document, fileName, registry, catalog, errors) {
  for (const duplicate of findDuplicateRegisteredLeaves(document, registry, catalog)) {
    const location = duplicate.leaf.cwd === '.'
      ? duplicate.leaf.command
      : `${duplicate.leaf.cwd}: ${duplicate.leaf.command}`;
    errors.push(
      `${fileName}:jobs.${duplicate.jobId}: duplicate registered command leaf in steps `
      + `${duplicate.steps.join(', ')}: ${location}`,
    );
  }
}

function checkWorkflowFenceDrift(registry, workflowsDir, rootDir) {
  const errors = [];
  let catalog;
  try {
    catalog = loadPackageScriptCatalog(rootDir);
  } catch (error) {
    return [`package script catalog unreadable: ${String(error?.message ?? error)}`];
  }
  let entries;
  try {
    entries = fs.readdirSync(workflowsDir)
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    return [`workflows directory unreadable: ${workflowsDir}: ${String(error?.message ?? error)}`];
  }

  const observedKeysByFile = new Map();
  const workflowDocuments = [];
  let totalFences = 0;
  for (const fileName of entries) {
    const fullPath = path.join(workflowsDir, fileName);
    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
      errors.push(`${fileName}: unreadable workflow: ${String(error?.message ?? error)}`);
      continue;
    }

    let document;
    try {
      document = YAML.parse(text);
    } catch (error) {
      errors.push(`${fileName}: malformed workflow YAML: ${String(error?.message ?? error)}`);
      continue;
    }
    workflowDocuments.push({ fileName, document });
    checkDuplicateJobCommands(document, fileName, registry, catalog, errors);

    const fences = extractFences(text, fileName, errors);
    observedKeysByFile.set(fileName, fences.map((fence) => fence.key));
    totalFences += fences.length;
    for (const fence of fences) {
      if (!isKnownProjectionKey(fence.key)) {
        errors.push(`${fileName}:${fence.headLine}: UNKNOWN_PROJECTION_KEY ${fence.key}`);
        continue;
      }
      let projected;
      try {
        projected = projectCiStepBlock(registry, fence.key, { indent: fence.indent });
      } catch (error) {
        errors.push(`${fileName}:${fence.headLine}: projection failed: ${String(error?.message ?? error)}`);
        continue;
      }
      const expected = projected.body.replace(/\n+$/u, '');
      const actual = fence.bodyLines.join('\n').replace(/\n+$/u, '');
      if (expected !== actual) {
        errors.push(
          `${fileName}:${fence.headLine}: PROJECTION_DRIFT for ${fence.key}; `
          + 'run: pnpm generate:ci-workflow-steps',
        );
      }
    }
  }

  errors.push(...checkPlatformSpecificGateConsumers(registry, workflowDocuments));

  if (totalFences === 0) errors.push(`${workflowsDir}: no release-gate projection fences found`);
  for (const [fileName, requiredKeys] of Object.entries(REQUIRED_WORKFLOW_PROJECTION_KEYS)) {
    if (!entries.includes(fileName)) {
      errors.push(`${fileName}: REQUIRED_WORKFLOW_MISSING`);
      continue;
    }
    const observed = new Set(observedKeysByFile.get(fileName) ?? []);
    for (const key of requiredKeys) {
      if (!observed.has(key)) errors.push(`${fileName}: MISSING_REQUIRED_PROJECTION_KEY ${key}`);
    }
  }
  return errors;
}

const options = parseArgs(process.argv.slice(2));
const loaded = loadRegistry(options.registryPath);
if (!loaded.ok) {
  for (const error of loaded.errors) process.stderr.write(`registry-load error: ${error}\n`);
  process.exit(1);
}

const errors = [
  ...checkLintChainDrift(loaded.registry, options.packageJsonPath),
  ...checkWorkflowFenceDrift(
    loaded.registry,
    options.workflowsDir,
    path.dirname(path.resolve(options.packageJsonPath)),
  ),
];
if (errors.length > 0) {
  process.stderr.write(`release-gate projection drift: FAIL (${errors.length} drift(s))\n`);
  for (const error of errors) process.stderr.write(`  - ${error}\n`);
  process.exit(1);
}
process.stdout.write('release-gate projection drift: OK\n');
