import path from 'node:path';
import { loadBatchContext } from './batch-delivery.mjs';
import {
  exists,
  loadYamlFile,
  resolveTopicPath,
} from './doc-utils.mjs';
import { runUntilBlocked } from './continuous-delivery.mjs';
import { validateOrchestrationState } from './validators.mjs';
import {
  DEFAULT_SCHEDULER_LEASE_TTL_MS,
  SCHEDULER_REFUSAL_CODES,
  acquireSchedulerLease,
  defaultSchedulerLeaseHolderId,
  readSchedulerLease,
  releaseSchedulerLease,
} from './scheduler-lease.mjs';

const REQUIRED_CONTINUOUS_PROTOCOLS = [
  'execution-packet.v1',
  'orchestration-state.v1',
  'dispatch.v1',
  'worker-output.v1',
  'acceptance.v1',
];
const REQUIRED_PROVIDER_BACKED_PROTOCOLS = [
  'provider-worker-execution.v1',
  'worker-runner-signal.v1',
];
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'superseded']);
const BLOCKED_RUN_STATUSES = new Set(['paused', 'awaiting_confirmation']);

function buildRefusal(code, message, details = {}) {
  return {
    code,
    message,
    details,
  };
}

function buildLeaseSurface(report, override = {}) {
  return {
    lease_ref: report?.lease_ref || null,
    exists: Boolean(report?.exists || report?.lease),
    active: Boolean(report?.active),
    stale: Boolean(report?.stale),
    stale_recovered: Boolean(override.staleRecovered),
    released: override.released ?? false,
    released_at: override.releasedAt || null,
    holder_id: report?.lease?.holder_id || override.holderId || null,
    acquired_at: report?.lease?.acquired_at || null,
    updated_at: report?.lease?.updated_at || null,
    expires_at: report?.lease?.expires_at || null,
  };
}

function ensureRequiredProtocols(topic, errors) {
  for (const protocolRef of [...REQUIRED_CONTINUOUS_PROTOCOLS, ...REQUIRED_PROVIDER_BACKED_PROTOCOLS]) {
    if (!Array.isArray(topic.protocol_refs) || !topic.protocol_refs.includes(protocolRef)) {
      errors.push(`scheduler requires protocol_refs to include ${protocolRef}`);
    }
  }
}

function buildPreflightReport(options = {}) {
  return {
    contract: 'scheduler-preflight.v1',
    ok: true,
    errors: options.errors || [],
    warnings: options.warnings || [],
    topic_id: options.topicId || null,
    packet_id: options.packetId || null,
    run_id: options.runId || null,
    run_status: options.runStatus || null,
    scheduler_status: options.schedulerStatus,
    eligible: Boolean(options.eligible),
    refusal: options.refusal || null,
    lease: options.lease || buildLeaseSurface(null),
  };
}

function buildSchedulerResult(options = {}) {
  return {
    contract: 'scheduler-result.v1',
    ok: Boolean(options.ok),
    errors: options.errors || [],
    warnings: options.warnings || [],
    topic_id: options.topicId || null,
    packet_id: options.packetId || null,
    run_id: options.runId || null,
    lease: options.lease || buildLeaseSurface(null),
    scheduler_outcome: options.schedulerOutcome || null,
    loop_summary: options.loopSummary || null,
    refusal: options.refusal || null,
    preflight: options.preflight || null,
  };
}

function loadSchedulerStateContext(topicDir) {
  const context = loadBatchContext(topicDir, { requireActiveTopic: false });
  const topicId = context.topic?.topic_id || null;
  const packetId = context.packet?.packet_id || null;
  const warnings = [...(context.warnings || [])];
  const errors = [...(context.errors || [])];

  if (!context.ok) {
    return {
      ok: false,
      topicId,
      packetId,
      warnings,
      errors,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_PREREQUISITES_MISSING,
        'scheduler requires a valid provider-backed topic context',
      ),
    };
  }

  ensureRequiredProtocols(context.topic, errors);
  if (!context.topic.orchestration_state_ref) {
    errors.push('scheduler requires orchestration_state_ref');
  }
  const statePath = context.topic.orchestration_state_ref
    ? resolveTopicPath(topicDir, context.topic.orchestration_state_ref)
    : null;
  if (statePath && !exists(statePath)) {
    errors.push(`missing orchestration state: ${context.topic.orchestration_state_ref}`);
  }

  const stateReport = statePath
    ? validateOrchestrationState(statePath, { topicDir })
    : null;
  if (stateReport && !stateReport.ok) {
    errors.push(...stateReport.errors.map((error) => `orchestration state invalid: ${error}`));
  }

  const state = statePath && exists(statePath) ? loadYamlFile(statePath) || {} : null;
  if (state && state.packet_ref !== context.topic.execution_packet_ref) {
    errors.push('scheduler requires orchestration state packet_ref to match execution_packet_ref');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      topicId,
      packetId,
      warnings,
      errors,
      runId: state?.state_id || null,
      runStatus: state?.run_status || null,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_PREREQUISITES_MISSING,
        'scheduler requires valid provider-backed prerequisites',
      ),
    };
  }

  return {
    ok: true,
    topicId,
    packetId,
    warnings,
    errors: [],
    context,
    state,
  };
}

export function runScheduleStatus(topicDir, options = {}) {
  const resolvedTopicDir = path.resolve(topicDir);
  const stateContext = loadSchedulerStateContext(resolvedTopicDir);
  const topicId = stateContext.topicId || null;
  const leaseReport = topicId
    ? readSchedulerLease(resolvedTopicDir, { topicId, now: options.now })
    : null;

  if (leaseReport && !leaseReport.ok) {
    return buildPreflightReport({
      topicId,
      packetId: stateContext.packetId || null,
      runId: stateContext.runId || null,
      runStatus: stateContext.runStatus || null,
      schedulerStatus: 'invalid_operational_lease',
      eligible: false,
      errors: [...(stateContext.errors || []), ...(leaseReport.errors || [])],
      warnings: stateContext.warnings || [],
      refusal: leaseReport.refusal,
      lease: buildLeaseSurface(leaseReport),
    });
  }

  if (!stateContext.ok) {
    return buildPreflightReport({
      topicId,
      packetId: stateContext.packetId || null,
      runId: stateContext.runId || null,
      runStatus: stateContext.runStatus || null,
      schedulerStatus: 'missing_provider_backed_prerequisites',
      eligible: false,
      errors: stateContext.errors || [],
      warnings: stateContext.warnings || [],
      refusal: stateContext.refusal,
      lease: buildLeaseSurface(leaseReport),
    });
  }

  if (leaseReport?.active) {
    return buildPreflightReport({
      topicId: stateContext.topicId,
      packetId: stateContext.packetId,
      runId: stateContext.state.state_id,
      runStatus: stateContext.state.run_status,
      schedulerStatus: 'blocked_by_active_lease',
      eligible: false,
      errors: [],
      warnings: stateContext.warnings,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_LEASE_ACTIVE,
        'active scheduler lease already exists for this topic',
        {
          holder_id: leaseReport.lease?.holder_id || null,
          run_id: leaseReport.lease?.run_id || null,
          expires_at: leaseReport.lease?.expires_at || null,
        },
      ),
      lease: buildLeaseSurface(leaseReport),
    });
  }

  if (TERMINAL_RUN_STATUSES.has(stateContext.state.run_status)) {
    return buildPreflightReport({
      topicId: stateContext.topicId,
      packetId: stateContext.packetId,
      runId: stateContext.state.state_id,
      runStatus: stateContext.state.run_status,
      schedulerStatus: 'run_terminal',
      eligible: false,
      errors: [],
      warnings: stateContext.warnings,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.RUN_TERMINAL,
        `run is already terminal: ${stateContext.state.run_status}`,
      ),
      lease: buildLeaseSurface(leaseReport),
    });
  }

  if (BLOCKED_RUN_STATUSES.has(stateContext.state.run_status)) {
    return buildPreflightReport({
      topicId: stateContext.topicId,
      packetId: stateContext.packetId,
      runId: stateContext.state.state_id,
      runStatus: stateContext.state.run_status,
      schedulerStatus: 'run_blocked',
      eligible: false,
      errors: [],
      warnings: stateContext.warnings,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.RUN_BLOCKED,
        `run is blocked and cannot be auto-scheduled: ${stateContext.state.run_status}`,
      ),
      lease: buildLeaseSurface(leaseReport),
    });
  }

  if (stateContext.state.run_status !== 'running') {
    return buildPreflightReport({
      topicId: stateContext.topicId,
      packetId: stateContext.packetId,
      runId: stateContext.state.state_id,
      runStatus: stateContext.state.run_status,
      schedulerStatus: 'state_precondition_failed',
      eligible: false,
      errors: [],
      warnings: stateContext.warnings,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.STATE_PRECONDITION_FAILED,
        `scheduler requires run_status=running, got ${stateContext.state.run_status}`,
      ),
      lease: buildLeaseSurface(leaseReport),
    });
  }

  return buildPreflightReport({
    topicId: stateContext.topicId,
    packetId: stateContext.packetId,
    runId: stateContext.state.state_id,
    runStatus: stateContext.state.run_status,
    schedulerStatus: 'eligible',
    eligible: true,
    errors: [],
    warnings: stateContext.warnings,
    refusal: null,
    lease: buildLeaseSurface(leaseReport),
  });
}

export function runScheduleOnce(topicDir, options = {}) {
  const resolvedTopicDir = path.resolve(topicDir);
  const holderId = String(options.leaseHolderId || defaultSchedulerLeaseHolderId());
  const preflight = runScheduleStatus(resolvedTopicDir, options);
  if (!preflight.eligible) {
    return buildSchedulerResult({
      ok: false,
      errors: preflight.errors,
      warnings: preflight.warnings,
      topicId: preflight.topic_id,
      packetId: preflight.packet_id,
      runId: preflight.run_id,
      lease: preflight.lease,
      schedulerOutcome: 'refusal',
      loopSummary: null,
      refusal: preflight.refusal,
      preflight,
    });
  }

  const acquiredLease = acquireSchedulerLease(resolvedTopicDir, {
    topicId: preflight.topic_id,
    runId: preflight.run_id,
    holderId,
    ttlMs: options.leaseTtlMs ?? DEFAULT_SCHEDULER_LEASE_TTL_MS,
    now: options.now,
  });
  if (!acquiredLease.ok) {
    return buildSchedulerResult({
      ok: false,
      errors: acquiredLease.errors || [],
      warnings: preflight.warnings,
      topicId: preflight.topic_id,
      packetId: preflight.packet_id,
      runId: preflight.run_id,
      lease: buildLeaseSurface(acquiredLease, { holderId }),
      schedulerOutcome: 'refusal',
      loopSummary: null,
      refusal: acquiredLease.refusal || buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_RUNTIME_FAILED,
        'scheduler lease acquisition failed',
      ),
      preflight,
    });
  }

  let loopReport = null;
  let unexpectedError = null;
  let releasedLease = null;
  try {
    loopReport = runUntilBlocked(resolvedTopicDir, {
      timeoutMs: options.timeoutMs,
      maxSteps: options.maxSteps,
      providerInvoker: options.providerInvoker,
    });
  } catch (error) {
    unexpectedError = error;
  } finally {
    releasedLease = releaseSchedulerLease(resolvedTopicDir, {
      topicId: preflight.topic_id,
      runId: preflight.run_id,
      holderId,
      now: options.now,
    });
  }

  const leaseSurface = buildLeaseSurface(acquiredLease, {
    staleRecovered: acquiredLease.stale_recovered,
    released: Boolean(releasedLease?.released),
    releasedAt: releasedLease?.released_at || null,
    holderId,
  });
  const warnings = [
    ...(preflight.warnings || []),
    ...(loopReport?.warnings || []),
    ...(releasedLease?.warnings || []),
  ];

  if (unexpectedError) {
    return buildSchedulerResult({
      ok: false,
      errors: [String(unexpectedError.message || unexpectedError)],
      warnings,
      topicId: preflight.topic_id,
      packetId: preflight.packet_id,
      runId: preflight.run_id,
      lease: leaseSurface,
      schedulerOutcome: 'refusal',
      loopSummary: null,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_RUNTIME_FAILED,
        'foreground scheduler invocation failed before a structured loop result was returned',
      ),
      preflight,
    });
  }

  if (!loopReport.ok) {
    return buildSchedulerResult({
      ok: false,
      errors: loopReport.errors || [],
      warnings,
      topicId: preflight.topic_id,
      packetId: preflight.packet_id,
      runId: preflight.run_id,
      lease: leaseSurface,
      schedulerOutcome: 'refusal',
      loopSummary: loopReport.summary || null,
      refusal: {
        code: loopReport.refusal?.code || SCHEDULER_REFUSAL_CODES.SCHEDULER_RUNTIME_FAILED,
        message: loopReport.refusal?.summary || 'foreground scheduler refused',
        details: loopReport.refusal?.details || {},
      },
      preflight,
    });
  }

  return buildSchedulerResult({
    ok: true,
    errors: [],
    warnings,
    topicId: preflight.topic_id,
    packetId: preflight.packet_id,
    runId: preflight.run_id,
    lease: leaseSurface,
    schedulerOutcome: 'invoked',
    loopSummary: loopReport.summary || null,
    refusal: null,
    preflight,
  });
}
