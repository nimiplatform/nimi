// Brain <-> Body Symbiosis Coordinator for apps/harness (agent.body.pc).
// Implements the v2.1 startup handshake (tombstone-first drain BEFORE projection
// reconciliation), 10s in-memory heartbeat, monotonic (lease_epoch, projection_seq),
// synchronous AuthorizeBodySideEffect fence, logical model ID local-agent:<binding>,
// streaming inference via StreamLocalAgentBodyStep (purpose=INFERENCE) with transient
// toolCallActivity keepalive, and beforeCompact compaction step with 2 bounded retries.
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
import { randomUUID } from 'node:crypto';
import type { NimiLocalAppAgentSessionClient } from '@nimiplatform/sdk/app';

export const HARNESS_PC_CAPABILITY_NAMESPACE = 'os.pc.workspace';

export interface BodyStepMessage {
  readonly role: string;
  readonly contentJson: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly outboxId?: string;
}

export interface BodyStepToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchemaJson: string;
}

export interface BodyInferenceStepInput {
  readonly agentHandle: string;
  readonly agentBinding: string;
  readonly workSessionRef: string;
  readonly workingMessages: readonly BodyStepMessage[];
  readonly tools: readonly BodyStepToolDef[];
  readonly workspaceName?: string;
  readonly permissionMode?: string;
  readonly toolNames?: readonly string[];
  readonly stepRequestId?: string;
}

export type DecodedBodyStepEvent =
  | { readonly kind: 'textDelta'; readonly textDelta: string; readonly effectiveContextBudgetTokens?: number }
  | { readonly kind: 'reasoningSummaryDelta'; readonly reasoningSummaryDelta: string; readonly effectiveContextBudgetTokens?: number }
  | { readonly kind: 'toolCallActivity'; readonly callId: string; readonly toolName: string; readonly argumentsDeltaBytes: number; readonly accumulatedBytes: number }
  | { readonly kind: 'toolCall'; readonly callId: string; readonly name: string; readonly argumentsJson: string }
  | {
    readonly kind: 'done';
    readonly finishReason: string;
    readonly usageInputTokens: number;
    readonly usageOutputTokens: number;
    readonly stepMac: string;
    readonly compactionSummary: string;
    readonly postCompactionMac: string;
    readonly effectiveContextBudgetTokens: number;
  }
  | { readonly kind: 'failed'; readonly message: string; readonly memoryInvalidated: boolean };

export interface BodyCompactionInput {
  readonly agentHandle?: string;
  readonly workSessionRef: string;
  readonly agentBinding: string;
  readonly workingMessages: readonly BodyStepMessage[];
  readonly keptTailMessages: readonly BodyStepMessage[];
}

export interface BodyCompactionOutput {
  readonly summary: string;
  readonly postCompactionMac: string;
  readonly usageInputTokens: number;
  readonly usageOutputTokens: number;
  readonly effectiveContextBudgetTokens: number;
}

export interface BodyOutboxHandlers {
  onPurgeSession(workSessionRef: string, outboxId: string): Promise<void>;
  onPurgeAgent(agentBinding: string, outboxId: string): Promise<void>;
  onInvalidateMemory(workSessionRef: string, outboxId: string): Promise<void>;
  onNewIntent(envelope: {
    outboxId: string;
    workSessionRef: string;
    agentBinding: string;
    payloadJson: string;
  }): Promise<void>;
  onReconcileAfterTombstones(): Promise<readonly {
    workSessionRef: string;
    status: string;
    title: string;
    workspaceRoot?: string;
    permissionMode?: string;
    latestReceiptJson?: string;
  }[]>;
  onLeaseLost?: (reason: string) => void;
}

/**
 * Computes the v2.1 stable logical Model ID so switching a LocalAgent's model
 * in Nimi Home NEVER invalidates or breaks durable pi-durable sessions.
 */
export function logicalAgentModelId(agentBinding: string): string {
  const trimmed = agentBinding.trim();
  return trimmed ? `local-agent:${trimmed}` : 'local-agent:default';
}

/**
 * Decodes a protobuf-ts BodyStepStreamEvent (whose oneof is stored under
 * `ev.payload = { oneofKind, ... }`), with bounded fallback for flat unit mocks.
 */
export function decodeBodyStepStreamEvent(ev: Record<string, unknown>): DecodedBodyStepEvent | null {
  const budgetTop = typeof ev.effectiveContextBudgetTokens === 'number' && ev.effectiveContextBudgetTokens > 0
    ? ev.effectiveContextBudgetTokens
    : undefined;
  const payload = ev.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload === 'object' && typeof payload.oneofKind === 'string') {
    switch (payload.oneofKind) {
      case 'textDelta':
        return { kind: 'textDelta', textDelta: String(payload.textDelta ?? ''), effectiveContextBudgetTokens: budgetTop };
      case 'reasoningSummaryDelta':
        return { kind: 'reasoningSummaryDelta', reasoningSummaryDelta: String(payload.reasoningSummaryDelta ?? ''), effectiveContextBudgetTokens: budgetTop };
      case 'toolCallActivity': {
        const act = (payload.toolCallActivity ?? {}) as Record<string, unknown>;
        return {
          kind: 'toolCallActivity',
          callId: String(act.callId ?? ''),
          toolName: String(act.toolName ?? ''),
          argumentsDeltaBytes: Number(act.argumentsDeltaBytes ?? 0),
          accumulatedBytes: Number(act.accumulatedBytes ?? 0),
        };
      }
      case 'toolCall': {
        const tc = (payload.toolCall ?? {}) as Record<string, unknown>;
        return {
          kind: 'toolCall',
          callId: String(tc.callId ?? ''),
          name: String(tc.name ?? ''),
          argumentsJson: String(tc.argumentsJson ?? '{}'),
        };
      }
      case 'done': {
        const done = (payload.done ?? {}) as Record<string, unknown>;
        return {
          kind: 'done',
          finishReason: String(done.finishReason ?? 'stop'),
          usageInputTokens: Number(done.usageInputTokens ?? 0),
          usageOutputTokens: Number(done.usageOutputTokens ?? 0),
          stepMac: String(done.stepMac ?? ''),
          compactionSummary: String(done.compactionSummary ?? ''),
          postCompactionMac: String(done.postCompactionMac ?? ''),
          effectiveContextBudgetTokens: Number(done.effectiveContextBudgetTokens ?? budgetTop ?? 0),
        };
      }
      case 'failed': {
        const failed = (payload.failed ?? {}) as Record<string, unknown>;
        return {
          kind: 'failed',
          message: String(failed.message ?? 'Body step failed.'),
          memoryInvalidated: Boolean(failed.memoryInvalidated),
        };
      }
      default:
        return null;
    }
  }
  // Legacy flat test-stub compatibility only if payload oneof is absent.
  if (typeof ev.textDelta === 'string') {
    return { kind: 'textDelta', textDelta: ev.textDelta, effectiveContextBudgetTokens: budgetTop };
  }
  if (typeof ev.reasoningSummaryDelta === 'string') {
    return { kind: 'reasoningSummaryDelta', reasoningSummaryDelta: ev.reasoningSummaryDelta, effectiveContextBudgetTokens: budgetTop };
  }
  if (ev.toolCallActivity && typeof ev.toolCallActivity === 'object') {
    const act = ev.toolCallActivity as Record<string, unknown>;
    return {
      kind: 'toolCallActivity',
      callId: String(act.callId ?? ''),
      toolName: String(act.toolName ?? ''),
      argumentsDeltaBytes: Number(act.argumentsDeltaBytes ?? 0),
      accumulatedBytes: Number(act.accumulatedBytes ?? 0),
    };
  }
  if (ev.toolCall && typeof ev.toolCall === 'object') {
    const tc = ev.toolCall as Record<string, unknown>;
    return {
      kind: 'toolCall',
      callId: String(tc.callId ?? ''),
      name: String(tc.name ?? ''),
      argumentsJson: String(tc.argumentsJson ?? '{}'),
    };
  }
  if (ev.done && typeof ev.done === 'object') {
    const done = ev.done as Record<string, unknown>;
    return {
      kind: 'done',
      finishReason: String(done.finishReason ?? 'stop'),
      usageInputTokens: Number(done.usageInputTokens ?? 0),
      usageOutputTokens: Number(done.usageOutputTokens ?? 0),
      stepMac: String(done.stepMac ?? ''),
      compactionSummary: String(done.compactionSummary ?? ''),
      postCompactionMac: String(done.postCompactionMac ?? ''),
      effectiveContextBudgetTokens: Number(done.effectiveContextBudgetTokens ?? budgetTop ?? 0),
    };
  }
  if (ev.failed && typeof ev.failed === 'object') {
    const failed = ev.failed as Record<string, unknown>;
    return {
      kind: 'failed',
      message: String(failed.message ?? 'Body step failed.'),
      memoryInvalidated: Boolean(failed.memoryInvalidated),
    };
  }
  return null;
}

export class HarnessBodySymbiosisClient {
  private readonly deviceId: string;
  private readonly instanceId: string;
  private readonly client: NimiLocalAppAgentSessionClient;
  private readonly handlers: BodyOutboxHandlers;
  private leaseEpoch = 0;
  private projectionSeq = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private tombstonesDrained = false;
  private effectiveContextBudgetTokens = 64_000;
  private consecutiveHeartbeatFailures = 0;

  constructor(options: {
    deviceId: string;
    client: NimiLocalAppAgentSessionClient;
    handlers: BodyOutboxHandlers;
    instanceId?: string;
  }) {
    this.deviceId = options.deviceId;
    this.instanceId = options.instanceId ?? randomUUID();
    this.client = options.client;
    this.handlers = options.handlers;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getLeaseEpoch(): number {
    return this.leaseEpoch;
  }

  isRunning(): boolean {
    return this.running && this.leaseEpoch > 0;
  }

  isReadyForProjections(): boolean {
    return this.running && this.leaseEpoch > 0 && this.tombstonesDrained;
  }

  getEffectiveContextBudgetTokens(): number {
    return this.effectiveContextBudgetTokens;
  }

  /**
   * Executes the strict v2.1 startup handshake:
   *   1. RegisterBodyCarrier -> receive (lease_epoch, pendingTombstones, pendingIntents)
   *   2. Drain & verified-ACK EVERY PURGE_* / INVALIDATE_MEMORY tombstone FIRST
   *   3. Reconcile local session projections with strictly monotonic (lease_epoch, projection_seq)
   *   4. Process pending NEW_INTENT items & start 10s heartbeat + SubscribeBodyOutbox loop
   */
  async start(signal: AbortSignal): Promise<void> {
    if (this.running) return;
    const reg = await this.client.registerBodyCarrier({
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      instanceId: this.instanceId,
      capabilitiesJson: JSON.stringify({ engine: 'pi-durable@1.6.0', gates: 7 }),
    } as never) as unknown as {
      leaseEpoch?: string | number | bigint;
      pendingTombstones?: readonly Record<string, unknown>[];
      pendingIntents?: readonly Record<string, unknown>[];
      heartbeatIntervalMs?: number;
    };

    this.leaseEpoch = Number(reg.leaseEpoch ?? 0);
    if (!Number.isSafeInteger(this.leaseEpoch) || this.leaseEpoch <= 0) {
      throw new Error('Runtime rejected Body carrier registration (invalid lease_epoch).');
    }
    this.running = true;
    this.tombstonesDrained = false;
    this.consecutiveHeartbeatFailures = 0;

    // Step 2: Drain ALL tombstones strictly BEFORE projection reconciliation or new intents.
    for (const env of reg.pendingTombstones ?? []) {
      signal.throwIfAborted();
      await this.handleEnvelopeAndAck(env);
    }
    this.tombstonesDrained = true;

    // Step 3: Startup reconciliation via strictly monotonic (lease_epoch, projection_seq).
    const reconciled = await this.handlers.onReconcileAfterTombstones();
    for (const item of reconciled) {
      signal.throwIfAborted();
      await this.reportProjection(item);
    }

    // Step 4: Drain initial pending intents.
    for (const env of reg.pendingIntents ?? []) {
      signal.throwIfAborted();
      await this.handleEnvelopeAndAck(env);
    }

    // Step 5: Start 10s in-memory heartbeat with lease-loss detection.
    const intervalMs = Math.max(2_000, Number(reg.heartbeatIntervalMs ?? 10_000));
    this.heartbeatTimer = setInterval(() => {
      if (!this.running || signal.aborted) return;
      void this.client.heartbeatBodyCarrier({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: String(this.leaseEpoch),
        instanceId: this.instanceId,
      } as never).then(resp => {
        const renewed = (resp as unknown as { renewed?: boolean })?.renewed;
        if (renewed === false) {
          this.handleLeaseLost('Runtime reported lease epoch superseded.');
        } else {
          this.consecutiveHeartbeatFailures = 0;
        }
      }).catch(err => {
        this.consecutiveHeartbeatFailures += 1;
        if (this.consecutiveHeartbeatFailures >= 3) {
          this.handleLeaseLost(err instanceof Error ? err.message : 'Body carrier heartbeat lost.');
        }
      });
    }, intervalMs);
    this.heartbeatTimer.unref?.();

    // Step 6: Subscribe long-lived outbox stream (exempt from 300s cap).
    void this.consumeOutboxStream(signal);
  }

  private handleLeaseLost(reason: string): void {
    if (!this.running) return;
    this.running = false;
    this.tombstonesDrained = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.handlers.onLeaseLost?.(reason);
  }

  private async consumeOutboxStream(signal: AbortSignal): Promise<void> {
    try {
      const stream = await this.client.subscribeBodyOutbox({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: String(this.leaseEpoch),
      } as never);
      for await (const env of stream as AsyncIterable<Record<string, unknown>>) {
        if (!this.running || signal.aborted) break;
        await this.handleEnvelopeAndAck(env);
      }
    } catch {
      // Stream disconnects cleanly on abort or daemon restart; AuthorizeBodySideEffect remains fail-closed.
    }
  }

  private async handleEnvelopeAndAck(env: Record<string, unknown>): Promise<void> {
    const outboxId = String(env.outboxId ?? '');
    if (!outboxId) return;
    const workSessionRef = String(env.workSessionRef ?? '');
    const agentBinding = String(env.agentBinding ?? '');
    const payloadJson = String(env.payloadJson ?? '{}');
    const kind = env.commandKind;

    if (kind === 3 || kind === 'BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION') {
      await this.handlers.onPurgeSession(workSessionRef, outboxId);
    } else if (kind === 4 || kind === 'BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT') {
      await this.handlers.onPurgeAgent(agentBinding, outboxId);
    } else if (kind === 2 || kind === 'BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY') {
      await this.handlers.onInvalidateMemory(workSessionRef, outboxId);
    } else {
      await this.handlers.onNewIntent({ outboxId, workSessionRef, agentBinding, payloadJson });
    }

    const ackResp = await this.client.ackBodyOutbox({
      outboxId,
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      leaseEpoch: String(this.leaseEpoch),
      resultState: 'acked',
    } as never) as unknown as { acked?: boolean };
    if (ackResp?.acked !== true) {
      throw new Error(`Runtime did not acknowledge body outbox item "${outboxId}".`);
    }
  }

  /**
   * Synchronous fail-closed fence called immediately before ANY high-risk side effect
   * (file write, edit, delete, shell exec, external write integration).
   */
  async authorizeSideEffect(input: {
    workSessionRef: string;
    callId: string;
    toolName: string;
    actionKind: string;
    payloadHash: string;
  }): Promise<void> {
    if (!this.running || this.leaseEpoch <= 0) {
      throw new Error('Side effect denied fail-closed: Harness PC body lease is offline.');
    }
    const resp = await this.client.authorizeBodySideEffect({
      workSessionRef: input.workSessionRef,
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      leaseEpoch: String(this.leaseEpoch),
      callId: input.callId,
      toolName: input.toolName,
      actionKind: input.actionKind,
      payloadHash: input.payloadHash,
    } as never) as unknown as {
      authorized?: boolean;
      denyReason?: string;
      workSessionDeleted?: boolean;
      memoryInvalidated?: boolean;
    };

    if (!resp?.authorized) {
      const reason = resp?.denyReason || (resp?.workSessionDeleted ? 'work_session_deleted' : resp?.memoryInvalidated ? 'memory_invalidated' : 'unauthorized');
      throw new Error(`Runtime denied PC body side effect (${reason}).`);
    }
  }

  async reportProjection(input: {
    workSessionRef: string;
    status: string;
    title?: string;
    workspaceRoot?: string;
    permissionMode?: string;
    latestReceiptJson?: string;
    milestoneKind?: string;
    topicSummary?: string;
    deliverablePaths?: readonly string[];
  }): Promise<void> {
    if (!this.isReadyForProjections()) return;
    this.projectionSeq += 1;
    await this.client.reportBodySessionProjection({
      workSessionRef: input.workSessionRef,
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      leaseEpoch: String(this.leaseEpoch),
      projectionSeq: String(this.projectionSeq),
      status: input.status,
      ...(input.title ? { title: input.title } : {}),
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.latestReceiptJson ? { latestReceiptJson: input.latestReceiptJson } : {}),
      ...(input.milestoneKind ? { milestoneKind: input.milestoneKind } : {}),
      ...(input.topicSummary ? { topicSummary: input.topicSummary } : {}),
      ...(input.deliverablePaths ? { deliverablePaths: [...input.deliverablePaths] } : {}),
    } as never);
  }

  /**
   * Streams one Runtime-authoritative Body inference step via StreamLocalAgentBodyStep
   * (purpose = BODY_STEP_PURPOSE_INFERENCE). Never sends Body-authored system prompts.
   */
  async *streamInferenceStep(
    input: BodyInferenceStepInput,
    signal?: AbortSignal,
  ): AsyncIterable<DecodedBodyStepEvent> {
    if (!this.running || this.leaseEpoch <= 0) {
      throw new Error('Harness PC body lease is offline; cannot stream inference step.');
    }
    const stream = await this.client.streamLocalAgentBodyStep({
      agentHandle: input.agentHandle,
      agentBinding: input.agentBinding,
      workSessionRef: input.workSessionRef,
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      leaseEpoch: String(this.leaseEpoch),
      purpose: 1, // BODY_STEP_PURPOSE_INFERENCE
      tools: input.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchemaJson: t.inputSchemaJson,
      })),
      workingMessages: input.workingMessages.map(m => ({
        role: m.role,
        contentJson: m.contentJson,
        toolCallId: m.toolCallId ?? '',
        toolName: m.toolName ?? '',
        isError: Boolean(m.isError),
        outboxId: m.outboxId ?? '',
      })),
      bodyAdvisoryContext: {
        workspaceName: input.workspaceName ?? '',
        permissionMode: input.permissionMode ?? 'strict',
        toolNames: [...(input.toolNames ?? input.tools.map(t => t.name))],
      },
      keptTailMessages: [],
      stepRequestId: input.stepRequestId ?? randomUUID(),
    } as never, signal ? ({ signal } as never) : undefined);

    for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
      signal?.throwIfAborted();
      const decoded = decodeBodyStepStreamEvent(raw);
      if (!decoded) continue;
      if (decoded.kind === 'done' && decoded.effectiveContextBudgetTokens > 0) {
        this.effectiveContextBudgetTokens = decoded.effectiveContextBudgetTokens;
      } else if (
        (decoded.kind === 'textDelta' || decoded.kind === 'reasoningSummaryDelta')
        && decoded.effectiveContextBudgetTokens
        && decoded.effectiveContextBudgetTokens > 0
      ) {
        this.effectiveContextBudgetTokens = decoded.effectiveContextBudgetTokens;
      }
      yield decoded;
    }
  }

  /**
   * Executes Runtime-governed compaction for pi-durable's official beforeCompact
   * hook with 2 bounded retries and usage / context-budget reporting.
   */
  async executeCompactionWithRetries(input: BodyCompactionInput, maxAttempts = 2): Promise<BodyCompactionOutput> {
    if (!this.running || this.leaseEpoch <= 0) {
      throw new Error('Harness PC body lease is offline; cannot execute compaction step.');
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const stream = await this.client.streamLocalAgentBodyStep({
          agentHandle: input.agentHandle ?? input.agentBinding,
          agentBinding: input.agentBinding,
          workSessionRef: input.workSessionRef,
          deviceId: this.deviceId,
          capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
          leaseEpoch: String(this.leaseEpoch),
          purpose: 2, // BODY_STEP_PURPOSE_COMPACTION
          tools: [],
          workingMessages: input.workingMessages.map(m => ({
            role: m.role,
            contentJson: m.contentJson,
            toolCallId: m.toolCallId ?? '',
            toolName: m.toolName ?? '',
            isError: Boolean(m.isError),
            outboxId: m.outboxId ?? '',
          })),
          keptTailMessages: input.keptTailMessages.map(m => ({
            role: m.role,
            contentJson: m.contentJson,
            toolCallId: m.toolCallId ?? '',
            toolName: m.toolName ?? '',
            isError: Boolean(m.isError),
            outboxId: m.outboxId ?? '',
          })),
          stepRequestId: randomUUID(),
        } as never);

        let summary = '';
        let postCompactionMac = '';
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        let budget = this.effectiveContextBudgetTokens;

        for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
          const decoded = decodeBodyStepStreamEvent(raw);
          if (!decoded) continue;
          if (decoded.kind === 'textDelta') {
            summary += decoded.textDelta;
            if (decoded.effectiveContextBudgetTokens && decoded.effectiveContextBudgetTokens > 0) {
              budget = decoded.effectiveContextBudgetTokens;
            }
          } else if (decoded.kind === 'done') {
            if (decoded.compactionSummary) summary = decoded.compactionSummary;
            postCompactionMac = decoded.postCompactionMac;
            usageInputTokens = decoded.usageInputTokens;
            usageOutputTokens = decoded.usageOutputTokens;
            if (decoded.effectiveContextBudgetTokens > 0) {
              budget = decoded.effectiveContextBudgetTokens;
            }
          } else if (decoded.kind === 'failed') {
            throw new Error(decoded.message || 'Compaction step failed.');
          }
        }
        if (!summary.trim()) {
          throw new Error('Runtime compaction step returned an empty summary.');
        }
        this.effectiveContextBudgetTokens = budget;
        return {
          summary: summary.trim(),
          postCompactionMac,
          usageInputTokens,
          usageOutputTokens,
          effectiveContextBudgetTokens: budget,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async stop(): Promise<void> {
    this.running = false;
    this.tombstonesDrained = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.leaseEpoch > 0) {
      const epoch = this.leaseEpoch;
      this.leaseEpoch = 0;
      await this.client.unregisterBodyCarrier({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: String(epoch),
        instanceId: this.instanceId,
      } as never).catch(() => {});
    }
  }
}
