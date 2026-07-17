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
  pointRowsForJourney,
} from './cross-app-driver.mjs';
import { repoRoot } from './registry.mjs';
import { assertSourceState } from './source-state.mjs';
import { validateJourneyResult } from './validation.mjs';
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
        ['zero-grant-session', observations.zeroGrant.session?.state === 'session-bound-zero-grant'],
        ['operation-denied-before-grant', observations.noGrant.lastError?.reasonCode === 'no-grant'],
        ['selected-runtime-agent-operation', Boolean(observations.ownerSelectedOperation.conversationAnchorId)],
        ['process-mismatch-denied', isRuntimeObservedProcessMismatch(observations.processMismatch)],
        ['grant-revoked-next-operation-denied', ['grant-revoked', 'revoked'].includes(observations.grantRevoked.lastError?.reasonCode)],
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
        zeroGrantState: observations.zeroGrant.session?.state || null,
        noGrantReason: observations.noGrant.lastError?.reasonCode || null,
        selectedOperationAnchorId: observations.ownerSelectedOperation.conversationAnchorId || null,
        processMismatchReason: observations.processMismatch.lastError?.reasonCode || null,
        grantRevokedReason: observations.grantRevoked.lastError?.reasonCode || null,
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
      assertSourceState(sourceState, repoRoot);
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
    anchorId, firstTurn, processLedger, journey, architecture, trial, sourceState, outputDir,
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
    const zhiyuAccessibility = assessAccessibilityAudit(zhiyuAudit, { requiresInput: true });
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
        narrowMetrics: observations.zhiyuZeroNarrowMetrics,
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
      },
      productionAccountSession: {
        state: observations.primaryAccountSession?.state || null,
        accountProjection: observations.primaryAccountSession?.accountProjection || null,
        productionInert: observations.primaryAccountSession?.productionInert ?? null,
        runtimeCandidateId: serviceBefore.runtimeCandidateId,
      },
      runOnceApproval: observations.runOnceApproval,
      zeroGrant: {
        state: observations.zeroGrant.state,
        session: observations.zeroGrant.session,
      },
      noGrantReason: observations.noGrant.lastError?.reasonCode,
      selectedOperationAnchorId: observations.ownerSelectedOperation.conversationAnchorId,
      processMismatchReason: observations.processMismatch.lastError?.reasonCode,
      grantRevokedReason: observations.grantRevoked.lastError?.reasonCode,
      rememberedApproval: observations.rememberedApproval,
      rememberedInitialGrantPosture: {
        posture: observations.rememberedInitialGrantPosture.posture,
        state: observations.rememberedInitialGrantPosture.evidence.state,
        reasonCode: observations.rememberedInitialGrantPosture.evidence.lastError?.reasonCode || null,
      },
      rememberedAuthorization: observations.rememberedAuthorization,
      conversation: {
        anchorId,
        threadId: firstTurn.evidence.threadId,
        eventNames: firstTurn.evidence.eventNames,
        transcriptMessageCount: firstTurn.evidence.transcript.length,
        keyboardFocusTestId: firstTurn.focused,
      },
      editBuildRestart: observations.editBuildRestart,
      mode: {
        off: observations.modeOff,
        on: observations.modeOn,
        dormantAuthorization: observations.dormantAuthorization,
        reactivationApproval: observations.reactivationApproval,
        reactivatedAuthorization: observations.reactivatedAuthorization,
      },
      runtimeRestart: observations.runtimeRestart,
      accountSwitch: observations.accountSwitch,
      projectRevoke: {
        operationId: observations.projectRevoke.operationId,
        attempted: observations.projectRevoke.attempted,
        beforeState: observations.projectRevoke.beforeState,
        beforeReasonCode: observations.projectRevoke.beforeReasonCode,
        denial: {
          state: observations.projectRevoke.denial?.state || '',
          lastError: observations.projectRevoke.denial?.lastError || null,
        },
      },
      sendDisabledAfterEmptyDraft: observations.sendDisabledAfterEmptyDraft,
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
    const zhiyuLayoutOk = observations.zhiyuZeroNarrowMetrics.scrollWidth
      <= observations.zhiyuZeroNarrowMetrics.clientWidth
      && zhiyuRevokedNarrowMetrics.scrollWidth <= zhiyuRevokedNarrowMetrics.clientWidth;
    const accountSwitchDenied = ['account-changed', 'revoked', 'process-replaced'].includes(
      observations.accountSwitch.evidence?.lastError?.reasonCode,
    ) || observations.accountSwitch.runs.some((run) => (
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
    pass('zero-grant-session', observations.zeroGrant.session?.state === 'session-bound-zero-grant');
    pass('operation-denied-before-grant', observations.noGrant.lastError?.reasonCode === 'no-grant');
    pass('selected-operation-granted', observations.ownerSelectedOperation.openPermission?.state === 'granted');
    pass('selected-runtime-agent-operation', Boolean(observations.ownerSelectedOperation.conversationAnchorId), { conversationAnchorId: observations.ownerSelectedOperation.conversationAnchorId });
    pass('process-mismatch-denied', processMismatchDenied, { reasonCode: observations.processMismatch.lastError?.reasonCode || null });
    pass('grant-revoked-next-operation-denied', ['grant-revoked', 'revoked'].includes(observations.grantRevoked.lastError?.reasonCode));
    pass('remembered-project-admitted', observations.rememberedApproval.decision === 'allow-remember-project'
      && ['session-zero-grant', 'revoked-grant-history'].includes(observations.rememberedInitialGrantPosture.posture)
      && observations.rememberedAuthorization.state === 'active'
      && observations.rememberedAuthorization.persistence === 'remember_project', {
      initialGrantPosture: observations.rememberedInitialGrantPosture.posture,
    });
    pass('runtime-agent-conversation', firstTurn.evidence.eventNames.includes('runtime.agent.turn.completed') && firstTurn.evidence.transcript.length >= 2, { conversationAnchorId: anchorId });
    pass('edit-build-process-replaced', observations.editBuildRestart.preEditRuns[0]?.hostGeneration < observations.editBuildRestart.postEditRuns[0]?.hostGeneration, { buildMarker });
    pass('conversation-resumed-after-process-replacement', observations.editBuildRestart.anchorAfter === anchorId && observations.editBuildRestart.transcriptAfter > observations.editBuildRestart.transcriptBefore, { conversationAnchorId: anchorId });
    pass('mode-off-dormant', observations.modeOff === 'off'
      && observations.dormantAuthorization.state === 'dormant'
      && observations.dormantAuthorization.selector === observations.rememberedAuthorization.selector);
    pass('remembered-project-reactivated', observations.modeOn === 'on'
      && observations.reactivationApproval.decision === 'allow-remember-project'
      && observations.reactivatedAuthorization.state === 'active'
      && observations.reactivatedAuthorization.selector === observations.rememberedAuthorization.selector);
    pass('fixed-service-restarted', isRuntimeRestartUiTransition(observations.runtimeRestart), {
      beforeProcessId: observations.runtimeRestart.before.processId,
      afterProcessId: observations.runtimeRestart.after.processId,
      unavailableState: observations.runtimeRestart.unavailableUi.state,
      recoveredState: observations.runtimeRestart.recoveredUi.state,
    });
    pass('conversation-resumed-after-runtime-restart', observations.runtimeRestart.anchorAfter === anchorId && observations.runtimeRestart.transcriptAfter > observations.runtimeRestart.transcriptBefore, { conversationAnchorId: anchorId });
    pass('account-switch-invalidated', accountSwitchDenied, { secondaryAccountId: fixtureConfig.secondaryAccountId });
    pass('project-revoked-next-operation-denied', isTypedProjectRevocationDenial(observations.projectRevoke), {
      operationId: observations.projectRevoke.operationId,
      reasonCode: observations.projectRevoke.denial?.lastError?.reasonCode || null,
    });
    pass('desktop-real-shell-acceptance', desktopLayoutOk && desktopAccessibility.ok && observations.runOnceApproval.disabledBeforeRisk === true);
    pass('zhiyu-real-shell-acceptance', zhiyuLayoutOk && zhiyuAccessibility.ok && firstTurn.focused === 'zhiyu-dev-kernel-composer' && observations.sendDisabledAfterEmptyDraft === true);
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

    const points = pointRowsForJourney(architecture, journey.journey_id);
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
      conversationAnchorId: anchorId,
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
    assertSourceState(sourceState, repoRoot);
    const persisted = persistResultEvidence({ outputDir, result, artifactInputs });
    const failures = validateJourneyResult({
      architecture,
      journey,
      result: persisted.result,
      expectedSourceState: sourceState,
    });
    if (failures.length > 0) throw new Error(`dev-kernel-core result validation failed: ${failures.join('; ')}`);
    if (persisted.result.outcome !== 'passed') {
      const failed = persisted.result.checkpoints
        .filter((checkpoint) => checkpoint.outcome !== 'passed')
        .map((checkpoint) => checkpoint.checkpointId);
      throw new Error(`dev-kernel-core product checkpoints failed: ${failed.join(', ')}`);
    }
    return persisted;

}
