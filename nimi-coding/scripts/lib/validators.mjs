import path from 'node:path';
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
  'prepared',
  'in_progress',
  'paused',
  'awaiting_human',
  'awaiting_final_confirmation',
  'completed',
  'superseded',
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
];

const ACCEPTANCE_BLOCKS = [
  'Findings',
  'Current Phase Disposition',
  'Next Step or Reopen Condition',
];

const ACCEPTANCE_DISPOSITIONS = new Set(['complete', 'partial', 'deferred']);

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

function validateOrchestrationStateData(filePath, doc = {}, options = {}) {
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
  if (runStatus === 'paused') {
    if (!(typeof pauseReason === 'string' && pauseReason.length > 0)) {
      fail('paused orchestration state requires pause_reason', errors);
    }
    if (!(typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0)) {
      fail('paused orchestration state requires awaiting_human_action', errors);
    }
  }
  if (runStatus === 'prepared' || runStatus === 'awaiting_human' || runStatus === 'awaiting_final_confirmation') {
    if (!(typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0)) {
      fail(`orchestration state run_status=${runStatus} requires awaiting_human_action`, errors);
    }
  }
  if ((runStatus === 'in_progress' || runStatus === 'completed' || runStatus === 'superseded')
    && typeof awaitingHumanAction === 'string' && awaitingHumanAction.length > 0) {
    fail(`orchestration state run_status=${runStatus} must not carry awaiting_human_action`, errors);
  }
  if ((runStatus === 'in_progress' || runStatus === 'completed' || runStatus === 'superseded')
    && typeof pauseReason === 'string' && pauseReason.length > 0) {
    fail(`orchestration state run_status=${runStatus} must not carry pause_reason`, errors);
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
      for (const key of ['event_type', 'correlation_id']) {
        if (!row[key] || typeof row[key] !== 'string') {
          fail(`orchestration state notification_refs entry missing string field: ${key}`, errors);
        }
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

export function validateWorkerOutput(filePath) {
  const errors = [];
  const warnings = [];
  if (!exists(filePath)) {
    return { ok: false, errors: [`missing file: ${filePath}`], warnings };
  }
  const text = loadMarkdownDoc(filePath).body;
  const headings = new Set(listMarkdownHeadings(text));
  for (const block of WORKER_OUTPUT_BLOCKS) {
    if (!headings.has(block)) {
      fail(`missing worker-output block: ${block}`, errors);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
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
