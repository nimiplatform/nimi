import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import {
  ensureDir,
  exists,
  loadMarkdownDoc,
  loadYamlFile,
  normalizeRel,
  resolveTopicPath,
  timestampNow,
} from './doc-utils.mjs';
import {
  loadBatchContext,
  normalizeNextPhaseId,
  phaseView,
} from './batch-delivery.mjs';
import { notificationLogRelPath } from './notification-log.mjs';
import { repoRootFrom } from './module-paths.mjs';
import {
  VALIDATOR_NATIVE_REFUSAL_CODES,
  validateDoc,
  validateNotificationPayloadData,
  validateOrchestrationStateData,
  validatePrompt,
  validateTopic,
  validateAcceptance,
  validateWorkerOutput,
} from './validators.mjs';
import { attachEvidence, closeTopic, setOrchestrationState } from './topic-ops.mjs';

const REPO_ROOT = repoRootFrom(import.meta.url);
const TERMINAL_STATES = new Set(['completed', 'failed', 'superseded']);
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
const CODEX_PROVIDER_ID = 'codex exec';
const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;
const DEFAULT_RUN_UNTIL_BLOCKED_MAX_STEPS = 16;
const PROVIDER_TRANSCRIPT_CAPTURE_MAX_CHARS = 4000;
const RUN_UNTIL_BLOCKED_STOP_STATUSES = new Set([
  'paused',
  'failed',
  'awaiting_confirmation',
  'completed',
  'superseded',
]);
const REFUSAL_CODES = Object.freeze({
  PROVIDER_NOT_ADMITTED: 'PROVIDER_NOT_ADMITTED',
  PROVIDER_INVOCATION_FAILED: 'PROVIDER_INVOCATION_FAILED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROMPT_GENERATION_FAILED: 'PROMPT_GENERATION_FAILED',
  LOOP_GUARD_HIT: 'LOOP_GUARD_HIT',
  STATE_PRECONDITION_FAILED: 'STATE_PRECONDITION_FAILED',
  OPERATIONAL_LOG_WRITE_FAILED: 'OPERATIONAL_LOG_WRITE_FAILED',
});
const REQUIRED_PROVIDER_PROMPT_PREAMBLE = [
  'PLANNING CONSTRAINT: This is an AI-native project. Do NOT propose MVP/phased approaches.',
  'Design the final-state solution directly. Intermediate states are forbidden unless',
  'a hard external dependency blocks the final state. Complexity with clear rules is',
  'trivial for AI execution — ambiguity is the real risk.',
].join('\n');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRunId(packetId) {
  const suffix = timestampNow().replace(/[^0-9A-Za-z]/g, '');
  return `${packetId}-run-${suffix}`;
}

function ensureContinuousProtocols(topic, errors) {
  for (const protocolRef of REQUIRED_CONTINUOUS_PROTOCOLS) {
    if (!Array.isArray(topic.protocol_refs) || !topic.protocol_refs.includes(protocolRef)) {
      errors.push(`continuous run requires protocol_refs to include ${protocolRef}`);
    }
  }
}

function ensureProviderBackedProtocols(topic, errors) {
  for (const protocolRef of REQUIRED_PROVIDER_BACKED_PROTOCOLS) {
    if (!Array.isArray(topic.protocol_refs) || !topic.protocol_refs.includes(protocolRef)) {
      errors.push(`provider-backed loop requires protocol_refs to include ${protocolRef}`);
    }
  }
}

function toTopicRelPath(topicDir, filePath, defaultRelPath) {
  const absPath = filePath
    ? (path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(topicDir, filePath))
    : path.resolve(topicDir, defaultRelPath);
  const topicRoot = path.resolve(topicDir);
  if (absPath !== topicRoot && !absPath.startsWith(`${topicRoot}${path.sep}`)) {
    throw new Error(`path must stay inside topic directory: ${filePath}`);
  }
  return {
    absPath,
    relPath: normalizeRel(path.relative(topicDir, absPath)),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextPhaseArtifactDefaultRelPath(topicDir, phaseId, artifactKind) {
  const baseName = `${phaseId}.${artifactKind}.md`;
  const basePath = path.join(topicDir, baseName);
  let maxAttempt = exists(basePath) ? 1 : 0;
  const attemptPattern = new RegExp(`^${escapeRegExp(phaseId)}\\.attempt-(\\d+)\\.${escapeRegExp(artifactKind)}\\.md$`);
  for (const entry of fs.readdirSync(topicDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(attemptPattern);
    if (!match) {
      continue;
    }
    const attempt = Number(match[1]);
    if (Number.isInteger(attempt) && attempt > maxAttempt) {
      maxAttempt = attempt;
    }
  }
  if (maxAttempt === 0) {
    return baseName;
  }
  return `${phaseId}.attempt-${String(maxAttempt + 1).padStart(3, '0')}.${artifactKind}.md`;
}

function phasePromptRelPath(topicDir, phaseId) {
  return nextPhaseArtifactDefaultRelPath(topicDir, phaseId, 'prompt');
}

function phaseAcceptanceRelPath(topicDir, phaseId) {
  return nextPhaseArtifactDefaultRelPath(topicDir, phaseId, 'acceptance');
}

function phaseWorkerOutputRelPath(topicDir, phaseId) {
  return nextPhaseArtifactDefaultRelPath(topicDir, phaseId, 'worker-output');
}

function providerExecutionLogRelPath(runId) {
  return normalizeRel(path.join('.nimi-coding', 'provider-execution', `${runId}.jsonl`));
}

function repoRelPath(absPath) {
  return normalizeRel(path.relative(REPO_ROOT, absPath));
}

function repoScopeRelPath(scopePath) {
  if (path.isAbsolute(scopePath)) {
    const resolved = path.resolve(scopePath);
    if (resolved === REPO_ROOT || resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
      return repoRelPath(resolved);
    }
  }
  return normalizeRel(scopePath);
}

function isWithinRepoScope(candidateAbsPath, candidateRelPath, scopePath) {
  if (path.isAbsolute(scopePath)) {
    const resolvedScopePath = path.resolve(scopePath);
    return candidateAbsPath === resolvedScopePath
      || candidateAbsPath.startsWith(`${resolvedScopePath}${path.sep}`);
  }
  const scopeRelPath = repoScopeRelPath(scopePath);
  if (scopeRelPath === '') {
    return true;
  }
  return candidateRelPath === scopeRelPath || candidateRelPath.startsWith(`${scopeRelPath}/`);
}

function phaseLookup(route, phaseId) {
  const phase = route.phaseById.get(phaseId);
  if (!phase) {
    throw new Error(`phase not present in packet route: ${phaseId}`);
  }
  return phase;
}

function refusalReport(options = {}) {
  const errors = [...(options.errors || [])];
  if (options.summary && !errors.includes(options.summary)) {
    errors.unshift(options.summary);
  }
  return {
    ok: false,
    errors,
    warnings: options.warnings || [],
    topic_id: options.topicId || null,
    packet_id: options.packetId || null,
    run_id: options.runId || null,
    phase_id: options.phaseId || null,
    prompt_ref: options.promptRef || null,
    worker_output_ref: options.workerOutputRef || null,
    provider_execution_log_ref: options.providerExecutionLogRef || null,
    refusal: {
      code: options.code,
      summary: options.summary,
      details: options.details || {},
    },
    summary: buildStatusSummary({
      outcome: 'refusal',
      runStatus: options.runStatus || null,
      stopReason: 'refusal',
      refusalCode: options.code,
      provider: options.provider?.provider_id || options.providerId || null,
      phaseId: options.phaseId || null,
      promptRef: options.promptRef || null,
      workerOutputRef: options.workerOutputRef || null,
      signalResultKind: options.signalResultKind || null,
      providerExecutionLogRef: options.providerExecutionLogRef || null,
      stepCount: options.stepCount ?? null,
      maxSteps: options.maxSteps ?? null,
      requiredHumanAction: options.requiredHumanAction || null,
      message: options.summary || null,
    }),
    provider: options.provider || null,
    ingest: options.ingest || null,
    run_status: options.runStatus || null,
  };
}

function isAdmittedProvider(providerId) {
  return providerId === CODEX_PROVIDER_ID;
}

function appendProviderExecutionLog(topicDir, runId, entry) {
  const logRelPath = providerExecutionLogRelPath(runId);
  const logAbsPath = path.join(topicDir, logRelPath);
  ensureDir(path.dirname(logAbsPath));
  fs.appendFileSync(logAbsPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return {
    ok: true,
    log_rel_path: logRelPath,
  };
}

function buildStatusSummary(options = {}) {
  return {
    contract: 'runner-status.v1',
    outcome: options.outcome || null,
    run_status: options.runStatus || null,
    stop_reason: options.stopReason || null,
    refusal_code: options.refusalCode || null,
    provider: options.provider || null,
    phase_id: options.phaseId || null,
    prompt_ref: options.promptRef || null,
    worker_output_ref: options.workerOutputRef || null,
    signal_result_kind: options.signalResultKind || null,
    provider_execution_log_ref: options.providerExecutionLogRef || null,
    step_count: options.stepCount ?? null,
    max_steps: options.maxSteps ?? null,
    required_human_action: options.requiredHumanAction || null,
    message: options.message || null,
  };
}

function sanitizeTranscriptText(rawText) {
  let text = rawText;
  let malformed = false;
  if (typeof text !== 'string') {
    malformed = true;
    text = text === undefined || text === null ? '' : String(text);
  }
  let redacted = false;
  const redact = (pattern, replacement) => {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      redacted = true;
      text = next;
    }
  };
  redact(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|COOKIE|SESSION|AUTH)[A-Z0-9_]*)\s*[:=]\s*\S+/gu, '$1=[REDACTED]');
  redact(/\bBearer\s+[A-Za-z0-9._-]+\b/gu, 'Bearer [REDACTED]');
  redact(/\b(?:sk|rk|pk|xoxb|ghp|gho|github_pat)_[A-Za-z0-9_-]+\b/gu, '[REDACTED_TOKEN]');
  return {
    text,
    malformed,
    redacted,
  };
}

function captureTranscriptStream(rawText) {
  const originalText = rawText === undefined || rawText === null ? '' : String(rawText);
  const sanitized = sanitizeTranscriptText(rawText);
  const truncated = sanitized.text.length > PROVIDER_TRANSCRIPT_CAPTURE_MAX_CHARS;
  const capturedText = truncated
    ? `${sanitized.text.slice(0, PROVIDER_TRANSCRIPT_CAPTURE_MAX_CHARS)}\n[TRUNCATED]`
    : sanitized.text;
  return {
    text: capturedText,
    original_length: originalText.length,
    captured_length: capturedText.length,
    truncated,
    malformed: sanitized.malformed,
    redacted: sanitized.redacted,
  };
}

function providerTranscriptPolicy() {
  return {
    max_chars_per_stream: PROVIDER_TRANSCRIPT_CAPTURE_MAX_CHARS,
    raw_prompt_body_logged: false,
    raw_command_arguments_logged: false,
    env_values_logged: false,
    tokens_logged: false,
  };
}

function normalizeProviderReport(providerReport) {
  return {
    provider_id: providerReport.provider_id || null,
    ok: Boolean(providerReport.ok),
    exit_code: Number.isInteger(providerReport.exit_code) ? providerReport.exit_code : null,
    timed_out: Boolean(providerReport.timed_out),
    reason: providerReport.reason || null,
    transcript: {
      policy: providerTranscriptPolicy(),
      stdout: captureTranscriptStream(providerReport.stdout),
      stderr: captureTranscriptStream(providerReport.stderr),
    },
  };
}

function buildProviderExecutionEntry(options = {}) {
  return {
    run_id: options.runId,
    phase_id: options.phaseId,
    provider: options.provider.provider_id || null,
    prompt_ref: options.promptRef || null,
    worker_output_ref: options.workerOutputRef || null,
    signal_result_kind: options.signalResultKind || null,
    started_at: options.startedAt,
    finished_at: options.finishedAt,
    exit_status: {
      ok: options.provider.ok,
      exit_code: options.provider.exit_code,
      timed_out: options.provider.timed_out,
    },
    refusal_code: options.refusalCode || null,
    transcript: options.provider.transcript,
    status_summary: buildStatusSummary({
      outcome: options.outcome,
      runStatus: options.runStatus || null,
      stopReason: options.stopReason || null,
      refusalCode: options.refusalCode || null,
      provider: options.provider.provider_id || null,
      phaseId: options.phaseId,
      promptRef: options.promptRef || null,
      workerOutputRef: options.workerOutputRef || null,
      signalResultKind: options.signalResultKind || null,
      providerExecutionLogRef: null,
      requiredHumanAction: options.requiredHumanAction || null,
      message: options.message || null,
    }),
  };
}

function readState(context) {
  const { topicDir, topic } = context;
  if (!topic.orchestration_state_ref) {
    return null;
  }
  const statePath = path.join(topicDir, topic.orchestration_state_ref);
  if (!exists(statePath)) {
    throw new Error(`missing orchestration state: ${topic.orchestration_state_ref}`);
  }
  return loadYamlFile(statePath) || {};
}

function validateStateForRunContext(context, errors) {
  if (!context.topic.orchestration_state_ref) {
    errors.push('continuous run requires orchestration_state_ref');
    return null;
  }
  const state = readState(context);
  if (state.packet_ref !== context.topic.execution_packet_ref) {
    errors.push('orchestration state packet_ref must match execution_packet_ref');
  }
  return state;
}

function loadRunContext(topicDir, options = {}) {
  const context = loadBatchContext(topicDir, { requireActiveTopic: options.requireActiveTopic });
  if (!context.ok) {
    return context;
  }
  context.topicDir = topicDir;

  const errors = [...context.errors];
  ensureContinuousProtocols(context.topic, errors);

  let state = null;
  if (options.requireState !== false) {
    state = validateStateForRunContext(context, errors);
  }

  if (errors.length > 0) {
    return {
      ...context,
      ok: false,
      errors,
    };
  }

  return {
    ...context,
    state,
  };
}

function currentPhaseView(context, state) {
  if (!state || !state.current_phase_id) {
    return null;
  }
  const phase = phaseLookup(context.route, state.current_phase_id);
  return phaseView(
    context.packet,
    phase,
    context.route.orderedPhaseIds.indexOf(String(state.current_phase_id)),
  );
}

function shouldEmitNotification(packet, eventType) {
  if (eventType === 'run_paused' || eventType === 'run_failed') {
    return Boolean(packet.notification_settings?.on_block);
  }
  if (eventType === 'run_completed') {
    return Boolean(packet.notification_settings?.on_final_completion);
  }
  if (eventType === 'awaiting_final_confirmation') {
    return Boolean(packet.notification_settings?.on_final_completion);
  }
  if (eventType === 'run_progress') {
    return Boolean(packet.notification_settings?.on_progress);
  }
  return false;
}

function emitNotification(topicDir, context, stateRelPath, state, eventType, options = {}) {
  if (!shouldEmitNotification(context.packet, eventType)) {
    return {
      ok: true,
      emitted: false,
      payload: null,
      log_rel_path: notificationLogRelPath(state.state_id),
      errors: [],
    };
  }

  const emittedAt = timestampNow();
  const correlationId = `${state.state_id}:${eventType}:${(state.notification_refs || []).length + 1}`;
  const logRelPath = notificationLogRelPath(state.state_id);
  const payload = {
    event: eventType,
    correlation_id: correlationId,
    topic_id: context.topic.topic_id,
    run_id: state.state_id,
    packet_ref: state.packet_ref,
    phase_id: options.phaseId ?? state.current_phase_id ?? state.last_completed_phase_id ?? null,
    run_status: state.run_status,
    reason: options.reason || null,
    required_human_action: options.requiredHumanAction || null,
    artifact_refs: {
      baseline_ref: context.topic.active_baseline,
      packet_ref: state.packet_ref,
      state_ref: stateRelPath,
      prompt_ref: options.promptRef ?? state.current_prompt_ref ?? null,
      worker_output_ref: options.workerOutputRef ?? state.latest_worker_output_ref ?? null,
      acceptance_ref: options.acceptanceRef ?? state.latest_acceptance_ref ?? null,
      evidence_refs: options.evidenceRefs ?? state.latest_evidence_refs ?? [],
    },
    emitted_at: emittedAt,
  };
  const payloadReport = validateNotificationPayloadData(
    path.join(topicDir, logRelPath),
    payload,
    { topicDir },
  );
  if (!payloadReport.ok) {
    return {
      ok: false,
      emitted: false,
      payload: null,
      log_rel_path: logRelPath,
      errors: payloadReport.errors,
    };
  }
  const logAbsPath = path.join(topicDir, logRelPath);
  ensureDir(path.dirname(logAbsPath));
  fs.appendFileSync(logAbsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  state.notification_refs = [
    ...(state.notification_refs || []),
    {
      event: eventType,
      correlation_id: correlationId,
      emitted_at: emittedAt,
    },
  ];

  return {
    ok: true,
    emitted: true,
    payload,
    log_rel_path: logRelPath,
    errors: [],
  };
}

function renderPrompt(context, state, phase) {
  const authorityRefs = [];
  const seenAuthority = new Set();
  for (const ref of [
    ...(phase.authority_refs || []),
    context.topic.active_baseline,
    context.topic.finding_ledger_ref,
    context.topic.latest_evidence,
    ...(state.latest_evidence_refs || []),
    state.latest_acceptance_ref,
  ]) {
    if (!ref || seenAuthority.has(ref)) {
      continue;
    }
    seenAuthority.add(ref);
    authorityRefs.push(`- \`${ref}\``);
  }

  const confirmedState = [
    `- Topic status: ${context.topic.status}`,
    `- Packet: ${context.packet.packet_id}`,
    `- Run id: ${state.state_id}`,
    `- Current phase: ${phase.phase_id}`,
    `- Last completed phase: ${state.last_completed_phase_id || '(none)'}`,
    `- Active baseline: ${context.topic.active_baseline}`,
    `- Read scope: ${(phase.read_scope || []).join(', ') || '(none)'}`,
    `- Write scope: ${(phase.write_scope || []).join(', ') || '(none)'}`,
  ];

  const hardConstraints = [
    `- Stay inside write scope: ${(phase.write_scope || []).join(', ') || '(none)'}`,
    `- Read only from declared read scope: ${(phase.read_scope || []).join(', ') || '(none)'}`,
    '- Do not widen authority, read scope, or write scope.',
    '- Do not modify execution packet, orchestration-state semantics, finding lifecycle, or final confirmation state.',
    '- Fail close on missing or invalid prerequisite artifacts.',
  ];

  const mustComplete = (phase.completion_criteria || []).map((line, index) => `${index + 1}. ${line}`);
  const explicitNonGoals = [
    '- No scope widening or packet mutation.',
    '- No semantic acceptance judgment.',
    '- No finding lifecycle judgment.',
    '- No notification transport or external service integration.',
  ];
  const requiredChecks = (phase.required_checks || []).map((line) => `- \`${line}\``);
  const escalationConditions = Array.from(new Set([
    ...(phase.escalation_conditions || []),
    ...(context.packet.escalation_policy?.pause_conditions || []),
  ]));

  return [
    `# ${phase.phase_id} Prompt`,
    '',
    '## Task Goal',
    '',
    phase.goal,
    '',
    '## Authority Reads',
    '',
    authorityRefs.join('\n'),
    '',
    '## Confirmed State',
    '',
    confirmedState.join('\n'),
    '',
    '## Hard Constraints',
    '',
    hardConstraints.join('\n'),
    '',
    '## Must Complete',
    '',
    mustComplete.join('\n'),
    '',
    '## Explicit Non-Goals',
    '',
    explicitNonGoals.join('\n'),
    '',
    '## Required Checks',
    '',
    requiredChecks.join('\n'),
    '',
    '## Required Final Output Format',
    '',
    '0. Add a `## Runner Signal` section with exactly one fenced `yaml` block containing `result_kind`, `worker_output_ref`, `evidence_refs`, `escalation_reasons`, and `fail_reason`.',
    '1. Findings',
    '2. Implementation summary',
    '3. Files changed',
    '4. Checks run',
    '5. Remaining gaps / risks',
    '',
    '## Blocker Escalation Rule',
    '',
    `If any blocker matches these packet-declared escalation conditions, stop and report the exact condition: ${escalationConditions.join('; ')}.`,
    '',
  ].join('\n');
}

function buildProviderExecutionPrompt(options) {
  const escalationConditions = Array.from(new Set([
    ...(options.phase.escalation_conditions || []),
    ...(options.packet.escalation_policy?.pause_conditions || []),
  ]));
  const expectedSignalYaml = [
    '```yaml',
    `result_kind: complete`,
    `worker_output_ref: ${options.workerOutputRef}`,
    'evidence_refs: []',
    'escalation_reasons: []',
    'fail_reason: null',
    '```',
  ].join('\n');

  return [
    'ROLE: You are the worker for one bounded nimi-coding phase.',
    REQUIRED_PROVIDER_PROMPT_PREAMBLE,
    '',
    `Read the phase dispatch from this file: ${options.promptAbsPath}`,
    `Your final response will be captured as the worker output artifact at: ${options.workerOutputAbsPath}`,
    `Inside that final response, set worker_output_ref exactly to: ${options.workerOutputRef}`,
    `Use evidence_refs only for evidence files that you actually wrote inside the topic workspace.`,
    '',
    'Required runner signal shape:',
    expectedSignalYaml,
    '',
    'Rules:',
    '- Do not inline repository file contents into this provider prompt or any wrapper prompt.',
    '- Read files directly from the repository.',
    '- Stay inside the packet-declared write scope.',
    '- Do not modify execution packet, orchestration-state semantics, finding lifecycle, or final confirmation state.',
    '- Your final response is the worker output artifact body; do not rely on separate ad hoc writeback paths for that artifact.',
    '- If blocked, set result_kind: escalate and use only packet-declared escalation reasons.',
    '- If execution cannot complete safely, set result_kind: fail and provide a concrete fail_reason.',
    `Allowed escalation reasons: ${escalationConditions.join('; ') || '(none declared)'}`,
    '',
    'Write any repository edits and optional evidence files first, then emit the worker output artifact as your final response and exit.',
  ].join('\n');
}

function invokeCodexProvider(options) {
  const args = [
    'exec',
    '--model',
    'gpt-5.4',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C',
    REPO_ROOT,
    '-o',
    options.workerOutputAbsPath,
    '-',
  ];
  const result = spawnSync('codex', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: options.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS,
    input: buildProviderExecutionPrompt(options),
  });

  const base = {
    ok: false,
    provider_id: CODEX_PROVIDER_ID,
    command: ['codex', ...args],
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    exit_code: result.status,
    timed_out: false,
    reason: null,
  };

  if (result.error) {
    return {
      ...base,
      timed_out: result.error.code === 'ETIMEDOUT',
      reason: result.error.code === 'ETIMEDOUT'
        ? `provider timed out after ${options.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS}ms`
        : `provider invocation failed: ${String(result.error.message || result.error)}`,
    };
  }
  if (result.status !== 0) {
    return {
      ...base,
      reason: `provider exited with status ${result.status}`,
    };
  }
  return {
    ...base,
    ok: true,
    reason: null,
  };
}

function validateEvidenceRefs(topicDir, evidenceRefs) {
  const errors = [];
  const resolved = [];
  for (const ref of evidenceRefs) {
    const { absPath, relPath } = toTopicRelPath(topicDir, ref, ref);
    if (!exists(absPath)) {
      errors.push(`missing evidence file: ${relPath}`);
      continue;
    }
    const report = validateDoc(absPath);
    if (!report.ok) {
      for (const error of report.errors) {
        errors.push(`evidence invalid (${relPath}): ${error}`);
      }
      continue;
    }
    if (report.doc?.frontmatter?.doc_type !== 'evidence') {
      errors.push(`evidence must be doc_type=evidence: ${relPath}`);
      continue;
    }
    resolved.push(relPath);
  }
  return { ok: errors.length === 0, errors, refs: resolved };
}

function validateFinalEvidenceRef(topicDir, evidenceRef) {
  const errors = [];
  const { absPath, relPath } = toTopicRelPath(topicDir, evidenceRef, evidenceRef);
  if (!exists(absPath)) {
    errors.push(`missing final evidence file: ${relPath}`);
    return { ok: false, errors };
  }
  const report = validateDoc(absPath);
  if (!report.ok) {
    for (const error of report.errors) {
      errors.push(`final evidence invalid (${relPath}): ${error}`);
    }
    return { ok: false, errors };
  }
  if (report.doc?.frontmatter?.doc_type !== 'evidence') {
    errors.push(`final evidence must be doc_type=evidence: ${relPath}`);
  }
  if (report.doc?.frontmatter?.status !== 'final') {
    errors.push(`final evidence must have status=final: ${relPath}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    relPath,
    absPath,
  };
}

function validateRunConfirmPreconditions(topicDir, context, state, finalEvidenceRef) {
  const errors = [];
  const currentTopicReport = validateTopic(topicDir);
  if (!currentTopicReport.ok) {
    errors.push(...currentTopicReport.errors.map((error) => `topic invalid before confirm: ${error}`));
  }
  if (context.topic.status !== 'active') {
    errors.push(`run-confirm requires topic status=active before closeout, got ${context.topic.status}`);
  }
  const terminalPhaseId = state.current_phase_id || state.last_completed_phase_id;
  if (!terminalPhaseId) {
    errors.push('run-confirm requires a terminal phase id from current_phase_id or last_completed_phase_id');
    return errors;
  }
  const phase = phaseLookup(context.route, terminalPhaseId);
  if (normalizeNextPhaseId(phase.next_on_success) !== null) {
    errors.push(`run-confirm requires packet terminal phase, got next_on_success=${phase.next_on_success}`);
  }
  if (state.last_completed_phase_id !== terminalPhaseId) {
    errors.push('run-confirm requires last_completed_phase_id to equal the terminal phase');
  }
  if (!state.latest_acceptance_ref) {
    errors.push('run-confirm requires latest_acceptance_ref from the terminal phase');
  } else {
    const acceptancePath = resolveTopicPath(topicDir, state.latest_acceptance_ref);
    const acceptanceReport = validateAcceptance(acceptancePath);
    if (!acceptanceReport.ok) {
      errors.push(...acceptanceReport.errors.map((error) => `latest acceptance invalid: ${error}`));
    } else {
      const acceptanceDoc = loadMarkdownDoc(acceptancePath);
      const disposition = String(acceptanceDoc.frontmatter?.disposition || '');
      if (disposition !== 'complete') {
        errors.push(`run-confirm requires latest acceptance disposition=complete, got ${disposition || '(missing)'}`);
      }
    }
  }

  const nextState = clone(state);
  nextState.run_status = 'completed';
  nextState.current_phase_id = null;
  nextState.awaiting_human_action = null;
  nextState.pause_reason = null;
  nextState.updated_at = timestampNow();
  const nextStateReport = validateOrchestrationStateData(
    path.join(topicDir, context.topic.orchestration_state_ref),
    nextState,
    { topicDir },
  );
  if (!nextStateReport.ok) {
    errors.push(...nextStateReport.errors.map((error) => `completed state invalid: ${error}`));
  }

  const evidenceReport = validateFinalEvidenceRef(topicDir, finalEvidenceRef);
  if (!evidenceReport.ok) {
    errors.push(...evidenceReport.errors);
  }
  return errors;
}

function runRequiredChecks(phase) {
  const results = [];
  let ok = true;
  for (const command of phase.required_checks || []) {
    try {
      const stdout = execSync(command, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      results.push({
        command,
        ok: true,
        output: stdout.trim(),
      });
    } catch (error) {
      ok = false;
      results.push({
        command,
        ok: false,
        output: String(error.stdout || '').trim(),
        error: String(error.stderr || error.message || '').trim(),
      });
    }
  }
  return { ok, results };
}

function renderAcceptance(options) {
  const findings = options.findings.map((line) => `- ${line}`);
  const nextLines = options.nextSteps.map((line) => `- ${line}`);
  return [
    '---',
    `disposition: ${options.disposition}`,
    '---',
    '',
    '# Phase Acceptance',
    '',
    '## Findings',
    '',
    findings.join('\n'),
    '',
    '## Current Phase Disposition',
    '',
    `**${options.disposition}** — ${options.summary}`,
    '',
    '## Next Step or Reopen Condition',
    '',
    nextLines.join('\n'),
    '',
  ].join('\n');
}

function writeAcceptance(topicDir, phaseId, content, outputPath) {
  const { absPath, relPath } = toTopicRelPath(topicDir, outputPath, phaseAcceptanceRelPath(topicDir, phaseId));
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, content, 'utf8');
  return { absPath, relPath };
}

function setStateAndValidate(topicDir, stateRelPath, state) {
  const report = setOrchestrationState(topicDir, stateRelPath, state);
  if (!report.ok) {
    throw new Error(report.errors.join('; '));
  }
}

function attachLatestEvidence(topicDir, evidenceRefs) {
  if (evidenceRefs.length === 0) {
    return;
  }
  const report = attachEvidence(topicDir, evidenceRefs[evidenceRefs.length - 1]);
  if (!report.ok) {
    throw new Error(report.errors.join('; '));
  }
}

function readAcceptanceDisposition(acceptancePath) {
  const acceptanceDoc = loadMarkdownDoc(acceptancePath);
  return String(acceptanceDoc.frontmatter?.disposition || '').trim();
}

function resolveOutcome(phase, options, validationErrors, checkReport) {
  if (options.failReason) {
    return {
      kind: 'fail',
      reason: options.failReason,
      requiredHumanAction: 'manual-repair-or-new-packet',
    };
  }
  if (options.escalationReasons.length > 0) {
    return {
      kind: 'pause',
      reason: options.escalationReasons.join('; '),
      requiredHumanAction: 'resolve-escalation-and-resume',
    };
  }
  if (validationErrors.length > 0) {
    return {
      kind: phase.stop_on_failure === 'stop' ? 'fail' : 'pause',
      reason: validationErrors.join('; '),
      requiredHumanAction: phase.stop_on_failure === 'stop' ? 'manual-repair-or-new-packet' : 'repair-prerequisites-and-resume',
    };
  }
  if (!checkReport.ok) {
    const failed = checkReport.results.filter((result) => !result.ok).map((result) => result.command);
    return {
      kind: phase.stop_on_failure === 'stop' ? 'fail' : 'pause',
      reason: `required check failed: ${failed.join(', ')}`,
      requiredHumanAction: phase.stop_on_failure === 'stop' ? 'manual-repair-or-new-packet' : 'repair-check-failure-and-resume',
    };
  }
  return {
    kind: 'success',
    reason: null,
    requiredHumanAction: null,
  };
}

function validateEscalationReasons(phase, packet, escalationReasons) {
  const allowed = new Set([
    ...(phase.escalation_conditions || []),
    ...(packet.escalation_policy?.pause_conditions || []),
    ...(packet.escalation_policy?.manager_decision_required || []),
  ]);
  const errors = [];
  for (const reason of escalationReasons) {
    if (!allowed.has(reason)) {
      errors.push(`escalation reason is not declared in packet policy: ${reason}`);
    }
  }
  return errors;
}

export function runStatus(topicDir) {
  const context = loadRunContext(topicDir, { requireState: false, requireActiveTopic: false });
  if (!context.ok) {
    return context;
  }

  if (!context.topic.orchestration_state_ref) {
    const entryPhase = context.route.phaseById.get(context.packet.entry_phase_id);
    return {
      ok: true,
      errors: [],
      warnings: context.warnings,
      topic_id: context.topic.topic_id,
      packet_id: context.packet.packet_id,
      run_status: 'idle',
      state_ref: null,
      notification_log_ref: null,
      current_phase: phaseView(context.packet, entryPhase, 0),
    };
  }

  const state = readState(context);
  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_status: state.run_status,
    state_ref: context.topic.orchestration_state_ref,
    notification_log_ref: notificationLogRelPath(state.state_id),
    state,
    current_phase: currentPhaseView(context, state),
  };
}

export function runStart(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: false });
  if (!context.ok) {
    return context;
  }

  const existingState = context.topic.orchestration_state_ref ? readState(context) : null;
  if (existingState && !TERMINAL_STATES.has(existingState.run_status)) {
    return {
      ok: false,
      errors: [`existing run is not terminal: ${existingState.run_status}`],
      warnings: context.warnings,
    };
  }

  const stateRelPath = normalizeRel(
    options.stateRef
    || context.topic.orchestration_state_ref
    || 'active-run.orchestration-state.yaml',
  );
  const now = timestampNow();
  const state = {
    state_id: options.runId || makeRunId(context.packet.packet_id),
    topic_id: context.topic.topic_id,
    packet_ref: context.topic.execution_packet_ref,
    run_status: 'running',
    current_phase_id: context.packet.entry_phase_id,
    last_completed_phase_id: null,
    awaiting_human_action: null,
    pause_reason: null,
    current_prompt_ref: null,
    latest_worker_output_ref: null,
    latest_acceptance_ref: null,
    latest_evidence_refs: [],
    notification_refs: [],
    started_at: now,
    updated_at: now,
    owner: context.topic.owner,
  };

  try {
    setStateAndValidate(topicDir, stateRelPath, state);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    state_ref: stateRelPath,
    run_status: state.run_status,
    current_phase: currentPhaseView(context, state),
  };
}

export function runNextPrompt(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return context;
  }

  const state = clone(context.state);
  if (state.run_status !== 'running') {
    return {
      ok: false,
      errors: [`run-next-prompt requires run_status=running, got ${state.run_status}`],
      warnings: context.warnings,
    };
  }

  const phase = phaseLookup(context.route, state.current_phase_id);
  const prompt = renderPrompt(context, state, phase);
  const stateRelPath = context.topic.orchestration_state_ref;

  let promptTarget;
  try {
    promptTarget = toTopicRelPath(topicDir, options.output, phasePromptRelPath(topicDir, phase.phase_id));
    ensureDir(path.dirname(promptTarget.absPath));
    fs.writeFileSync(promptTarget.absPath, prompt, 'utf8');
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  const promptReport = validatePrompt(promptTarget.absPath);
  if (!promptReport.ok) {
    return {
      ok: false,
      errors: promptReport.errors.map((error) => `generated prompt invalid: ${error}`),
      warnings: [...context.warnings, ...promptReport.warnings],
    };
  }

  state.current_prompt_ref = promptTarget.relPath;
  state.updated_at = timestampNow();

  try {
    setStateAndValidate(topicDir, stateRelPath, state);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [...context.warnings, ...promptReport.warnings],
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    state_ref: stateRelPath,
    prompt_ref: promptTarget.relPath,
    phase: phaseView(context.packet, phase, context.route.orderedPhaseIds.indexOf(phase.phase_id)),
  };
}

export function runIngest(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return context;
  }

  const state = clone(context.state);
  if (state.run_status !== 'running') {
    return {
      ok: false,
      errors: [`run-ingest requires run_status=running, got ${state.run_status}`],
      warnings: context.warnings,
    };
  }
  if (!state.current_prompt_ref) {
    return {
      ok: false,
      errors: ['run-ingest requires current_prompt_ref; generate prompt first'],
      warnings: context.warnings,
    };
  }
  if (!options.workerOutput) {
    return {
      ok: false,
      errors: ['run-ingest requires --worker-output'],
      warnings: context.warnings,
    };
  }

  const phase = phaseLookup(context.route, state.current_phase_id);
  const stateRelPath = context.topic.orchestration_state_ref;
  const executedPromptRef = state.current_prompt_ref;
  const errors = [];

  const promptPath = resolveTopicPath(topicDir, state.current_prompt_ref);
  const promptReport = validatePrompt(promptPath);
  if (!promptReport.ok) {
    errors.push(...promptReport.errors.map((error) => `prompt invalid: ${error}`));
  }

  let workerOutputTarget = null;
  try {
    workerOutputTarget = toTopicRelPath(topicDir, options.workerOutput, options.workerOutput);
  } catch (error) {
    errors.push(error.message);
  }

  if (workerOutputTarget && !exists(workerOutputTarget.absPath)) {
    errors.push(`missing worker-output file: ${workerOutputTarget.relPath}`);
  }

  const workerOutputReport = workerOutputTarget
    ? validateWorkerOutput(workerOutputTarget.absPath, {
      topicDir,
      expectedWorkerOutputRef: workerOutputTarget.relPath,
    })
    : { ok: false, errors: [], warnings: [] };
  if (workerOutputTarget && !workerOutputReport.ok) {
    errors.push(...workerOutputReport.errors.map((error) => `worker-output invalid: ${error}`));
  }

  const escalationErrors = validateEscalationReasons(
    phase,
    context.packet,
    options.escalationReasons || [],
  );
  if (escalationErrors.length > 0) {
    return {
      ok: false,
      errors: escalationErrors,
      warnings: context.warnings,
    };
  }

  const evidenceReport = validateEvidenceRefs(topicDir, options.evidenceRefs || []);
  if (!evidenceReport.ok) {
    errors.push(...evidenceReport.errors);
  }

  const checkReport = errors.length === 0 && (options.escalationReasons || []).length === 0 && !options.failReason
    ? runRequiredChecks(phase)
    : { ok: true, results: [] };

  const outcome = resolveOutcome(
    phase,
    {
      escalationReasons: options.escalationReasons || [],
      failReason: options.failReason || null,
    },
    errors,
    checkReport,
  );

  const findings = [
    `Worker output processed for phase \`${phase.phase_id}\`.`,
    workerOutputTarget ? `Worker output ref: \`${workerOutputTarget.relPath}\`.` : 'Worker output ref missing.',
  ];
  if (outcome.kind === 'success') {
    findings.push('All packet-declared checks passed.');
  } else {
    findings.push(`Run ${outcome.kind} reason: ${outcome.reason}.`);
  }
  if (evidenceReport.refs.length > 0) {
    findings.push(`Evidence refs: ${evidenceReport.refs.join(', ')}.`);
  }

  const nextPhaseId = outcome.kind === 'success' ? normalizeNextPhaseId(phase.next_on_success) : null;
  const acceptanceText = renderAcceptance({
    disposition: outcome.kind === 'success' ? 'complete' : 'deferred',
    findings,
    summary: outcome.kind === 'success'
      ? 'packet-declared mechanical closure rules were satisfied'
      : outcome.kind === 'pause'
        ? 'execution paused pending explicit human action'
        : 'run failed and requires manual repair or a new packet',
    nextSteps: outcome.kind === 'success'
      ? (nextPhaseId === null
        ? ['Final human confirmation is required before terminal closeout.']
        : [`Generate dispatch for next phase: \`${nextPhaseId}\`.`])
      : [`Human action required: ${outcome.requiredHumanAction}.`, `Reason: ${outcome.reason}.`],
  });

  let acceptanceTarget;
  try {
    acceptanceTarget = writeAcceptance(topicDir, phase.phase_id, acceptanceText, options.acceptance);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  const acceptedEvidenceRefs = evidenceReport.refs;
  const acceptedWorkerOutputRef = workerOutputTarget && workerOutputReport.ok
    ? workerOutputTarget.relPath
    : null;
  state.latest_worker_output_ref = acceptedWorkerOutputRef;
  state.latest_acceptance_ref = acceptanceTarget.relPath;
  state.latest_evidence_refs = acceptedEvidenceRefs;
  state.last_completed_phase_id = outcome.kind === 'success' ? phase.phase_id : state.last_completed_phase_id;
  state.current_prompt_ref = outcome.kind === 'success' ? null : state.current_prompt_ref;

  if (outcome.kind === 'success' && nextPhaseId !== null) {
    state.run_status = 'running';
    state.current_phase_id = nextPhaseId;
    state.awaiting_human_action = null;
    state.pause_reason = null;
  } else if (outcome.kind === 'success') {
    state.run_status = 'completed';
    state.current_phase_id = null;
    state.last_completed_phase_id = phase.phase_id;
    state.awaiting_human_action = null;
    state.pause_reason = null;
  } else if (outcome.kind === 'pause') {
    state.run_status = 'paused';
    state.current_phase_id = phase.phase_id;
    state.awaiting_human_action = outcome.requiredHumanAction;
    state.pause_reason = outcome.reason;
  } else {
    state.run_status = 'failed';
    state.current_phase_id = phase.phase_id;
    state.awaiting_human_action = outcome.requiredHumanAction;
    state.pause_reason = null;
  }
  state.updated_at = timestampNow();

  let notification = {
    ok: true,
    emitted: false,
    payload: null,
    log_rel_path: notificationLogRelPath(state.state_id),
    errors: [],
  };
  if (state.run_status === 'paused') {
    notification = emitNotification(topicDir, context, stateRelPath, state, 'run_paused', {
      reason: outcome.reason,
      requiredHumanAction: outcome.requiredHumanAction,
      promptRef: executedPromptRef,
      workerOutputRef: acceptedWorkerOutputRef,
      acceptanceRef: acceptanceTarget.relPath,
      evidenceRefs: acceptedEvidenceRefs,
    });
  } else if (state.run_status === 'failed') {
    notification = emitNotification(topicDir, context, stateRelPath, state, 'run_failed', {
      reason: outcome.reason,
      requiredHumanAction: outcome.requiredHumanAction,
      promptRef: executedPromptRef,
      workerOutputRef: acceptedWorkerOutputRef,
      acceptanceRef: acceptanceTarget.relPath,
      evidenceRefs: acceptedEvidenceRefs,
    });
  } else if (state.run_status === 'completed') {
    notification = emitNotification(topicDir, context, stateRelPath, state, 'run_completed', {
      reason: 'terminal packet phase completed mechanically',
      requiredHumanAction: null,
      promptRef: executedPromptRef,
      workerOutputRef: acceptedWorkerOutputRef,
      acceptanceRef: acceptanceTarget.relPath,
      evidenceRefs: acceptedEvidenceRefs,
    });
  }
  if (!notification.ok) {
    return {
      ok: false,
      errors: notification.errors,
      warnings: [...context.warnings, ...promptReport.warnings, ...workerOutputReport.warnings],
    };
  }

  try {
    attachLatestEvidence(topicDir, acceptedEvidenceRefs);
    setStateAndValidate(topicDir, stateRelPath, state);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: [...context.warnings, ...promptReport.warnings, ...workerOutputReport.warnings],
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [...context.warnings, ...promptReport.warnings, ...workerOutputReport.warnings],
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    state_ref: stateRelPath,
    run_status: state.run_status,
    phase_id: phase.phase_id,
    next_phase: nextPhaseId ? phaseView(
      context.packet,
      phaseLookup(context.route, nextPhaseId),
      context.route.orderedPhaseIds.indexOf(nextPhaseId),
    ) : null,
    prompt_ref: state.current_prompt_ref,
    worker_output_ref: state.latest_worker_output_ref,
    acceptance_ref: state.latest_acceptance_ref,
    evidence_refs: state.latest_evidence_refs,
    checks_run: checkReport.results,
    notification,
    required_human_action: state.awaiting_human_action,
  };
}

export function runReview(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return context;
  }

  const state = clone(context.state);
  if (state.run_status !== 'running') {
    return {
      ok: false,
      errors: [`run-review requires run_status=running, got ${state.run_status}`],
      warnings: context.warnings,
    };
  }
  if (!state.current_prompt_ref) {
    return {
      ok: false,
      errors: ['run-review requires current_prompt_ref; generate prompt first'],
      warnings: context.warnings,
    };
  }
  if (!options.workerOutput) {
    return {
      ok: false,
      errors: ['run-review requires --worker-output'],
      warnings: context.warnings,
    };
  }
  if (!options.acceptance) {
    return {
      ok: false,
      errors: ['run-review requires --acceptance'],
      warnings: context.warnings,
    };
  }
  if (!options.disposition) {
    return {
      ok: false,
      errors: ['run-review requires --disposition'],
      warnings: context.warnings,
    };
  }

  const validDispositions = new Set(['complete', 'partial', 'deferred']);
  if (!validDispositions.has(options.disposition)) {
    return {
      ok: false,
      errors: [`invalid disposition: ${options.disposition}`],
      warnings: context.warnings,
    };
  }
  if (options.disposition === 'deferred') {
    if (!options.awaitingHumanAction) {
      return {
        ok: false,
        errors: ['run-review disposition=deferred requires --awaiting-human-action'],
        warnings: context.warnings,
      };
    }
    if (!options.deferReason) {
      return {
        ok: false,
        errors: ['run-review disposition=deferred requires --defer-reason'],
        warnings: context.warnings,
      };
    }
  }

  const phase = phaseLookup(context.route, state.current_phase_id);
  const stateRelPath = context.topic.orchestration_state_ref;
  const executedPromptRef = state.current_prompt_ref;
  const errors = [];

  const promptPath = resolveTopicPath(topicDir, executedPromptRef);
  const promptReport = validatePrompt(promptPath);
  if (!promptReport.ok) {
    errors.push(...promptReport.errors.map((error) => `prompt invalid: ${error}`));
  }

  let workerOutputTarget = null;
  try {
    workerOutputTarget = toTopicRelPath(topicDir, options.workerOutput, options.workerOutput);
  } catch (error) {
    errors.push(error.message);
  }
  if (workerOutputTarget && !exists(workerOutputTarget.absPath)) {
    errors.push(`missing worker-output file: ${workerOutputTarget.relPath}`);
  }
  const workerOutputReport = workerOutputTarget
    ? validateWorkerOutput(workerOutputTarget.absPath, {
      topicDir,
      expectedWorkerOutputRef: workerOutputTarget.relPath,
    })
    : { ok: false, errors: [], warnings: [] };
  if (workerOutputTarget && !workerOutputReport.ok) {
    errors.push(...workerOutputReport.errors.map((error) => `worker-output invalid: ${error}`));
  }

  let acceptanceTarget = null;
  try {
    acceptanceTarget = toTopicRelPath(topicDir, options.acceptance, options.acceptance);
  } catch (error) {
    errors.push(error.message);
  }
  if (acceptanceTarget && !exists(acceptanceTarget.absPath)) {
    errors.push(`missing acceptance file: ${acceptanceTarget.relPath}`);
  }
  const acceptanceReport = acceptanceTarget
    ? validateAcceptance(acceptanceTarget.absPath)
    : { ok: false, errors: [], warnings: [] };
  if (acceptanceTarget && !acceptanceReport.ok) {
    errors.push(...acceptanceReport.errors.map((error) => `acceptance invalid: ${error}`));
  }
  if (acceptanceTarget && acceptanceReport.ok) {
    const acceptanceDisposition = readAcceptanceDisposition(acceptanceTarget.absPath);
    if (acceptanceDisposition && acceptanceDisposition !== options.disposition) {
      errors.push(`acceptance disposition mismatch: frontmatter=${acceptanceDisposition} cli=${options.disposition}`);
    }
  }

  const evidenceReport = validateEvidenceRefs(topicDir, options.evidenceRefs || []);
  if (!evidenceReport.ok) {
    errors.push(...evidenceReport.errors);
  }

  const checkReport = errors.length === 0
    ? runRequiredChecks(phase)
    : { ok: false, results: [] };
  if (options.disposition === 'complete' && !checkReport.ok) {
    errors.push('run-review disposition=complete requires all packet-declared checks to pass');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings: [
        ...context.warnings,
        ...(promptReport.warnings || []),
        ...(workerOutputReport.warnings || []),
        ...(acceptanceReport.warnings || []),
      ],
    };
  }

  const nextPhaseId = options.disposition === 'complete'
    ? normalizeNextPhaseId(phase.next_on_success)
    : options.disposition === 'partial'
      ? phase.phase_id
      : null;

  state.latest_worker_output_ref = workerOutputTarget.relPath;
  state.latest_acceptance_ref = acceptanceTarget.relPath;
  state.latest_evidence_refs = evidenceReport.refs;
  state.current_prompt_ref = null;

  if (options.disposition === 'complete' && nextPhaseId !== null) {
    state.run_status = 'running';
    state.current_phase_id = nextPhaseId;
    state.last_completed_phase_id = phase.phase_id;
    state.awaiting_human_action = null;
    state.pause_reason = null;
  } else if (options.disposition === 'complete') {
    state.run_status = 'completed';
    state.current_phase_id = null;
    state.last_completed_phase_id = phase.phase_id;
    state.awaiting_human_action = null;
    state.pause_reason = null;
  } else if (options.disposition === 'partial') {
    state.run_status = 'running';
    state.current_phase_id = phase.phase_id;
    state.awaiting_human_action = null;
    state.pause_reason = null;
  } else {
    state.run_status = 'paused';
    state.current_phase_id = phase.phase_id;
    state.awaiting_human_action = options.awaitingHumanAction;
    state.pause_reason = options.deferReason;
  }
  state.updated_at = timestampNow();

  let notification = {
    ok: true,
    emitted: false,
    payload: null,
    log_rel_path: notificationLogRelPath(state.state_id),
    errors: [],
  };
  if (state.run_status === 'paused') {
    notification = emitNotification(topicDir, context, stateRelPath, state, 'run_paused', {
      reason: options.deferReason,
      requiredHumanAction: options.awaitingHumanAction,
      promptRef: executedPromptRef,
      workerOutputRef: workerOutputTarget.relPath,
      acceptanceRef: acceptanceTarget.relPath,
      evidenceRefs: evidenceReport.refs,
    });
  } else if (state.run_status === 'completed') {
    notification = emitNotification(topicDir, context, stateRelPath, state, 'run_completed', {
      reason: 'terminal phase accepted as complete by manager review',
      requiredHumanAction: null,
      promptRef: executedPromptRef,
      workerOutputRef: workerOutputTarget.relPath,
      acceptanceRef: acceptanceTarget.relPath,
      evidenceRefs: evidenceReport.refs,
    });
  }
  if (!notification.ok) {
    return {
      ok: false,
      errors: notification.errors,
      warnings: [
        ...context.warnings,
        ...(promptReport.warnings || []),
        ...(workerOutputReport.warnings || []),
        ...(acceptanceReport.warnings || []),
      ],
    };
  }

  try {
    attachLatestEvidence(topicDir, evidenceReport.refs);
    setStateAndValidate(topicDir, stateRelPath, state);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: [
        ...context.warnings,
        ...(promptReport.warnings || []),
        ...(workerOutputReport.warnings || []),
        ...(acceptanceReport.warnings || []),
      ],
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [
      ...context.warnings,
      ...(promptReport.warnings || []),
      ...(workerOutputReport.warnings || []),
      ...(acceptanceReport.warnings || []),
    ],
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    state_ref: stateRelPath,
    run_status: state.run_status,
    phase_id: phase.phase_id,
    next_phase: nextPhaseId ? phaseView(
      context.packet,
      phaseLookup(context.route, nextPhaseId),
      context.route.orderedPhaseIds.indexOf(nextPhaseId),
    ) : null,
    prompt_ref: executedPromptRef,
    worker_output_ref: state.latest_worker_output_ref,
    acceptance_ref: state.latest_acceptance_ref,
    evidence_refs: state.latest_evidence_refs,
    checks_run: checkReport.results,
    notification,
    disposition: options.disposition,
    required_human_action: state.awaiting_human_action,
  };
}

export function runLoopOnce(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: 'provider-backed loop requires a valid packet-bound run context',
      errors: context.errors,
      warnings: context.warnings,
    });
  }

  const protocolErrors = [];
  ensureProviderBackedProtocols(context.topic, protocolErrors);
  if (protocolErrors.length > 0) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: 'provider-backed loop requires admitted provider execution protocols',
      errors: protocolErrors,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: context.state?.state_id || null,
      runStatus: context.state?.run_status || null,
    });
  }

  const state = clone(context.state);
  if (state.run_status !== 'running') {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: `run-loop-once requires run_status=running, got ${state.run_status}`,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      runStatus: state.run_status,
    });
  }

  const phase = phaseLookup(context.route, state.current_phase_id);
  const providerId = options.providerId || CODEX_PROVIDER_ID;
  if (!isAdmittedProvider(providerId)) {
    return refusalReport({
      code: REFUSAL_CODES.PROVIDER_NOT_ADMITTED,
      summary: `provider-backed loop admits only ${CODEX_PROVIDER_ID}, got ${providerId}`,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      phaseId: phase.phase_id,
      runStatus: state.run_status,
      details: {
        admitted_provider_set: [CODEX_PROVIDER_ID],
        provider: providerId,
      },
    });
  }

  let workerOutputTarget;
  try {
    workerOutputTarget = toTopicRelPath(
      topicDir,
      options.workerOutput,
      phaseWorkerOutputRelPath(topicDir, phase.phase_id),
    );
  } catch (error) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: error.message,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      phaseId: phase.phase_id,
      runStatus: state.run_status,
    });
  }

  const workerOutputRepoRel = repoRelPath(workerOutputTarget.absPath);
  const withinWriteScope = (phase.write_scope || []).some((scopePath) =>
    isWithinRepoScope(workerOutputTarget.absPath, workerOutputRepoRel, scopePath));
  if (!withinWriteScope) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: `provider-backed loop requires worker output inside packet write_scope: ${workerOutputRepoRel}`,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      phaseId: phase.phase_id,
      workerOutputRef: workerOutputTarget.relPath,
      runStatus: state.run_status,
    });
  }

  const stepStartedAt = timestampNow();
  const promptReport = runNextPrompt(topicDir, options.promptOutput ? { output: options.promptOutput } : {});
  if (!promptReport.ok) {
    const stepFinishedAt = timestampNow();
    let providerExecutionLogRef = null;
    try {
      providerExecutionLogRef = appendProviderExecutionLog(topicDir, state.state_id, {
        run_id: state.state_id,
        phase_id: phase.phase_id,
        provider: providerId,
        prompt_ref: null,
        worker_output_ref: workerOutputTarget.relPath,
        signal_result_kind: null,
        started_at: stepStartedAt,
        finished_at: stepFinishedAt,
        exit_status: {
          ok: false,
          exit_code: null,
          timed_out: false,
        },
        refusal_code: REFUSAL_CODES.PROMPT_GENERATION_FAILED,
        transcript: {
          policy: providerTranscriptPolicy(),
          stdout: captureTranscriptStream(''),
          stderr: captureTranscriptStream(''),
        },
        status_summary: buildStatusSummary({
          outcome: 'refusal',
          runStatus: state.run_status,
          stopReason: 'refusal',
          refusalCode: REFUSAL_CODES.PROMPT_GENERATION_FAILED,
          provider: providerId,
          phaseId: phase.phase_id,
          workerOutputRef: workerOutputTarget.relPath,
          message: 'prompt generation failed before provider invocation',
        }),
      }).log_rel_path;
    } catch (error) {
      return refusalReport({
        code: REFUSAL_CODES.OPERATIONAL_LOG_WRITE_FAILED,
        summary: `provider execution log write failed: ${String(error.message || error)}`,
        warnings: [...context.warnings, ...(promptReport.warnings || [])],
        topicId: context.topic.topic_id,
        packetId: context.packet.packet_id,
        runId: state.state_id,
        phaseId: phase.phase_id,
        workerOutputRef: workerOutputTarget.relPath,
        runStatus: state.run_status,
      });
    }
    return refusalReport({
      code: REFUSAL_CODES.PROMPT_GENERATION_FAILED,
      summary: 'provider-backed loop could not generate the current prompt',
      errors: promptReport.errors,
      warnings: [...context.warnings, ...(promptReport.warnings || [])],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      phaseId: phase.phase_id,
      workerOutputRef: workerOutputTarget.relPath,
      providerExecutionLogRef,
      runStatus: state.run_status,
    });
  }

  const refreshedContext = loadRunContext(topicDir, { requireState: true });
  if (!refreshedContext.ok) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: 'provider-backed loop requires a valid orchestration state after prompt generation',
      errors: refreshedContext.errors,
      warnings: [...context.warnings, ...(promptReport.warnings || [])],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      phaseId: phase.phase_id,
      workerOutputRef: workerOutputTarget.relPath,
      runStatus: state.run_status,
    });
  }
  const refreshedState = clone(refreshedContext.state);
  const promptRef = refreshedState.current_prompt_ref;
  if (!promptRef) {
    return refusalReport({
      code: REFUSAL_CODES.PROMPT_GENERATION_FAILED,
      summary: 'run-loop-once requires current_prompt_ref after prompt generation',
      warnings: [...context.warnings, ...promptReport.warnings],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: refreshedState.state_id,
      phaseId: phase.phase_id,
      workerOutputRef: workerOutputTarget.relPath,
      runStatus: refreshedState.run_status,
    });
  }

  const promptAbsPath = resolveTopicPath(topicDir, promptRef);
  const providerInvoker = options.providerInvoker || invokeCodexProvider;
  const providerReport = providerInvoker({
    topicDir,
    repoRoot: REPO_ROOT,
    packet: refreshedContext.packet,
    phase,
    state: refreshedState,
    promptRef,
    promptAbsPath,
    workerOutputRef: workerOutputTarget.relPath,
    workerOutputAbsPath: workerOutputTarget.absPath,
    timeoutMs: options.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS,
  });
  const providerRuntime = normalizeProviderReport(providerReport);
  if (!isAdmittedProvider(providerRuntime.provider_id)) {
    return refusalReport({
      code: REFUSAL_CODES.PROVIDER_NOT_ADMITTED,
      summary: `provider-backed loop admits only ${CODEX_PROVIDER_ID}, got ${providerRuntime.provider_id || '(missing)'}`,
      warnings: [...context.warnings, ...promptReport.warnings],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: refreshedState.state_id,
      phaseId: phase.phase_id,
      promptRef,
      workerOutputRef: workerOutputTarget.relPath,
      provider: providerRuntime,
      runStatus: refreshedState.run_status,
      details: {
        admitted_provider_set: [CODEX_PROVIDER_ID],
        provider: providerRuntime.provider_id || null,
      },
    });
  }

  let ingestReport;
  let signal = null;
  let refusal = null;
  if (!providerRuntime.ok) {
    ingestReport = runIngest(topicDir, {
      workerOutput: workerOutputTarget.relPath,
      acceptance: options.acceptance,
      failReason: providerRuntime.reason,
    });
    refusal = {
      code: providerRuntime.timed_out
        ? REFUSAL_CODES.PROVIDER_TIMEOUT
        : REFUSAL_CODES.PROVIDER_INVOCATION_FAILED,
      summary: providerRuntime.reason || 'provider invocation failed',
      details: {
        exit_code: providerRuntime.exit_code,
        timed_out: providerRuntime.timed_out,
      },
    };
  } else {
    const workerOutputReport = validateWorkerOutput(workerOutputTarget.absPath, {
      topicDir,
      expectedWorkerOutputRef: workerOutputTarget.relPath,
    });
    if (!workerOutputReport.ok) {
      ingestReport = runIngest(topicDir, {
        workerOutput: workerOutputTarget.relPath,
        acceptance: options.acceptance,
        failReason: `worker output invalid: ${workerOutputReport.errors.join('; ')}`,
      });
      refusal = {
        code: workerOutputReport.refusal?.code || VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_INVALID,
        summary: workerOutputReport.refusal?.message || 'provider-backed loop requires a valid worker-output artifact',
        details: {
          validation_errors: workerOutputReport.errors,
        },
      };
    } else {
      signal = workerOutputReport.signal;
      if (signal.result_kind === 'complete') {
        ingestReport = runIngest(topicDir, {
          workerOutput: signal.worker_output_ref,
          acceptance: options.acceptance,
          evidenceRefs: signal.evidence_refs,
        });
      } else if (signal.result_kind === 'escalate') {
        ingestReport = runIngest(topicDir, {
          workerOutput: signal.worker_output_ref,
          acceptance: options.acceptance,
          evidenceRefs: signal.evidence_refs,
          escalationReasons: signal.escalation_reasons,
        });
      } else {
        ingestReport = runIngest(topicDir, {
          workerOutput: signal.worker_output_ref,
          acceptance: options.acceptance,
          evidenceRefs: signal.evidence_refs,
          failReason: signal.fail_reason,
        });
      }
    }
  }

  const stepFinishedAt = timestampNow();
  const stepOutcome = refusal
    ? 'refusal'
    : ingestReport?.run_status === 'running'
      ? 'advanced'
      : 'stopped';
  const stopReason = refusal
    ? 'refusal'
    : ingestReport?.run_status === 'running'
      ? null
      : ingestReport?.run_status || null;
  const statusSummary = buildStatusSummary({
    outcome: stepOutcome,
    runStatus: ingestReport?.run_status || null,
    stopReason,
    refusalCode: refusal?.code || null,
    provider: providerRuntime.provider_id || providerId,
    phaseId: phase.phase_id,
    promptRef,
    workerOutputRef: workerOutputTarget.relPath,
    signalResultKind: signal?.result_kind || null,
    providerExecutionLogRef: null,
    requiredHumanAction: ingestReport?.required_human_action || null,
    message: refusal
      ? refusal.summary
      : ingestReport?.run_status === 'running'
        ? `phase advanced to ${ingestReport.next_phase?.phase_id || '(unknown)'}`
        : ingestReport?.run_status === 'completed'
          ? 'packet completed'
          : ingestReport?.run_status === 'awaiting_confirmation'
            ? 'packet reached awaiting_confirmation'
          : ingestReport?.run_status === 'paused'
            ? `run paused: ${ingestReport.required_human_action || 'human action required'}`
            : ingestReport?.run_status === 'failed'
              ? 'run failed'
              : 'provider-backed step completed',
  });
  let providerExecutionLogRef = null;
  try {
    providerExecutionLogRef = appendProviderExecutionLog(
      topicDir,
      refreshedState.state_id,
      buildProviderExecutionEntry({
        runId: refreshedState.state_id,
        phaseId: phase.phase_id,
        provider: providerRuntime,
        promptRef,
        workerOutputRef: workerOutputTarget.relPath,
        signalResultKind: signal?.result_kind || null,
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        refusalCode: refusal?.code || null,
        outcome: stepOutcome,
        runStatus: ingestReport?.run_status || null,
        stopReason,
        requiredHumanAction: ingestReport?.required_human_action || null,
        message: statusSummary.message,
      }),
    ).log_rel_path;
  } catch (error) {
    return refusalReport({
      code: REFUSAL_CODES.OPERATIONAL_LOG_WRITE_FAILED,
      summary: `provider execution log write failed: ${String(error.message || error)}`,
      warnings: [
        ...(context.warnings || []),
        ...(promptReport.warnings || []),
        ...(ingestReport?.warnings || []),
      ],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: refreshedState.state_id,
      phaseId: phase.phase_id,
      promptRef,
      workerOutputRef: workerOutputTarget.relPath,
      provider: providerRuntime,
      ingest: ingestReport,
      runStatus: ingestReport?.run_status || null,
    });
  }

  if (!ingestReport?.ok) {
    return refusalReport({
      code: refusal?.code || REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: refusal?.summary || 'provider-backed loop could not complete this step',
      errors: ingestReport?.errors || [],
      warnings: [
        ...(context.warnings || []),
        ...(promptReport.warnings || []),
        ...(ingestReport?.warnings || []),
      ],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: refreshedState.state_id,
      phaseId: phase.phase_id,
      promptRef,
      workerOutputRef: workerOutputTarget.relPath,
      providerExecutionLogRef,
      provider: providerRuntime,
      ingest: ingestReport,
      runStatus: ingestReport?.run_status || null,
      signalResultKind: signal?.result_kind || null,
      requiredHumanAction: ingestReport?.required_human_action || null,
      details: refusal?.details || {},
    });
  }

  if (refusal) {
    return refusalReport({
      code: refusal.code,
      summary: refusal.summary,
      warnings: [
        ...(context.warnings || []),
        ...(promptReport.warnings || []),
        ...(ingestReport?.warnings || []),
      ],
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: refreshedState.state_id,
      phaseId: phase.phase_id,
      promptRef,
      workerOutputRef: workerOutputTarget.relPath,
      providerExecutionLogRef,
      provider: providerRuntime,
      ingest: ingestReport,
      runStatus: ingestReport?.run_status || null,
      signalResultKind: signal?.result_kind || null,
      requiredHumanAction: ingestReport?.required_human_action || null,
      details: refusal.details,
    });
  }

  return {
    ok: true,
    errors: [],
    warnings: [
      ...(context.warnings || []),
      ...(promptReport.warnings || []),
      ...(ingestReport?.warnings || []),
    ],
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: refreshedState.state_id,
    phase_id: phase.phase_id,
    prompt_ref: promptRef,
    provider_execution_log_ref: providerExecutionLogRef,
    summary: buildStatusSummary({
      outcome: stepOutcome,
      runStatus: ingestReport?.run_status || null,
      stopReason,
      provider: providerRuntime.provider_id || providerId,
      phaseId: phase.phase_id,
      promptRef,
      workerOutputRef: workerOutputTarget.relPath,
      signalResultKind: signal?.result_kind || null,
      providerExecutionLogRef,
      requiredHumanAction: ingestReport?.required_human_action || null,
      message: statusSummary.message,
    }),
    provider: providerRuntime,
    signal,
    worker_output_ref: workerOutputTarget.relPath,
    ingest: ingestReport,
    run_status: ingestReport?.run_status || null,
  };
}

export function runUntilBlocked(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: 'run-until-blocked requires a valid packet-bound run context',
      errors: context.errors,
      warnings: context.warnings,
    });
  }

  const protocolErrors = [];
  ensureProviderBackedProtocols(context.topic, protocolErrors);
  if (protocolErrors.length > 0) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: 'run-until-blocked requires admitted provider execution protocols',
      errors: protocolErrors,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: context.state?.state_id || null,
      runStatus: context.state?.run_status || null,
    });
  }

  const maxSteps = Number(options.maxSteps ?? DEFAULT_RUN_UNTIL_BLOCKED_MAX_STEPS);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: `run-until-blocked requires --max-steps to be an integer >= 1, got ${String(options.maxSteps)}`,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: context.state?.state_id || null,
      runStatus: context.state?.run_status || null,
    });
  }

  const state = clone(context.state);
  if (state.run_status !== 'running') {
    return refusalReport({
      code: REFUSAL_CODES.STATE_PRECONDITION_FAILED,
      summary: `run-until-blocked requires run_status=running, got ${state.run_status}`,
      warnings: context.warnings,
      topicId: context.topic.topic_id,
      packetId: context.packet.packet_id,
      runId: state.state_id,
      runStatus: state.run_status,
    });
  }

  const steps = [];
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const stepReport = runLoopOnce(topicDir, options);
    steps.push(stepReport);
    if (!stepReport.ok) {
      return {
        ...stepReport,
        warnings: [...(context.warnings || []), ...(stepReport.warnings || [])],
        step_count: steps.length,
        max_steps: maxSteps,
        stop_reason: 'refusal',
        summary: buildStatusSummary({
          outcome: 'refusal',
          runStatus: stepReport.run_status || null,
          stopReason: 'refusal',
          refusalCode: stepReport.refusal?.code || null,
          provider: stepReport.provider?.provider_id || null,
          phaseId: stepReport.phase_id || null,
          promptRef: stepReport.prompt_ref || null,
          workerOutputRef: stepReport.worker_output_ref || null,
          signalResultKind: stepReport.signal?.result_kind || null,
          providerExecutionLogRef: stepReport.provider_execution_log_ref || null,
          stepCount: steps.length,
          maxSteps: maxSteps,
          requiredHumanAction: stepReport.ingest?.required_human_action || null,
          message: stepReport.refusal?.summary || 'run-until-blocked refused',
        }),
        steps,
      };
    }
    if (RUN_UNTIL_BLOCKED_STOP_STATUSES.has(stepReport.run_status)) {
      return {
        ok: true,
        errors: [],
        warnings: [...(context.warnings || []), ...(stepReport.warnings || [])],
        topic_id: context.topic.topic_id,
        packet_id: context.packet.packet_id,
        run_id: state.state_id,
        run_status: stepReport.run_status,
        stop_reason: stepReport.run_status,
        step_count: steps.length,
        max_steps: maxSteps,
        provider_execution_log_ref: stepReport.provider_execution_log_ref || null,
        summary: buildStatusSummary({
          outcome: 'stopped',
          runStatus: stepReport.run_status,
          stopReason: stepReport.run_status,
          provider: stepReport.provider?.provider_id || null,
          phaseId: stepReport.phase_id || null,
          promptRef: stepReport.prompt_ref || null,
          workerOutputRef: stepReport.worker_output_ref || null,
          signalResultKind: stepReport.signal?.result_kind || null,
          providerExecutionLogRef: stepReport.provider_execution_log_ref || null,
          stepCount: steps.length,
          maxSteps: maxSteps,
          requiredHumanAction: stepReport.ingest?.required_human_action || null,
          message: `run-until-blocked stopped at ${stepReport.run_status}`,
        }),
        last_step: stepReport,
        steps,
      };
    }
  }

  const latestStatus = runStatus(topicDir);
  return refusalReport({
    code: REFUSAL_CODES.LOOP_GUARD_HIT,
    summary: `run-until-blocked stopped after ${maxSteps} steps while the run was still progressing`,
    warnings: [...(context.warnings || []), ...(latestStatus.warnings || [])],
    topicId: context.topic.topic_id,
    packetId: context.packet.packet_id,
    runId: state.state_id,
    runStatus: latestStatus.run_status || null,
    providerExecutionLogRef: providerExecutionLogRelPath(state.state_id),
    stepCount: maxSteps,
    maxSteps,
    details: {
      step_count: maxSteps,
      final_run_status: latestStatus.run_status || null,
    },
    ingest: null,
  });
}

export function runResume(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return context;
  }

  const state = clone(context.state);
  if (state.run_status !== 'paused') {
    return {
      ok: false,
      errors: [`run-resume requires run_status=paused, got ${state.run_status}`],
      warnings: context.warnings,
    };
  }
  if (!options.reason) {
    return {
      ok: false,
      errors: ['run-resume requires --reason'],
      warnings: context.warnings,
    };
  }
  if (!context.packet.resume_policy?.same_revision_resume_allowed_reasons?.includes(options.reason)) {
    return {
      ok: false,
      errors: [`resume reason is not allowed by packet resume_policy: ${options.reason}`],
      warnings: context.warnings,
    };
  }

  state.run_status = 'running';
  state.awaiting_human_action = null;
  state.pause_reason = null;
  state.updated_at = timestampNow();

  try {
    setStateAndValidate(topicDir, context.topic.orchestration_state_ref, state);
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    run_status: state.run_status,
    state_ref: context.topic.orchestration_state_ref,
    current_phase: currentPhaseView(context, state),
  };
}

export function runConfirm(topicDir, options = {}) {
  const context = loadRunContext(topicDir, { requireState: true });
  if (!context.ok) {
    return context;
  }

  const state = clone(context.state);
  if (state.run_status !== 'completed' && state.run_status !== 'awaiting_confirmation') {
    return {
      ok: false,
      errors: [`run-confirm requires run_status=completed or awaiting_confirmation, got ${state.run_status}`],
      warnings: context.warnings,
    };
  }

  const finalEvidenceInput = options?.finalEvidence || context.topic.final_evidence;
  if (!finalEvidenceInput) {
    return {
      ok: false,
      errors: ['run-confirm requires --final-evidence or an existing topic.final_evidence'],
      warnings: context.warnings,
    };
  }
  let finalEvidenceRef = null;
  try {
    finalEvidenceRef = toTopicRelPath(topicDir, finalEvidenceInput, finalEvidenceInput).relPath;
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }
  const preflightErrors = validateRunConfirmPreconditions(topicDir, context, state, finalEvidenceRef);
  if (preflightErrors.length > 0) {
    return {
      ok: false,
      errors: preflightErrors,
      warnings: context.warnings,
    };
  }

  const originalState = clone(state);
  if (state.run_status !== 'completed') {
    state.run_status = 'completed';
    state.current_phase_id = null;
    state.awaiting_human_action = null;
    state.pause_reason = null;
    state.updated_at = timestampNow();
  }

  try {
    setStateAndValidate(topicDir, context.topic.orchestration_state_ref, state);
    const closeoutReport = closeTopic(topicDir, {
      finalEvidenceRef,
      reason: options?.reason || 'Final human confirmation accepted after packet-terminal mechanical completion.',
    });
    if (!closeoutReport.ok) {
      setStateAndValidate(topicDir, context.topic.orchestration_state_ref, originalState);
      return {
        ok: false,
        errors: closeoutReport.errors,
        warnings: [...context.warnings, ...(closeoutReport.warnings || [])],
      };
    }
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings: context.warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    run_id: state.state_id,
    run_status: state.run_status,
    state_ref: context.topic.orchestration_state_ref,
    topic_status: 'closed',
    final_evidence_ref: finalEvidenceRef,
  };
}
