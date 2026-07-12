import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import { withSdkDistLock } from '../../../scripts/lib/sdk-dist-lock.mjs';
import { withRuntimeDaemon } from '../../../sdks/typescript/runtime/live-runtime-daemon.test-helper.ts';
import { withRealmFixtureServer } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-server.test-helper.ts';
import {
  admitLocalFirstPartyRuntimeAccountCaller,
  completeRuntimeAccountLogin,
  createRuntimeForEndpoint,
  desktopAccountCaller,
  logoutRuntimeAccount,
  registerRuntimeApp,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  LOCAL_TEXT_MODEL_ID,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-shared.test-helper.ts';
import {
  seedRuntimeAgentLiveImageCatalogProvider,
  seedRuntimeAgentLiveLocalRouteState,
  seedRuntimeAgentLiveVoiceCatalogProvider,
} from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-routes.test-helper.ts';
import {
  assertNoPageProblems,
  captureLiveRuntimeEvidence,
  captureLiveRuntimeInteractionEvidence,
  createZhiyuLiveRuntimeAcceptanceRendererUrl,
  resetLiveRuntimeEvidenceRoot,
  trackPageProblems,
  waitForEvidence,
} from './electron-live-runtime-acceptance-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const zhiyuAppId = 'nimi.zhiyu';
const evidenceCheckpoint = 'live-runtime-empty-local-partner';
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.autonomy.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
  'ai.spend.meter',
];

test('zhiyu Electron live Runtime empty LocalAgent inventory renders an empty rail and explore guidance', { timeout: 180_000 }, async () => {
  const previousCheckpoint = process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT;
  process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT = evidenceCheckpoint;
  try {
    await resetLiveRuntimeEvidenceRoot();
    await withEmptyLocalAgentRuntime(async ({ endpoint }) => {
      await withTempDir('empty-local-partner', async (tmpRoot) => {
        const dataRoot = path.join(tmpRoot, 'data');
        await mkdir(dataRoot, { recursive: true });

        await withSdkDistLock('zhiyu empty local partner electron app', async () => {
          const app = await electron.launch({
            args: [mainEntry, `--user-data-dir=${path.join(dataRoot, 'electron-user-data')}`],
            env: {
              ...process.env,
              NIMI_RUNTIME_GRPC_ADDR: '',
              NIMI_ZHIYU_ELECTRON_RENDERER_URL: createZhiyuLiveRuntimeAcceptanceRendererUrl(root),
              NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: endpoint,
              NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
            },
          });

          try {
            const page = await app.firstWindow({ timeout: 120_000 });
            const pageProblems = trackPageProblems(page);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
            await page.waitForSelector('[data-zhiyu-screen="home"]');
            await waitForEvidence(page, () =>
              globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
              && globalThis.window.__nimiZhiyuEvidence?.auth?.ready === true
              && globalThis.window.__nimiZhiyuEvidence?.inventory?.ready === true
              && globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 0
              && Array.isArray(globalThis.window.__nimiZhiyuEvidence?.inventory?.localAgents)
              && globalThis.window.__nimiZhiyuEvidence.inventory.localAgents.length === 0
              && globalThis.window.__nimiZhiyuEvidence?.localAgent?.ready === false,
            'empty LocalAgent inventory runtime evidence');

            const emptyLocalPartnerEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
            assert.equal(emptyLocalPartnerEvidence.auth.ready, true);
            assert.equal(emptyLocalPartnerEvidence.runtime.ready, true);
            assert.equal(emptyLocalPartnerEvidence.inventory.ready, true);
            assert.equal(emptyLocalPartnerEvidence.inventory.count, 0);
            assert.deepEqual(emptyLocalPartnerEvidence.inventory.localAgents, []);
            assert.equal(emptyLocalPartnerEvidence.localAgent.localAgentRef, null);
            assert.equal(emptyLocalPartnerEvidence.localAgent.ready, false);
            assert.equal(await page.locator('[data-zhiyu-local-agent-candidate="true"]').count(), 0);
            assert.equal(await page.locator('[data-zhiyu-relationship-rail-empty]').getAttribute('data-zhiyu-relationship-rail-empty'), 'true');
            assert.equal(await page.locator('[data-zhiyu-relationship-rail-state]').getAttribute('data-zhiyu-relationship-rail-state'), 'empty');
            assert.equal(await page.locator('[data-zhiyu-no-local-partner-empty="true"]').count(), 1);

            const shellText = await page.locator('[data-zhiyu-product-shell="workspace"]').innerText();
            assert.match(shellText, /还没有本地伙伴/);
            assert.match(shellText, /从世界中选择一位角色加入本地后，就可以和他开始对话/);
            assert.match(shellText, /去探索伙伴/);
            assert.match(shellText, /本地伙伴会保留角色来源与身份设定/);
            assert.doesNotMatch(shellText, /添加本地伙伴后开始聊天。/);
            assert.doesNotMatch(shellText, /请选择已存在的本地伙伴/);
            assert.doesNotMatch(shellText, /你还没有添加可对话的本地伙伴/);
            assert.doesNotMatch(shellText, /Runtime Live Source|LocalAgent|sourceRef|localAgentRef|Capability Studio|Image Studio/);

            const action = page.locator('[data-zhiyu-no-local-partner-action="desktop-open-select-partner"]').first();
            await action.waitFor({ state: 'visible', timeout: 15_000 });
            assert.equal(await action.isDisabled(), false);
            assert.equal(await action.getAttribute('aria-expanded'), 'false');
            assert.equal(await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled'), 'false');
            assert.equal(await page.locator('[data-chat-composer-send="true"]').isDisabled(), true);
            assert.equal(await page.locator('[data-chat-composer-textarea="true"]').getAttribute('placeholder'), '添加本地伙伴后开始聊天...');

            await captureLiveRuntimeEvidence(page, 'noPartner', pageProblems, {
              emptyLocalPartnerEvidence,
            });

            await action.click();
            assert.equal(await action.getAttribute('aria-expanded'), 'true');
            assert.match(
              await page.locator('[data-zhiyu-no-local-partner-guidance="desktop-explore"]').innerText(),
              /Desktop Explore|Nimi Desktop|Desktop Open|桌面端「探索」/,
            );
            await captureLiveRuntimeInteractionEvidence(page, 'empty-local-partner-guidance', pageProblems, {
              emptyLocalPartnerEvidence,
            });
            assertNoPageProblems(pageProblems);
          } finally {
            await app.close();
          }
        });
      });
    });
  } finally {
    if (previousCheckpoint === undefined) {
      delete process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT;
    } else {
      process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT = previousCheckpoint;
    }
  }
});

async function withEmptyLocalAgentRuntime(run) {
  await withRealmFixtureServer({
    run: async ({ baseUrl }) => {
      await withRuntimeDaemon({
        appId: DESKTOP_APP_ID,
        runtimeEnv: {
          NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL: baseUrl,
          NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL: `${baseUrl}/api/auth/oauth/authorize`,
          NIMI_RUNTIME_ACCOUNT_TOKEN_URL: `${baseUrl}/api/auth/oauth/token`,
          NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION: `zhiyu-empty-local-partner-${randomUUID()}`,
          NIMI_RUNTIME_APP_REGISTRY_PATH: path.join(repoRoot, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-app-registry.yaml'),
          NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL: LOCAL_TEXT_MODEL_ID,
          NIMI_RUNTIME_ENGINE_LLAMA_ENABLED: '0',
          NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: `${baseUrl}/v1`,
          NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT: '1',
        },
        prepareState: ({ localStatePath, stateRoot }) => {
          const catalogCustomDir = path.join(stateRoot, 'model-catalog-custom');
          seedRuntimeAgentLiveLocalRouteState(localStatePath, `${baseUrl}/v1`);
          seedRuntimeAgentLiveImageCatalogProvider(catalogCustomDir);
          seedRuntimeAgentLiveVoiceCatalogProvider(catalogCustomDir);
        },
        run: async ({ endpoint }) => {
          const runtime = createRuntimeForEndpoint(endpoint, DESKTOP_APP_ID);
          const desktopCaller = desktopAccountCaller();
          await registerRuntimeApp(runtime, DESKTOP_APP_ID, DESKTOP_APP_INSTANCE_ID, DESKTOP_DEVICE_ID);
          await completeRuntimeAccountLogin(runtime, desktopCaller);
          await admitLocalFirstPartyRuntimeAccountCaller(
            createRuntimeForEndpoint(endpoint, zhiyuAppId),
            {
              appId: zhiyuAppId,
              appInstanceId: `${zhiyuAppId}.local-first-party`,
              deviceId: 'nimi-zhiyu-local-first-party-device',
              capabilities: zhiyuRuntimeProtectedScopes,
            },
          );
          try {
            await run({ endpoint });
          } finally {
            await logoutRuntimeAccount(runtime, desktopCaller);
          }
        },
      });
    },
  });
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
