import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  createLive2dDiagnostic,
  type ChatAgentAvatarLive2dDiagnostic,
  type Live2dRuntimeError,
} from './chat-agent-avatar-live2d-diagnostics';
import type { ChatAgentAvatarLive2dModelSource } from './chat-agent-avatar-live2d-viewport-state';

type ChatAgentAvatarLive2dFailureReportInput = {
  assetRef: string;
  source: ChatAgentAvatarLive2dModelSource | null;
  stage: ChatAgentAvatarLive2dDiagnostic['stage'];
  error: string;
  cause?: unknown;
  runtimeUrls: string[];
  assetProbeFailures: string[];
  recoveryAttemptCount: number;
  recoveryReason: string | null;
};

export function createLive2dViewportFailureDiagnostic(
  input: ChatAgentAvatarLive2dFailureReportInput,
): ChatAgentAvatarLive2dDiagnostic {
  return {
    ...createLive2dDiagnostic({
      assetRef: input.assetRef,
      source: input.source,
      stage: input.stage,
      status: 'error',
      error: input.error,
      cause: input.cause,
      recoveryAttemptCount: input.recoveryAttemptCount,
      recoveryReason: input.recoveryReason,
    }),
    runtimeUrls: input.runtimeUrls,
    assetProbeFailures: input.assetProbeFailures,
  };
}

export function logLive2dViewportFailure(input: ChatAgentAvatarLive2dFailureReportInput): void {
  const runtimeError = input.cause as Live2dRuntimeError | null | undefined;
  logRendererEvent({
    level: 'error',
    area: 'chat-live2d',
    message: 'action:live2d-viewport-load-failed',
    details: {
      assetRef: input.assetRef,
      stage: input.stage,
      resourceId: input.source?.resourceId || null,
      fileUrl: input.source?.fileUrl || null,
      modelUrl: input.source?.modelUrl || null,
      mocVersion: input.source?.mocVersion ?? null,
      error: input.error,
      errorUrl: typeof runtimeError?.url === 'string' ? runtimeError.url || null : null,
      errorStatus: typeof runtimeError?.status === 'number' ? runtimeError.status || null : null,
      runtimeUrls: input.runtimeUrls,
      assetProbeFailures: input.assetProbeFailures,
    },
  });
}
