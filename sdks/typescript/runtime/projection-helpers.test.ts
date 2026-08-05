import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asNimiRuntimeCallError,
  formatNimiRuntimeErrorDetail,
  getNimiRuntimeReasonCodeMessage,
  getNimiRuntimeReasonCodeDefaultMessage,
  normalizeNimiRuntimeReasonCode,
  projectNimiCloudConnectorGrantError,
  projectNimiRuntimeAuditCallerKindName,
  projectNimiRuntimeUsageWindowName,
  runNimiRuntimeScenarioJob,
  toNimiRuntimeUserFacingError,
  toNimiRuntimeVoiceReference,
  type NimiRuntimeScenarioJobClient,
  type NimiRuntimeScenarioJobSubmitRequest,
} from './index';
import {
  CallerKind,
  ExecutionMode,
  ReasonCode as RuntimeGeneratedReasonCode,
  ScenarioJobStatus,
  ScenarioType,
  UsageWindow,
  VoiceReferenceKind,
} from '../core-generated/runtime-typed-client';
import { ReasonCode } from '../types';

test('Runtime reason message projection normalizes generated enum values and SDK reason strings', () => {
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.SESSION_EXPIRED)?.defaultMessage,
    'Session has expired.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(' RUNTIME_CALL_FAILED ')?.reasonCode,
    'RUNTIME_CALL_FAILED',
  );
  assert.equal(getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED), null);
  assert.equal(normalizeNimiRuntimeReasonCode(String(RuntimeGeneratedReasonCode.AUTH_TOKEN_EXPIRED)), 'AUTH_TOKEN_EXPIRED');
  assert.equal(getNimiRuntimeReasonCodeDefaultMessage('AI_PROVIDER_RATE_LIMITED'), 'AI provider rate limit was reached.');
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_STREAM_BROKEN)?.defaultMessage,
    'AI streaming response was interrupted.',
  );
  assert.deepEqual(
    projectNimiCloudConnectorGrantError({
      reasonCode: RuntimeGeneratedReasonCode.AI_CONNECTOR_GRANT_SELECTION_REQUIRED,
    }),
    {
      state: 'selection-required',
      tone: 'info',
      message: 'Choose an account authorization before running this Cloud capability.',
      action: 'configure-account-authorization',
    },
  );
  assert.deepEqual(
    projectNimiCloudConnectorGrantError({ reasonCode: 'AI_CONNECTOR_GRANT_REVOKED' }),
    {
      state: 'revoked',
      tone: 'warning',
      message: 'The selected account authorization was revoked. Choose another authorization.',
      action: 'configure-account-authorization',
    },
  );
  assert.deepEqual(
    projectNimiCloudConnectorGrantError(new Error('outer failure', {
      cause: { reasonCode: 'AI_CONNECTOR_GRANT_REVOKED' },
    })),
    {
      state: 'revoked',
      tone: 'warning',
      message: 'The selected account authorization was revoked. Choose another authorization.',
      action: 'configure-account-authorization',
    },
  );
  assert.equal(projectNimiCloudConnectorGrantError(new Error('AI_CONNECTOR_GRANT_REVOKED')), null);
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_MEDIA_IDEMPOTENCY_CONFLICT)?.defaultMessage,
    'Media task idempotency conflict occurred.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_LOCAL_MODEL_UNAVAILABLE)?.defaultMessage,
    'Runtime local execution is unavailable.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED)?.defaultMessage,
    'Local Speech requires explicit download confirmation before continuing.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED)?.defaultMessage,
    'Runtime local speech environment initialization failed. Inspect Runtime diagnostics.',
  );
  assert.equal(
    toNimiRuntimeUserFacingError(
      { reasonCode: ReasonCode.AI_MODEL_NOT_READY, message: 'runtime call failed', actionHint: 'runtime call failed' },
      { fallbackMessage: 'Runtime call failed' },
    ).message,
    'Runtime could not prepare an admitted implementation.',
  );
  assert.equal(
    toNimiRuntimeUserFacingError(
      { reasonCode: ReasonCode.AI_CONNECTOR_DISABLED, message: 'Connector disabled by policy' },
      {
        fallbackMessage: 'Runtime call failed',
        resolveReasonCodeMessage: (reasonCode, defaultMessage) => `${reasonCode}:${defaultMessage}`,
      },
    ).message,
    'Connector disabled by policy',
  );
  assert.equal(asNimiRuntimeCallError(new Error('boom')).reasonCode, 'RUNTIME_CALL_FAILED');
  assert.equal(
    formatNimiRuntimeErrorDetail({ reasonCode: ReasonCode.RUNTIME_UNAVAILABLE, message: 'down', traceId: 'trace-1' }),
    'down (reasonCode=RUNTIME_UNAVAILABLE, traceId=trace-1)',
  );
});

test('Runtime audit projections cover generated enum names', () => {
  assert.equal(projectNimiRuntimeAuditCallerKindName(CallerKind.DESKTOP_CORE), 'DESKTOP_CORE');
  assert.equal(projectNimiRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_APP), 'THIRD_PARTY_APP');
  assert.equal(projectNimiRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_SERVICE), 'THIRD_PARTY_SERVICE');
  assert.equal(projectNimiRuntimeAuditCallerKindName(999), undefined);
  assert.equal(projectNimiRuntimeUsageWindowName(UsageWindow.MINUTE), 'MINUTE');
  assert.equal(projectNimiRuntimeUsageWindowName(UsageWindow.HOUR), 'HOUR');
  assert.equal(projectNimiRuntimeUsageWindowName(UsageWindow.DAY), 'DAY');
  assert.equal(projectNimiRuntimeUsageWindowName('bad'), undefined);
});

test('Runtime speech voice projection maps public refs and rejects provider-native handles', () => {
  assert.deepEqual(toNimiRuntimeVoiceReference({
    kind: 'preset_voice_id',
    presetVoiceId: ' alloy ',
  }), {
    kind: VoiceReferenceKind.PRESET,
    reference: {
      oneofKind: 'presetVoiceId',
      presetVoiceId: 'alloy',
    },
  });

  assert.deepEqual(toNimiRuntimeVoiceReference({
    kind: 'voice_asset_id',
    voiceAssetId: 'voice-1',
  }), {
    kind: VoiceReferenceKind.VOICE_ASSET,
    reference: {
      oneofKind: 'voiceAssetId',
      voiceAssetId: 'voice-1',
    },
  });

  assert.throws(
    () => toNimiRuntimeVoiceReference({
      kind: 'provider_voice_ref',
      providerVoiceRef: 'provider:voice',
    } as never),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_VOICE_REF_KIND_UNSUPPORTED',
  );

  assert.throws(
    () => toNimiRuntimeVoiceReference({ kind: 'preset_voice_id', presetVoiceId: ' ' }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_VOICE_REF_INVALID',
  );
});

test('Runtime scenario job runner follows submit, event stream, artifact lookup, and fail-closed terminal status', async () => {
  const updates: ScenarioJobStatus[] = [];
  const client = createScenarioJobClient([
    { job: createScenarioJob('job-1', ScenarioJobStatus.RUNNING) },
    { job: createScenarioJob('job-1', ScenarioJobStatus.COMPLETED) },
  ]);

  const result = await runNimiRuntimeScenarioJob({
    ai: client,
    request: createScenarioJobRequest(),
    onJobUpdate: (job) => updates.push(job.status),
  });

  assert.deepEqual(updates, [
    ScenarioJobStatus.SUBMITTED,
    ScenarioJobStatus.RUNNING,
    ScenarioJobStatus.COMPLETED,
  ]);
  assert.equal(result.job.jobId, 'job-1');
  assert.equal(result.traceId, 'trace-1');
  assert.deepEqual(result.artifacts, [{ artifactId: 'artifact-1' }]);
});

test('Runtime scenario job runner fails closed on non-completed terminal job', async () => {
  const client = createScenarioJobClient([
    {
      job: {
        ...createScenarioJob('job-1', ScenarioJobStatus.FAILED),
        reasonCode: RuntimeGeneratedReasonCode.SESSION_EXPIRED,
        reasonDetail: 'session expired',
      },
    },
  ]);

  await assert.rejects(
    runNimiRuntimeScenarioJob({
      ai: client,
      request: createScenarioJobRequest(),
    }),
    (error: unknown) => {
      const shaped = error as { code?: string; reasonCode?: string; source?: string };
      assert.equal(shaped.code, 'SESSION_EXPIRED');
      assert.equal(shaped.reasonCode, 'SESSION_EXPIRED');
      assert.equal(shaped.source, 'runtime');
      return true;
    },
  );
});

function createScenarioJobRequest(): NimiRuntimeScenarioJobSubmitRequest {
  return {
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: 'request-1',
    idempotencyKey: 'idem-1',
    labels: {},
    extensions: [],
  };
}

function createScenarioJob(jobId: string, status: ScenarioJobStatus) {
  return {
    jobId,
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: 0,
    modelResolved: '',
    status,
    providerJobId: '',
    reasonCode: RuntimeGeneratedReasonCode.REASON_CODE_UNSPECIFIED,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-1',
    ignoredExtensions: [],
    progressPercent: status === ScenarioJobStatus.RUNNING ? 50 : 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
  };
}

function createScenarioJobClient(
  events: readonly { readonly job: ReturnType<typeof createScenarioJob> }[],
): NimiRuntimeScenarioJobClient {
  return {
    async submitScenarioJob() {
      return {
        job: createScenarioJob('job-1', ScenarioJobStatus.SUBMITTED),
      };
    },
    async getScenarioJob() {
      return {
        job: createScenarioJob('job-1', ScenarioJobStatus.COMPLETED),
      };
    },
    async cancelScenarioJob() {
      return {};
    },
    async *subscribeScenarioJobEvents() {
      for (const event of events) {
        yield {
          eventType: 0,
          sequence: '1',
          traceId: 'trace-1',
          job: event.job,
        };
      }
    },
    async getScenarioArtifacts() {
      return {
        jobId: 'job-1',
        artifacts: [{ artifactId: 'artifact-1' }],
        traceId: 'trace-1',
      };
    },
  };
}
