#!/usr/bin/env node
// Guard for Avatar external-driver provenance wording.
//
// Runtime owns the presentation event provenance values. Avatar must consume
// `apml_output` / `direct_api` (plus `mock` for explicit fixtures) instead of
// inventing `runtime_projection` as a second source enum.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireActiveUnits } from './lib/authority-units.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  avatarEvent: '.nimi/spec/avatar/embodiment-surface.authority.yaml',
  agentScript: '.nimi/spec/runtime/agent-participation.authority.yaml',
  runtimePresentation: '.nimi/spec/runtime/agent-participation.authority.yaml',
  driverTypes: 'apps/avatar/src/shell/renderer/driver/types.ts',
  sdkDriver: 'apps/avatar/src/shell/renderer/sdk/SdkDriver.ts',
  eventDispatch: 'apps/avatar/src/shell/renderer/nas/event-dispatch.ts',
};

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[avatar-external-driver-source-enum] FAIL ${message}`);
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

// The authority side asks whether the units this boundary depends on exist and
// are active, not whether their sentences still read a particular way. The
// sentence assertions that used to stand here were prose matching over
// authority text: rewording a statement broke the gate, and retiring a unit
// did not.
for (const failure of requireActiveUnits('avatar-external-driver-source-enum', [
  'rule.nimi.runtime.agent-participation.r038',
  'rule.nimi.runtime.agent-participation.r158',
  'rule.nimi.avatar.embodiment.r010',
])) {
  fail(failure);
}

requireIncludes(FILES.driverTypes, [
  "export type ActivitySource = 'apml_output' | 'direct_api' | 'mock';",
  'source: ActivitySource;',
]);
requireExcludes(FILES.driverTypes, [
  "'runtime_projection' | 'direct_api' | 'mock'",
]);

requireIncludes(FILES.sdkDriver, [
  'const runtimeSource = requireRuntimeProjectionSource',
  'source: runtimeSource',
]);
requireExcludes(FILES.sdkDriver, [
  "source: 'runtime_projection'",
]);

requireIncludes(FILES.eventDispatch, [
  "source !== 'apml_output' && source !== 'direct_api'",
  'source: activity.source',
  'parseRuntimeProjectionSource',
]);
requireExcludes(FILES.eventDispatch, [
  "source: 'runtime_projection'",
  'runtime_source:',
]);

if (failures > 0) {
  console.error(`[avatar-external-driver-source-enum] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[avatar-external-driver-source-enum] PASS');

