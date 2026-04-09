import path from 'node:path';
import YAML from 'yaml';
import {
  exists,
  fail,
  listMarkdownHeadings,
  loadMarkdownDoc,
  loadYamlFile,
  normalizeRel,
  resolveTopicPath,
} from './doc-utils.mjs';

const DOC_CONFIG = {
  explore: {
    requiredFrontmatter: ['title', 'doc_type', 'status', 'reason', 'owner', 'updated_at'],
    allowedStatus: new Set(['draft', 'active', 'superseded', 'archived']),
    requiredSections: [
      'Question / Scope',
      'Current Understanding',
      'Options',
      'Recommendation or Current Lean',
      'Open Questions',
    ],
  },
  baseline: {
    requiredFrontmatter: ['title', 'doc_type', 'status', 'reason', 'owner', 'updated_at', 'phase'],
    allowedStatus: new Set(['draft', 'active', 'frozen', 'superseded', 'archived']),
    requiredSections: [
      'Phase Goal',
      'Confirmed State',
      'Entry Criteria',
      'Hard Constraints',
      'Explicit Non-Goals',
      'Required Checks',
      'Completion Criteria',
      'Reject / Reopen Conditions',
      'Next Step',
    ],
  },
  evidence: {
    requiredFrontmatter: ['title', 'doc_type', 'status', 'reason', 'owner', 'updated_at', 'decision'],
    allowedStatus: new Set(['recorded', 'accepted', 'rejected', 'deferred', 'final', 'archived']),
    requiredSections: [
      'Findings',
      'Checks Run',
      'Decision',
      'Why This Decision',
      'Remaining Risks or Gaps',
      'Next Action or Reopen Condition',
    ],
  },
};

const TOPIC_STATUS = new Set(['exploring', 'active', 'blocked', 'deferred', 'closed', 'archived']);
const FINDING_STATUS = new Set(['active', 'fixed', 'deferred', 'invalid', 'superseded', 'archived']);
const EXECUTION_PACKET_STATUS = new Set(['draft', 'frozen', 'superseded', 'archived']);
const EXECUTION_PACKET_STOP_ON_FAILURE = new Set(['pause', 'stop']);
const ORCHESTRATION_STATE_RUN_STATUS = new Set([
  'running',
  'paused',
  'awaiting_confirmation',
  'completed',
  'failed',
  'superseded',
]);
const NOTIFICATION_EVENTS = new Map([
  ['run_paused', 'paused'],
  ['run_failed', 'failed'],
  ['run_completed', 'completed'],
  ['awaiting_final_confirmation', 'awaiting_confirmation'],
]);
const PROMPT_BLOCKS = [
  'Task Goal',
  'Authority Reads',
  'Confirmed State',
  'Hard Constraints',
  'Must Complete',
  'Explicit Non-Goals',
  'Required Checks',
  'Required Final Output Format',
  'Blocker Escalation Rule',
];

const WORKER_OUTPUT_BLOCKS = [
  'Findings',
  'Implementation summary',
  'Files changed',
  'Checks run',
  'Remaining gaps / risks',
  'Runner Signal',
];

const ACCEPTANCE_BLOCKS = [
  'Findings',
  'Current Phase Disposition',
  'Next Step or Reopen Condition',
];

const ACCEPTANCE_DISPOSITIONS = new Set(['complete', 'partial', 'deferred']);
const WORKER_RUNNER_SIGNAL_RESULT_KINDS = new Set(['complete', 'escalate', 'fail']);
export const VALIDATOR_NATIVE_REFUSAL_CODES = Object.freeze({
  WORKER_OUTPUT_MISSING: 'WORKER_OUTPUT_MISSING',
  WORKER_OUTPUT_INVALID: 'WORKER_OUTPUT_INVALID',
  RUNNER_SIGNAL_MISSING: 'RUNNER_SIGNAL_MISSING',
  RUNNER_SIGNAL_INVALID: 'RUNNER_SIGNAL_INVALID',
  RUNNER_SIGNAL_ARTIFACT_MISMATCH: 'RUNNER_SIGNAL_ARTIFACT_MISMATCH',
});

function makeValidatorRefusal(code, message) {
  return { code, message };
}

function inferTopicDir(filePath) {
  let cursor = path.dirname(filePath);
  while (true) {
    if (exists(path.join(cursor, 'topic.index.yaml'))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return path.dirname(filePath);
    }
    cursor = parent;
  }
}

function extractMarkdownSection(body, heading) {
  const lines = body.split(/\r?\n/u);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.+?)\s*$/u);
    if (match && match[1] === heading) {
      start = index + 1;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function parseYamlFence(sectionText, label, errors) {
  const trimmed = String(sectionText || '').trim();
  const match = trimmed.match(/^```yaml\r?\n([\s\S]*?)\r?\n```\s*$/u);
  if (!match) {
    fail(`${label} must contain exactly one fenced yaml block`, errors);
    return null;
  }
  try {
    const parsed = YAML.parse(match[1]) || {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${label} yaml must parse to a mapping`, errors);
      return null;
    }
    return parsed;
  } catch (error) {
    fail(`${label} yaml is invalid: ${String(error.message || error)}`, errors);
    return null;
  }
}

export function readWorkerRunnerSignal(filePath, options = {}) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return {
      ok: false,
      errors: [`missing file: ${filePath}`],
      warnings,
      signal: null,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_MISSING,
        'worker-output artifact is missing',
      ),
    };
  }
  const topicDir = options.topicDir || inferTopicDir(filePath);
  const doc = loadMarkdownDoc(filePath);
  const section = extractMarkdownSection(doc.body, 'Runner Signal');
  if (!section) {
    fail('missing worker-output block: Runner Signal', errors);
    return {
      ok: false,
      errors,
      warnings,
      signal: null,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_MISSING,
        'worker-output artifact is missing the required Runner Signal block',
      ),
    };
  }
  const parsed = parseYamlFence(section, 'Runner Signal', errors);
  if (!parsed) {
    return {
      ok: false,
      errors,
      warnings,
      signal: null,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_INVALID,
        'Runner Signal must be exactly one valid fenced yaml mapping',
      ),
    };
  }

  const resultKind = String(parsed.result_kind || '');
  if (!WORKER_RUNNER_SIGNAL_RESULT_KINDS.has(resultKind)) {
    fail(`invalid worker runner signal result_kind: ${resultKind || '(missing)'}`, errors);
  }

  const workerOutputRef = parsed.worker_output_ref ? normalizeRel(parsed.worker_output_ref) : '';
  if (!workerOutputRef) {
    fail('worker runner signal worker_output_ref must be a non-empty string', errors);
  }

  const expectedWorkerOutputRef = options.expectedWorkerOutputRef
    ? normalizeRel(options.expectedWorkerOutputRef)
    : normalizeRel(path.relative(topicDir, filePath));
  if (workerOutputRef && expectedWorkerOutputRef && workerOutputRef !== expectedWorkerOutputRef) {
    fail(`worker runner signal worker_output_ref must match the current artifact path: ${expectedWorkerOutputRef}`, errors);
  }

  const evidenceRefs = parsed.evidence_refs === undefined ? [] : parsed.evidence_refs;
  if (!Array.isArray(evidenceRefs)) {
    fail('worker runner signal evidence_refs must be an array when present', errors);
  } else {
    for (const ref of evidenceRefs) {
      if (typeof ref !== 'string' || ref.length === 0) {
        fail('worker runner signal evidence_refs entries must be non-empty strings', errors);
        continue;
      }
      const relRef = normalizeRel(ref);
      const evidencePath = resolveTopicPath(topicDir, relRef);
      if (!exists(evidencePath)) {
        fail(`worker runner signal evidence_ref does not exist: ${relRef}`, errors);
        continue;
      }
      const report = validateDoc(evidencePath);
      for (const error of report.errors) {
        fail(`worker runner signal evidence_ref invalid (${relRef}): ${error}`, errors);
      }
      if (report.doc?.frontmatter?.doc_type !== 'evidence') {
        fail(`worker runner signal evidence_ref must target doc_type=evidence: ${relRef}`, errors);
      }
    }
  }

  const escalationReasons = parsed.escalation_reasons === undefined ? [] : parsed.escalation_reasons;
  if (!Array.isArray(escalationReasons)) {
    fail('worker runner signal escalation_reasons must be an array when present', errors);
  } else {
    for (const reason of escalationReasons) {
      if (typeof reason !== 'string' || reason.length === 0) {
        fail('worker runner signal escalation_reasons entries must be non-empty strings', errors);
      }
    }
  }

  const failReason = parsed.fail_reason;
  if (!(failReason === undefined || failReason === null || failReason === '' || typeof failReason === 'string')) {
    fail('worker runner signal fail_reason must be a string or null', errors);
  }

  if (resultKind === 'complete') {
    if (Array.isArray(escalationReasons) && escalationReasons.length > 0) {
      fail('worker runner signal result_kind=complete must not carry escalation_reasons', errors);
    }
    if (typeof failReason === 'string' && failReason.length > 0) {
      fail('worker runner signal result_kind=complete must not carry fail_reason', errors);
    }
  }
  if (resultKind === 'escalate') {
    if (!Array.isArray(escalationReasons) || escalationReasons.length === 0) {
      fail('worker runner signal result_kind=escalate requires escalation_reasons', errors);
    }
    if (typeof failReason === 'string' && failReason.length > 0) {
      fail('worker runner signal result_kind=escalate must not carry fail_reason', errors);
    }
  }
  if (resultKind === 'fail') {
    if (!(typeof failReason === 'string' && failReason.length > 0)) {
      fail('worker runner signal result_kind=fail requires fail_reason', errors);
    }
    if (Array.isArray(escalationReasons) && escalationReasons.length > 0) {
      fail('worker runner signal result_kind=fail must not carry escalation_reasons', errors);
    }
  }

  let refusal = null;
  if (errors.length > 0) {
    const mismatchError = errors.find((error) => error.includes('worker runner signal worker_output_ref must match the current artifact path'));
    refusal = mismatchError
      ? makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_ARTIFACT_MISMATCH,
        'worker runner signal must point at the current worker-output artifact path',
      )
      : makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.RUNNER_SIGNAL_INVALID,
        'worker-output artifact contains an invalid Runner Signal payload',
      );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal,
    signal: errors.length === 0
      ? {
        result_kind: resultKind,
        worker_output_ref: workerOutputRef,
        evidence_refs: Array.isArray(evidenceRefs) ? evidenceRefs.map((ref) => normalizeRel(ref)) : [],
        escalation_reasons: Array.isArray(escalationReasons) ? escalationReasons : [],
        fail_reason: typeof failReason === 'string' && failReason.length > 0 ? failReason : null,
      }
      : null,
  };
}

function validateExecutionPacketData(filePath, doc = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const topicDir = options.topicDir || path.dirname(filePath);
  for (const key of [
    'packet_id',
    'topic_id',
    'status',
    'owner',
    'created_at',
    'updated_at',
    'baseline_ref',
    'entry_phase_id',
    'phases',
    'escalation_policy',
    'notification_settings',
    'resume_policy',
  ]) {
    if (!(key in doc)) {
      fail(`missing execution packet field: ${key}`, errors);
    }
  }
  const status = String(doc.status || '');
  if (status && !EXECUTION_PACKET_STATUS.has(status)) {
    fail(`invalid execution packet status: ${status}`, errors);
  }
  const baselineRef = doc.baseline_ref ? normalizeRel(doc.baseline_ref) : null;
  if (baselineRef) {
    const baselinePath = resolveTopicPath(topicDir, baselineRef);
    if (!exists(baselinePath)) {
      fail(`execution packet baseline_ref does not exist: ${doc.baseline_ref}`, errors);
    } else {
      const report = validateDoc(baselinePath);
      for (const error of report.errors) {
        fail(`execution packet baseline_ref invalid: ${error}`, errors);
      }
      if (report.doc?.frontmatter?.doc_type !== 'baseline') {
        fail('execution packet baseline_ref must target doc_type=baseline', errors);
      }
    }
  }
  if (!Array.isArray(doc.phases) || doc.phases.length === 0) {
    fail('execution packet phases must be a non-empty array', errors);
  }
  const phaseIds = new Set();
  for (const phase of Array.isArray(doc.phases) ? doc.phases : []) {
    for (const key of [
      'phase_id',
      'goal',
      'authority_refs',
      'write_scope',
      'read_scope',
      'required_checks',
      'completion_criteria',
      'escalation_conditions',
      'next_on_success',
      'stop_on_failure',
    ]) {
      if (!(key in (phase || {}))) {
        fail(`execution packet phase missing field: ${key}`, errors);
      }
    }
    const phaseId = String(phase?.phase_id || '');
    if (!phaseId) {
      continue;
    }
    if (phaseIds.has(phaseId)) {
      fail(`duplicate execution packet phase_id: ${phaseId}`, errors);
    }
    phaseIds.add(phaseId);
    for (const key of ['authority_refs', 'write_scope', 'read_scope', 'required_checks', 'completion_criteria', 'escalation_conditions']) {
      if (!Array.isArray(phase?.[key]) || phase[key].length === 0) {
        fail(`execution packet phase ${phaseId}: ${key} must be a non-empty array`, errors);
      }
    }
    const stopOnFailure = String(phase?.stop_on_failure || '');
    if (stopOnFailure && !EXECUTION_PACKET_STOP_ON_FAILURE.has(stopOnFailure)) {
      fail(`execution packet phase ${phaseId}: invalid stop_on_failure ${stopOnFailure}`, errors);
    }
    const nextOnSuccess = phase?.next_on_success;
    if (!(nextOnSuccess === null || nextOnSuccess === '' || typeof nextOnSuccess === 'string')) {
      fail(`execution packet phase ${phaseId}: next_on_success must be a string or null`, errors);
    }
    if (typeof nextOnSuccess === 'string' && nextOnSuccess === phaseId) {
      fail(`execution packet phase ${phaseId}: next_on_success must not self-reference`, errors);
    }
  }
  if (doc.entry_phase_id && !phaseIds.has(String(doc.entry_phase_id))) {
    fail(`execution packet entry_phase_id does not exist in phases: ${doc.entry_phase_id}`, errors);
  }
  for (const phase of Array.isArray(doc.phases) ? doc.phases : []) {
    const phaseId = String(phase?.phase_id || '');
    const nextOnSuccess = phase?.next_on_success;
    if (typeof nextOnSuccess === 'string' && nextOnSuccess !== '' && !phaseIds.has(nextOnSuccess)) {
      fail(`execution packet phase ${phaseId}: next_on_success target does not exist: ${nextOnSuccess}`, errors);
    }
  }
  if (!doc.escalation_policy || typeof doc.escalation_policy !== 'object' || Array.isArray(doc.escalation_policy)) {
    fail('execution packet escalation_policy must be a mapping', errors);
  } else {
    for (const key of ['pause_conditions', 'manager_decision_required']) {
      if (!Array.isArray(doc.escalation_policy[key])) {
        fail(`execution packet escalation_policy missing array: ${key}`, errors);
      }
    }
  }
  if (!doc.notification_settings || typeof doc.notification_settings !== 'object' || Array.isArray(doc.notification_settings)) {
    fail('execution packet notification_settings must be a mapping', errors);
  } else {
    for (const key of ['on_block', 'on_final_completion', 'on_progress']) {
      if (typeof doc.notification_settings[key] !== 'boolean') {
        fail(`execution packet notification_settings.${key} must be boolean`, errors);
      }
    }
  }
  if (!doc.resume_policy || typeof doc.resume_policy !== 'object' || Array.isArray(doc.resume_policy)) {
    fail('execution packet resume_policy must be a mapping', errors);
  } else {
    for (const key of ['same_revision_resume_allowed_reasons', 'new_packet_required_on']) {
      if (!Array.isArray(doc.resume_policy[key])) {
        fail(`execution packet resume_policy missing array: ${key}`, errors);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}

export function validateExecutionPacket(filePath, options = {}) {
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings: [] };
  }
  const topicDir = options.topicDir || path.dirname(filePath);
  const doc = loadYamlFile(filePath) || {};
  return validateExecutionPacketData(filePath, doc, { ...options, topicDir });
}

export function validateOrchestrationStateData(filePath, doc = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const topicDir = options.topicDir || path.dirname(filePath);
  for (const key of [
    'state_id',
    'topic_id',
    'packet_ref',
    'run_status',
    'current_phase_id',
    'last_completed_phase_id',
    'awaiting_human_action',
    'updated_at',
    'owner',
  ]) {
    if (!(key in doc)) {
      fail(`missing orchestration state field: ${key}`, errors);
    }
  }
  const runStatus = String(doc.run_status || '');
  if (runStatus && !ORCHESTRATION_STATE_RUN_STATUS.has(runStatus)) {
    fail(`invalid orchestration state run_status: ${runStatus}`, errors);
  }
  if (Object.prototype.hasOwnProperty.call(doc, 'resume_token')) {
    fail('orchestration state must not contain resume_token', errors);
  }
  const packetRef = doc.packet_ref ? normalizeRel(doc.packet_ref) : null;
  let packet = null;
  if (packetRef) {
    const packetPath = resolveTopicPath(topicDir, packetRef);
    const packetReport = validateExecutionPacket(packetPath, { topicDir });
    if (!packetReport.ok) {
      for (const error of packetReport.errors) {
        fail(`orchestration state packet_ref invalid: ${error}`, errors);
      }
    } else {
      packet = packetReport.doc;
      if (packet.topic_id !== doc.topic_id) {
        fail('orchestration state packet_ref topic_id must match state topic_id', errors);
      }
    }
  }
  const phaseIds = new Set(Array.isArray(packet?.phases) ? packet.phases.map((phase) => String(phase.phase_id)) : []);
  for (const key of ['current_phase_id', 'last_completed_phase_id']) {
    const value = doc[key];
    if (!(value === null || value === '' || typeof value === 'string')) {
      fail(`orchestration state ${key} must be a string or null`, errors);
      continue;
    }
    if (typeof value === 'string' && value !== '' && packet && !phaseIds.has(value)) {
      fail(`orchestration state ${key} does not exist in packet phases: ${value}`, errors);
    }
  }
  const awaitingHumanAction = doc.awaiting_human_action;
  if (!(awaitingHumanAction === null || awaitingHumanAction === '' || typeof awaitingHumanAction === 'string')) {
    fail('orchestration state awaiting_human_action must be a string or null', errors);
  }
  const pauseReason = doc.pause_reason;
  if (!(pauseReason === undefined || pauseReason === null || pauseReason === '' || typeof pauseReason === 'string')) {
    fail('orchestration state pause_reason must be a string or null', errors);
  }
  if (runStatus === 'running') {
    if (!(typeof doc.current_phase_id === 'string' && doc.current_phase_id.length > 0)) {
      fail('running orchestration state requires current_phase_id', errors);
    }
  }
  if (runStatus === 'paused') {
    if (!(typeof pauseReason === 'string' && pauseReason.length > 0)) {
      fail('paused orchestration state requires pause_reason', errors);
    }
    if (!(typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0)) {
      fail('paused orchestration state requires awaiting_human_action', errors);
    }
    if (!(typeof doc.current_phase_id === 'string' && doc.current_phase_id.length > 0)) {
      fail('paused orchestration state requires current_phase_id', errors);
    }
  }
  if (runStatus === 'awaiting_confirmation' || runStatus === 'failed') {
    if (!(typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0)) {
      fail(`orchestration state run_status=${runStatus} requires awaiting_human_action`, errors);
    }
  }
  if ((runStatus === 'running' || runStatus === 'completed' || runStatus === 'superseded')
    && typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0) {
      fail(`orchestration state run_status=${runStatus} must not carry awaiting_human_action`, errors);
  }
  if ((runStatus === 'running' || runStatus === 'completed' || runStatus === 'superseded' || runStatus === 'awaiting_confirmation')
    && typeof pauseReason === 'string' && pauseReason.length > 0) {
      fail(`orchestration state run_status=${runStatus} must not carry pause_reason`, errors);
  }
  if (runStatus === 'awaiting_confirmation') {
    if (!(typeof doc.current_phase_id === 'string' && doc.current_phase_id.length > 0)) {
      fail('awaiting_confirmation orchestration state requires current_phase_id', errors);
    }
    if (!(typeof doc.last_completed_phase_id === 'string' && doc.last_completed_phase_id.length > 0)) {
      fail('awaiting_confirmation orchestration state requires last_completed_phase_id', errors);
    }
  }
  if (runStatus === 'completed') {
    if (!(doc.current_phase_id === null || doc.current_phase_id === '')) {
      fail('completed orchestration state must not carry current_phase_id', errors);
    }
    if (!(typeof doc.last_completed_phase_id === 'string' && doc.last_completed_phase_id.length > 0)) {
      fail('completed orchestration state requires last_completed_phase_id', errors);
    }
  }
  if (packet && typeof doc.current_phase_id === 'string' && doc.current_phase_id.length > 0
    && typeof doc.last_completed_phase_id === 'string' && doc.last_completed_phase_id.length > 0) {
    const phaseOrder = new Map(packet.phases.map((phase, index) => [String(phase.phase_id), index]));
    if (phaseOrder.get(doc.last_completed_phase_id) > phaseOrder.get(doc.current_phase_id)) {
      fail('orchestration state last_completed_phase_id must not be after current_phase_id', errors);
    }
  }
  if (Array.isArray(doc.notification_refs)) {
    for (const row of doc.notification_refs) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        fail('orchestration state notification_refs entries must be mappings', errors);
        continue;
      }
      for (const key of ['event', 'correlation_id']) {
        if (!row[key] || typeof row[key] !== 'string') {
          fail(`orchestration state notification_refs entry missing string field: ${key}`, errors);
        }
      }
      if (row.event && !NOTIFICATION_EVENTS.has(row.event)) {
        fail(`orchestration state notification_refs entry has invalid event: ${row.event}`, errors);
      }
      if (row.emitted_at && typeof row.emitted_at !== 'string') {
        fail('orchestration state notification_refs entry emitted_at must be a string when present', errors);
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(doc, 'notification_refs') && doc.notification_refs !== null) {
    fail('orchestration state notification_refs must be an array when present', errors);
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}

export function validateOrchestrationState(filePath, options = {}) {
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings: [] };
  }
  const topicDir = options.topicDir || path.dirname(filePath);
  const doc = loadYamlFile(filePath) || {};
  return validateOrchestrationStateData(filePath, doc, { ...options, topicDir });
}

function validateBaselineRef(topicDir, relPath, errors, label) {
  const absPath = resolveTopicPath(topicDir, relPath);
  if (!exists(absPath)) {
    fail(`${label} target does not exist: ${relPath}`, errors);
    return null;
  }
  const report = validateDoc(absPath);
  for (const error of report.errors) {
    fail(`${label} target invalid: ${error}`, errors);
  }
  if (report.doc?.frontmatter?.doc_type !== 'baseline') {
    fail(`${label} target must be doc_type=baseline: ${relPath}`, errors);
  }
  return report;
}

function validatePromptTarget(topicDir, relPath, errors, label) {
  const absPath = resolveTopicPath(topicDir, relPath);
  if (!exists(absPath)) {
    fail(`${label} target does not exist: ${relPath}`, errors);
    return;
  }
  const report = validatePrompt(absPath);
  for (const error of report.errors) {
    fail(`${label} target invalid: ${error}`, errors);
  }
}

function validateWorkerOutputTarget(topicDir, relPath, errors, label) {
  const absPath = resolveTopicPath(topicDir, relPath);
  if (!exists(absPath)) {
    fail(`${label} target does not exist: ${relPath}`, errors);
    return;
  }
  const report = validateWorkerOutput(absPath);
  for (const error of report.errors) {
    fail(`${label} target invalid: ${error}`, errors);
  }
}

function validateAcceptanceTarget(topicDir, relPath, errors, label) {
  const absPath = resolveTopicPath(topicDir, relPath);
  if (!exists(absPath)) {
    fail(`${label} target does not exist: ${relPath}`, errors);
    return;
  }
  const report = validateAcceptance(absPath);
  for (const error of report.errors) {
    fail(`${label} target invalid: ${error}`, errors);
  }
}

export function validateNotificationPayloadData(filePath, doc = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const topicDir = options.topicDir || path.dirname(filePath);
  for (const key of [
    'event',
    'correlation_id',
    'topic_id',
    'run_id',
    'packet_ref',
    'phase_id',
    'run_status',
    'reason',
    'required_human_action',
    'artifact_refs',
    'emitted_at',
  ]) {
    if (!(key in doc)) {
      fail(`missing notification payload field: ${key}`, errors);
    }
  }
  const event = String(doc.event || '');
  if (event && !NOTIFICATION_EVENTS.has(event)) {
    fail(`invalid notification event: ${event}`, errors);
  }
  for (const key of ['correlation_id', 'topic_id', 'run_id', 'packet_ref', 'phase_id', 'emitted_at']) {
    if (!doc[key] || typeof doc[key] !== 'string') {
      fail(`notification payload ${key} must be a non-empty string`, errors);
    }
  }
  const runStatus = String(doc.run_status || '');
  if (runStatus && !ORCHESTRATION_STATE_RUN_STATUS.has(runStatus)) {
    fail(`invalid notification payload run_status: ${runStatus}`, errors);
  }
  if (event && NOTIFICATION_EVENTS.has(event) && runStatus && NOTIFICATION_EVENTS.get(event) !== runStatus) {
    fail(`notification payload event ${event} requires run_status=${NOTIFICATION_EVENTS.get(event)}`, errors);
  }
  for (const key of ['reason', 'required_human_action']) {
    const value = doc[key];
    if (!(value === null || value === '' || typeof value === 'string')) {
      fail(`notification payload ${key} must be a string or null`, errors);
    }
  }
  if ((event === 'run_paused' || event === 'run_failed' || event === 'awaiting_final_confirmation')
    && !(typeof doc.required_human_action === 'string' && doc.required_human_action.length > 0)) {
    fail(`notification payload event ${event} requires required_human_action`, errors);
  }
  if ((event === 'run_paused' || event === 'run_failed' || event === 'awaiting_final_confirmation' || event === 'run_completed')
    && !(typeof doc.reason === 'string' && doc.reason.length > 0)) {
    fail(`notification payload event ${event} requires reason`, errors);
  }

  const packetRef = doc.packet_ref ? normalizeRel(doc.packet_ref) : null;
  if (packetRef) {
    const packetPath = resolveTopicPath(topicDir, packetRef);
    const report = validateExecutionPacket(packetPath, { topicDir });
    for (const error of report.errors) {
      fail(`notification payload packet_ref invalid: ${error}`, errors);
    }
    if (report.doc?.topic_id && doc.topic_id && report.doc.topic_id !== doc.topic_id) {
      fail('notification payload packet_ref topic_id must match topic_id', errors);
    }
    const phaseIds = new Set(Array.isArray(report.doc?.phases) ? report.doc.phases.map((phase) => String(phase.phase_id)) : []);
    if (doc.phase_id && !phaseIds.has(String(doc.phase_id))) {
      fail(`notification payload phase_id does not exist in packet phases: ${doc.phase_id}`, errors);
    }
  }

  if (!doc.artifact_refs || typeof doc.artifact_refs !== 'object' || Array.isArray(doc.artifact_refs)) {
    fail('notification payload artifact_refs must be a mapping', errors);
  } else {
    for (const key of ['baseline_ref', 'packet_ref', 'state_ref', 'prompt_ref', 'worker_output_ref', 'acceptance_ref', 'evidence_refs']) {
      if (!(key in doc.artifact_refs)) {
        fail(`notification payload artifact_refs missing field: ${key}`, errors);
      }
    }
    const baselineRef = doc.artifact_refs.baseline_ref ? normalizeRel(doc.artifact_refs.baseline_ref) : null;
    if (!baselineRef || typeof doc.artifact_refs.baseline_ref !== 'string') {
      fail('notification payload artifact_refs.baseline_ref must be a non-empty string', errors);
    } else {
      validateBaselineRef(topicDir, baselineRef, errors, 'notification artifact_refs.baseline_ref');
    }

    const artifactPacketRef = doc.artifact_refs.packet_ref ? normalizeRel(doc.artifact_refs.packet_ref) : null;
    if (!artifactPacketRef || typeof doc.artifact_refs.packet_ref !== 'string') {
      fail('notification payload artifact_refs.packet_ref must be a non-empty string', errors);
    } else if (packetRef && artifactPacketRef !== packetRef) {
      fail('notification payload artifact_refs.packet_ref must match packet_ref', errors);
    }

    const stateRef = doc.artifact_refs.state_ref ? normalizeRel(doc.artifact_refs.state_ref) : null;
    if (!stateRef || typeof doc.artifact_refs.state_ref !== 'string') {
      fail('notification payload artifact_refs.state_ref must be a non-empty string', errors);
    } else {
      const statePath = resolveTopicPath(topicDir, stateRef);
      const stateReport = validateOrchestrationState(statePath, { topicDir });
      for (const error of stateReport.errors) {
        fail(`notification payload artifact_refs.state_ref invalid: ${error}`, errors);
      }
      if (stateReport.doc?.topic_id && doc.topic_id && stateReport.doc.topic_id !== doc.topic_id) {
        fail('notification payload artifact_refs.state_ref topic_id must match topic_id', errors);
      }
      if (stateReport.doc?.packet_ref && packetRef && normalizeRel(stateReport.doc.packet_ref) !== packetRef) {
        fail('notification payload artifact_refs.state_ref packet_ref must match packet_ref', errors);
      }
    }

    const promptRef = doc.artifact_refs.prompt_ref;
    if (!(promptRef === null || promptRef === '' || typeof promptRef === 'string')) {
      fail('notification payload artifact_refs.prompt_ref must be a string or null', errors);
    } else if (typeof promptRef === 'string' && promptRef.length > 0) {
      validatePromptTarget(topicDir, normalizeRel(promptRef), errors, 'notification artifact_refs.prompt_ref');
    }

    const workerOutputRef = doc.artifact_refs.worker_output_ref;
    if (!(workerOutputRef === null || workerOutputRef === '' || typeof workerOutputRef === 'string')) {
      fail('notification payload artifact_refs.worker_output_ref must be a string or null', errors);
    } else if (typeof workerOutputRef === 'string' && workerOutputRef.length > 0) {
      validateWorkerOutputTarget(topicDir, normalizeRel(workerOutputRef), errors, 'notification artifact_refs.worker_output_ref');
    }

    const acceptanceRef = doc.artifact_refs.acceptance_ref;
    if (!(acceptanceRef === null || acceptanceRef === '' || typeof acceptanceRef === 'string')) {
      fail('notification payload artifact_refs.acceptance_ref must be a string or null', errors);
    } else if (typeof acceptanceRef === 'string' && acceptanceRef.length > 0) {
      validateAcceptanceTarget(topicDir, normalizeRel(acceptanceRef), errors, 'notification artifact_refs.acceptance_ref');
    }

    if (!Array.isArray(doc.artifact_refs.evidence_refs)) {
      fail('notification payload artifact_refs.evidence_refs must be an array', errors);
    } else {
      for (const relPath of doc.artifact_refs.evidence_refs) {
        if (typeof relPath !== 'string' || relPath.length === 0) {
          fail('notification payload artifact_refs.evidence_refs entries must be non-empty strings', errors);
          continue;
        }
        validateEvidenceTarget(topicDir, normalizeRel(relPath), errors, 'notification artifact_refs.evidence_refs');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, doc };
}

export function validateNotificationPayload(filePath, options = {}) {
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings: [] };
  }
  const topicDir = options.topicDir || inferTopicDir(filePath);
  const doc = loadYamlFile(filePath) || {};
  return validateNotificationPayloadData(filePath, doc, { ...options, topicDir });
}

export function validateDoc(filePath) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings };
  }
  const doc = loadMarkdownDoc(filePath);
  if (!doc.frontmatter || typeof doc.frontmatter !== 'object') {
    return { ok: false, errors: ['missing YAML frontmatter'], warnings };
  }
  const docType = doc.frontmatter.doc_type;
  if (!DOC_CONFIG[docType]) {
    fail(`unsupported doc_type: ${String(docType || '')}`, errors);
    return { ok: false, errors, warnings };
  }
  const config = DOC_CONFIG[docType];
  for (const key of config.requiredFrontmatter) {
    if (!doc.frontmatter[key]) {
      fail(`missing frontmatter field: ${key}`, errors);
    }
  }
  const status = String(doc.frontmatter.status || '');
  if (status && !config.allowedStatus.has(status)) {
    fail(`invalid status for ${docType}: ${status}`, errors);
  }
  const headings = new Set(listMarkdownHeadings(doc.body));
  for (const heading of config.requiredSections) {
    if (!headings.has(heading)) {
      fail(`missing section: ${heading}`, errors);
    }
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}

export function validatePrompt(filePath) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings };
  }
  const text = loadMarkdownDoc(filePath).body;
  const headings = new Set(listMarkdownHeadings(text));
  for (const block of PROMPT_BLOCKS) {
    if (!headings.has(block)) {
      fail(`missing prompt block: ${block}`, errors);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateWorkerOutput(filePath, options = {}) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return {
      ok: false,
      errors: [`missing file: ${filePath}`],
      warnings,
      refusal: makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_MISSING,
        'worker-output artifact is missing',
      ),
    };
  }
  const text = loadMarkdownDoc(filePath).body;
  const headings = new Set(listMarkdownHeadings(text));
  const missingBlocks = [];
  for (const block of WORKER_OUTPUT_BLOCKS) {
    if (!headings.has(block)) {
      missingBlocks.push(block);
      fail(`missing worker-output block: ${block}`, errors);
    }
  }
  const signalReport = readWorkerRunnerSignal(filePath, options);
  errors.push(...signalReport.errors);
  warnings.push(...signalReport.warnings);
  const refusal = signalReport.refusal
    || (missingBlocks.length > 0
      ? makeValidatorRefusal(
        VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_INVALID,
        'worker-output artifact is missing one or more required sections',
      )
      : (errors.length > 0
        ? makeValidatorRefusal(
          VALIDATOR_NATIVE_REFUSAL_CODES.WORKER_OUTPUT_INVALID,
          'worker-output artifact is invalid',
        )
        : null));
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refusal,
    signal: signalReport.signal,
  };
}

export function validateAcceptance(filePath) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings };
  }
  const doc = loadMarkdownDoc(filePath);
  const headings = new Set(listMarkdownHeadings(doc.body));
  for (const block of ACCEPTANCE_BLOCKS) {
    if (!headings.has(block)) {
      fail(`missing acceptance block: ${block}`, errors);
    }
  }
  if (doc.frontmatter?.disposition) {
    const disposition = String(doc.frontmatter.disposition);
    if (!ACCEPTANCE_DISPOSITIONS.has(disposition)) {
      fail(`invalid acceptance disposition: ${disposition}`, errors);
    }
  } else {
    warnings.push('acceptance missing disposition in frontmatter');
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validateEvidenceTarget(topicDir, relPath, errors, label) {
  const abs = resolveTopicPath(topicDir, relPath);
  if (!exists(abs)) {
    fail(`${label} target does not exist: ${relPath}`, errors);
    return null;
  }
  const report = validateDoc(abs);
  for (const error of report.errors) {
    fail(`${label} target invalid: ${error}`, errors);
  }
  if (report.doc?.frontmatter?.doc_type !== 'evidence') {
    fail(`${label} target is not doc_type=evidence: ${relPath}`, errors);
  }
  return report;
}

export function validateFindingLedger(filePath, options = {}) {
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings: [] };
  }
  const topicDir = options.topicDir || path.dirname(filePath);
  const doc = loadYamlFile(filePath) || {};
  return validateFindingLedgerData(filePath, doc, { ...options, topicDir });
}

export function validateFindingLedgerData(filePath, doc = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const topicDir = options.topicDir || path.dirname(filePath);
  for (const key of ['topic_id', 'updated_at', 'owner', 'findings']) {
    if (!doc[key]) {
      fail(`missing ledger field: ${key}`, errors);
    }
  }
  if (!Array.isArray(doc.findings)) {
    fail('findings must be an array', errors);
    return { ok: false, errors, warnings, doc };
  }
  const seenIds = new Set();
  for (const finding of doc.findings) {
    if (finding?.finding_id) {
      if (seenIds.has(finding.finding_id)) {
        fail(`duplicate finding_id: ${finding.finding_id}`, errors);
      }
      seenIds.add(finding.finding_id);
    }
    for (const key of ['finding_id', 'title', 'source', 'status', 'phase', 'reason', 'opened_at', 'updated_at', 'owner']) {
      if (!finding?.[key]) {
        fail(`finding missing field "${key}"`, errors);
      }
    }
    const status = String(finding?.status || '');
    if (status && !FINDING_STATUS.has(status)) {
      fail(`finding ${finding.finding_id}: invalid status ${status}`, errors);
    }
    if (status === 'fixed' || status === 'invalid') {
      if (!finding?.evidence_ref) {
        fail(`finding ${finding.finding_id}: status ${status} requires evidence_ref`, errors);
      }
    }
    if (status === 'superseded' && !finding?.superseded_by) {
      fail(`finding ${finding.finding_id}: status superseded requires superseded_by`, errors);
    }
    if (finding?.evidence_ref) {
      validateEvidenceTarget(topicDir, normalizeRel(finding.evidence_ref), errors, `finding ${finding.finding_id} evidence_ref`);
    }
    if (finding?.baseline_ref) {
      const baselinePath = resolveTopicPath(topicDir, normalizeRel(finding.baseline_ref));
      if (!exists(baselinePath)) {
        fail(`finding ${finding.finding_id}: baseline_ref does not exist: ${finding.baseline_ref}`, errors);
      } else {
        const baselineReport = validateDoc(baselinePath);
        if (baselineReport.doc?.frontmatter?.doc_type !== 'baseline') {
          fail(`finding ${finding.finding_id}: baseline_ref is not doc_type=baseline`, errors);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}

export function validateTopic(topicDir) {
  const topicPath = path.join(topicDir, 'topic.index.yaml');
  if (!exists(topicPath)) {
    return { ok: false, errors: [`missing topic.index.yaml in ${topicDir}`], warnings: [] };
  }
  const doc = loadYamlFile(topicPath) || {};
  return validateTopicData(topicDir, doc);
}

export function validateTopicData(topicDir, doc = {}) {
  const errors = [];
  const warnings = [];
  for (const key of [
    'topic_id',
    'title',
    'status',
    'reason',
    'owner',
    'updated_at',
    'active_baseline',
    'active_explores',
    'latest_evidence',
    'final_evidence',
    'spec_rule_refs',
    'protocol_refs',
  ]) {
    if (!(key in doc)) {
      fail(`missing topic index field: ${key}`, errors);
    }
  }
  const status = String(doc.status || '');
  if (status && !TOPIC_STATUS.has(status)) {
    fail(`invalid topic status: ${status}`, errors);
  }
  if (status === 'active' && !doc.active_baseline) {
    fail('active topic requires active_baseline', errors);
  }
  if (!Array.isArray(doc.active_explores)) {
    fail('active_explores must be an array', errors);
  }
  if (!Array.isArray(doc.spec_rule_refs)) {
    fail('spec_rule_refs must be an array', errors);
  }
  if (!Array.isArray(doc.protocol_refs)) {
    fail('protocol_refs must be an array', errors);
  }
  if (status === 'closed' && !doc.final_evidence) {
    fail('closed topic requires final_evidence', errors);
  }
  if (doc.active_baseline) {
    const baselinePath = resolveTopicPath(topicDir, normalizeRel(doc.active_baseline));
    if (!exists(baselinePath)) {
      fail(`active_baseline target does not exist: ${doc.active_baseline}`, errors);
    } else {
      const report = validateDoc(baselinePath);
      for (const error of report.errors) {
        fail(`active_baseline invalid: ${error}`, errors);
      }
      if (report.doc?.frontmatter?.doc_type !== 'baseline') {
        fail('active_baseline target must be doc_type=baseline', errors);
      }
      if (status === 'active') {
        const baselineStatus = report.doc?.frontmatter?.status;
        if (baselineStatus !== 'active' && baselineStatus !== 'frozen') {
          fail('active topic requires active_baseline status=active|frozen', errors);
        }
      }
      const baselineStatus = report.doc?.frontmatter?.status;
      if ((status === 'closed' || status === 'archived') && baselineStatus === 'active') {
        fail(`${status} topic must not have active_baseline with status=active`, errors);
      }
    }
  }
  for (const relPath of doc.active_explores || []) {
    const explorePath = resolveTopicPath(topicDir, normalizeRel(relPath));
    if (!exists(explorePath)) {
      fail(`active_explore target does not exist: ${relPath}`, errors);
      continue;
    }
    const report = validateDoc(explorePath);
    for (const error of report.errors) {
      fail(`active_explore invalid: ${error}`, errors);
    }
    if (report.doc?.frontmatter?.doc_type !== 'explore') {
      fail(`active_explore target must be doc_type=explore: ${relPath}`, errors);
    }
    if (report.doc?.frontmatter?.status !== 'active') {
      fail(`active_explore target must have status=active: ${relPath}`, errors);
    }
  }
  if (doc.latest_evidence) {
    validateEvidenceTarget(topicDir, normalizeRel(doc.latest_evidence), errors, 'latest_evidence');
  }
  if (doc.final_evidence) {
    const report = validateEvidenceTarget(topicDir, normalizeRel(doc.final_evidence), errors, 'final_evidence');
    if (report?.doc?.frontmatter?.status !== 'final') {
      fail('final_evidence target must have status=final', errors);
    }
  }
  if (doc.finding_ledger_ref) {
    const ledgerPath = resolveTopicPath(topicDir, normalizeRel(doc.finding_ledger_ref));
    const report = validateFindingLedger(ledgerPath, { topicDir });
    for (const error of report.errors) {
      fail(`finding_ledger_ref invalid: ${error}`, errors);
    }
  } else {
    warnings.push('topic has no finding_ledger_ref');
  }
  if ('execution_packet_ref' in doc && doc.execution_packet_ref) {
    const packetPath = resolveTopicPath(topicDir, normalizeRel(doc.execution_packet_ref));
    const report = validateExecutionPacket(packetPath, { topicDir });
    for (const error of report.errors) {
      fail(`execution_packet_ref invalid: ${error}`, errors);
    }
    if (report.doc?.baseline_ref && doc.active_baseline) {
      if (normalizeRel(report.doc.baseline_ref) !== normalizeRel(doc.active_baseline)) {
        fail('execution_packet_ref baseline_ref must match active_baseline', errors);
      }
    }
    if (report.doc?.topic_id && doc.topic_id && report.doc.topic_id !== doc.topic_id) {
      fail('execution_packet_ref topic_id must match topic.index.yaml topic_id', errors);
    }
    if (status === 'active' && report.doc?.status !== 'frozen') {
      fail('active topic execution_packet_ref must target packet status=frozen', errors);
    }
  }
  if ('orchestration_state_ref' in doc && doc.orchestration_state_ref) {
    const statePath = resolveTopicPath(topicDir, normalizeRel(doc.orchestration_state_ref));
    const report = validateOrchestrationState(statePath, { topicDir });
    for (const error of report.errors) {
      fail(`orchestration_state_ref invalid: ${error}`, errors);
    }
    if (!doc.execution_packet_ref) {
      fail('orchestration_state_ref requires execution_packet_ref', errors);
    }
    if (report.doc?.topic_id && doc.topic_id && report.doc.topic_id !== doc.topic_id) {
      fail('orchestration_state_ref topic_id must match topic.index.yaml topic_id', errors);
    }
    if (report.doc?.packet_ref && doc.execution_packet_ref) {
      if (normalizeRel(report.doc.packet_ref) !== normalizeRel(doc.execution_packet_ref)) {
        fail('orchestration_state_ref packet_ref must match execution_packet_ref', errors);
      }
    }
  }
  if (status === 'active' && (!doc.protocol_refs || doc.protocol_refs.length === 0)) {
    warnings.push('active topic has empty protocol_refs');
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}
