#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const cwd = process.cwd();
const avatarRoot = '.nimi/spec/avatar';
const retiredAvatarSpecRoot = 'apps/avatar/spec';
const kernelRoot = `${avatarRoot}/kernel`;
const tablesRoot = `${kernelRoot}/tables`;
const oldRootPattern = /apps\/avatar\/spec|avatar\/spec/u;
const requiredFiles = [
  `${avatarRoot}/index.md`,
  `${avatarRoot}/nimi-avatar.md`,
  `${kernelRoot}/index.md`,
  `${kernelRoot}/agent-script-contract.md`,
  `${kernelRoot}/app-shell-contract.md`,
  `${kernelRoot}/avatar-event-contract.md`,
  `${kernelRoot}/backend-branch-contract.md`,
  `${kernelRoot}/carrier-visual-acceptance-contract.md`,
  `${kernelRoot}/embodiment-projection-contract.md`,
  `${kernelRoot}/generated-motion-provider-contract.md`,
  `${kernelRoot}/live2d-asset-compatibility-contract.md`,
  `${kernelRoot}/live2d-render-contract.md`,
  `${kernelRoot}/mock-fixture-contract.md`,
  `${kernelRoot}/vrm-backend-contract.md`,
  `${tablesRoot}/activity-mapping.yaml`,
  `${tablesRoot}/backend-capability-profile.schema.yaml`,
  `${tablesRoot}/feature-matrix.yaml`,
  `${tablesRoot}/generated-motion-routes.yaml`,
  `${tablesRoot}/i18n-keys.yaml`,
  `${tablesRoot}/live2d-compatibility-tiers.yaml`,
  `${tablesRoot}/mapping-sidecar.schema.yaml`,
  `${tablesRoot}/scenario-catalog.yaml`,
  `${tablesRoot}/vrm-emote-states.yaml`,
  `${tablesRoot}/vrm-motion-presets.yaml`,
  `${tablesRoot}/window-bounds-policy.yaml`,
];
const activeReferenceScanRoots = [
  '.nimi/spec',
  'docs/architecture',
  'apps/avatar/AGENTS.md',
  'apps/avatar/src',
  'apps/avatar/src-tauri',
  'scripts/check-account-session-hardcut.mjs',
  '.nimi/config',
  'config',
  'package.json',
  'pnpm-workspace.yaml',
  '.nimi/topics/proposal/2026-04-24-live2d-existing-assets-nimi-adaptation',
  '.nimi/topics/proposal/2026-05-01-avatar-apml-auto-adapter',
];
const generatedMotionBoundaryFiles = new Set([
  `${kernelRoot}/generated-motion-provider-contract.md`,
  `${tablesRoot}/generated-motion-routes.yaml`,
]);

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(cwd, rel));
}

function* walkFiles(rel) {
  const abs = path.join(cwd, rel);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    yield rel;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') {
      continue;
    }
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(childRel);
    } else if (entry.isFile()) {
      yield childRel;
    }
  }
}

function firstLineMatching(content, pattern) {
  const lines = content.split(/\r?\n/u);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : null;
}

for (const rel of [avatarRoot, kernelRoot, tablesRoot]) {
  if (!exists(rel) || !fs.statSync(path.join(cwd, rel)).isDirectory()) {
    fail(`missing Avatar spec directory: ${rel}`);
  }
}

if (exists(retiredAvatarSpecRoot)) {
  fail(`${retiredAvatarSpecRoot} must not exist after Avatar authority promotion hardcut`);
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Avatar spec file: ${rel}`);
  }
}

for (const rel of requiredFiles) {
  if (!exists(rel)) continue;
  const content = read(rel);
  if (content.includes('apps/avatar/spec')) {
    fail(`${rel} must not cite apps/avatar/spec as active authority`);
  }
  if (!generatedMotionBoundaryFiles.has(rel) && /\bapml\./u.test(content)) {
    fail(`${rel} must not consume raw apml.* parser events`);
  }
  if (
    !generatedMotionBoundaryFiles.has(rel)
    && /<(?:motion|expression|lookat|pose)\b|<clear-pose\/>/u.test(content)
  ) {
    fail(`${rel} must not re-admit public APML motion/expression/lookat/pose syntax`);
  }
}

for (const root of activeReferenceScanRoots) {
  for (const rel of walkFiles(root)) {
    const content = read(rel);
    const line = firstLineMatching(content, oldRootPattern);
    if (line !== null) {
      fail(`${rel}:${line} must not cite retired Avatar spec root`);
    }
  }
}

for (const rel of requiredFiles.filter((file) => file.endsWith('.yaml'))) {
  if (!exists(rel)) continue;
  try {
    YAML.parse(read(rel));
  } catch (error) {
    fail(`${rel} must parse as YAML: ${error.message}`);
  }
}

const activityMappingRel = `${tablesRoot}/activity-mapping.yaml`;
if (exists(activityMappingRel)) {
  const parsed = YAML.parse(read(activityMappingRel));
  const sourceAuthority = String(parsed?.source_authority || '').trim();
  if (sourceAuthority && !sourceAuthority.includes('.nimi/spec/runtime/')) {
    fail(`${activityMappingRel} source_authority must remain runtime-owned`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('avatar-spec-kernel-consistency: OK');
