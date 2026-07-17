import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { collectZhiyuLocalDevelopmentEntryViolations } from './check-zhiyu-local-development-entry.mjs';
import { collectLocalDevelopmentSupervisorParityViolations } from './check-local-development-supervisor-parity.mjs';
import {
  collectHarnessInputViolations,
  isProductSourcePath,
} from './check-local-development-harness-inputs.mjs';

test('G1 rejects a harness selector read added to product source', () => {
  assert.equal(isProductSourcePath('apps/example/src/main.ts'), true);
  assert.equal(isProductSourcePath('apps/example/test/main.test.ts'), false);
  const violations = collectHarnessInputViolations([{
    relativePath: 'apps/example/src/main.ts',
    source: 'const selector = process.env.NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID;',
  }]);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /outside the product allowlist/u);
});

test('G1 requires an allowlisted trial-root read to retain its same-file checkpoint gate', () => {
  const relativePath = 'apps/desktop/src-electron/dev-kernel-external-url-capture.ts';
  const unguarded = collectHarnessInputViolations([{
    relativePath,
    source: 'const trialRoot = process.env.NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT;',
  }]);
  assert.equal(unguarded.length, 1);
  assert.match(unguarded[0], /same-file checkpoint gate/u);

  const guarded = collectHarnessInputViolations([{
    relativePath,
    source: [
      "const checkpoint = process.env.NIMI_DEV_KERNEL_CHECKPOINT === '1';",
      'const trialRoot = process.env.NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT;',
    ].join('\n'),
  }]);
  assert.deepEqual(guarded, []);
});

async function zhiyuSources() {
  const files = {
    contract: '../apps/zhiyu/src-electron/local-development-contract.ts',
    main: '../apps/zhiyu/src-electron/main.ts',
    preload: '../apps/zhiyu/src-electron/preload.cts',
    app: '../apps/zhiyu/src/shell/app/App.tsx',
    inventory: '../apps/zhiyu/src/shell/agent/agent-inventory.ts',
    account: '../apps/zhiyu/src/shell/auth/runtime-account-status.ts',
    platform: '../apps/zhiyu/src/shell/local-development/local-app-runtime-platform.ts',
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [
    key, await readFile(new URL(relativePath, import.meta.url), 'utf8'),
  ])));
}

async function supervisorSources() {
  const files = {
    tsHost: '../apps/desktop/src-electron/local-development-host.ts',
    tsAuthoritySummary: '../apps/desktop/src-electron/local-development-authority-summary.ts',
    tsPlan: '../apps/desktop/src-electron/local-development-plan.ts',
    rustSupervisor: '../apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs',
    rustMod: '../apps/desktop/src-tauri/src/desktop_local_development/mod.rs',
    rustHttp: '../apps/desktop/src-tauri/src/desktop_local_development/http.rs',
    rustPlan: '../apps/desktop/src-tauri/src/desktop_local_development/plan.rs',
    rustDomain: '../apps/desktop/src-tauri/src/desktop_local_development/domain.rs',
    rustAuthoritySummary: '../apps/desktop/src-tauri/src/desktop_local_development/authority_summary.rs',
    doctor: './doctor-dev.mjs',
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [
    key, await readFile(new URL(relativePath, import.meta.url), 'utf8'),
  ])));
}

test('G2 rejects drift in the bounded local-app inventory contract', async () => {
  const sources = await zhiyuSources();
  assert.deepEqual(collectZhiyuLocalDevelopmentEntryViolations(sources), []);
  const drifted = {
    ...sources,
    inventory: sources.inventory.replace('zhiyuLocalAppRuntimePlatform.agent.listInventory()', 'Promise.resolve({})'),
  };
  assert.match(collectZhiyuLocalDevelopmentEntryViolations(drifted).join('\n'), /bounded SDK agent inventory/u);
});

test('G5 rejects one-sided supervisor timing or authority-summary drift', async () => {
  const sources = await supervisorSources();
  assert.deepEqual(collectLocalDevelopmentSupervisorParityViolations(sources), []);
  const drifted = {
    ...sources,
    rustSupervisor: sources.rustSupervisor.replace('Duration::from_millis(450)', 'Duration::from_millis(451)'),
  };
  assert.match(collectLocalDevelopmentSupervisorParityViolations(drifted).join('\n'), /450ms/u);

  const electronSummaryMissing = {
    ...sources,
    tsHost: sources.tsHost.replaceAll(
      'createDesktopElectronLocalDevelopmentProjectionPublisher',
      'missingElectronAuthoritySummaryPublisher',
    ),
  };
  assert.match(
    collectLocalDevelopmentSupervisorParityViolations(electronSummaryMissing).join('\n'),
    /authority summary publisher parity missing/u,
  );

  const electronSummaryPathDrifted = {
    ...sources,
    tsAuthoritySummary: sources.tsAuthoritySummary.replace(
      "'authority-summary.v1.json'",
      "'authority-summary.v2.json'",
    ),
  };
  assert.match(
    collectLocalDevelopmentSupervisorParityViolations(electronSummaryPathDrifted).join('\n'),
    /authority summary path parity missing/u,
  );
});
