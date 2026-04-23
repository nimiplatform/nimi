import type { ExecuteLocalKernelTurnResult } from '../../../llm-adapter/execution/types';
import { emitRuntimeLog } from '../../../telemetry/logger';
import { extractRuntimeErrorFields } from '../../../telemetry/error-fields';
import type { ExecuteLocalTurnInput, KernelStage } from '../../contracts/types';
import { recordDesktopWorldEvolutionLocalTurnExecutionEvent } from '../../../world-evolution/execution-events';

type LocalTurnFlowInput = {
  input: ExecuteLocalTurnInput;
  invokeTurnHooks: (input: {
    point: 'pre-policy' | 'pre-model' | 'post-state' | 'pre-commit';
    context: Record<string, unknown>;
  }) => Promise<{ context: Record<string, unknown> }>;
  executeLocalKernelTurn: (input: ExecuteLocalTurnInput) => Promise<ExecuteLocalKernelTurnResult>;
  appendAudit: (entry: {
    id: string;
    stage: KernelStage;
    eventType: string;
    decision: 'ALLOW' | 'DENY' | 'ALLOW_WITH_WARNING';
    reasonCodes: string[];
    payload?: Record<string, unknown>;
    occurredAt: string;
  }) => Promise<void>;
  reportCrash: (key: string) => number;
  shouldDisable: (key: string) => boolean;
};

export async function runLocalTurnFlow({
  input,
  invokeTurnHooks,
  executeLocalKernelTurn,
  appendAudit,
  reportCrash,
  shouldDisable,
}: LocalTurnFlowInput): Promise<ExecuteLocalKernelTurnResult> {
  const prePolicy = await invokeTurnHooks({
    point: 'pre-policy',
    context: {
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      userInput: input.userInputText,
    },
  });
  const effectiveInput = String(prePolicy.context.userInput || input.userInputText);

  const preModel = await invokeTurnHooks({
    point: 'pre-model',
    context: {
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      runtimeInput: effectiveInput,
    },
  });
  const runtimeInput = String(preModel.context.runtimeInput || effectiveInput);

  try {
    const result = await executeLocalKernelTurn({
      ...input,
      userInputText: runtimeInput,
    });

    recordDesktopWorldEvolutionLocalTurnExecutionEvent({
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      worldId: input.worldId,
      agentId: input.agentId,
      provider: input.provider,
      mode: input.mode,
      traceId: result.traceId,
      eventKind: 'LOCAL_TURN_EXECUTED',
      stage: 'TERMINAL',
      effectClass: 'NONE',
      reason: 'local turn executed',
      evidenceRefs: [
        { kind: 'promptTrace', refId: result.promptTraceId },
        ...result.auditEventIds.map((auditEventId) => ({
          kind: 'auditEvent',
          refId: String(auditEventId || '').trim(),
        })),
      ],
      detail: {
        kind: 'desktop-local-turn',
        assistantStyle: result.assistantMessage.style,
        localOnly: result.localOnly,
      },
    });

    await invokeTurnHooks({
      point: 'post-state',
      context: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        stateDelta: result.stateDelta,
      },
    });

    await invokeTurnHooks({
      point: 'pre-commit',
      context: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        promptTraceId: String(result.promptTraceId || ''),
        auditEventIds: Array.isArray(result.auditEventIds) ? result.auditEventIds : [],
      },
    });

    try {
      await appendAudit({
        id: `audit:execute:${Date.now().toString(36)}`,
        stage: 'audit',
        eventType: 'LOCAL_TURN_EXECUTED',
        decision: 'ALLOW',
        reasonCodes: ['LOCAL_EXECUTION_OK'],
        payload: {
          requestId: input.requestId,
          sessionId: input.sessionId,
          provider: input.provider,
        },
        occurredAt: new Date().toISOString(),
      });
    } catch (auditError) {
      const errorFields = extractRuntimeErrorFields(auditError);
      emitRuntimeLog({
        level: 'error',
        area: 'execution-kernel',
        message: 'action:audit-persistence:failed',
        traceId: errorFields.traceId,
        details: {
          eventType: 'LOCAL_TURN_EXECUTED',
          provider: input.provider,
          requestId: input.requestId,
          sessionId: input.sessionId,
          reasonCode: errorFields.reasonCode,
          actionHint: errorFields.actionHint,
          retryable: errorFields.retryable,
          traceId: errorFields.traceId,
          error: errorFields.message || (auditError instanceof Error ? auditError.message : String(auditError || '')),
        },
      });
    }

    return result;
  } catch (error) {
    const crashCount = reportCrash(`local:${input.provider}`);
    const errorFields = extractRuntimeErrorFields(error);
    recordDesktopWorldEvolutionLocalTurnExecutionEvent({
      requestId: input.requestId,
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      worldId: input.worldId,
      agentId: input.agentId,
      provider: input.provider,
      mode: input.mode,
      traceId: errorFields.traceId,
      eventKind: 'LOCAL_TURN_FAILED',
      stage: 'TERMINAL',
      effectClass: 'NONE',
      reason: errorFields.reasonCode || 'local turn failed',
      detail: {
        kind: 'desktop-local-turn-error',
        crashCount,
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
    try {
      await appendAudit({
        id: `audit:execute:${Date.now().toString(36)}`,
        stage: 'audit',
        eventType: 'LOCAL_TURN_FAILED',
        decision: 'DENY',
        reasonCodes: ['CRASH_ISOLATED'],
        payload: {
          provider: input.provider,
          crashCount,
          error: error instanceof Error ? error.message : String(error),
        },
        occurredAt: new Date().toISOString(),
      });
    } catch (auditError) {
      const auditErrorFields = extractRuntimeErrorFields(auditError);
      emitRuntimeLog({
        level: 'error',
        area: 'execution-kernel',
        message: 'action:audit-persistence:failed',
        traceId: auditErrorFields.traceId,
        details: {
          eventType: 'LOCAL_TURN_FAILED',
          provider: input.provider,
          requestId: input.requestId,
          sessionId: input.sessionId,
          reasonCode: auditErrorFields.reasonCode,
          actionHint: auditErrorFields.actionHint,
          retryable: auditErrorFields.retryable,
          traceId: auditErrorFields.traceId,
          error: auditErrorFields.message || (auditError instanceof Error ? auditError.message : String(auditError || '')),
        },
      });
    }
    if (shouldDisable(`local:${input.provider}`)) {
      throw new Error('CRASH_ISOLATED: provider disabled by crash-isolator', { cause: error });
    }
    throw error;
  }
}
