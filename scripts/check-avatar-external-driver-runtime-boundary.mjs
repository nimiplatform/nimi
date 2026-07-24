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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  avatarContract: 'docs/authority/runtime-agent-participation-rationale.md',
  avatarIndex: 'docs/authority/runtime-agent-participation-rationale.md',
  avatarEvent: 'docs/authority/avatar-embodiment-rationale.md',
  agentScript: 'docs/authority/avatar-embodiment-rationale.md',
  runtimeParticipationPolicy: 'docs/authority/runtime-agent-participation-rationale.md',
  runtimePresentation: 'docs/authority/runtime-agent-participation-rationale.md',
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

requireIncludes(FILES.avatarContract, [
  'K-AGCORE-079..094',
  'agent-participation-external-entry-boundaries.yaml',
  'K-DELEG-100..119',
  'K-DELEG-120..129',
  'direct_api` means Runtime-admitted direct projection provenance',
  'Avatar MUST NOT expose or own',
  'an Avatar-local HTTP endpoint',
  'an Avatar-local WebSocket endpoint',
  'a Petdex-style `/state` protocol',
  'token posture for local driver writes',
  'rate-limit posture for local driver writes',
  'user-consent posture for local driver writes',
  'External-entry presentation consumption must remain render-only',
  'Refusal must use admitted degraded/debug surfaces',
]);

requireIncludes(FILES.avatarIndex, ['avatar-external-entry-consumer-contract.md']);

requireIncludes(FILES.runtimeParticipationPolicy, [
  'K-AGCORE-089 External Entry Boundary Matrix',
  'K-AGCORE-090 MCP-Backed AI Capability Entry',
  'K-AGCORE-091 Future A2A External Agent Entry',
  'K-AGCORE-092',
  'K-AGCORE-093',
  'K-AGCORE-094',
]);

requireIncludes(FILES.externalBoundaryTable, [
  'app_desktop_avatar_mod_direct_protocol_client: forbidden',
  'external_principal_memory_writeback: forbidden',
  'external_principal_cognition_writeback: forbidden',
  'external_principal_canonical_chat_writeback: forbidden',
  'external_principal_realm_group_commit: forbidden',
  'external_principal_product_domain_commit: forbidden',
  'missing_verdict_policy: fail_closed',
  'direct_mcp_client_outside_runtime_delegated_adapter: forbidden',
  'direct_a2a_client_outside_future_admitted_runtime_adapter: forbidden',
]);

requireIncludes(FILES.runtimePresentation, [
  'detail.source` records provenance such as `apml_output` or `direct_api`',
]);

requireIncludes(FILES.avatarEvent, ['source: enum(apml_output|direct_api|mock)']);
requireIncludes(FILES.agentScript, ['source: "apml_output" | "direct_api" | "mock";']);
requireIncludes(FILES.driverTypes, ["export type ActivitySource = 'apml_output' | 'direct_api' | 'mock';"]);
requireIncludes(FILES.sdkDriver, ['requireRuntimeProjectionSource']);
requireIncludes(FILES.sdkDriverHelpers, ["value === 'apml_output' || value === 'direct_api'"]);
requireIncludes(FILES.eventDispatch, ["source !== 'apml_output' && source !== 'direct_api'"]);

for (const relPath of [FILES.avatarEvent, FILES.agentScript, FILES.driverTypes, FILES.sdkDriver, FILES.eventDispatch]) {
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




