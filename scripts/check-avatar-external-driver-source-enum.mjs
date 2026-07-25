#!/usr/bin/env node
// Guard for Avatar external-driver provenance wording.
//
// Runtime owns the presentation event provenance values. Avatar must consume
// `apml_output` / `direct_api` (plus `mock` for explicit fixtures) instead of
// inventing `runtime_projection` as a second source enum.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

requireIncludes(FILES.runtimePresentation, [
  'id: rule.nimi.runtime.agent-participation.r038',
  'detail.source records provenance such as apml_output or direct_api',
  'id: rule.nimi.runtime.agent-participation.r158',
  'an apml_output source identifies validated Runtime APML projection',
  'a direct_api source identifies a Runtime-admitted direct projection rather than an Avatar write',
]);
requireExcludes(FILES.runtimePresentation, ['a runtime_projection source identifies']);

requireIncludes(FILES.avatarEvent, [
  'id: rule.nimi.avatar.embodiment.r010',
  'Embodiment projection emits only motion, expression, pose, lookat, speak, parameter_delta, and surface_bounds cues',
]);

requireIncludes(FILES.agentScript, [
  'Avatar-local, Desktop, shell, backend, provider, mock, or fixture events never become, mirror, or imply runtime.agent truth',
]);

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

