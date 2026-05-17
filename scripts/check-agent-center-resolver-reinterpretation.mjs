#!/usr/bin/env node
// Guard for Avatar Agent Center resolver reinterpretation.
//
// Enforces the current decision:
//   - local Avatar asset import/materialization is the primary launch path
//   - Agent Center resolver names may remain as current storage/materialization plumbing
//   - Remote package lifecycle, inventory, activation, and publish truth stay upstream
//   - Avatar consumes selected local Avatar assets and materialized files only

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
  rustResolver: 'apps/avatar/src-tauri/src/agent_center_avatar_asset.rs',
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
  'selected local Avatar asset',
  'Asset Market packages may become a local Avatar asset only after acquisition',
  'Agent Center resolver plumbing is local Avatar asset',
  'not marketplace package lifecycle',
]);
requireExcludes(FILES.appShell, [
  'Runtime / SDK-authorized opaque visual package ref',
  'Agent Center package descriptor',
  'local Agent Center package',
  'Agent Center owns',
]);

requireIncludes(FILES.carrierVisual, [
  'selected local Avatar asset',
  'local materialization resolver',
]);
requireExcludes(FILES.carrierVisual, ['local Agent Center package']);

requireIncludes(FILES.debugSession, [
  'local files',
  'not package lifecycle',
]);

requireIncludes(FILES.desktopConfig, [
  'local Avatar asset controls',
  'Local import is the primary Avatar asset path',
  'Realm / Asset Market package acquisition may appear',
  'Desktop MUST validate local Avatar asset materialization',
  'Agent Center resolver plumbing',
]);

requireIncludes(FILES.modelResolver, [
  'resolveLocalAvatarAssetManifest',
  'local materialized Avatar asset',
  'not package lifecycle',
  'inventory, or activation authority',
]);

requireIncludes(FILES.live2dLoader, [
  'resolveLocalAvatarAssetManifest',
  'Local Avatar asset resolution',
  'Realm/Asset Market distribution may feed this local store later',
]);

requireIncludes(FILES.rustResolver, [
  'nimi_avatar_resolve_local_avatar_asset',
  'nimi_avatar_resolve_agent_center_avatar_asset',
  'Local Avatar asset materialization resolver',
  'not package lifecycle',
  'inventory, or activation authority',
  'AgentCenterLocalConfigFile',
  'local_avatar_asset_ref',
  'backend_capability_profile_ref',
  'expected_materialization_ref',
  'local Avatar asset selection',
]);
requireExcludes(FILES.rustResolver, [
  'fn read_selected_avatar_asset',
  'agent center local config is unavailable',
  'authorized Avatar package handoff',
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
