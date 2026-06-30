import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_IDS } from '../helpers/selectors.mjs';
import { assertScenario, clickByTestId, waitForTestId } from '../helpers/app.mjs';
import { PLATFORM_FIXTURE_APP_ID } from '../helpers/nimi-app-platform.mjs';

const ACCOUNT_ONLY_APP_ID = 'community.nimi.fixture.account-only';

describe('nimi-app-platform.negative.lifecycle', () => {
  it('fails closed at the scenario-specific lifecycle boundary', async () => {
    const scenario = process.env.NIMI_E2E_SCENARIO || '';
    assertScenario(scenario);
    await waitForTestId(E2E_IDS.mainShell);
    await clickByTestId(E2E_IDS.navTab('apps'));
    await waitForTestId(E2E_IDS.panel('apps'));

    if (scenario === 'nimi-app-platform.negative.digest-mismatch') {
      await expectCard(PLATFORM_FIXTURE_APP_ID, {
        ordinaryVisibility: 'developer-only',
        ordinaryCatalogDiscovery: 'false',
        installState: 'installed',
        openReadiness: 'repair-required',
      });
      assert.equal(await $(`[data-testid="apps-action-${PLATFORM_FIXTURE_APP_ID}-repair"]`).isExisting(), true);
      assert.equal(await $(`[data-testid="apps-action-${PLATFORM_FIXTURE_APP_ID}-open"]`).isExisting(), false);
      await expectDetail(PLATFORM_FIXTURE_APP_ID, /Digest mismatch fixture/);
      return;
    }

    if (scenario === 'nimi-app-platform.negative.permission-pending') {
      await expectCard(PLATFORM_FIXTURE_APP_ID, {
        ordinaryVisibility: 'developer-only',
        ordinaryCatalogDiscovery: 'false',
        installState: 'installed',
        openReadiness: 'ready',
      });
      assert.equal(await $(`[data-testid="apps-action-${PLATFORM_FIXTURE_APP_ID}-open"]`).isExisting(), true);
      await expectDetail(PLATFORM_FIXTURE_APP_ID, /Permission pending fixture/);
      await seedAppScopeAIConfig(PLATFORM_FIXTURE_APP_ID);
      await clickByTestId(`apps-action-${PLATFORM_FIXTURE_APP_ID}-open`);
      await expectOpenAppProjectionLog([
        /runtime_app_fixture openAppProjection app_id=community\.nimi\.fixture\.platform-proof/,
        /state=APP_OPEN_STATE_BLOCKED/,
        /reached_step=APP_OPEN_FLOW_STEP_VERIFY_PERMISSIONS/,
        /launched=false/,
        /reason_code=APP_OPEN_PERMISSION_NOT_GRANTED/,
      ]);
      return;
    }

    if (scenario === 'nimi-app-platform.negative.account-only') {
      await expectCard(ACCOUNT_ONLY_APP_ID, {
        ordinaryVisibility: 'absent',
        ordinaryCatalogDiscovery: 'false',
        installState: 'not-installed',
        openReadiness: 'install-required',
      });
      await expectSourceStatus(ACCOUNT_ONLY_APP_ID, 'catalog', 'absent');
      await expectSourceStatus(ACCOUNT_ONLY_APP_ID, 'account', 'present');
      await expectSourceStatus(ACCOUNT_ONLY_APP_ID, 'local', 'absent');
      assert.equal(await $(`[data-testid="apps-action-${ACCOUNT_ONLY_APP_ID}-connect_local"]`).isExisting(), true);
      assert.equal(await $(`[data-testid="apps-action-${ACCOUNT_ONLY_APP_ID}-install"]`).isExisting(), false);
      assert.equal(await $(`[data-testid="apps-entry-${PLATFORM_FIXTURE_APP_ID}"]`).isExisting(), false);
      return;
    }

    throw new Error(`unhandled Nimi App Platform negative scenario: ${scenario}`);
  });
});

async function expectCard(appId, expected) {
  await browser.waitUntil(async () => {
    const card = await $(`[data-testid="apps-entry-${appId}"]`);
    return (await card.isExisting())
      && (await card.getAttribute('data-ordinary-visibility')) === expected.ordinaryVisibility
      && (await card.getAttribute('data-ordinary-catalog-discovery')) === expected.ordinaryCatalogDiscovery
      && (await card.getAttribute('data-install-state')) === expected.installState
      && (await card.getAttribute('data-open-readiness')) === expected.openReadiness;
  }, {
    timeout: 15_000,
    timeoutMsg: `expected ${appId} card projection ${JSON.stringify(expected)}`,
  });
}

async function expectSourceStatus(appId, source, expected) {
  const chip = await waitForTestId(`apps-entry-${appId}-source-${source}`);
  assert.equal(await chip.getAttribute('data-source-status'), expected);
}

async function expectDetail(appId, pattern) {
  const detail = await waitForTestId(`apps-entry-${appId}-detail`);
  assert.match(await detail.getText(), pattern);
}

async function expectOpenAppProjectionLog(patterns) {
  const artifactsDir = String(process.env.NIMI_E2E_ARTIFACT_DIR || '').trim();
  assert.ok(artifactsDir, 'NIMI_E2E_ARTIFACT_DIR is required for backend log assertions');
  const backendLogPath = path.join(artifactsDir, 'backend.log');
  await browser.waitUntil(async () => {
    const log = await readFile(backendLogPath, 'utf8').catch(() => '');
    return patterns.every((pattern) => pattern.test(log));
  }, {
    timeout: 15_000,
    timeoutMsg: `expected Runtime OpenApp blocked projection in ${backendLogPath}`,
  });
}

async function seedAppScopeAIConfig(appId) {
  await browser.execute((targetAppId) => {
    const scopeKey = ['app', targetAppId, ''].map(encodeURIComponent).join(':');
    const indexKey = 'nimi.ai-config.scope-index.v2';
    const configKey = `nimi.ai-config.scope.${scopeKey}.v2`;
    const existingIndex = (() => {
      try {
        const parsed = JSON.parse(globalThis.localStorage.getItem(indexKey) || '[]');
        return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
      } catch {
        return [];
      }
    })();
    globalThis.localStorage.setItem(indexKey, JSON.stringify([...new Set([...existingIndex, scopeKey])]));
    globalThis.localStorage.setItem(configKey, JSON.stringify({
      scopeRef: { kind: 'app', ownerId: targetAppId },
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            readinessRef: 'readiness:e2e-app-platform:text',
          },
        },
        selectedParams: {},
      },
      profileOrigin: {
        profileId: 'local-standard',
        title: 'E2E app-scope AIConfig',
        appliedAt: '2026-06-30T00:00:00.000Z',
      },
    }));
  }, appId);
}
