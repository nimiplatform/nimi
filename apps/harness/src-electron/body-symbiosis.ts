// Brain <-> Body Symbiosis Coordinator for apps/harness (agent.body.pc).
// Implements the v2.1 startup handshake (tombstone-first drain BEFORE projection
// reconciliation), 10s in-memory heartbeat, monotonic (lease_epoch, projection_seq),
// synchronous AuthorizeBodySideEffect fence, logical model ID local-agent:<binding>,
// streaming inference via StreamLocalAgentBodyStep (purpose=INFERENCE) with transient
// toolCallActivity keepalive, and beforeCompact compaction step with 2 bounded retries.
// @nimi-authority: rule.nimi.runtime.agent-participation.body-step-symbiosis
import { createHash, randomUUID } from 'node:crypto';
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

export interface BodyPendingAttention {
  readonly attentionId: string;
  readonly attentionKind: string;
  readonly summaryJson: string;
  readonly expiresAt: string;
}

export interface BodyProjectionInput {
  readonly milestoneRef?: string;
  readonly workSessionRef: string;
  readonly status: string;
  readonly title?: string;
  readonly workspaceRoot?: string;
  readonly permissionMode?: string;
  readonly latestReceiptJson?: string;
  readonly milestoneKind?: string;
  readonly topicSummary?: string;
  readonly deliverablePaths?: readonly string[];
  readonly pendingAttention?: BodyPendingAttention;
  readonly clearPendingAttention?: boolean;
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
  onReconcileAfterTombstones(): Promise<readonly BodyProjectionInput[]>;
  onMilestoneAccepted?(sessionRef: string, milestoneRef: string): Promise<void>;
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
  private leaseStream?: AbortController;
  private projectionSeq = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private tombstonesDrained = false;
  private effectiveContextBudgetTokens = 64_000;
  private consecutiveHeartbeatFailures = 0;
  private projectionChain: Promise<void> = Promise.resolve();
  private readyResolve?: () => void;
  private readyPromise: Promise<void>;

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
    this.readyPromise = new Promise<void>(r => { this.readyResolve = r; });
  }

  getAgentSessionClient(): NimiLocalAppAgentSessionClient {
    return this.client;
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

  async waitUntilReady(timeoutMs = 15_000): Promise<void> {
    if (this.isReadyForProjections()) return;
    await Promise.race([
      this.readyPromise,
      new Promise<void>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Harness PC body symbiosis lease did not become ready in time.')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  /**
   * Executes the strict v2.1 startup handshake:
   *   1. RegisterBodyCarrier -> receive (lease_epoch, pendingTombstones, pendingIntents)
   *   2. Drain & verified-ACK EVERY PURGE_* / INVALIDATE_MEMORY tombstone FIRST
   *   3. Reconcile local session projections with strictly monotonic (lease_epoch, projection_seq)
   *   4. Process pending NEW_INTENT items & start 10s heartbeat + SubscribeBodyOutbox loop
   */
  async start(signal: AbortSignal, options?: { readonly retryInitialHandshake?: boolean }): Promise<void> {
    if (this.running) return;
    this.stopped = false;
    try {
      await this.registerAndDrain(signal);
    } catch (error) {
      if (!options?.retryInitialHandshake || this.stopped || signal.aborted) {
        throw error;
      }
      // Keep the background reconnect loop running so transient startup races with
      // Runtime recover automatically with exponential backoff.
    }
    void this.consumeOutboxStreamWithReconnect(signal);
  }

  private async registerAndDrain(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
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

    const nextEpoch = Number(reg.leaseEpoch ?? 0);
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= 0) {
      throw new Error('Runtime rejected Body carrier registration (invalid lease_epoch).');
    }
    this.leaseEpoch = nextEpoch;
    this.projectionSeq = 0;
    this.running = true;
    this.tombstonesDrained = false;
    this.consecutiveHeartbeatFailures = 0;

    try {
      // Step 2: Drain ALL tombstones strictly BEFORE projection reconciliation or new intents.
      for (const env of reg.pendingTombstones ?? []) {
        signal.throwIfAborted();
        await this.handleEnvelopeAndAck(env);
      }
      this.tombstonesDrained = true;
      this.readyResolve?.();

      // Step 3: Startup reconciliation via strictly monotonic (lease_epoch, projection_seq).
      const reconciled = await this.handlers.onReconcileAfterTombstones();
      for (const item of reconciled) {
        signal.throwIfAborted();
        await this.reportProjection(item);
        if (item.milestoneRef) await this.handlers.onMilestoneAccepted?.(item.workSessionRef, item.milestoneRef);
      }

      // Step 4: Drain initial pending intents.
      for (const env of reg.pendingIntents ?? []) {
        signal.throwIfAborted();
        await this.handleEnvelopeAndAck(env);
      }

      // Step 5: Start 10s in-memory heartbeat with epoch-fenced lease-loss detection.
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
      }
      const intervalMs = Math.max(2_000, Number(reg.heartbeatIntervalMs ?? 10_000));
      const myEpoch = this.leaseEpoch;
      this.heartbeatTimer = setInterval(() => {
        if (!this.running || this.stopped || this.leaseEpoch !== myEpoch || signal.aborted) return;
        void this.client.heartbeatBodyCarrier({
          deviceId: this.deviceId,
          capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
          leaseEpoch: String(myEpoch),
          instanceId: this.instanceId,
        } as never).then(resp => {
          if (!this.running || this.stopped || this.leaseEpoch !== myEpoch || signal.aborted) return;
          const parsed = resp as unknown as { alive?: boolean; renewed?: boolean };
          if (parsed?.alive === false || parsed?.renewed === false) {
            this.handleLeaseLost('Runtime reported lease epoch superseded.');
          } else {
            this.consecutiveHeartbeatFailures = 0;
          }
        }).catch(err => {
          if (!this.running || this.stopped || this.leaseEpoch !== myEpoch || signal.aborted) return;
          this.consecutiveHeartbeatFailures += 1;
          if (this.consecutiveHeartbeatFailures >= 3) {
            this.handleLeaseLost(err instanceof Error ? err.message : 'Body carrier heartbeat lost.');
          }
        });
      }, intervalMs);
      this.heartbeatTimer.unref?.();
    } catch (error) {
      this.handleLeaseLost(error instanceof Error ? error.message : String(error));
      await this.unregisterLease();
      throw error;
    }
  }

  private async unregisterLease(): Promise<void> {
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

  private clearLeaseState(): void {
    if (this.tombstonesDrained) {
      this.readyPromise = new Promise<void>(r => { this.readyResolve = r; });
    }
    this.leaseStream?.abort();
    this.leaseStream = undefined;
    this.running = false;
    this.tombstonesDrained = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private handleLeaseLost(reason: string): void {
    if (!this.running) return;
    this.clearLeaseState();
    this.handlers.onLeaseLost?.(reason);
  }

  private async consumeOutboxStreamWithReconnect(signal: AbortSignal): Promise<void> {
    let backoffMs = 1_000;
    while (!this.stopped && !signal.aborted) {
      try {
        if (!this.running || this.leaseEpoch <= 0) {
          await this.registerAndDrain(signal);
        }
        this.leaseStream = new AbortController();
        const streamSignal = AbortSignal.any([signal, this.leaseStream.signal]);
        const stream = await this.client.subscribeBodyOutbox({
          deviceId: this.deviceId,
          capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
          leaseEpoch: String(this.leaseEpoch),
        } as never, { signal: streamSignal } as never);
        backoffMs = 1_000;
        for await (const env of stream as AsyncIterable<Record<string, unknown>>) {
          if (!this.running || this.stopped || signal.aborted) break;
          try {
            await this.handleEnvelopeAndAck(env);
          } catch (envErr) {
            this.handleLeaseLost(envErr instanceof Error ? envErr.message : String(envErr));
            throw envErr;
          }
        }
      } catch (err) {
        if (this.stopped || signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        if (/AGENT_BODY_LEASE_CONFLICT|FAILED_PRECONDITION/i.test(msg)) {
          this.handleLeaseLost(msg);
        }
      }
      if (this.stopped || signal.aborted) break;
      await new Promise<void>(resolve => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, backoffMs);
        timer.unref?.();
        signal.addEventListener('abort', onAbort, { once: true });
      });
      backoffMs = Math.min(15_000, backoffMs * 2);
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
    } else if (kind === 1 || kind === 'BODY_OUTBOX_COMMAND_KIND_NEW_INTENT') {
      await this.handlers.onNewIntent({ outboxId, workSessionRef, agentBinding, payloadJson });
    } else {
      throw new Error(`Unsupported body outbox command kind "${String(kind)}" for outbox "${outboxId}".`);
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

  async reportProjection(input: BodyProjectionInput): Promise<void> {
    if (!this.isReadyForProjections() || !input.workSessionRef.trim()) throw new Error('Body projection is unavailable.');
    const run = this.projectionChain.then(async () => {
      if (!this.isReadyForProjections()) throw new Error('Body lease changed before reporting projection.');
      this.projectionSeq += 1;
      const seq = this.projectionSeq;
      const receipt = await this.client.reportBodySessionProjection({
        workSessionRef: input.workSessionRef,
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: String(this.leaseEpoch),
        projectionSeq: String(seq),
        status: input.status,
        ...(input.title ? { title: input.title } : {}),
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.latestReceiptJson ? { latestReceiptJson: input.latestReceiptJson } : {}),
        ...(input.milestoneKind ? { milestoneKind: input.milestoneKind } : {}),
        ...(input.topicSummary ? { topicSummary: input.topicSummary } : {}),
        ...(input.deliverablePaths ? { deliverablePaths: [...input.deliverablePaths] } : {}),
        ...(input.pendingAttention ? {
          pendingAttention: {
            attentionId: input.pendingAttention.attentionId,
            workSessionRef: input.workSessionRef,
            attentionKind: input.pendingAttention.attentionKind,
            summaryJson: input.pendingAttention.summaryJson,
            expiresAt: input.pendingAttention.expiresAt,
          },
        } : {}),
        ...(input.clearPendingAttention ? { clearPendingAttention: true } : {}),
      } as never) as { applied?: boolean };
      if (receipt?.applied !== true) throw new Error('Runtime did not apply the Body projection.');
    });
    const epoch = this.leaseEpoch;
    this.projectionChain = run.catch(error => {
      if (input.milestoneRef && this.leaseEpoch === epoch) {
        this.handleLeaseLost(error instanceof Error ? error.message : 'Milestone projection was not confirmed.');
      }
    });
    return run;
  }

  /**
   * Streams one Runtime-authoritative Body inference step via StreamLocalAgentBodyStep
   * (purpose = BODY_STEP_PURPOSE_INFERENCE). Never sends Body-authored system prompts.
   */
  async *streamInferenceStep(
    input: BodyInferenceStepInput,
    signal?: AbortSignal,
  ): AsyncIterable<DecodedBodyStepEvent> {
    if (!this.isReadyForProjections()) {
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
    if (!this.isReadyForProjections()) {
      throw new Error('Harness PC body lease is offline; cannot execute compaction step.');
    }
    // Keep one stable stepRequestId across all retries so a post-commit stream drop
    // replays the committed Runtime ledger journal idempotently without MAC mismatch.
    const stepRequestId = createHash('sha256').update(JSON.stringify(['compaction', input])).digest('hex');
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
          stepRequestId,
        } as never);

        let summary = '';
        let postCompactionMac = '';
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        let budget = this.effectiveContextBudgetTokens;
        let sawDone = false;

        for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
          const decoded = decodeBodyStepStreamEvent(raw);
          if (!decoded) continue;
          if (decoded.kind === 'textDelta') {
            summary += decoded.textDelta;
            if (decoded.effectiveContextBudgetTokens && decoded.effectiveContextBudgetTokens > 0) {
              budget = decoded.effectiveContextBudgetTokens;
            }
          } else if (decoded.kind === 'done') {
            sawDone = true;
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
        if (!sawDone) {
          throw new Error('Runtime compaction step stream closed before terminal done event.');
        }
        if (!summary.trim()) {
          throw new Error('Runtime compaction step returned an empty summary.');
        }
        if (!postCompactionMac.trim()) {
          throw new Error('Runtime compaction step did not return post_compaction_mac.');
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
    this.stopped = true;
    this.clearLeaseState();
    await this.unregisterLease();
  }
}
