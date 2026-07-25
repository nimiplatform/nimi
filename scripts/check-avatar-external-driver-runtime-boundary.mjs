#!/usr/bin/env node
// Guard for the Avatar external-driver Runtime boundary.
//
// Enforces:
//   - Avatar external driving is consumer-only
//   - Runtime external-entry boundary matrix remains the owner of admission
//   - Avatar has no local endpoint/protocol/token/rate-limit posture
//   - `direct_api` is Runtime provenance, not browser/local state write authority

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { requireActiveUnits } from './lib/authority-units.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  avatarContract: '.nimi/spec/runtime/agent-participation.authority.yaml',
  avatarIndex: '.nimi/spec/runtime/agent-participation.authority.yaml',
  avatarEvent: '.nimi/spec/runtime/agent-participation.authority.yaml',
  agentScript: '.nimi/spec/runtime/agent-participation.authority.yaml',
  avatarProjection: '.nimi/spec/avatar/embodiment-surface.authority.yaml',
  runtimeParticipationPolicy: '.nimi/spec/runtime/agent-participation.authority.yaml',
  runtimePresentation: '.nimi/spec/runtime/agent-participation.authority.yaml',
  externalBoundaryTable: 'config/runtime-agent-participation-external-entry-boundaries.yaml',
  driverTypes: 'apps/avatar/src/shell/renderer/driver/types.ts',
  sdkDriver: 'apps/avatar/src/shell/renderer/sdk/SdkDriver.ts',
  sdkDriverHelpers: 'apps/avatar/src/shell/renderer/sdk/sdk-driver-event-helpers.ts',
  eventDispatch: 'apps/avatar/src/shell/renderer/nas/event-dispatch.ts',
};

const CODE_DIRS = [
  'apps/avatar/src',
  'apps/avatar/src-tauri/src',
];

const FORBIDDEN_CODE_PATTERNS = [
  [/POST\s+\/state/iu, 'Petdex-style POST /state protocol'],
  [/\/state\s+endpoint/iu, 'state endpoint wording'],
  [/avatar[-_]?external[-_]?driver/iu, 'Avatar-local external driver surface'],
  [/\bexternalDriver\b/u, 'Avatar-local externalDriver symbol'],
  [/\bexternal_driver\b/u, 'Avatar-local external_driver symbol'],
  [/local adapter protocol/iu, 'Avatar-local adapter protocol'],
  [/token posture/iu, 'Avatar-local token posture'],
  [/rate[- ]limit posture/iu, 'Avatar-local rate-limit posture'],
  [/browser-reachable\s+Avatar-local/iu, 'browser-reachable Avatar-local endpoint'],
  [/localhost\s+state\s+writes?/iu, 'localhost state write authority'],
];

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[avatar-external-driver-runtime-boundary] FAIL ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

function parseYaml(relPath) {
  return YAML.parse(read(relPath));
}

// The dispositions live one level down in the table; find the exact key
// wherever it sits rather than assuming one shape.
function findBoundaryDisposition(node, key) {
  if (node === null || typeof node !== 'object') return undefined;
  if (!Array.isArray(node) && Object.hasOwn(node, key)) return node[key];
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findBoundaryDisposition(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
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
}

function walk(dirRel) {
  const abs = path.join(ROOT, dirRel);
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.cache', 'target', 'public'].includes(entry.name)) {
        continue;
      }
      out.push(...walk(path.relative(ROOT, full)));
    } else if (entry.isFile() && /\.(ts|tsx|rs)$/u.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Authority side: the units this boundary rests on must exist and be active.
// The sentences that used to be matched here were prose over authority text --
// the "[avatar-external-entry-consumer-contract]" marker was a title prefix of
// r148 and r149, so unit existence covers it exactly.
for (const failure of requireActiveUnits('avatar-external-driver-runtime-boundary', [
  'rule.nimi.runtime.agent-participation.r148',
  'rule.nimi.runtime.agent-participation.r149',
  'rule.nimi.runtime.agent-participation.r158',
  'definition.nimi.runtime.agent-participation.external-entry-plane',
  'rule.nimi.avatar.embodiment.r010',
])) {
  fail(failure);
}

// The boundary table is YAML, so it is parsed and its dispositions compared as
// values instead of matched as "key: value" text.
const externalBoundaries = parseYaml(FILES.externalBoundaryTable);
for (const [key, expected] of [
  ['app_desktop_avatar_mod_direct_protocol_client', 'forbidden'],
  ['external_principal_memory_writeback', 'forbidden'],
  ['external_principal_cognition_writeback', 'forbidden'],
  ['external_principal_canonical_chat_writeback', 'forbidden'],
  ['external_principal_realm_group_commit', 'forbidden'],
  ['external_principal_product_domain_commit', 'forbidden'],
  ['missing_verdict_policy', 'fail_closed'],
  ['direct_mcp_client_outside_runtime_delegated_adapter', 'forbidden'],
  ['direct_a2a_client_outside_future_admitted_runtime_adapter', 'forbidden'],
]) {
  const actual = findBoundaryDisposition(externalBoundaries, key);
  if (actual !== expected) {
    fail(`${FILES.externalBoundaryTable} ${key} must be ${expected}, found ${actual ?? 'nothing'}`);
  }
}

requireIncludes(FILES.driverTypes, ["export type ActivitySource = 'apml_output' | 'direct_api' | 'mock';"]);
requireIncludes(FILES.sdkDriver, ['requireRuntimeProjectionSource']);
requireIncludes(FILES.sdkDriverHelpers, ["value === 'apml_output' || value === 'direct_api'"]);
requireIncludes(FILES.eventDispatch, ["source !== 'apml_output' && source !== 'direct_api'"]);

for (const relPath of [FILES.driverTypes, FILES.sdkDriver, FILES.eventDispatch]) {
  requireExcludes(relPath, [
    'source: enum(runtime_projection|direct_api)',
    'source: "runtime_projection" | "direct_api"',
    "'runtime_projection' | 'direct_api' | 'mock'",
    "source: 'runtime_projection'",
  ]);
}

for (const dirRel of CODE_DIRS) {
  for (const file of walk(dirRel)) {
    if (!statSync(file).isFile()) continue;
    const text = readFileSync(file, 'utf8');
    for (const [pattern, label] of FORBIDDEN_CODE_PATTERNS) {
      if (pattern.test(text)) {
        fail(`${path.relative(ROOT, file)} contains forbidden ${label}`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`[avatar-external-driver-runtime-boundary] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[avatar-external-driver-runtime-boundary] PASS');




