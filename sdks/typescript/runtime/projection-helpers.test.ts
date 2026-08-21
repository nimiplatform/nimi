import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asNimiRuntimeCallError,
  formatNimiRuntimeErrorDetail,
  getNimiRuntimeScenarioJobTerminalStatusFromError,
  getNimiRuntimeReasonCodeMessage,
  getNimiRuntimeReasonCodeDefaultMessage,
  normalizeNimiRuntimeReasonCode,
  projectNimiRuntimeAuditCallerKindName,
  projectNimiRuntimeUsageWindowName,
  runNimiRuntimeScenarioJob,
  toNimiRuntimeProtoStruct,
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
  ScenarioJobEventType,
  ScenarioType,
  UsageWindow,
  VoiceAssetPersistence,
  VoiceAssetStatus,
  VoiceCreationSource,
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
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_MEDIA_IDEMPOTENCY_CONFLICT)?.defaultMessage,
    'Media task idempotency conflict occurred.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_MEDIA_OPTION_UNSUPPORTED)?.defaultMessage,
    'Media option is not supported.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_LOCAL_EXECUTION_CANCELED)?.defaultMessage,
    'Local AI execution was canceled.',
  );
  assert.equal(
    getNimiRuntimeReasonCodeMessage(RuntimeGeneratedReasonCode.AI_LOCAL_EXECUTION_OUT_OF_MEMORY)?.defaultMessage,
    'Local AI execution ran out of memory.',
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

test('Runtime voice job runner uses one terminal Get as the result and artifact snapshot', async () => {
  let artifactLookups = 0;
  const terminalJob = {
    ...createScenarioJob('job-voice-1', ScenarioJobStatus.COMPLETED),
    head: { appId: 'app-voice', subjectUserId: 'user-voice', timeoutMs: 0 },
    scenarioType: ScenarioType.VOICE_CREATE,
  };
  const asset = {
    voiceAssetId: 'voice-asset-1', appId: 'app-voice', subjectUserId: 'user-voice', provider: 'dashscope', modelId: '', targetModelId: '',
    providerVoiceRef: 'provider-voice-1', persistence: VoiceAssetPersistence.PROVIDER_PERSISTENT, status: VoiceAssetStatus.ACTIVE,
    metadata: undefined, creationSource: VoiceCreationSource.TEXT_DESCRIPTION,
  };
  const voiceReference = {
    kind: VoiceReferenceKind.VOICE_ASSET,
    reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: asset.voiceAssetId },
  };
  const client: NimiRuntimeScenarioJobClient = {
    async submitScenarioJob() {
      return { job: { ...terminalJob, status: ScenarioJobStatus.SUBMITTED } };
    },
    async getScenarioJob() {
      return { job: terminalJob, asset, voiceReference };
    },
    async cancelScenarioJob() { return {}; },
    async *subscribeScenarioJobEvents() {
      yield { eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED, sequence: '1', traceId: terminalJob.traceId, job: terminalJob };
    },
    async getScenarioArtifacts() {
      artifactLookups += 1;
      throw new Error('voice terminal result must not require a second artifacts lookup');
    },
  };

  const result = await runNimiRuntimeScenarioJob({
    ai: client,
    request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE },
  });

  assert.equal(artifactLookups, 0);
  assert.deepEqual(result.artifacts, terminalJob.artifacts);
  assert.equal(result.traceId, terminalJob.traceId);
  assert.deepEqual(result.asset, asset);
  assert.deepEqual(result.voiceReference, voiceReference);
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

test('Runtime scenario job runner preserves typed terminal status and safe failure diagnostics', async () => {
  const cases = [
    {
      status: ScenarioJobStatus.FAILED,
      reasonCode: RuntimeGeneratedReasonCode.SESSION_EXPIRED,
      reasonDetail: 'session expired',
      reasonMetadata: { action_hint: 'reauthenticate', retryable: false, failure_stage: 'runtime' },
    },
    {
      status: ScenarioJobStatus.CANCELED,
      reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED,
      reasonDetail: 'acceptance cancellation',
      reasonMetadata: undefined,
    },
    {
      status: ScenarioJobStatus.TIMEOUT,
      reasonCode: RuntimeGeneratedReasonCode.AI_PROVIDER_TIMEOUT,
      reasonDetail: 'provider request timed out',
      reasonMetadata: { action_hint: 'retry_provider_request', retryable: true },
    },
  ] as const;

  for (const expected of cases) {
    const client = createScenarioJobClient([
      {
        job: {
          ...createScenarioJob('job-1', expected.status),
          reasonCode: expected.reasonCode,
          reasonDetail: expected.reasonDetail,
          traceId: 'trace-terminal-1',
          reasonMetadata: expected.reasonMetadata
            ? toNimiRuntimeProtoStruct(expected.reasonMetadata)
            : undefined,
        },
      },
    ]);

    await assert.rejects(
      runNimiRuntimeScenarioJob({
        ai: client,
        request: createScenarioJobRequest(),
      }),
      (error: unknown) => {
        const shaped = error as {
          actionHint?: string;
          details?: { reasonMetadata?: unknown };
          message?: string;
          retryable?: boolean;
          traceId?: string;
        };
        assert.equal(getNimiRuntimeScenarioJobTerminalStatusFromError(error), expected.status);
        assert.equal(shaped.message, expected.reasonDetail);
        assert.equal(shaped.traceId, 'trace-terminal-1');
        if (expected.reasonMetadata) {
          assert.equal(shaped.actionHint, expected.reasonMetadata.action_hint);
          assert.equal(shaped.retryable, expected.reasonMetadata.retryable);
          assert.deepEqual(shaped.details?.reasonMetadata, expected.reasonMetadata);
        }
        return true;
      },
    );
  }
});

test('Runtime scenario job runner recovers a terminal result after a normal stream close', async () => {
  let gets = 0;
  const client = createScenarioJobClient([
    { job: createScenarioJob('job-1', ScenarioJobStatus.RUNNING) },
  ]);
  const guarded: NimiRuntimeScenarioJobClient = {
    ...client,
    async getScenarioJob(request, options) {
      gets += 1;
      return client.getScenarioJob(request, options);
    },
  };

  const result = await runNimiRuntimeScenarioJob({ ai: guarded, request: createScenarioJobRequest() });
  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
  assert.equal(gets, 1);
});

test('Runtime scenario job runner rejects mismatched terminal event type before Get', async () => {
  let gets = 0;
  const completed = createScenarioJob('job-1', ScenarioJobStatus.COMPLETED);
  const base = createScenarioJobClient([]);
  const client: NimiRuntimeScenarioJobClient = {
    ...base,
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING,
        sequence: '1',
        traceId: completed.traceId,
        job: completed,
      };
    },
    async getScenarioJob(request, options) {
      gets += 1;
      return base.getScenarioJob(request, options);
    },
  };

  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: client, request: createScenarioJobRequest() }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );
  assert.equal(gets, 0);
});

test('Runtime scenario job runner rejects a terminal event for another Job before Get', async () => {
  let gets = 0;
  const completed = createScenarioJob('job-other', ScenarioJobStatus.COMPLETED);
  const base = createScenarioJobClient([]);
  const client: NimiRuntimeScenarioJobClient = {
    ...base,
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: completed.traceId,
        job: completed,
      };
    },
    async getScenarioJob(request, options) {
      gets += 1;
      return base.getScenarioJob(request, options);
    },
  };

  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: client, request: createScenarioJobRequest() }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );
  assert.equal(gets, 0);
});

test('Runtime voice job runner rejects malformed terminal result pairs', async () => {
  const terminalJob = {
    ...createScenarioJob('job-1', ScenarioJobStatus.COMPLETED),
    scenarioType: ScenarioType.VOICE_CREATE,
  };
  const base = createScenarioJobClient([{ job: terminalJob }]);
  const asset = {
    voiceAssetId: 'voice-asset-1', appId: '', subjectUserId: '', provider: '', modelId: '', targetModelId: '',
    providerVoiceRef: '', persistence: VoiceAssetPersistence.UNSPECIFIED, status: VoiceAssetStatus.ACTIVE,
    metadata: undefined, creationSource: VoiceCreationSource.TEXT_DESCRIPTION,
  };
  const incomplete: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() { return { job: terminalJob, asset }; },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: incomplete, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const onlyReference: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() {
      return {
        job: terminalJob,
        voiceReference: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: asset.voiceAssetId },
        },
      };
    },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: onlyReference, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const missingPair: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() { return { job: terminalJob }; },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: missingPair, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const mismatched: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() {
      return {
        job: terminalJob,
        asset,
        voiceReference: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: 'voice-asset-other' },
        },
      };
    },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: mismatched, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const inactive: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() {
      return {
        job: terminalJob,
        asset: { ...asset, status: VoiceAssetStatus.DELETED },
        voiceReference: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: asset.voiceAssetId },
        },
      };
    },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: inactive, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const emptyIdentity: NimiRuntimeScenarioJobClient = {
    ...base,
    async getScenarioJob() {
      return {
        job: terminalJob,
        asset: { ...asset, voiceAssetId: '' },
        voiceReference: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: '' },
        },
      };
    },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: emptyIdentity, request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE } }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );

  const nonVoiceJob = { ...terminalJob, scenarioType: ScenarioType.TEXT_GENERATE };
  const nonVoiceWithPair: NimiRuntimeScenarioJobClient = {
    ...base,
    async *subscribeScenarioJobEvents() {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: nonVoiceJob.traceId,
        job: nonVoiceJob,
      };
    },
    async getScenarioJob() {
      return {
        job: nonVoiceJob,
        asset,
        voiceReference: {
          kind: VoiceReferenceKind.VOICE_ASSET,
          reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: asset.voiceAssetId },
        },
      };
    },
  };
  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: nonVoiceWithPair, request: createScenarioJobRequest() }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
  );
});

test('Runtime voice job runner rejects incomplete or cross-owner full VoiceAssets', async () => {
  const terminalJob = {
    ...createScenarioJob('job-1', ScenarioJobStatus.COMPLETED),
    head: { appId: 'app-owner', subjectUserId: 'user-owner', timeoutMs: 0 },
    scenarioType: ScenarioType.VOICE_CREATE,
  };
  const base = createScenarioJobClient([{ job: terminalJob }]);
  const validAsset = {
    voiceAssetId: 'voice-asset-owner', appId: 'app-owner', subjectUserId: 'user-owner', provider: 'dashscope', modelId: '', targetModelId: '',
    providerVoiceRef: 'provider-voice-owner', persistence: VoiceAssetPersistence.PROVIDER_PERSISTENT, status: VoiceAssetStatus.ACTIVE,
    metadata: undefined, creationSource: VoiceCreationSource.TEXT_DESCRIPTION,
  };
  const voiceReference = {
    kind: VoiceReferenceKind.VOICE_ASSET,
    reference: { oneofKind: 'voiceAssetId' as const, voiceAssetId: validAsset.voiceAssetId },
  };
  for (const asset of [
    { ...validAsset, providerVoiceRef: '' },
    { ...validAsset, appId: 'foreign-app' },
  ]) {
    const client: NimiRuntimeScenarioJobClient = {
      ...base,
      async getScenarioJob() { return { job: terminalJob, asset, voiceReference }; },
    };
    await assert.rejects(
      runNimiRuntimeScenarioJob({
        ai: client,
        request: { ...createScenarioJobRequest(), scenarioType: ScenarioType.VOICE_CREATE },
      }),
      (error: unknown) => (error as { code?: string }).code === 'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
    );
  }
});

test('Runtime ScenarioJob abort requests cancellation and reports the Runtime terminal state when available', async () => {
  const controller = new AbortController();
  let cancelReason = '';
  let queryCount = 0;
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async cancelScenarioJob(request) {
      cancelReason = request.reason;
      return {
        job: {
          ...createScenarioJob('job-1', ScenarioJobStatus.CANCELED),
          reasonDetail: 'Canceled by user',
        },
      };
    },
    async getScenarioJob() {
      queryCount += 1;
      return { job: createScenarioJob('job-1', ScenarioJobStatus.RUNNING) };
    },
    async *subscribeScenarioJobEvents() {
      await new Promise(() => undefined);
    },
  };
  const pending = runNimiRuntimeScenarioJob({
    ai: client,
    request: createScenarioJobRequest(),
    signal: controller.signal,
    abortReason: 'tester-user-canceled',
  });

  await Promise.resolve();
  controller.abort('tester-user-canceled');

  await assert.rejects(pending, (error: unknown) => {
    assert.equal(getNimiRuntimeScenarioJobTerminalStatusFromError(error), ScenarioJobStatus.CANCELED);
    return true;
  });
  assert.equal(cancelReason, 'tester-user-canceled');
  assert.equal(queryCount, 0);
});

test('Runtime ScenarioJob abort preserves a Runtime completion that won the cancellation race', async () => {
  const controller = new AbortController();
  const completedJob = createScenarioJob('job-1', ScenarioJobStatus.COMPLETED);
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async getScenarioJob() {
      return { job: completedJob };
    },
    async *subscribeScenarioJobEvents() {
      await new Promise(() => undefined);
    },
  };

  const pending = runNimiRuntimeScenarioJob({
    ai: client,
    request: createScenarioJobRequest(),
    signal: controller.signal,
  });
  controller.abort('tester-user-canceled');

  const result = await pending;
  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
});

test('Runtime ScenarioJob abort waits for the terminal event when cancel initially remains running', async () => {
  const controller = new AbortController();
  let releaseCancellation!: () => void;
  const cancellationRequested = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });
  let queryCount = 0;
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async cancelScenarioJob() {
      releaseCancellation();
      return { job: createScenarioJob('job-1', ScenarioJobStatus.RUNNING) };
    },
    async getScenarioJob() {
      queryCount += 1;
      return { job: createScenarioJob('job-1', ScenarioJobStatus.RUNNING) };
    },
    async *subscribeScenarioJobEvents() {
      await cancellationRequested;
      const job = createScenarioJob('job-1', ScenarioJobStatus.CANCELED);
      yield {
        eventType: scenarioJobEventTypeForStatus(job.status),
        sequence: '1',
        traceId: 'trace-1',
        job,
      };
    },
  };
  const pending = runNimiRuntimeScenarioJob({
    ai: client,
    request: createScenarioJobRequest(),
    signal: controller.signal,
  });

  await Promise.resolve();
  controller.abort('tester-user-canceled');

  await assert.rejects(pending, (error: unknown) => {
    assert.equal(getNimiRuntimeScenarioJobTerminalStatusFromError(error), ScenarioJobStatus.CANCELED);
    return true;
  });
  assert.equal(queryCount, 1);
});

test('Runtime ScenarioJob stream interruption performs one bounded terminal lookup', async () => {
  let queryCount = 0;
  const runningJob = createScenarioJob('job-1', ScenarioJobStatus.RUNNING);
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async getScenarioJob() {
      queryCount += 1;
      return { job: runningJob };
    },
  };

  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: client, request: createScenarioJobRequest() }),
    (error: unknown) => (error as { readonly reasonCode?: unknown }).reasonCode
      === 'SDK_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED',
  );
  assert.equal(queryCount, 1);
});

test('Runtime ScenarioJob stream recovery rejects a terminal lookup for another Job', async () => {
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async getScenarioJob() {
      return { job: createScenarioJob('job-other', ScenarioJobStatus.COMPLETED) };
    },
  };

  await assert.rejects(
    runNimiRuntimeScenarioJob({ ai: client, request: createScenarioJobRequest() }),
    (error: unknown) => (error as { readonly reasonCode?: unknown }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
  );
});

test('Runtime ScenarioJob abort recovery rejects a lookup for another Job', async () => {
  const controller = new AbortController();
  const client: NimiRuntimeScenarioJobClient = {
    ...createScenarioJobClient([]),
    async getScenarioJob() {
      return { job: createScenarioJob('job-other', ScenarioJobStatus.CANCELED) };
    },
    async *subscribeScenarioJobEvents() {
      await new Promise(() => undefined);
    },
  };
  const pending = runNimiRuntimeScenarioJob({
    ai: client,
    request: createScenarioJobRequest(),
    signal: controller.signal,
  });
  controller.abort('tester-user-canceled');

  await assert.rejects(
    pending,
    (error: unknown) => (error as { readonly reasonCode?: unknown }).reasonCode
      === ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
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
          eventType: scenarioJobEventTypeForStatus(event.job.status),
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

function scenarioJobEventTypeForStatus(status: ScenarioJobStatus): ScenarioJobEventType {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED;
    case ScenarioJobStatus.QUEUED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED;
    case ScenarioJobStatus.RUNNING: return ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING;
    case ScenarioJobStatus.COMPLETED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED;
    case ScenarioJobStatus.FAILED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED;
    case ScenarioJobStatus.CANCELED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED;
    case ScenarioJobStatus.TIMEOUT: return ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT;
    default: return ScenarioJobEventType.SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED;
  }
}
