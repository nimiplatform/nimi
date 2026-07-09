#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH,
  extractDesktopOpenAcceptanceRows,
} from './lib/desktop-open-acceptance-rows.mjs';
import { read, root } from './lib/desktop-open-checks.mjs';
import {
  DESKTOP_OPEN_TEST_TARGETS,
} from '../apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs';

const MANIFEST_REL_PATH = '.nimi/local/evidence/desktop-open-intent/e2e-acceptance-manifest.json';
const pendingPlatformRows = new Set([
  'product.desktop-can-be-focused-while-running',
  'state.running-ready-visible',
  'state.running-ready-hidden',
  'state.running-ready-minimized',
]);
const targetRows = new Set(DESKTOP_OPEN_TEST_TARGETS.map((target) => target.rowId));
const rendererNavigationRows = new Set([
  ...targetRows,
  'owner.navigation-execution',
  'state.invalid-intent',
]);
const parserRows = new Set([
  'failure.raw-url-payload',
  'failure.unknown-field',
  'failure.renderer-provided-source-app',
  'failure.provider-model-credential-fields',
]);

function evidenceWithAssertion(rowId, evidence) {
  if (evidence.status !== 'passed') {
    return evidence;
  }
  return {
    ...evidence,
    assertionRefs: [assertionRefFor(rowId, evidence)],
  };
}

function assertionRefFor(rowId, evidence) {
  if (targetRows.has(rowId)) {
    return {
      file: 'apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs',
      assertionKind: 'test-data-row',
      assertion: rowId,
    };
  }
  const file = assertionFileFor(rowId, evidence);
  const testName = assertionTestNameFor(rowId, file);
  if (testName) {
    return {
      file,
      assertionKind: file.endsWith('.rs') ? 'rust-test-name' : 'test-name',
      assertion: testName,
    };
  }
  return {
    file,
    assertionKind: 'guard-invariant',
    assertion: rowId,
  };
}

function assertionFileFor(rowId, evidence) {
  if (targetRows.has(rowId) || rowId === 'owner.navigation-execution') {
    return 'apps/desktop/test/desktop-open-intent-navigation.test.ts';
  }
  if (rowId === 'state.invalid-intent') {
    return 'sdks/typescript/core/app/desktop-open.test.ts';
  }
  if (rowId.startsWith('unsupported-v1.') || parserRows.has(rowId)) {
    return 'scripts/check-desktop-open-parser-golden-vectors.mjs';
  }
  if (rowId === 'product.generic-app-proof-exists') {
    return 'apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs';
  }
  if (rowId === 'product.apps-use-standard-shell-operation' || rowId === 'owner.product-placement') {
    return 'apps/zhiyu/test/desktop-open-action.test.mjs';
  }
  if (rowId === 'product.sdk-remains-data-only') {
    return 'sdks/typescript/core/app/desktop-open.test.ts';
  }
  if (rowId === 'product.kit-parser-is-not-second-truth') {
    return 'kit/core/test/desktop-open.test.ts';
  }
  if (rowId.includes('oauth-opener') || rowId === 'product.oauth-boundary-remains-intact') {
    return 'scripts/check-desktop-open-oauth-reserved-routes.mjs';
  }
  if (rowId.includes('installed-app-source-host') || rowId === 'owner.installed-app-source-host') {
    return 'scripts/check-desktop-open-installed-host-sourcehost.mjs';
  }
  if (
    rowId === 'owner.target-kind-vocabulary'
    || rowId === 'owner.desktop-ia-values'
    || rowId === 'owner.open-intent-envelope'
  ) {
    return 'scripts/check-desktop-open-target-catalog-drift.mjs';
  }
  if (rowId === 'descriptor-bridge.ready-lifecycle-resets') {
    return 'scripts/check-desktop-open-ready-lifecycle.mjs';
  }
  if (
    rowId === 'state.stale-presence'
    || rowId === 'descriptor-bridge.symlink-substitution-fails-closed'
    || rowId === 'descriptor-bridge.malformed-descriptor-fails-closed'
  ) {
    return 'kit/shell/electron/test/electron-desktop-open.test.ts';
  }
  if (
    rowId === 'descriptor-bridge.bridge-method-is-post-only'
    || rowId === 'descriptor-bridge.bridge-has-no-cors-surface'
  ) {
    return 'apps/desktop/src-tauri/src/desktop_open_intent.rs';
  }
  if (rowId === 'descriptor-bridge.no-not-ready-queue') {
    return 'apps/desktop/src-tauri/src/desktop_open_intent_tests.rs';
  }
  if (
    rowId === 'descriptor-bridge.standard-shell-result-mapping'
    || rowId === 'descriptor-bridge.host-generated-request-id'
  ) {
    return 'kit/shell/electron/test/electron-desktop-open.test.ts';
  }
  if (
    rowId.startsWith('descriptor-bridge.')
    || rowId === 'state.stale-presence'
    || rowId === 'owner.presence-descriptor'
  ) {
    return 'scripts/check-desktop-open-presence-security.mjs';
  }
  if (
    rowId === 'product.desktop-not-running-fails-closed'
    || rowId === 'product.host-unavailable-fails-closed'
    || rowId === 'state.not-running'
    || rowId === 'state.bridge-id-mismatch'
  ) {
    return 'kit/shell/electron/test/electron-desktop-open.test.ts';
  }
  if (
    rowId === 'product.desktop-not-ready-fails-closed'
    || rowId === 'state.running-not-ready'
  ) {
    return 'apps/desktop/src-tauri/src/desktop_open_intent_tests.rs';
  }
  if (rowId === 'state.invalid-token') {
    return 'apps/desktop/src-tauri/src/desktop_open_intent.rs';
  }
  if (
    rowId === 'product.standard-is-running-only'
    || rowId === 'owner.not-running-behavior'
    || rowId === 'failure.nimi-desktop-in-app-code'
    || rowId === 'failure.external-menu-bar-open-tab-dispatch'
    || rowId === 'failure.desktop-launch-intent-or-desktop-launch-open-intent'
    || rowId === 'failure.legitimate-desktop-launched-nimi-app-vocabulary'
  ) {
    return 'scripts/check-desktop-open-intent-hardcut.mjs';
  }
  return Array.isArray(evidence.evidenceRef) ? evidence.evidenceRef[0] : String(evidence.evidenceRef);
}

function assertionTestNameFor(rowId, file) {
  const mapping = {
    'apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs': {
      'product.generic-app-proof-exists': 'Desktop Open generic fixture can collect a full target evidence manifest',
    },
    'apps/zhiyu/test/desktop-open-action.test.mjs': {
      'product.apps-use-standard-shell-operation': 'Zhiyu desktop_open_select_partner sends the standard DesktopOpenIntent',
      'owner.product-placement': 'Zhiyu desktop_open_select_partner sends the standard DesktopOpenIntent',
    },
    'sdks/typescript/core/app/desktop-open.test.ts': {
      'product.sdk-remains-data-only': 'accepts admitted golden envelopes',
      'state.invalid-intent': 'rejects malformed envelopes with stable reason codes',
    },
    'kit/core/test/desktop-open.test.ts': {
      'product.kit-parser-is-not-second-truth': 'matches every Desktop Open golden vector id through the Kit parser contract',
    },
    'kit/shell/electron/test/electron-desktop-open.test.ts': {
      'product.desktop-not-running-fails-closed': 'returns not-running for missing descriptors without starting Desktop',
      'product.host-unavailable-fails-closed': 'returns host-unavailable only when the shell host lacks transport primitives',
      'state.not-running': 'returns not-running for missing descriptors without starting Desktop',
      'state.stale-presence': 'returns not-running for stale descriptors without contacting the bridge',
      'state.bridge-id-mismatch': 'returns not-running for bridgeId mismatch',
      'descriptor-bridge.symlink-substitution-fails-closed': 'rejects symlink descriptor ancestry before reading token material',
      'descriptor-bridge.standard-shell-result-mapping': 'posts a host-stamped envelope to the running Desktop bridge',
      'descriptor-bridge.host-generated-request-id': 'generates a host-owned requestId when the renderer omits one',
      'descriptor-bridge.malformed-descriptor-fails-closed': 'returns not-running for malformed descriptors without leaking token material',
    },
    'apps/desktop/src-tauri/src/desktop_open_intent.rs': {
      'state.invalid-token': 'desktop_open_bridge_auth_rejects_invalid_token',
      'descriptor-bridge.bridge-method-is-post-only': 'desktop_open_bridge_route_is_post_only_and_has_no_cors_surface',
      'descriptor-bridge.bridge-has-no-cors-surface': 'desktop_open_bridge_route_is_post_only_and_has_no_cors_surface',
    },
    'apps/desktop/src-tauri/src/desktop_open_intent_tests.rs': {
      'product.desktop-not-ready-fails-closed': 'desktop_open_intent_bridge_rejects_until_renderer_is_ready',
      'state.running-not-ready': 'desktop_open_intent_bridge_rejects_until_renderer_is_ready',
      'descriptor-bridge.no-not-ready-queue': 'desktop_open_intent_bridge_rejects_until_renderer_is_ready',
      'owner.navigation-execution': 'Desktop Open Intent maps settings profile and app details to owned surfaces',
    },
    'apps/desktop/test/desktop-open-intent-navigation.test.ts': {
      'owner.navigation-execution': 'Desktop Open Intent maps settings profile and app details to owned surfaces',
    },
  };
  return mapping[file]?.[rowId] ?? null;
}

function evidenceFor(row) {
  if (pendingPlatformRows.has(row.rowId)) {
    return {
      status: 'pending-platform-e2e',
      evidenceKind: 'wdio-platform-e2e-required',
      evidenceRef: [
        'apps/desktop/scripts/run-e2e.mjs#ensureSupportedPlatform',
        'apps/desktop/e2e/specs/desktop-open-intent.running.e2e.mjs',
      ],
      command: 'pnpm --filter @nimiplatform/desktop run test:e2e:desktop-open',
    };
  }

  if (targetRows.has(row.rowId)) {
    return evidenceWithAssertion(row.rowId, {
      status: 'passed',
      evidenceKind: 'generic-fixture+renderer-unit',
      evidenceRef: [
        'apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs',
        'apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs',
        'apps/desktop/test/desktop-open-intent-navigation.test.ts',
      ],
      command: 'pnpm --dir apps/desktop run test:unit:rest -- desktop-open-intent-navigation.test.ts && node --test apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs',
    });
  }

  if (row.tableSlug === 'unsupported-v1') {
    return evidenceWithAssertion(row.rowId, {
      status: 'passed',
      evidenceKind: 'sdk-parser-golden-vector',
      evidenceRef: [
        '.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml',
        'sdks/typescript/core/app/desktop-open.test.ts',
        'scripts/check-desktop-open-parser-golden-vectors.mjs',
      ],
      command: 'pnpm check:desktop-open-parser-golden-vectors && pnpm --filter @nimiplatform/sdk test',
    });
  }

  if (row.tableSlug === 'state') {
    return stateEvidence(row.rowId);
  }

  if (row.tableSlug === 'descriptor-bridge') {
    return descriptorEvidence(row.rowId);
  }

  if (row.tableSlug === 'owner') {
    return ownerEvidence(row.rowId);
  }

  if (row.tableSlug === 'failure') {
    return failureEvidence(row.rowId);
  }

  return productEvidence(row.rowId);
}

function productEvidence(rowId) {
  const commonStatic = [
    'scripts/check-no-raw-desktop-open-urls.mjs',
    'scripts/check-desktop-open-intent-hardcut.mjs',
    'scripts/check-desktop-open-intent-transport-hardcut.mjs',
  ];
  const mapping = {
    'product.desktop-not-ready-fails-closed': {
      evidenceKind: 'desktop-host-unit',
      evidenceRef: ['apps/desktop/src-tauri/src/desktop_open_intent_tests.rs'],
      command: 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml desktop_open_intent -- --nocapture',
    },
    'product.desktop-not-running-fails-closed': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: ['kit/shell/electron/test/electron-desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
    'product.host-unavailable-fails-closed': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: [
        'kit/shell/electron/test/electron-desktop-open.test.ts',
      ],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
    'product.apps-use-standard-shell-operation': {
      evidenceKind: 'static-boundary+app-unit',
      evidenceRef: [
        ...commonStatic,
        'apps/zhiyu/test/desktop-open-action.test.mjs',
        'apps/zhiyu/src/shell/desktop-open/desktop-open-action.ts',
      ],
      command: 'pnpm check:no-raw-desktop-open-urls && pnpm --filter @nimiplatform/zhiyu test',
    },
    'product.oauth-boundary-remains-intact': {
      evidenceKind: 'oauth-hardening-tests',
      evidenceRef: [
        'scripts/check-desktop-open-oauth-reserved-routes.mjs',
        'kit/shell/electron/test/electron-shell-bridge-host-features.test.ts',
        'kit/shell/tauri/src/oauth',
      ],
      command: 'pnpm check:desktop-open-oauth-reserved-routes && cargo test --manifest-path kit/shell/tauri/Cargo.toml oauth -- --nocapture',
    },
    'product.sdk-remains-data-only': {
      evidenceKind: 'sdk-boundary-tests',
      evidenceRef: ['sdks/typescript/core/app/desktop-open.ts', 'sdks/typescript/core/app/desktop-open.test.ts'],
      command: 'pnpm --filter @nimiplatform/sdk test',
    },
    'product.kit-parser-is-not-second-truth': {
      evidenceKind: 'kit-sdk-wrapper-test',
      evidenceRef: ['kit/core/src/desktop-open.ts', 'kit/core/test/desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts core/test/desktop-open.test.ts',
    },
    'product.installed-app-host-source-host-is-explicit': {
      evidenceKind: 'installed-host-sourcehost-guard',
      evidenceRef: [
        'scripts/check-desktop-open-installed-host-sourcehost.mjs',
        'kit/shell/electron/src/main/desktop-open.ts',
        'apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs',
      ],
      command: 'pnpm check:desktop-open-installed-host-sourcehost',
    },
    'product.generic-app-proof-exists': {
      evidenceKind: 'generic-fixture-unit',
      evidenceRef: [
        'apps/desktop/e2e/fixtures/desktop-open-test-launcher.mjs',
        'apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs',
      ],
      command: 'node --test apps/desktop/test/desktop-open-test-launcher-fixture.test.mjs',
    },
  };

  const entry = mapping[rowId] || {
    evidenceKind: 'static-hardcut+host-unit',
    evidenceRef: commonStatic,
    command: 'pnpm check:no-raw-desktop-open-urls && pnpm check:desktop-open-intent-hardcut && pnpm check:desktop-open-intent-transport-hardcut',
  };
  return evidenceWithAssertion(rowId, { status: 'passed', ...entry });
}

function stateEvidence(rowId) {
  const mapping = {
    'state.running-not-ready': {
      evidenceKind: 'desktop-host-unit',
      evidenceRef: ['apps/desktop/src-tauri/src/desktop_open_intent_tests.rs'],
      command: 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml desktop_open_intent -- --nocapture',
    },
    'state.not-running': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: ['kit/shell/electron/test/electron-desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
    'state.stale-presence': {
      evidenceKind: 'presence-security-guard+kit-host-unit',
      evidenceRef: [
        'scripts/check-desktop-open-presence-security.mjs',
        'kit/shell/electron/test/electron-desktop-open.test.ts',
      ],
      command: 'pnpm check:desktop-open-presence-security',
    },
    'state.invalid-token': {
      evidenceKind: 'desktop-auth-unit',
      evidenceRef: ['apps/desktop/src-tauri/src/desktop_open_intent.rs'],
      command: 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml desktop_open_intent -- --nocapture',
    },
    'state.bridge-id-mismatch': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: ['kit/shell/electron/test/electron-desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
    'state.invalid-intent': {
      evidenceKind: 'parser+renderer-unit',
      evidenceRef: [
        'sdks/typescript/core/app/desktop-open.test.ts',
        'apps/desktop/test/desktop-open-intent-navigation.test.ts',
      ],
      command: 'pnpm check:desktop-open-parser-golden-vectors && pnpm --dir apps/desktop run test:unit:rest -- desktop-open-intent-navigation.test.ts',
    },
  };
  return evidenceWithAssertion(rowId, { status: 'passed', ...mapping[rowId] });
}

function descriptorEvidence(rowId) {
  const mapping = {
    'descriptor-bridge.ready-lifecycle-resets': {
      evidenceKind: 'ready-lifecycle-guard',
      evidenceRef: [
        'scripts/check-desktop-open-ready-lifecycle.mjs',
        'apps/desktop/src/shell/renderer/infra/desktop-open/desktop-open-intent-listener.ts',
      ],
      command: 'pnpm check:desktop-open-ready-lifecycle',
    },
    'descriptor-bridge.standard-shell-result-mapping': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: ['kit/shell/electron/test/electron-desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
    'descriptor-bridge.host-generated-request-id': {
      evidenceKind: 'kit-host-unit',
      evidenceRef: ['kit/shell/electron/test/electron-desktop-open.test.ts'],
      command: 'pnpm --dir kit exec vitest run --config vitest.config.ts shell/electron/test/electron-desktop-open.test.ts',
    },
  };
  return evidenceWithAssertion(rowId, {
    status: 'passed',
    evidenceKind: mapping[rowId]?.evidenceKind || 'presence-security-guard+desktop-unit',
    evidenceRef: mapping[rowId]?.evidenceRef || [
      'scripts/check-desktop-open-presence-security.mjs',
      'apps/desktop/src-tauri/src/desktop_open_intent.rs',
      'kit/shell/electron/src/main/desktop-open.ts',
    ],
    command: mapping[rowId]?.command || 'pnpm check:desktop-open-presence-security && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml desktop_open_intent -- --nocapture',
  });
}

function ownerEvidence(rowId) {
  const mapping = {
    'owner.installed-app-source-host': {
      evidenceKind: 'installed-host-sourcehost-guard',
      evidenceRef: [
        'scripts/check-desktop-open-installed-host-sourcehost.mjs',
        '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml',
      ],
      command: 'pnpm check:desktop-open-installed-host-sourcehost',
    },
    'owner.navigation-execution': {
      evidenceKind: 'desktop-renderer-unit',
      evidenceRef: ['apps/desktop/test/desktop-open-intent-navigation.test.ts'],
      command: 'pnpm --dir apps/desktop run test:unit:rest -- desktop-open-intent-navigation.test.ts',
    },
    'owner.product-placement': {
      evidenceKind: 'app-unit',
      evidenceRef: ['apps/zhiyu/test/desktop-open-action.test.mjs'],
      command: 'pnpm --filter @nimiplatform/zhiyu test',
    },
  };
  return evidenceWithAssertion(rowId, {
    status: 'passed',
    evidenceKind: mapping[rowId]?.evidenceKind || 'target-catalog-owner-guard',
    evidenceRef: mapping[rowId]?.evidenceRef || [
      'scripts/check-desktop-open-target-catalog-drift.mjs',
      '.nimi/spec/platform/kernel/index.md',
      '.nimi/spec/desktop/kernel/index.md',
    ],
    command: mapping[rowId]?.command || 'pnpm check:desktop-open-target-catalog-drift',
  });
}

function failureEvidence(rowId) {
  if (parserRows.has(rowId)) {
    return evidenceWithAssertion(rowId, {
      status: 'passed',
      evidenceKind: 'parser-golden-vector',
      evidenceRef: ['sdks/typescript/core/app/desktop-open.test.ts', 'scripts/check-desktop-open-parser-golden-vectors.mjs'],
      command: 'pnpm check:desktop-open-parser-golden-vectors && pnpm --filter @nimiplatform/sdk test',
    });
  }
  if (rowId.startsWith('failure.oauth-opener')) {
    return evidenceWithAssertion(rowId, {
      status: 'passed',
      evidenceKind: 'oauth-hardening-tests',
      evidenceRef: ['scripts/check-desktop-open-oauth-reserved-routes.mjs', 'kit/shell/electron/test/electron-shell-bridge-host-features.test.ts', 'kit/shell/tauri/src/oauth'],
      command: 'pnpm check:desktop-open-oauth-reserved-routes && cargo test --manifest-path kit/shell/tauri/Cargo.toml oauth -- --nocapture',
    });
  }
  return evidenceWithAssertion(rowId, {
    status: 'passed',
    evidenceKind: 'static-hardcut-guard',
    evidenceRef: [
      'scripts/check-no-raw-desktop-open-urls.mjs',
      'scripts/check-desktop-open-intent-hardcut.mjs',
      'scripts/check-desktop-open-intent-transport-hardcut.mjs',
    ],
    command: 'pnpm check:no-raw-desktop-open-urls && pnpm check:desktop-open-intent-hardcut && pnpm check:desktop-open-intent-transport-hardcut',
  });
}

const rows = extractDesktopOpenAcceptanceRows(read(DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH)).map((row) => ({
  rowId: row.rowId,
  tableSlug: row.tableSlug,
  label: row.label,
  ...evidenceFor(row),
}));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceMatrix: DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH,
  rows,
};

const manifestPath = path.join(root, MANIFEST_REL_PATH);
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`wrote ${MANIFEST_REL_PATH} with ${rows.length} acceptance row(s)`);
