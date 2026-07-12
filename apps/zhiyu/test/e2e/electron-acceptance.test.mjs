import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = withAcceptanceQuery(pathToFileURL(path.join(root, 'dist', 'index.html')).toString());

test('zhiyu Electron host boots sandboxed renderer and fails closed without Runtime', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
    const dataRoot = path.join(tmpRoot, 'data');
    const nestedLive2dSource = await writeNestedLive2dSource(tmpRoot);
    await mkdir(dataRoot, { recursive: true });

    const app = await electron.launch({
      args: [mainEntry],
      env: {
        ...process.env,
        NIMI_RUNTIME_GRPC_ADDR: '',
        NIMI_ZHIYU_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
        NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
        NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
        NIMI_ZHIYU_ELECTRON_TEST_FILE_DIALOG_PATHS: nestedLive2dSource,
      },
    });

    try {
      const page = await app.firstWindow();
      const pageProblems = trackPageProblems(page);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
      {
        await page.waitForSelector('.runtime-unavailable-screen');
        await assertVisibleText(page, '织羽 Zhiyu');
        await assertVisibleText(page, '本地运行服务暂未连接');
        await assertNativeEditMenu(app);
        await assertNativeCopyShortcut(app, page);
        await assertVisibleText(page, '重新检查本地服务');
        const unavailableText = await page.locator('.runtime-unavailable-screen').innerText();
        assert.doesNotMatch(unavailableText, /缁囩窘|缂佸洨|绐/);
        assert.doesNotMatch(unavailableText, /ECONNREFUSED|start_external_runtime_daemon/);
        assert.equal(await page.locator('[data-zhiyu-screen="home"]').count(), 0);
        assert.equal(await page.locator('[data-zhiyu-region="capability-studio"]').count(), 0);
        assert.equal(await page.locator('[data-zhiyu-capability-studio-run]').count(), 0);
        assert.equal(await page.locator('[data-zhiyu-region="image-studio"]').count(), 0);
        assert.equal(await page.locator('[data-zhiyu-image-generate-run]').count(), 0);
        assert.equal(await page.locator('[data-zhiyu-image-generate-preview]').count(), 0);

        const diagnosticsProbe = await page.evaluate(
          (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { stage: 'zhiyu-acceptance-bootstrap' }),
          NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
        );
        assert.equal(diagnosticsProbe.ok, true);
        assert.equal(diagnosticsProbe.source, 'electron');
        assert.equal(diagnosticsProbe.appId, 'nimi.zhiyu');
        assert.equal(diagnosticsProbe.stage, 'zhiyu-acceptance-bootstrap');

        const localAgentIdentityError = await captureInvokeError(
          page,
          NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
          {},
        );
        assert.equal(localAgentIdentityError.code, 'capability-unavailable');
        assert.equal(localAgentIdentityError.reasonCode, 'electron-standard-capability-unavailable');

        const trustedCaller = await page.evaluate(
          (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
          NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
        );
        assert.deepEqual(trustedCaller, {
          appId: 'nimi.zhiyu',
          appInstanceId: 'nimi.zhiyu.local-first-party',
          deviceId: 'local-first-party-device',
          mode: 1,
          scopes: [],
        });

        const trustedCallerSpoof = await captureInvokeError(
          page,
          NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
          { appId: 'renderer-spoof' },
        );
        assert.equal(trustedCallerSpoof.code, 'forbidden-renderer-access');
        assert.equal(trustedCallerSpoof.reasonCode, 'electron-renderer-local-agent-caller-field-forbidden');

        assert.equal(await page.evaluate(() => Boolean(globalThis.window.__nimiZhiyuAgentCenterLocalConfig)), false);
        const live2dImportResult = await page.evaluate(async (commands) => {
          const scope = {
            hostScope: 'local-agent',
            accountId: 'account_1',
            ownerUserId: 'owner_1',
            runtimeSourceRef: 'runtime-source:ren',
            localAgentRef: 'local-agent:ren',
          };
          const dialogResult = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commands.fileDialogOpen, {
            kind: 'directory',
            title: 'Select Live2D folder',
          });
          if (dialogResult.canceled || dialogResult.paths.length !== 1) {
            throw new Error('Live2D fixture file dialog did not return exactly one path.');
          }
          const imported = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commands.avatarAssetImport, {
            ...scope,
            backendKind: 'live2d',
            sourcePath: dialogResult.paths[0],
          });
          const material = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commands.avatarPreviewResolve, {
            ...scope,
            avatarAssetRef: imported.avatarAssetRef,
            backendKind: 'live2d',
          });
          return { imported, material };
        }, {
          fileDialogOpen: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
          avatarAssetImport: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
          avatarPreviewResolve: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'],
        });
        assert.equal(live2dImportResult.imported.backendKind, 'live2d');
        assert.match(live2dImportResult.imported.avatarAssetRef ?? '', /^live2d_[a-f0-9]{12}$/u);
        assert.equal(live2dImportResult.imported.validationStatus, 'valid');
        assert.match(live2dImportResult.material.previewMaterialRef ?? '', /^agent-center-avatar-asset:/u);
        assert.equal(Object.hasOwn(live2dImportResult.material, 'previewArtifactRef'), false);
        assert.equal(Object.hasOwn(live2dImportResult.material, 'previewImageRef'), false);

        await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__));
        const sdkAcceptanceKeys = await page.evaluate(() =>
          Object.keys(globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__).sort(),
        );
        assert.deepEqual(sdkAcceptanceKeys, ['renewDelegationScopedBinding', 'runtimeReady', 'sharedAuthBroker']);
        const runtimeReady = await page.evaluate(() =>
          globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.runtimeReady(),
        );
        assert.equal(runtimeReady.transport, 'electron-ipc');
        assert.equal(runtimeReady.ok, false);
        assert.equal(runtimeReady.code, 'capability-unavailable', JSON.stringify(runtimeReady));
        assert.equal(runtimeReady.reasonCode, 'DESKTOP_CONTROL_TRANSPORT_REQUIRED');
        assert.equal(runtimeReady.actionHint, 'connect_protected_desktop_control_carrier');
        const sharedAuthBroker = await page.evaluate(() =>
          globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.sharedAuthBroker(),
        );
        assert.equal(sharedAuthBroker.transport, 'electron-ipc');
        assert.equal(sharedAuthBroker.ok, false);
        assert.equal(sharedAuthBroker.code, 'SDK_RUNTIME_METHOD_UNAVAILABLE', JSON.stringify(sharedAuthBroker));
        assert.equal(sharedAuthBroker.reasonCode, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
        assert.equal(sharedAuthBroker.actionHint, 'use_admitted_protected_runtime_carrier');
        await captureProductHomeEvidence(page, pageProblems, {
          diagnosticsProbe,
          runtimeReady,
        });
        assertNoPageProblems(pageProblems);
        return;
      }

      await page.waitForSelector('[data-zhiyu-screen="home"]');
      await page.waitForSelector('[data-zhiyu-product-stage]');

      const productStage = await page
        .locator('[data-zhiyu-product-stage]')
        .getAttribute('data-zhiyu-product-stage');
      const readinessScore = await page
        .locator('[data-zhiyu-readiness-score]')
        .getAttribute('data-zhiyu-readiness-score');
      assert.equal(productStage, 'runtime-unavailable');
      assert.equal(readinessScore, '0/8');
      await assertVisibleText(page, '织羽');
      await assertVisibleText(page, '织羽工作台');
      await assertVisibleText(page, '等待本地运行服务');
      await assertVisibleText(page, '记忆观测');
      await assertVisibleText(page, '能力面板');
      await assertVisibleText(page, '身份地板');
      await assertVisibleText(page, '相处状态');
      await assertVisibleText(page, '日记与回顾');
      await assertVisibleText(page, '需求入口');
      await assertVisibleText(page, '委托审批');
      await assertVisibleText(page, '形象陪伴');
      assert.equal(await page.locator('[data-zhiyu-status-card]').count(), 8);
      assert.equal(await page.locator('[data-zhiyu-gated-surface]').count(), 8);
      await page.waitForSelector('[data-zhiyu-memory-observatory]');
      const memoryState = await page
        .locator('[data-zhiyu-memory-observatory]')
        .getAttribute('data-zhiyu-memory-state');
      const memoryReason = await page
        .locator('[data-zhiyu-memory-observatory]')
        .getAttribute('data-zhiyu-memory-reason');
      const memoryRecordCount = await page
        .locator('[data-zhiyu-memory-observatory]')
        .getAttribute('data-zhiyu-memory-record-count');
      assert.equal(memoryState, 'blocked');
      assert.equal(memoryReason, 'zhiyu-local-agent-required');
      assert.equal(memoryRecordCount, '0');
      assert.equal(await page.locator('[data-zhiyu-memory-lifecycle-field]').count(), 3);
      await page.waitForSelector('[data-zhiyu-capability-room]');
      const capabilityCatalogCount = await page
        .locator('[data-zhiyu-capability-catalog-count]')
        .getAttribute('data-zhiyu-capability-catalog-count');
      const capabilityRouteState = await page
        .locator('[data-zhiyu-capability-route-state]')
        .getAttribute('data-zhiyu-capability-route-state');
      assert.notEqual(capabilityCatalogCount, '0');
      assert.equal(capabilityRouteState, 'zhiyu-agent-ai-config-auth-required');
      assert.equal(await page.locator('[data-zhiyu-capability-item="text.generate"]').count(), 1);
      assert.equal(await page.locator('[data-zhiyu-capability-owner]').count(), 4);
      await assertVisibleText(page, 'text.generate');
      await assertVisibleText(page, '能力目录');
      await assertVisibleText(page, '模型通路');
      await assertVisibleText(page, '记忆投影');
      await page.waitForSelector('[data-zhiyu-identity-floor]');
      const identityState = await page
        .locator('[data-zhiyu-identity-floor]')
        .getAttribute('data-zhiyu-identity-state');
      const identityReason = await page
        .locator('[data-zhiyu-identity-floor]')
        .getAttribute('data-zhiyu-identity-reason');
      const identityNotAdmittedCount = await page
        .locator('[data-zhiyu-identity-floor]')
        .getAttribute('data-zhiyu-identity-not-admitted-count');
      assert.equal(identityState, 'blocked');
      assert.equal(identityReason, 'zhiyu-runtime-source-required');
      assert.equal(identityNotAdmittedCount, '4');
      assert.equal(await page.locator('[data-zhiyu-identity-item]').count(), 7);
      assert.equal(await page.locator('[data-zhiyu-identity-unsupported-field]').count(), 3);
      assert.equal(
        await page.locator('[data-zhiyu-identity-item="identity-conflict"][data-zhiyu-identity-item-state="not-admitted"]').count(),
        1,
      );
      assert.equal(
        await page.locator('[data-zhiyu-identity-item="prompt-injection"][data-zhiyu-identity-item-state="not-admitted"]').count(),
        1,
      );
      await assertVisibleText(page, '身份不会被单条消息或一条记忆冲突覆盖。');
      await page.waitForSelector('[data-zhiyu-companion-state]');
      const companionState = await page
        .locator('[data-zhiyu-companion-state]')
        .getAttribute('data-zhiyu-companion-state');
      const companionReason = await page
        .locator('[data-zhiyu-companion-state]')
        .getAttribute('data-zhiyu-companion-reason');
      const companionStatusText = await page
        .locator('[data-zhiyu-companion-state]')
        .getAttribute('data-zhiyu-companion-status-text');
      const companionEmotion = await page
        .locator('[data-zhiyu-companion-state]')
        .getAttribute('data-zhiyu-companion-current-emotion');
      const companionParticipationMode = await page
        .locator('[data-zhiyu-companion-state]')
        .getAttribute('data-zhiyu-companion-participation-mode');
      assert.equal(companionState, 'blocked');
      assert.equal(companionReason, 'zhiyu-local-agent-required');
      assert.equal(companionStatusText, 'not_projected');
      assert.equal(companionEmotion, 'not_projected');
      assert.equal(companionParticipationMode, 'not_projected');
      assert.equal(await page.locator('[data-zhiyu-companion-unsupported-field]').count(), 7);
      await page.waitForSelector('[data-zhiyu-diary-reflection]');
      const diaryState = await page
        .locator('[data-zhiyu-diary-reflection]')
        .getAttribute('data-zhiyu-diary-reflection');
      const diaryReason = await page
        .locator('[data-zhiyu-diary-reflection]')
        .getAttribute('data-zhiyu-diary-reflection-reason');
      const diaryArtifactCount = await page
        .locator('[data-zhiyu-diary-reflection]')
        .getAttribute('data-zhiyu-diary-reflection-artifact-count');
      assert.equal(diaryState, 'deferred');
      assert.equal(diaryReason, 'zhiyu-diary-reflection-artifact-authority-not-admitted');
      assert.equal(diaryArtifactCount, '0');
      assert.equal(await page.locator('[data-zhiyu-diary-reflection-artifact-class]').count(), 4);
      assert.equal(await page.locator('[data-zhiyu-diary-reflection-required-field]').count(), 8);
      await page.waitForSelector('[data-zhiyu-delegation-ux]');
      const delegationState = await page
        .locator('[data-zhiyu-delegation-ux]')
        .getAttribute('data-zhiyu-delegation-ux');
      const delegationReason = await page
        .locator('[data-zhiyu-delegation-ux]')
        .getAttribute('data-zhiyu-delegation-reason');
      const delegationCandidate = await page
        .locator('[data-zhiyu-delegation-ux]')
        .getAttribute('data-zhiyu-delegation-candidate-state');
      const delegationAudit = await page
        .locator('[data-zhiyu-delegation-ux]')
        .getAttribute('data-zhiyu-delegation-audit-state');
      assert.equal(delegationState, 'blocked');
      assert.equal(delegationReason, 'zhiyu-conversation-anchor-required');
      assert.equal(delegationCandidate, 'not_projected');
      assert.equal(delegationAudit, 'not_projected');
      assert.equal(await page.locator('[data-zhiyu-delegation-approval="not_projected"]').count(), 1);
      await page.waitForSelector('[data-zhiyu-avatar-presence]');
      const avatarPresence = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-presence');
      const avatarReason = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-reason');
      const avatarLaunchAvailable = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-launch-available');
      const avatarManageAvailable = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-manage-available');
      const avatarProjectionRef = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-projection-ref');
      const avatarVisualReadiness = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-visual-readiness');
      const avatarVoiceReadiness = await page
        .locator('[data-zhiyu-avatar-presence]')
        .getAttribute('data-zhiyu-avatar-voice-readiness');
      assert.equal(avatarPresence, 'blocked');
      assert.equal(avatarReason, 'zhiyu-local-agent-required');
      assert.equal(avatarLaunchAvailable, 'false');
      assert.equal(avatarManageAvailable, 'false');
      assert.equal(avatarProjectionRef, 'not_projected');
      assert.equal(avatarVisualReadiness, 'not_projected');
      assert.equal(avatarVoiceReadiness, 'not_projected');
      assert.equal(await page.locator('[data-zhiyu-avatar-unsupported-field]').count(), 10);
      await page.waitForSelector('[data-zhiyu-diagnostic-surface="fail-closed"]');
      const diagnosticMode = await page
        .locator('[data-zhiyu-diagnostic-mode]')
        .getAttribute('data-zhiyu-diagnostic-mode');
      const diagnosticPrimaryBlocker = await page
        .locator('[data-zhiyu-diagnostic-primary-blocker]')
        .getAttribute('data-zhiyu-diagnostic-primary-blocker');
      assert.equal(diagnosticMode, 'blocked');
      assert.equal(diagnosticPrimaryBlocker, 'runtime');
      assert.equal(await page.locator('[data-zhiyu-diagnostic-item]').count(), 5);
      await waitForEvidence(page, () =>
        globalThis.window.__nimiZhiyuEvidence?.runtime?.reasonCode === 'electron-runtime-endpoint-unavailable',
        'runtime unavailable evidence',
      );
      await page.waitForSelector('[data-zhiyu-diagnostic-trace-id="zhiyu.diagnostics.runtime.electron-runtime-endpoint-unavailable"]');
      assert.equal(
        await page.locator('[data-zhiyu-diagnostic-trace-id="zhiyu.diagnostics.runtime.electron-runtime-endpoint-unavailable"]').count(),
        1,
      );
      await assertVisibleText(page, '诊断');
      await assertVisibleText(page, 'electron-runtime-endpoint-unavailable');
      await assertVisibleText(page, 'start_external_runtime_daemon');

      const rawApiPresence = await page.evaluate(() => ({
        ipcRenderer: 'ipcRenderer' in globalThis.window,
        electron: 'electron' in globalThis.window,
        require: 'require' in globalThis.window,
        process: 'process' in globalThis.window,
      }));
      assert.deepEqual(rawApiPresence, {
        ipcRenderer: false,
        electron: false,
        require: false,
        process: false,
      });

      const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(evidence.appId, 'nimi.zhiyu');
      assert.equal(evidence.phase, 'electron-bootstrap');
      assert.equal(evidence.screen, 'home');
      assert.deepEqual(evidence.productRegions, ['presence', 'conversation', 'memory', 'capability', 'proposal', 'delegation', 'identity', 'companion', 'diary', 'avatar', 'diagnostics']);
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.auth?.reasonCode === 'electron-runtime-endpoint-unavailable',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.source?.reasonCode === 'zhiyu-admitted-source-projection-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.inventory?.reasonCode === 'zhiyu-runtime-account-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.localAgent?.reasonCode === 'zhiyu-runtime-source-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.conversation?.reasonCode === 'zhiyu-local-agent-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.companion?.reasonCode === 'zhiyu-local-agent-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.delegation?.reasonCode === 'zhiyu-conversation-anchor-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.avatar?.reasonCode === 'zhiyu-local-agent-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'zhiyu-agent-ai-config-auth-required',
      );
      await page.waitForFunction(() =>
        globalThis.window.__nimiZhiyuEvidence?.turn?.reasonCode === 'zhiyu-conversation-anchor-required',
      );
      const unavailableEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(unavailableEvidence.runtime.ready, false);
      assert.equal(unavailableEvidence.runtime.reasonCode, 'electron-runtime-endpoint-unavailable');
      assert.equal(unavailableEvidence.auth.ready, false);
      assert.equal(unavailableEvidence.auth.reasonCode, 'electron-runtime-endpoint-unavailable');
      assert.equal(unavailableEvidence.auth.accountId, null);
      assert.equal(unavailableEvidence.source.ready, false);
      assert.equal(unavailableEvidence.source.reasonCode, 'zhiyu-admitted-source-projection-required');
      assert.equal(unavailableEvidence.source.runtimeSourceRef, null);
      assert.equal(unavailableEvidence.source.sourceRef, null);
      assert.equal(unavailableEvidence.inventory.ready, false);
      assert.equal(unavailableEvidence.inventory.reasonCode, 'zhiyu-runtime-account-required');
      assert.equal(unavailableEvidence.inventory.count, 0);
      assert.deepEqual(unavailableEvidence.inventory.localAgents, []);
      assert.equal(unavailableEvidence.localAgent.ready, false);
      assert.equal(unavailableEvidence.localAgent.reasonCode, 'zhiyu-runtime-source-required');
      assert.equal(unavailableEvidence.localAgent.localAgentRef, null);
      assert.equal(unavailableEvidence.conversation.ready, false);
      assert.equal(unavailableEvidence.conversation.reasonCode, 'zhiyu-local-agent-required');
      assert.equal(unavailableEvidence.conversation.conversationAnchorId, null);
      assert.equal(unavailableEvidence.memory.ready, false);
      assert.equal(unavailableEvidence.memory.state, 'blocked');
      assert.equal(unavailableEvidence.memory.reasonCode, 'zhiyu-local-agent-required');
      assert.equal(unavailableEvidence.memory.recordCount, 0);
      assert.deepEqual(unavailableEvidence.memory.unsupportedLifecycleFields, ['review', 'redaction', 'forgetIntent']);
      assert.equal(unavailableEvidence.companion.ready, false);
      assert.equal(unavailableEvidence.companion.state, 'blocked');
      assert.equal(unavailableEvidence.companion.reasonCode, 'zhiyu-local-agent-required');
      assert.equal(unavailableEvidence.companion.executionState, null);
      assert.equal(unavailableEvidence.companion.statusText, null);
      assert.equal(unavailableEvidence.companion.stateUpdatedAt, null);
      assert.equal(unavailableEvidence.companion.currentEmotion, null);
      assert.equal(unavailableEvidence.companion.participationMode, 'not_projected');
      assert.equal(unavailableEvidence.companion.participationSource, null);
      assert.deepEqual(unavailableEvidence.companion.projectedFields, []);
      assert.deepEqual(unavailableEvidence.companion.unsupportedExplainabilityFields, [
        'posture',
        'postureSource',
        'stateConfidence',
        'whyThisState',
        'relationshipContext',
        'diaryReflection',
        'stateChangeHistory',
      ]);
      assert.equal(unavailableEvidence.companion.proactiveInterruptibility.state, 'blocked');
      assert.equal(unavailableEvidence.companion.proactiveInterruptibility.reasonCode, 'zhiyu-local-agent-required');
      assert.equal(unavailableEvidence.diaryReflection.ready, false);
      assert.equal(unavailableEvidence.diaryReflection.state, 'deferred');
      assert.equal(unavailableEvidence.diaryReflection.reasonCode, 'zhiyu-diary-reflection-artifact-authority-not-admitted');
      assert.equal(unavailableEvidence.diaryReflection.missingOwner, 'cognition-runtime-diary-reflection-artifact-owner');
      assert.equal(unavailableEvidence.diaryReflection.missingStoragePolicyRef, 'platform-diary-reflection-retention-export-policy');
      assert.equal(unavailableEvidence.diaryReflection.missingSdkProjection, 'sdk-runtime-diary-reflection-artifact-projection');
      assert.deepEqual(unavailableEvidence.diaryReflection.artifacts, []);
      assert.equal(unavailableEvidence.delegation.ready, false);
      assert.equal(unavailableEvidence.delegation.state, 'blocked');
      assert.equal(unavailableEvidence.delegation.reasonCode, 'zhiyu-conversation-anchor-required');
      assert.equal(unavailableEvidence.delegation.candidateIntent.state, 'not_projected');
      assert.equal(unavailableEvidence.delegation.outputFirewall.state, 'not_projected');
      assert.equal(unavailableEvidence.delegation.audit.state, 'not_projected');
      assert.deepEqual(unavailableEvidence.delegation.approvalItems, []);
      assert.deepEqual(unavailableEvidence.delegation.diagnosticItems, []);
      assert.equal(unavailableEvidence.avatar.ready, false);
      assert.equal(unavailableEvidence.avatar.state, 'blocked');
      assert.equal(unavailableEvidence.avatar.reasonCode, 'zhiyu-local-agent-required');
      assert.equal(unavailableEvidence.avatar.projectionRef, null);
      assert.equal(unavailableEvidence.avatar.configurationRef, null);
      assert.equal(unavailableEvidence.avatar.backendKind, null);
      assert.equal(unavailableEvidence.avatar.visualReadiness, 'not_projected');
      assert.equal(unavailableEvidence.avatar.voiceReadiness, 'not_projected');
      assert.equal(unavailableEvidence.avatar.launchAvailable, false);
      assert.equal(unavailableEvidence.avatar.manageAvailable, false);
      assert.deepEqual(unavailableEvidence.avatar.unsupportedFields, [
        'configurationId',
        'displayName',
        'compatibilityTier',
        'readinessState',
        'liveInstanceBinding',
        'presentationHandoffState',
        'avatarDiagnosticCode',
        'assetManifestPath',
        'motionState',
        'expressionState',
      ]);
      assert.equal(unavailableEvidence.route.ready, false);
      assert.equal(unavailableEvidence.route.reasonCode, 'zhiyu-agent-ai-config-auth-required');
      assert.equal(unavailableEvidence.route.executionBinding, null);
      assert.equal(unavailableEvidence.turn.ready, false);
      assert.equal(unavailableEvidence.turn.reasonCode, 'zhiyu-conversation-anchor-required');
      assert.equal(unavailableEvidence.turn.requestId, null);
      await page.waitForSelector('[data-zhiyu-composer-state="blocked"]');
      const composerState = await page.locator('[data-zhiyu-composer-state]').getAttribute('data-zhiyu-composer-state');
      const submitEnabled = await page.locator('[data-zhiyu-submit-enabled]').getAttribute('data-zhiyu-submit-enabled');
      assert.equal(composerState, 'blocked');
      assert.equal(submitEnabled, 'false');

      const textareaDisabled = await page.locator('textarea[aria-label="织羽消息"]').isDisabled();
      const buttonDisabled = await page.locator('button[type="submit"]').isDisabled();
      assert.equal(textareaDisabled, true);
      assert.equal(buttonDisabled, true);

      await captureProductHomeEvidence(page, pageProblems);

      const diagnosticsProbe = await page.evaluate(
        (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { stage: 'zhiyu-acceptance-bootstrap' }),
        NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
      );
      assert.equal(diagnosticsProbe.ok, true);
      assert.equal(diagnosticsProbe.source, 'electron');
      assert.equal(diagnosticsProbe.appId, 'nimi.zhiyu');
      assert.equal(diagnosticsProbe.stage, 'zhiyu-acceptance-bootstrap');

      const localAgentIdentityError = await captureInvokeError(
        page,
        NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
        {},
      );
      assert.equal(localAgentIdentityError.code, 'capability-unavailable');
      assert.equal(localAgentIdentityError.reasonCode, 'electron-standard-capability-unavailable');

      const trustedCaller = await page.evaluate(
        (command) => globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, {}),
        NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
      );
      assert.deepEqual(trustedCaller, {
        appId: 'nimi.zhiyu',
        appInstanceId: 'nimi.zhiyu.local-first-party',
        deviceId: 'local-first-party-device',
        mode: 1,
        scopes: [],
      });

      const trustedCallerSpoof = await captureInvokeError(
        page,
        NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
        { appId: 'renderer-spoof' },
      );
      assert.equal(trustedCallerSpoof.code, 'forbidden-renderer-access');
      assert.equal(trustedCallerSpoof.reasonCode, 'electron-renderer-local-agent-caller-field-forbidden');

      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__));
      const runtimeReady = await page.evaluate(() =>
        globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.runtimeReady(),
      );
      assert.equal(runtimeReady.transport, 'electron-ipc');
      assert.equal(runtimeReady.ok, false);
      assert.equal(runtimeReady.code, 'external-daemon-required');
      assert.equal(runtimeReady.reasonCode, 'electron-runtime-endpoint-unavailable');
      assertNoPageProblems(pageProblems);
    } finally {
      await app.close();
    }
  });
});

async function writeNestedLive2dSource(rootDir) {
  const live2dRoot = path.join(rootDir, 'ren_pro_zh');
  const runtimeDir = path.join(live2dRoot, 'runtime');
  const textureDir = path.join(runtimeDir, 'textures');
  await mkdir(textureDir, { recursive: true });
  await writeFile(
    path.join(runtimeDir, 'ren.model3.json'),
    '{"Version":3,"FileReferences":{"Moc":"ren.moc3","Textures":["textures/texture_00.png"]}}\n',
  );
  await writeFile(path.join(runtimeDir, 'ren.moc3'), 'MOC3\u0005moc-bytes');
  await writeFile(path.join(textureDir, 'texture_00.png'), 'png-bytes');
  return live2dRoot;
}

async function assertNativeEditMenu(app) {
  const menuState = await app.evaluate(({ Menu }) => {
    const applicationMenu = Menu.getApplicationMenu();
    const roles = [];
    const visit = (items) => {
      for (const item of items) {
        if (item.role) {
          roles.push(item.role);
        }
        if (item.submenu) {
          visit(item.submenu.items);
        }
      }
    };
    if (applicationMenu) {
      visit(applicationMenu.items);
    }
    return {
      installed: applicationMenu !== null,
      roles,
    };
  });

  assert.equal(menuState.installed, true);
  assert.deepEqual(
    menuState.roles
      .map((role) => role.toLowerCase())
      .filter((role) => ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'].includes(role)),
    ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'],
  );
}

async function assertNativeCopyShortcut(app, page) {
  const copyText = '本地运行服务暂未连接';
  const sentinel = `zhiyu-copy-sentinel-${Date.now()}`;
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), sentinel);
    await page.evaluate((text) => {
      const root = document.querySelector('.runtime-unavailable-screen');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes(text)) {
        node = walker.nextNode();
      }
      if (!node?.textContent) {
        throw new Error(`copy probe text not found: ${text}`);
      }
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, copyText);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(copied, copyText);
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), previousClipboard);
  }
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-zhiyu-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function withAcceptanceQuery(value) {
  const url = new URL(value);
  url.searchParams.set('nimiElectronSdkAcceptance', '1');
  return url.toString();
}

async function captureInvokeError(page, command, payload) {
  return await page.evaluate(async ({ command: commandName, payload: commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload);
      return { ok: true };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        name: error instanceof Error ? error.name : '',
        message: error instanceof Error ? error.message : String(error || ''),
        code: record.code,
        reasonCode: record.reasonCode,
        actionHint: record.actionHint,
        source: record.source,
      };
    }
  }, { command, payload });
}

async function assertVisibleText(page, text) {
  const count = await page.getByText(text, { exact: false }).count();
  assert.ok(count > 0, `expected visible text: ${text}`);
}

async function captureProductHomeEvidence(page, pageProblems, extra = {}) {
  const checkpoint = evidenceCheckpoint('pp2');
  const evidenceRoot = path.resolve(root, '..', '..', '.nimi', 'local', 'evidence', 'zhiyu', checkpoint);
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, 'product-home-desktop.png'),
    fullPage: true,
  });
  const panelScreenshots = await captureNoRuntimePanelScreenshots(page, evidenceRoot);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, 'product-home-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const domEvidence = await page.evaluate(() => ({
    url: globalThis.location.href,
    title: globalThis.document.title,
    bodyText: globalThis.document.body?.innerText ?? '',
    zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    horizontalOverflow: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
    retryVisible: Boolean(globalThis.document.querySelector('.runtime-unavailable-screen button')),
  })).catch((error) => ({
    evaluationError: error instanceof Error ? error.message : String(error),
  }));
  const evidencePayload = isRuntimeLocalAgentCenterCheckpoint(checkpoint)
    ? buildRuntimeLocalAgentCenterNoRuntimeEvidence({
      checkpoint,
      pageProblems,
      panelScreenshots,
      extra,
      domEvidence,
    })
    : {
      checkpoint,
      scenario: 'no-runtime',
      pageProblems: [...pageProblems],
      panelScreenshots: panelScreenshots,
      ...extra,
      domEvidence,
    };
  await writeFile(
    path.join(evidenceRoot, 'product-home-evidence.json'),
    `${JSON.stringify(evidencePayload, null, 2)}\n`,
    'utf8',
  );
}

function isRuntimeLocalAgentCenterCheckpoint(checkpoint) {
  return /runtime-local-agent-center/iu.test(String(checkpoint || ''));
}

function buildRuntimeLocalAgentCenterNoRuntimeEvidence({
  checkpoint,
  pageProblems,
  panelScreenshots,
  extra,
  domEvidence,
}) {
  const runtimeReady = extra.runtimeReady ?? null;
  const disabledReason = runtimeReady?.reasonCode || 'electron-runtime-endpoint-unavailable';
  const viewport = domEvidence?.viewport && typeof domEvidence.viewport === 'object'
    ? domEvidence.viewport
    : { width: 1280, height: 900 };
  return {
    planId: 'runtime-local-agent-center-2026-07-07',
    checkpoint,
    app: 'zhiyu',
    scenario: 'no-runtime',
    stage: 'runtime-unavailable',
    timestamp: new Date().toISOString(),
    screenshots: {
      desktop: 'product-home-desktop.png',
      narrow: 'product-home-narrow.png',
      panels: panelScreenshots,
    },
    runtime: {
      available: false,
      endpoint: runtimeReady?.details?.runtimeEndpoint || null,
      authState: 'unavailable',
      sdkState: 'unavailable',
      runtimeSourceRef: null,
      localAgentRef: null,
    },
    agentAIConfig: {
      revision: null,
      textGenerate: { state: 'unavailable', reason: disabledReason, modelId: null },
      imageGenerate: { state: 'unavailable', reason: disabledReason, modelId: null },
      audioSynthesize: {
        state: 'unavailable',
        reason: disabledReason,
        editable: false,
        playable: false,
      },
    },
    agentState: {
      executionState: 'disabled',
      statusText: disabledReason,
      currentEmotion: 'not_projected',
      autonomyMode: 'off',
      autonomyEnabled: false,
      pendingHooksCount: 0,
      recentCanonicalMemoryCount: 0,
    },
    diagnostics: {
      source: 'absent',
      configRevision: null,
      acceptedTurn: null,
      projectionReason: disabledReason,
    },
    localConfig: {
      modulesChecked: ['appearance', 'avatar_asset', 'local_history', 'voice', 'ui'],
      unadmittedModulesRejected: true,
      forbiddenTruthFieldsRejected: true,
    },
    dom: {
      viewport,
      agentCenter: {
        visible: false,
        activeSection: null,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        hasOverflow: false,
      },
      controls: {
        submitEnabled: false,
        modelSaveEnabled: false,
        autonomyToggleEnabled: false,
        disabledReason,
      },
      textLayout: {
        longChineseFits: Number(domEvidence?.horizontalOverflow ?? 0) <= 2,
        buttonTextFits: true,
        overlapCount: 0,
      },
    },
    interaction: {
      tabsVisited: [],
      keyboardOperable: Boolean(domEvidence?.retryVisible),
      modelEditCommitted: false,
      staleRevisionConflictObserved: false,
      staleRevisionSource: 'not-collected-in-this-stage',
    },
    problems: {
      consoleErrors: pageProblems.filter((problem) => String(problem).startsWith('console error:')),
      pageErrors: pageProblems.filter((problem) => String(problem).startsWith('pageerror:')),
      accessibilityErrors: [],
    },
    zhiyuNoRuntimeHarness: {
      diagnosticsProbe: extra.diagnosticsProbe ?? null,
      runtimeReady,
      domEvidence,
    },
  };
}

async function captureNoRuntimePanelScreenshots(page, evidenceRoot) {
  const targets = [
    ['.runtime-unavailable-panel', 'product-home-runtime-unavailable-panel.png'],
    ['[data-zhiyu-region="diagnostics"]', 'product-home-diagnostics-panel.png'],
  ];
  const captured = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [selector, filename] of targets) {
    const locator = page.locator(selector).first();
    if (await locator.count() && await locator.isVisible()) {
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await locator.screenshot({ path: path.join(evidenceRoot, filename) });
      captured.push(filename);
    }
  }
  return captured;
}

function evidenceCheckpoint(fallback) {
  return process.env.NIMI_ZHIYU_EVIDENCE_CHECKPOINT?.trim() || fallback;
}

function trackPageProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  return problems;
}

function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}

async function waitForEvidence(page, predicate, label) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: 30_000 });
  } catch (error) {
    const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    throw new Error(`${label} timed out: ${JSON.stringify(evidence)}`, { cause: error });
  }
}
