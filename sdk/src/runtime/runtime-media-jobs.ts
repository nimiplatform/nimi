import { ReasonCode } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import { createNimiError } from './errors.js';
import {
  ScenarioJobStatus,
  type ScenarioArtifact,
  type ScenarioOutput,
  type ScenarioJob,
  type ScenarioJobEvent,
} from './generated/runtime/v1/ai';
import { Struct as ProtoStruct } from './generated/google/protobuf/struct.js';
import { ReasonCode as RuntimeReasonCode } from './generated/runtime/v1/common';
import type { RuntimeInternalContext } from './internal-context.js';
import type { ScenarioJobSubmitInput } from './types.js';
import {
  DEFAULT_MEDIA_POLL_INTERVAL_MS,
  DEFAULT_MEDIA_TIMEOUT_MS,
  ensureText,
  mediaStatusToString,
  normalizeText,
  nowIso,
  sleep,
  wrapModeBMediaStream,
} from './helpers.js';
import { runtimeBuildSubmitScenarioJobRequestForMedia } from './runtime-media-request.js';

export async function runtimeSubmitScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  input: ScenarioJobSubmitInput,
): Promise<ScenarioJob> {
  const request = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, input);
  const metadata = input.input.metadata;

  const response = await ctx.invokeWithClient(async (client) => client.ai.submitScenarioJob(
    request,
    ctx.resolveRuntimeCallOptions({
      timeoutMs: request.head?.timeoutMs,
      idempotencyKey: request.idempotencyKey,
      metadata,
    }),
  ));

  if (!response.job) {
    throw createNimiError({
      message: 'submitScenarioJob returned empty job',
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_scenario_job_request',
      source: 'runtime',
    });
  }

  const job = response.job;
  ctx.emitTelemetry('media.job.status', {
    jobId: job.jobId,
    status: mediaStatusToString(job.status),
    at: nowIso(),
  });

  return job;
}

function normalizeScenarioJobReasonCode(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const enumName = RuntimeReasonCode[numeric as RuntimeReasonCode];
    if (enumName && enumName !== 'REASON_CODE_UNSPECIFIED') {
      return String(enumName).trim();
    }
  }
  return normalizeText(value);
}

function scenarioJobReasonDetails(job: ScenarioJob): JsonObject | undefined {
  if (!job.reasonMetadata) {
    return undefined;
  }
  const json = ProtoStruct.toJson(job.reasonMetadata);
  return json && typeof json === 'object' && !Array.isArray(json)
    ? json as JsonObject
    : undefined;
}

export async function runtimeGetScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<ScenarioJob> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getScenarioJob({
    jobId: ensureText(jobId, 'jobId'),
  }));

  if (!response.job) {
    throw createNimiError({
      message: `scenario job not found: ${jobId}`,
      reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
      actionHint: 'check_job_id_or_retry_submit',
      source: 'runtime',
    });
  }

  return response.job;
}

export async function runtimeCancelScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  input: { jobId: string; reason?: string },
): Promise<ScenarioJob> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.cancelScenarioJob({
    jobId: ensureText(input.jobId, 'jobId'),
    reason: normalizeText(input.reason),
  }));

  if (!response.job) {
    throw createNimiError({
      message: `cancelScenarioJob returned empty job: ${input.jobId}`,
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_or_check_job_status',
      source: 'runtime',
    });
  }

  const job = response.job;
  ctx.emitTelemetry('media.job.status', {
    jobId: job.jobId,
    status: mediaStatusToString(job.status),
    at: nowIso(),
  });

  return job;
}

export async function runtimeSubscribeScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<AsyncIterable<ScenarioJobEvent>> {
  const raw = await ctx.invokeWithClient(async (client) => client.ai.subscribeScenarioJobEvents({
    jobId: ensureText(jobId, 'jobId'),
  }));
  return wrapModeBMediaStream(raw);
}

export async function runtimeGetScenarioArtifactsForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string; output?: ScenarioOutput }> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getScenarioArtifacts({
    jobId: ensureText(jobId, 'jobId'),
  }));

  return {
    artifacts: response.artifacts || [],
    traceId: normalizeText(response.traceId) || undefined,
    output: response.output,
  };
}

export async function runtimeWaitForScenarioJobCompletion(
  ctx: RuntimeInternalContext,
  jobId: string,
  input: {
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<ScenarioJob> {
  const timeoutMs = Number(input.timeoutMs || ctx.options.timeoutMs || DEFAULT_MEDIA_TIMEOUT_MS)
    || DEFAULT_MEDIA_TIMEOUT_MS;
  const startedAt = Date.now();

  let cancelRequested = false;

  const cancel = async (reason: string): Promise<void> => {
    if (cancelRequested) {
      return;
    }
    cancelRequested = true;
    try {
      await runtimeCancelScenarioJobForMedia(ctx, {
        jobId,
        reason,
      });
    } catch {
      // best effort cancellation
    }
  };

  while (true) {
    if (input.signal?.aborted) {
      await cancel('aborted_by_abort_signal');
      throw createNimiError({
        message: 'scenario job aborted',
        reasonCode: ReasonCode.OPERATION_ABORTED,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    const job = await runtimeGetScenarioJobForMedia(ctx, jobId);

    ctx.emitTelemetry('media.job.status', {
      jobId,
      status: mediaStatusToString(job.status),
      at: nowIso(),
    });

    if (job.status === ScenarioJobStatus.COMPLETED) {
      return job;
    }

    if (
      job.status === ScenarioJobStatus.FAILED
      || job.status === ScenarioJobStatus.CANCELED
      || job.status === ScenarioJobStatus.TIMEOUT
    ) {
      const reasonCode = normalizeScenarioJobReasonCode(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE;
      throw createNimiError({
        message: normalizeText(job.reasonDetail) || `scenario job failed: ${reasonCode}`,
        reasonCode,
        actionHint: 'retry_scenario_job_request',
        traceId: normalizeText(job.traceId) || undefined,
        source: 'runtime',
        details: scenarioJobReasonDetails(job),
      });
    }

    if ((Date.now() - startedAt) > timeoutMs) {
      await cancel('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'scenario job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    await sleep(DEFAULT_MEDIA_POLL_INTERVAL_MS);
  }
}
