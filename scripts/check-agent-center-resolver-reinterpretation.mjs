#!/usr/bin/env node
// Guard for Avatar Agent Center resolver reinterpretation.
//
// Enforces the current decision:
//   - Agent Center resolver names may remain as storage/materialization plumbing
//   - Package lifecycle, inventory, activation, and publish truth stay upstream
//   - Avatar consumes authorized opaque refs and local materialized files only

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  appShell: '.nimi/spec/avatar/kernel/app-shell-contract.md',
  carrierVisual: '.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md',
  debugSession: '.nimi/spec/avatar/kernel/avatar-debug-session-contract.md',
  desktopConfig: '.nimi/spec/desktop/kernel/agent-avatar-configuration-contract.md',
  modelResolver: 'apps/avatar/src/shell/renderer/carrier/model-resolver.ts',
  live2dLoader: 'apps/avatar/src/shell/renderer/live2d/model-loader.ts',
  rustResolver: 'apps/avatar/src-tauri/src/agent_center_avatar_package.rs',
};

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[agent-center-resolver-reinterpretation] FAIL ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

function requireIncludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`${relPath} must include ${needle}`);
    }
  }
  return text;
}

function requireExcludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (text.includes(needle)) {
      fail(`${relPath} must not include ${needle}`);
    }
  }
  return text;
}

if (existsSync(path.join(ROOT, '.nimi', 'spec', 'asset-market'))) {
  fail('.nimi/spec/asset-market must not exist; Asset Market authority is apps/asset-market/spec');
}

requireIncludes(FILES.appShell, [
  'Runtime / SDK-authorized opaque visual package ref',
  'local materialization only',
  'not package lifecycle',
  'not package lifecycle,\n  inventory, or activation authority',
]);
requireExcludes(FILES.appShell, [
  'Agent Center package descriptor',
  'local Agent Center package',
  'Agent Center owns',
]);

requireIncludes(FILES.carrierVisual, [
  'Runtime/SDK-authorized opaque visual package ref',
  'local materialization resolver',
]);
requireExcludes(FILES.carrierVisual, ['local Agent Center package']);

requireIncludes(FILES.debugSession, [
  'authorized Runtime/SDK projection',
  'local files',
  'not package lifecycle',
]);

requireIncludes(FILES.desktopConfig, [
  '`avatar_package_ref` and `backend_capability_profile_ref` are opaque refs',
  'Desktop MUST NOT dereference package descriptors',
  'Desktop stores opaque refs and renders status.',
]);

requireIncludes(FILES.modelResolver, [
  'resolveAgentCenterAvatarPackageManifest',
  'local materialization',
  'not package lifecycle',
  'not package lifecycle,\n// inventory, or activation authority',
]);

requireIncludes(FILES.live2dLoader, [
  'resolveAgentCenterAvatarPackageManifest',
  'local materialization plumbing',
  'Package lifecycle and activation truth live upstream',
  'avatarPackageRef',
  'backendCapabilityProfileRef',
  'materializationRef',
]);

requireIncludes(FILES.rustResolver, [
  'nimi_avatar_resolve_agent_center_avatar_package',
  'Local materialization resolver',
  'not package lifecycle',
  'not package lifecycle,\n// inventory, or activation authority',
  'avatar_package_ref',
  'backend_capability_profile_ref',
  'materialization_ref',
  'expected_materialization_ref',
  'authorized Avatar package handoff',
]);
requireExcludes(FILES.rustResolver, [
  'struct AgentCenterLocalConfig',
  'fn read_selected_avatar_package',
  'config.modules.avatar_package',
  'agent center local config is unavailable',
]);

for (const relPath of [FILES.appShell, FILES.carrierVisual, FILES.debugSession, FILES.desktopConfig]) {
  requireExcludes(relPath, [
    'Agent Center owns package',
    'Agent Center package authority',
    'Agent Center inventory authority',
    'Agent Center activation authority',
  ]);
}

if (failures > 0) {
  console.error(`[agent-center-resolver-reinterpretation] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[agent-center-resolver-reinterpretation] PASS');
