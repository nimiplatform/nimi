import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { persistResultEvidence } from './artifact-writer.mjs';
import {
  assessAccessibilityAudit,
  assessObservedProcessBudget,
  isRuntimeObservedProcessMismatch,
  isRuntimeRestartUiTransition,
  isTypedProjectRevocationDenial,
} from './dev-kernel-contract.mjs';
import {
  allFiles,
  artifactIdFor,
  buildCheckpointResults,
  buildLeafResults,
} from './cross-app-driver.mjs';
import { readFixedServiceStatus, sha256, writeJson } from './dev-kernel-host-driver.mjs';
import { pageAudit, summarizeProviderRequests } from './dev-kernel-local-development-driver.mjs';

export async function persistOwnerMinimalResult(context) {
  const {
    observer, desktop, runOnceZhiyu, observedPages, observations, trial, serviceBefore,
    artifactsRoot, screenshotsRoot, sourceState, outputDir, started,
  } = context;
      const desktopAudit = await pageAudit(desktop, 'owner-minimal Desktop');
      const zhiyuAudit = await pageAudit(runOnceZhiyu, 'owner-minimal Zhiyu');
      await observer.flush();
      const privacyOk = observedPages.every((page) => page.authorizationHeaderObserved === false
        && page.secretTextObserved === false
        && page.consoleErrors.length === 0
        && page.pageErrors.length === 0
        && page.observerErrors.length === 0
        && (page.kind !== 'renderer-network-context' || page.requestObserverAttached === true)
        && (page.kind !== 'renderer-page' || (
          page.historicalResourceAuditCompleted === true
          && page.storageObserverAttached === true
          && page.storageAuditCompleted === true
          && page.storageAuthorityMaterialObserved === false
        )))
        && desktopAudit.storage.authorityMaterialObserved === false
        && zhiyuAudit.storage.authorityMaterialObserved === false;
      const facts = [
        ['dev-principal-session', observations.runOnceApproval.decision === 'allow-run-once'],
        ['session-bound', observations.sessionBound.session?.sessionBound === true],
        ['reserved-permission-unavailable', observations.sessionBound.permission?.posture === 'unavailable'
          && observations.sessionBound.permission?.canRequest === false],
        ['reserved-permission-request-denied', observations.reservedPermission.permissionRequest?.state === 'rejected'],
        ['app-private-storage-base-entitlement', observations.appPrivateStorage.appPrivateStorage?.state === 'succeeded'],
        ['process-mismatch-denied', isRuntimeObservedProcessMismatch(observations.processMismatch)],
      ];
      const checkpoints = facts.map(([checkpointId, passed]) => ({
        checkpointId,
        outcome: passed ? 'passed' : 'failed',
      }));
      const summaryPath = path.join(artifactsRoot, 'owner-minimal-summary.json');
      writeJson(summaryPath, {
        schemaVersion: 'nimi.local-agent-product-owner-minimal-observation/v1',
        journeyTrialId: trial.identity.journeyTrialId,
        runtimeCandidateId: serviceBefore.runtimeCandidateId,
        productControlState: observations.firstRun.productState,
        accountState: observations.primaryAccountSession?.state || null,
        developerMode: observations.developerModeEnabled,
        runOnceDecision: observations.runOnceApproval.decision,
        sessionState: observations.sessionBound.session?.state || null,
        permissionPosture: observations.sessionBound.permission?.posture || null,
        permissionRequestState: observations.reservedPermission.permissionRequest?.state || null,
        appPrivateStorageState: observations.appPrivateStorage.appPrivateStorage?.state || null,
        processMismatchReason: observations.processMismatch.lastError?.reasonCode || null,
        privacyOk,
      });
      const pageSummaryPath = path.join(artifactsRoot, 'owner-minimal-dom-console-a11y.json');
      writeJson(pageSummaryPath, { observedPages, desktopAudit, zhiyuAudit });
      const screenshotFiles = allFiles(screenshotsRoot).filter((file) => path.extname(file).toLowerCase() === '.png');
      const browserAuthBudgetValid = observations.realmAuthPolicy?.profile === 'dev_kernel_checkpoint'
        && observations.browserAuthBudget?.attemptCount === observations.browserAuthPlan?.length
        && observations.browserAuthBudget?.attemptCount <= observations.browserAuthBudget?.passwordLoginLimit;
      const electronArtifactsAcceptanceEligible = ['fresh', 'fresh-prepared'].includes(observations.electronArtifactPosture?.mode)
        && observations.electronArtifactPosture?.acceptanceEligible === true
        && observations.electronArtifactPosture?.sourceDigest === sourceState.sourceDigest;
      const outcome = checkpoints.every((checkpoint) => checkpoint.outcome === 'passed')
        && privacyOk
        && browserAuthBudgetValid
        && electronArtifactsAcceptanceEligible ? 'passed' : 'failed';
      const result = {
        schemaVersion: 'nimi.local-agent-product-owner-minimal-result/v1',
        journeyTrialId: trial.identity.journeyTrialId,
        journeyId: 'dev-kernel-owner-minimal',
        tier: 'L2',
        batch: trial.identity.batch,
        repeatIndex: trial.identity.repeatIndex,
        sourceState,
        electronArtifactPosture: observations.electronArtifactPosture,
        durationMs: Math.round(performance.now() - started),
        checkpoints,
        artifacts: [],
        privacy: { ok: privacyOk, findings: privacyOk ? [] : ['owner-minimal protected carrier observation failed privacy or console checks'] },
        outcome,
      };
      const persisted = persistResultEvidence({
        outputDir,
        result,
        artifactInputs: [
          { artifactId: 'owner-minimal-summary', file: summaryPath },
          { artifactId: 'owner-minimal-dom-console-a11y', file: pageSummaryPath },
          ...screenshotFiles.map((file, index) => ({
            artifactId: artifactIdFor('owner-minimal-shell', screenshotsRoot, file, index),
            file,
          })),
        ],
      });
      if (persisted.result.outcome !== 'passed') {
        const failed = checkpoints.filter((checkpoint) => checkpoint.outcome !== 'passed')
          .map((checkpoint) => checkpoint.checkpointId);
        if (!browserAuthBudgetValid) failed.push('formal-test-realm-browser-auth-budget');
        if (!electronArtifactsAcceptanceEligible) failed.push('diagnostic-electron-artifact-reuse');
        throw new Error(`dev-kernel owner-minimal failed: ${failed.join(', ') || 'privacy'}`);
      }
      return persisted;

}

export async function persistCoreResult(context) {
  const {
    fixture, providerRawPath, observations, artifactsRoot, desktop, observer, observedPages,
    desktopAuditBeforeSwitch, desktopAuditAfterSwitch, zhiyuAudit, zhiyuAuditBeforeSwitch,
    zhiyuAuditAfterSwitch, zhiyuRevokedNarrowMethod, zhiyuRevokedNarrowMetrics,
    desktopNarrowMethod, desktopNarrowMetrics, screenshotsRoot, serviceBefore, fixtureConfig,
    firstStorage, secondStorage, processLedger, journey, trial, sourceState, outputDir,
    startedAt, started, buildMarker,
  } = context;
    const fixtureManifest = await (await fetch(`${fixture.origin}/__fixture/control/manifest`)).json();
    writeJson(providerRawPath, fixtureManifest);
    const providerRequests = fixtureManifest.realmFixture?.providerRequests || [];
    const providerSummary = summarizeProviderRequests(providerRequests);
    const providerSummaryPath = path.join(artifactsRoot, 'provider-capture-summary.json');
    writeJson(providerSummaryPath, providerSummary);

    const desktopAudit = await pageAudit(desktop, 'desktop-final');
    await observer.flush();
    const desktopAccessibility = assessAccessibilityAudit(desktopAudit);
    const zhiyuAccessibility = assessAccessibilityAudit(zhiyuAudit);
    const pageSummary = {
      desktop: {
        audit: desktopAudit,
        auditBeforeSwitch: desktopAuditBeforeSwitch,
        auditAfterSwitch: desktopAuditAfterSwitch,
        accessibilityAcceptance: desktopAccessibility,
        narrowMethod: desktopNarrowMethod,
        narrowMetrics: desktopNarrowMetrics,
      },
      zhiyu: {
        audit: zhiyuAudit,
        auditBeforeSwitch: zhiyuAuditBeforeSwitch,
        auditAfterSwitch: zhiyuAuditAfterSwitch,
        accessibilityAcceptance: zhiyuAccessibility,
        narrowMethod: observations.zhiyuNarrowMethod,
        narrowMetrics: observations.zhiyuAuthorityNarrowMetrics,
        revokedNarrowMethod: zhiyuRevokedNarrowMethod,
        revokedNarrowMetrics: zhiyuRevokedNarrowMetrics,
      },
      observedPages,
    };
    const pageSummaryPath = path.join(artifactsRoot, 'real-shell-dom-console-a11y.json');
    writeJson(pageSummaryPath, pageSummary);

    const runtimeFinal = readFixedServiceStatus();
    const serviceSummaryPath = path.join(artifactsRoot, 'fixed-service-summary.json');
    writeJson(serviceSummaryPath, {
      before: serviceBefore,
      afterStorageSelection: observations.firstRun.serviceAfterStorage,
      afterFirstRunReady: observations.firstRun.serviceAfterReady,
      afterRestart: observations.runtimeRestart.after,
      final: runtimeFinal,
    });

    const safeObservations = {
      firstRun: {
        productState: observations.firstRun.productState,
        selectedDataRootSha256: sha256(observations.firstRun.selectedDataRoot.dataRoot.path),
        serviceProcessIds: [
          observations.firstRun.serviceAfterStorage.processId,
          observations.firstRun.serviceAfterReady.processId,
        ],
        narrowMetrics: observations.firstRun.layout.narrowMetrics,
        reusedReady: observations.firstRun.reusedReady === true,
        resumedFromDevice: observations.firstRun.resumedFromDevice === true,
      },
      productionAccountSession: {
        state: observations.primaryAccountSession?.state || null,
        accountProjection: observations.primaryAccountSession?.accountProjection || null,
        productionInert: observations.primaryAccountSession?.productionInert ?? null,
        runtimeCandidateId: serviceBefore.runtimeCandidateId,
      },
      runOnceApproval: observations.runOnceApproval,
      sessionBound: {
        state: observations.sessionBound.state,
        session: observations.sessionBound.session,
        permission: observations.sessionBound.permission,
      },
      reservedPermission: observations.reservedPermission.permissionRequest,
      appPrivateStorage: observations.appPrivateStorage.appPrivateStorage,
      processMismatchReason: observations.processMismatch.lastError?.reasonCode,
      rememberedApproval: observations.rememberedApproval,
      rememberedInitialAuthorityPosture: {
        posture: observations.rememberedInitialAuthorityPosture.posture,
        state: observations.rememberedInitialAuthorityPosture.evidence.state,
        permission: observations.rememberedInitialAuthorityPosture.evidence.permission,
      },
      rememberedAuthorization: observations.rememberedAuthorization,
      rememberedAuthorityBoundary: {
        permissionRequest: observations.rememberedReservedPermission.permissionRequest,
        storage: observations.rememberedAppPrivateStorage.appPrivateStorage,
      },
      editBuildRestart: observations.editBuildRestart,
      mode: {
        off: observations.modeOff,
        on: observations.modeOn,
        modeOffAuthorization: observations.modeOffAuthorization,
        continuedAuthorization: observations.continuedAuthorization,
      },
      runtimeRestart: observations.runtimeRestart,
      accountSwitch: observations.accountSwitch,
      projectRevoke: {
        attempted: observations.projectRevoke.attempted,
        denial: {
          state: observations.projectRevoke.denial?.state || '',
          session: observations.projectRevoke.denial?.session || null,
        },
      },
      agentInteractionDisabled: observations.agentInteractionDisabled,
    };
    const journeySummaryPath = path.join(artifactsRoot, 'dev-kernel-journey-summary.json');
    writeJson(journeySummaryPath, safeObservations);

    const auditedPageSnapshots = [
      desktopAudit,
      desktopAuditBeforeSwitch,
      desktopAuditAfterSwitch,
      zhiyuAudit,
      zhiyuAuditBeforeSwitch,
      zhiyuAuditAfterSwitch,
    ];
    const privacyOk = observedPages.every((page) => page.authorizationHeaderObserved === false
      && page.secretTextObserved === false
      && page.consoleErrors.length === 0
      && page.pageErrors.length === 0
      && page.observerErrors.length === 0
      && (page.kind !== 'renderer-network-context' || page.requestObserverAttached === true)
      && (page.kind !== 'renderer-page' || (
        page.historicalResourceAuditCompleted === true
        && page.storageObserverAttached === true
        && page.storageAuditCompleted === true
        && page.storageAuthorityMaterialObserved === false
      )))
      && auditedPageSnapshots.every((audit) => audit.storage.authorityMaterialObserved === false);
    const desktopLayoutOk = observations.runOnceApproval.layout?.narrowMetrics.scrollWidth
      <= observations.runOnceApproval.layout?.narrowMetrics.clientWidth
      && (observations.firstRun.reusedReady === true
        || observations.firstRun.layout.narrowMetrics.scrollWidth <= observations.firstRun.layout.narrowMetrics.clientWidth)
      && desktopNarrowMetrics.scrollWidth <= desktopNarrowMetrics.clientWidth;
    const zhiyuLayoutOk = observations.zhiyuAuthorityNarrowMetrics.scrollWidth
      <= observations.zhiyuAuthorityNarrowMetrics.clientWidth
      && zhiyuRevokedNarrowMetrics.scrollWidth <= zhiyuRevokedNarrowMetrics.clientWidth;
    const accountSwitchDenied = observations.accountSwitch.evidence?.session?.sessionBound === false
      || observations.accountSwitch.runs.some((run) => (
      ['authorization-required', 'revoked', 'stopped'].includes(run.state)
      && ['principal-unauthorized', 'account-changed', 'local-app-account-changed'].includes(run.reasonCode)
    ));
    const processMismatchDenied = isRuntimeObservedProcessMismatch(observations.processMismatch);
    const processObservation = processLedger.snapshot();
    const processStarts = processObservation.processStarts;
    const processBudget = assessObservedProcessBudget(
      processStarts,
      journey.environment.start_limits,
      { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 },
    );
    const processProblems = processBudget.ok
      ? []
      : [...processBudget.overages, ...processBudget.missing].map((problem) => `observed-process-budget:${problem}`);
    if (observations.realmAuthPolicy?.profile !== 'dev_kernel_checkpoint'
      || observations.browserAuthBudget?.attemptCount !== observations.browserAuthPlan?.length
      || observations.browserAuthBudget?.attemptCount > observations.browserAuthBudget?.passwordLoginLimit) {
      processProblems.push('formal-test-realm-browser-auth-budget-invalid');
    }
    if (!['fresh', 'fresh-prepared'].includes(observations.electronArtifactPosture?.mode)
      || observations.electronArtifactPosture?.acceptanceEligible !== true
      || observations.electronArtifactPosture?.sourceDigest !== sourceState.sourceDigest) {
      processProblems.push('diagnostic-electron-artifact-reuse-is-not-acceptance-eligible');
    }

    const facts = new Map();
    const pass = (checkpointId, passed, correlations = {}) => facts.set(checkpointId, {
      passed: passed === true,
      correlations,
    });
    pass('fixed-service-ready', serviceBefore.state === 'running', { serviceName: serviceBefore.serviceName, processId: serviceBefore.processId });
    pass('production-account-login', observations.firstRun.productState === 'ready_for_use'
      && observations.primaryAccountSession?.state === 'authenticated'
      && observations.primaryAccountSession?.accountProjection?.accountId === fixtureConfig.primaryAccountId
      && observations.primaryAccountSession?.productionInert === false
      && fixtureManifest.realmFixture?.runtimeAccountTokenRequests?.length >= 1, {
      accountId: observations.primaryAccountSession?.accountProjection?.accountId || null,
      accountState: observations.primaryAccountSession?.state || null,
      runtimeCandidateId: serviceBefore.runtimeCandidateId,
      selectedDataRootSha256: sha256(observations.firstRun.selectedDataRoot.dataRoot.path),
    });
    pass('developer-mode-enabled', observations.developerModeEnabled === 'on');
    pass('run-once-project-admitted', observations.runOnceApproval.decision === 'allow-run-once');
    pass('local-app-session-bound', observations.sessionBound.session?.sessionBound === true);
    pass('app-private-storage-base-entitlement', observations.appPrivateStorage.appPrivateStorage?.state === 'succeeded');
    pass('reserved-permission-unavailable', observations.sessionBound.permission?.posture === 'unavailable'
      && observations.sessionBound.permission?.canRequest === false);
    pass('reserved-permission-request-denied', observations.reservedPermission.permissionRequest?.state === 'rejected');
    pass('process-mismatch-denied', processMismatchDenied, { reasonCode: observations.processMismatch.lastError?.reasonCode || null });
    pass('allow-project-admitted', observations.rememberedApproval.decision === 'allow-project'
      && observations.rememberedInitialAuthorityPosture.posture === 'session-bound-reserved-unavailable'
      && observations.rememberedAuthorization.state === 'active'
      && observations.rememberedAuthorization.persistence === 'allow-project', {
      initialAuthorityPosture: observations.rememberedInitialAuthorityPosture.posture,
    });
    pass('allow-project-authority-boundary', observations.rememberedReservedPermission.permissionRequest?.state === 'rejected'
      && observations.rememberedAppPrivateStorage.appPrivateStorage?.state === 'succeeded');
    pass('edit-build-process-replaced', observations.editBuildRestart.preEditRuns[0]?.hostGeneration < observations.editBuildRestart.postEditRuns[0]?.hostGeneration, { buildMarker });
    pass('app-private-storage-after-process-replacement', observations.editBuildRestart.storageAfter?.state === 'succeeded'
      && observations.editBuildRestart.permissionAfter?.posture === 'unavailable');
    pass('mode-off-live-authority-revoked', observations.modeOff === 'off'
      && observations.modeOffAuthorization.state === 'active'
      && observations.modeOffAuthorization.selector === observations.rememberedAuthorization.selector);
    pass('allow-project-reused-after-mode-reenable', observations.modeOn === 'on'
      && observations.continuedAuthorization.state === 'active'
      && observations.continuedAuthorization.selector === observations.rememberedAuthorization.selector
      && observations.continuedAppPrivateStorage.appPrivateStorage?.state === 'succeeded');
    pass('fixed-service-restarted', isRuntimeRestartUiTransition(observations.runtimeRestart), {
      beforeProcessId: observations.runtimeRestart.before.processId,
      afterProcessId: observations.runtimeRestart.after.processId,
      unavailableState: observations.runtimeRestart.unavailableUi.state,
      recoveredState: observations.runtimeRestart.recoveredUi.state,
    });
    pass('app-private-storage-after-runtime-restart', observations.runtimeRestart.storageAfter?.state === 'succeeded');
    pass('account-switch-invalidated', accountSwitchDenied, { secondaryAccountId: fixtureConfig.secondaryAccountId });
    pass('project-revoked-session-invalidated', isTypedProjectRevocationDenial(observations.projectRevoke), {
      reasonCode: observations.projectRevoke.denial?.session?.reasonCode || null,
    });
    pass('desktop-real-shell-acceptance', desktopLayoutOk && desktopAccessibility.ok && observations.runOnceApproval.disabledBeforeRisk === true);
    pass('zhiyu-real-shell-acceptance', zhiyuLayoutOk && zhiyuAccessibility.ok && observations.agentInteractionDisabled === true);
    pass('protected-carrier-privacy-closeout', privacyOk && processBudget.ok);

    const processSummaryPath = path.join(artifactsRoot, 'process-summary.json');
    writeJson(processSummaryPath, {
      schemaVersion: 'nimi.local-agent-product-process-summary/v3-dev-kernel',
      processStarts,
      startLimits: journey.environment.start_limits,
      budget: processBudget,
      observedEvents: processObservation.events,
      serviceProcessIds: [...new Set(processObservation.events
        .filter((event) => event.role === 'runtime' && Number.isSafeInteger(event.pid))
        .map((event) => event.pid))],
      desktopProcessIds: desktopAudit.processIds,
      zhiyuProcessIds: zhiyuAudit.processIds,
      observedPageCount: observedPages.length,
    });

    const environmentIdentity = {
      rootId: sha256(trial.paths.root),
      accountIds: [fixtureConfig.primaryAccountId, fixtureConfig.secondaryAccountId],
      runtimeSourceRefs: [fixtureConfig.agent.runtimeSourceRef],
      localAgentIds: [fixtureConfig.agent.localAgentRef],
      processStarts,
    };
    const environmentPath = path.join(artifactsRoot, 'environment.json');
    writeJson(environmentPath, {
      schemaVersion: 'nimi.local-agent-product-environment/v3-dev-kernel',
      journeyTrialId: trial.identity.journeyTrialId,
      platform: process.platform,
      architecture: process.arch,
      sourceState,
      ...environmentIdentity,
    });

    const points = [];
    const safeEvidenceRefs = [
      'dev-kernel-journey-summary',
      'fixed-service-summary',
      'provider-capture-summary',
      'real-shell-dom-console-a11y',
      'process-summary',
      'journey-environment',
    ];
    const completedAt = new Date().toISOString();
    const correlations = {
      accountId: fixtureConfig.primaryAccountId,
      runtimeSourceRef: fixtureConfig.agent.runtimeSourceRef,
      localAgentRef: fixtureConfig.agent.localAgentRef,
      runtimeProcessId: runtimeFinal.processId,
    };
    const { checkpoints, checkpointById } = buildCheckpointResults({
      journey,
      points,
      facts,
      correlations,
      artifactRefs: safeEvidenceRefs,
      startedAt,
      completedAt,
    });
    const leafResults = buildLeafResults({
      points,
      checkpointById,
      journeyTrialId: trial.identity.journeyTrialId,
      artifactRefs: safeEvidenceRefs,
    });
    const proofPath = path.join(artifactsRoot, 'journey-checkpoint-proof.json');
    writeJson(proofPath, {
      schemaVersion: 'nimi.local-agent-product-checkpoint-proof/v3-dev-kernel',
      journeyTrialId: trial.identity.journeyTrialId,
      facts: Object.fromEntries(facts),
      correlations,
    });

    const screenshotFiles = allFiles(screenshotsRoot).filter((file) => path.extname(file).toLowerCase() === '.png');
    const artifactInputs = [
      { artifactId: 'dev-kernel-journey-summary', file: journeySummaryPath },
      { artifactId: 'fixed-service-summary', file: serviceSummaryPath },
      { artifactId: 'provider-capture-summary', file: providerSummaryPath },
      { artifactId: 'real-shell-dom-console-a11y', file: pageSummaryPath },
      { artifactId: 'process-summary', file: processSummaryPath },
      { artifactId: 'journey-environment', file: environmentPath },
      { artifactId: 'journey-checkpoint-proof', file: proofPath },
      ...screenshotFiles.map((file, index) => ({
        artifactId: artifactIdFor('real-shell', screenshotsRoot, file, index),
        file,
      })),
    ];
    const outcome = checkpoints.every((checkpoint) => checkpoint.outcome === 'passed')
      && processProblems.length === 0 ? 'passed' : 'failed';
    const result = {
      schemaVersion: 'nimi.local-agent-product-journey-result/v2',
      journeyTrialId: trial.identity.journeyTrialId,
      journeyId: journey.journey_id,
      tier: journey.applicable_layer,
      batch: trial.identity.batch,
      repeatIndex: trial.identity.repeatIndex,
      sourceState,
      electronArtifactPosture: observations.electronArtifactPosture,
      environmentIdentity,
      durationMs: Math.round(performance.now() - started),
      checkpoints,
      leafResults,
      artifacts: [],
      processProblems,
      privacy: { ok: privacyOk, findings: privacyOk ? [] : ['protected carrier page observation detected console/storage/network authority material'] },
      outcome,
    };
    const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
    if (persisted.result.outcome !== 'passed') {
      const failed = persisted.result.checkpoints
        .filter((checkpoint) => checkpoint.outcome !== 'passed')
        .map((checkpoint) => checkpoint.checkpointId);
      throw new Error(`dev-kernel-core product checkpoints failed: ${failed.join(', ')}`);
    }
    return persisted;

}
