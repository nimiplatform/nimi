// Brain <-> Body Symbiosis Coordinator for apps/harness (agent.body.pc).
// Implements the v2.1 startup handshake (tombstone-first drain BEFORE projection
// reconciliation), 10s in-memory heartbeat, monotonic (lease_epoch, projection_seq),
// synchronous AuthorizeBodySideEffect fence, logical model ID local-agent:<binding>,
// and beforeCompact compaction step with 2 bounded retries.
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

export interface BodyCompactionInput {
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
}

/**
 * Computes the v2.1 stable logical Model ID so switching a LocalAgent's model
 * in Nimi Home NEVER invalidates or breaks durable pi-durable sessions.
 */
export function logicalAgentModelId(agentBinding: string): string {
  const trimmed = agentBinding.trim();
  return trimmed ? `local-agent:${trimmed}` : 'local-agent:default';
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

  getLeaseEpoch(): number {
    return this.leaseEpoch;
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
   *   2. Drain & ACK EVERY PURGE_* / INVALIDATE_MEMORY tombstone FIRST
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
    if (this.leaseEpoch <= 0) {
      throw new Error('Runtime rejected Body carrier registration (invalid lease_epoch).');
    }
    this.running = true;
    this.tombstonesDrained = false;

    // Step 2: Drain ALL tombstones strictly BEFORE projection reconciliation or new intents.
    for (const env of reg.pendingTombstones ?? []) {
      signal.throwIfAborted();
      await this.handleEnvelopeAndAck(env);
    }
    this.tombstonesDrained = true;

    // Step 3: Startup reconciliation via strictly monotonic projection_seq.
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

    // Step 5: Start 10s in-memory heartbeat.
    const intervalMs = Math.max(2_000, Number(reg.heartbeatIntervalMs ?? 10_000));
    this.heartbeatTimer = setInterval(() => {
      if (!this.running || signal.aborted) return;
      void this.client.heartbeatBodyCarrier({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: this.leaseEpoch,
        instanceId: this.instanceId,
      } as never).catch(() => {
        // Heartbeat failure triggers fail-closed side-effect authorization on next step.
      });
    }, intervalMs);
    this.heartbeatTimer.unref?.();

    // Step 6: Subscribe long-lived outbox stream (exempt from 300s cap).
    void this.consumeOutboxStream(signal);
  }

  private async consumeOutboxStream(signal: AbortSignal): Promise<void> {
    try {
      const stream = await this.client.subscribeBodyOutbox({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: this.leaseEpoch,
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

    await this.client.ackBodyOutbox({
      outboxId,
      deviceId: this.deviceId,
      capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
      leaseEpoch: this.leaseEpoch,
      resultState: 'acked',
    } as never);
  }

  /**
   * Synchronous fail-closed fence called immediately before ANY high-risk side effect
   * (file write, edit, delete, shell exec, external integration).
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
      leaseEpoch: this.leaseEpoch,
      callId: input.callId,
      toolName: input.toolName,
      actionKind: input.actionKind,
      payloadHash: input.payloadHash,
    } as never) as { authorized?: boolean; denyReason?: string; workSessionDeleted?: boolean; memoryInvalidated?: boolean };

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
      leaseEpoch: this.leaseEpoch,
      projectionSeq: this.projectionSeq,
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
   * Executes Runtime-governed compaction for pi-durable's official beforeCompact
   * hook with 2 bounded retries and usage / context-budget reporting.
   */
  async executeCompactionWithRetries(input: BodyCompactionInput, maxAttempts = 2): Promise<BodyCompactionOutput> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const stream = await this.client.streamLocalAgentBodyStep({
          agentBinding: input.agentBinding,
          workSessionRef: input.workSessionRef,
          deviceId: this.deviceId,
          capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
          leaseEpoch: this.leaseEpoch,
          purpose: 2, // BODY_STEP_PURPOSE_COMPACTION
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

        for await (const ev of stream as AsyncIterable<Record<string, unknown>>) {
          if (typeof ev.effectiveContextBudgetTokens === 'number' && ev.effectiveContextBudgetTokens > 0) {
            budget = ev.effectiveContextBudgetTokens;
          }
          const done = ev.done as Record<string, unknown> | undefined;
          if (done) {
            summary = String(done.compactionSummary ?? summary);
            postCompactionMac = String(done.postCompactionMac ?? '');
            usageInputTokens = Number(done.usageInputTokens ?? 0);
            usageOutputTokens = Number(done.usageOutputTokens ?? 0);
            if (typeof done.effectiveContextBudgetTokens === 'number' && done.effectiveContextBudgetTokens > 0) {
              budget = done.effectiveContextBudgetTokens;
            }
          }
          const failed = ev.failed as Record<string, unknown> | undefined;
          if (failed) {
            throw new Error(String(failed.message ?? 'Compaction step failed.'));
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.leaseEpoch > 0) {
      await this.client.unregisterBodyCarrier({
        deviceId: this.deviceId,
        capabilityNamespace: HARNESS_PC_CAPABILITY_NAMESPACE,
        leaseEpoch: this.leaseEpoch,
      } as never).catch(() => {});
      this.leaseEpoch = 0;
    }
  }
}
