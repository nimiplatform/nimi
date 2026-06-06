#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ledgerPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-ai-capability-ledger.yaml',
);
const vnextPackagePath = path.join(repoRoot, 'sdks', 'typescript', 'package.json');
const BASELINE_SDK_SOURCE_ROOT = 'archive/sdk-pre-vnext-20260606/src';

function baselineSdkSource(relativePath) {
  return `${BASELINE_SDK_SOURCE_ROOT}/${relativePath}`;
}

const REQUIRED_CURRENT_SOURCES = [
  baselineSdkSource('ai/index.ts'),
  baselineSdkSource('ai/account-profile-library.ts'),
  baselineSdkSource('ai/ai-config.ts'),
  baselineSdkSource('ai/ai-config-diff.ts'),
  baselineSdkSource('ai/app-ai-config.ts'),
  baselineSdkSource('ai/host-ai-config.ts'),
  baselineSdkSource('ai/host-ai-profile-surface.ts'),
  baselineSdkSource('ai/host-ai-snapshot.ts'),
  baselineSdkSource('ai/i18n.ts'),
  baselineSdkSource('ai-app/index.ts'),
  baselineSdkSource('ai-app/chat.ts'),
  baselineSdkSource('ai-app/history-window.ts'),
  baselineSdkSource('ai-app/session-loop.ts'),
  baselineSdkSource('ai-app/structured-output.ts'),
  baselineSdkSource('ai-app/text-generate.ts'),
  baselineSdkSource('ai-app/text-stream-response.ts'),
  baselineSdkSource('ai-app/text-turn.ts'),
  baselineSdkSource('ai-app/tools.ts'),
  baselineSdkSource('runtime/runtime-ai-text.ts'),
  baselineSdkSource('runtime/runtime-ai-codec.ts'),
  baselineSdkSource('runtime/runtime-scenario-output-codec.ts'),
  baselineSdkSource('runtime/types.ts'),
  baselineSdkSource('runtime/runtime-route-types.ts'),
  baselineSdkSource('runtime/runtime-route-bindings.ts'),
  baselineSdkSource('runtime/runtime-route-capability-runtime.ts'),
  baselineSdkSource('runtime/runtime-scheduling.ts'),
  baselineSdkSource('runtime/ai-config-scheduling.ts'),
  baselineSdkSource('runtime/memory-embedding-config.ts'),
  baselineSdkSource('runtime/memory-embedding-runtime.ts'),
  baselineSdkSource('runtime/runtime-media-generation-job-runner.ts'),
  baselineSdkSource('runtime/runtime-media-jobs.ts'),
  baselineSdkSource('runtime/runtime-media-request.ts'),
  baselineSdkSource('runtime/runtime-stream-codec.ts'),
  baselineSdkSource('runtime/runtime-artifacts.ts'),
  '.nimi/spec/sdks/kernel/runtime-agent-participation-contract.md',
  '.nimi/spec/sdks/kernel/tables/runtime-agent-participation-methods.yaml',
];

const VALID_DECISIONS = new Set(['retain-redesign', 'delete-hardcut', 'defer-blocking']);
const VALID_STATUSES = new Set(['implemented', 'pending', 'deferred', 'hardcut']);
const REQUIRED_FIELDS = [
  'id',
  'current_capability',
  'decision',
  'implementation_status',
  'vnext_owner',
  'required_binding',
];
const FORBIDDEN_VNEXT_EXPORTS = new Set([
  '@nimiplatform/sdk/ai-app',
  '@nimiplatform/sdk/scope',
  '@nimiplatform/sdk/scope/permission',
  '@nimiplatform/sdk/runtime/browser',
  '@nimiplatform/sdk/runtime/agent-identity',
]);

function strip(value) {
  return value.trim().replace(/^"|"$/g, '');
}

function parseList(chunk, key) {
  const match = chunk.match(new RegExp(`\\n    ${key}:\\n((?:      - .+\\n?)+)`));
  if (!match) {
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => strip(line.replace(/^- /, '')));
}

function parseScalar(chunk, key) {
  const match = chunk.match(new RegExp(`(?:^  - |\\n    )${key}:\\s*(.+)`));
  return match ? strip(match[1]) : '';
}

function parseCapabilities(raw) {
  const marker = '\nsurfaces:\n';
  const index = raw.indexOf(marker);
  if (index < 0) {
    throw new Error('ledger missing surfaces block');
  }
  return raw
    .slice(index + marker.length)
    .split(/\n(?=  - id: )/g)
    .map((chunk) => chunk.trimEnd())
    .filter(Boolean)
    .map((chunk) => {
      const normalized = chunk.startsWith('  - id: ') ? chunk : `  - id: ${chunk}`;
      return {
        id: parseScalar(normalized, 'id'),
        current_sources: parseList(normalized, 'current_sources'),
        current_capability: parseScalar(normalized, 'current_capability'),
        decision: parseScalar(normalized, 'decision'),
        implementation_status: parseScalar(normalized, 'implementation_status'),
        vnext_exports: parseList(normalized, 'vnext_exports'),
        vnext_owner: parseScalar(normalized, 'vnext_owner'),
        required_binding: parseScalar(normalized, 'required_binding'),
        hardcut_reason: parseScalar(normalized, 'hardcut_reason'),
        verification_gates: parseList(normalized, 'verification_gates'),
      };
    });
}

function fail(violations) {
  process.stderr.write('SDK vNext AI capability ledger check failed:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  process.exitCode = 1;
}

function main() {
  const violations = [];
  if (!existsSync(ledgerPath)) {
    throw new Error(`missing ledger: ${path.relative(repoRoot, ledgerPath)}`);
  }

  const raw = readFileSync(ledgerPath, 'utf8');
  const capabilities = parseCapabilities(raw);
  const vnextPackage = JSON.parse(readFileSync(vnextPackagePath, 'utf8'));
  const vnextExports = new Set(Object.keys(vnextPackage.exports ?? {}).map((key) => {
    if (key === '.') {
      return '@nimiplatform/sdk';
    }
    return `@nimiplatform/sdk/${key.replace(/^\.\//, '')}`;
  }));

  if (!raw.includes('protocol_id: sdks_typescript_ai_capability_ledger')) {
    violations.push('ledger must use protocol_id sdks_typescript_ai_capability_ledger');
  }
  if (capabilities.length === 0) {
    violations.push('ledger must contain at least one capability row');
  }

  const byId = new Map();
  const coveredSources = new Set();
  for (const capability of capabilities) {
    if (byId.has(capability.id)) {
      violations.push(`duplicate capability id: ${capability.id}`);
    }
    byId.set(capability.id, capability);

    for (const field of REQUIRED_FIELDS) {
      if (!capability[field]) {
        violations.push(`capability ${capability.id || '<missing-id>'} missing ${field}`);
      }
    }
    if (!VALID_DECISIONS.has(capability.decision)) {
      violations.push(`capability ${capability.id} has invalid decision ${capability.decision}`);
    }
    if (!VALID_STATUSES.has(capability.implementation_status)) {
      violations.push(`capability ${capability.id} has invalid implementation_status ${capability.implementation_status}`);
    }
    if (capability.current_sources.length === 0) {
      violations.push(`capability ${capability.id} must list current_sources`);
    }
    if (capability.verification_gates.length === 0) {
      violations.push(`capability ${capability.id} must list verification_gates`);
    }
    if (capability.verification_gates.includes('check:sdk-consumer-smoke')) {
      violations.push(`capability ${capability.id} must not use broad current SDK consumer smoke as AI capability replacement evidence`);
    }

    for (const source of capability.current_sources) {
      coveredSources.add(source);
      if (!existsSync(path.join(repoRoot, source))) {
        violations.push(`capability ${capability.id} current source does not exist: ${source}`);
      }
    }

    if (capability.decision === 'delete-hardcut' || capability.decision === 'defer-blocking') {
      if (!capability.hardcut_reason) {
        violations.push(`capability ${capability.id} must record hardcut_reason for ${capability.decision}`);
      }
    } else if (capability.hardcut_reason) {
      violations.push(`capability ${capability.id} must not carry hardcut_reason for retained capability`);
    }

    for (const exportName of capability.vnext_exports) {
      if (FORBIDDEN_VNEXT_EXPORTS.has(exportName)) {
        violations.push(`capability ${capability.id} uses forbidden legacy vNext export ${exportName}`);
      }
      if (exportName.startsWith('@nimiplatform/sdk/') && !vnextExports.has(exportName)) {
        violations.push(`capability ${capability.id} references package export not implemented by sdks/typescript: ${exportName}`);
      }
    }

    if (capability.implementation_status === 'implemented') {
      const owner = capability.vnext_owner.split(' + ')[0].trim();
      if (owner.startsWith('sdks/typescript/') && owner.endsWith('.ts') && !existsSync(path.join(repoRoot, owner))) {
        violations.push(`implemented capability ${capability.id} owner file missing: ${owner}`);
      }
    }
  }

  for (const source of REQUIRED_CURRENT_SOURCES) {
    if (!coveredSources.has(source)) {
      violations.push(`required AI capability baseline source is not covered by ledger: ${source}`);
    }
  }

  if (!byId.has('runtime-text-generate-stream')) {
    violations.push('ledger must include runtime-text-generate-stream capability');
  }
  if (!byId.has('ai-app-public-subpath')) {
    violations.push('ledger must include ai-app-public-subpath hardcut capability');
  }
  if (vnextExports.has('@nimiplatform/sdk/ai-app')) {
    violations.push('sdks/typescript package must not restore @nimiplatform/sdk/ai-app');
  }

  if (violations.length > 0) {
    fail(violations);
    return;
  }

  process.stdout.write(
    `SDK vNext AI capability ledger check passed (${capabilities.length} capability row(s), ${coveredSources.size} covered source(s))\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-ai-capability-ledger failed: ${message}\n`);
  process.exitCode = 1;
}
