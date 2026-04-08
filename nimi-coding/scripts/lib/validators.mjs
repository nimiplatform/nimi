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
  if (status === 'active' && (!doc.protocol_refs || doc.protocol_refs.length === 0)) {
    warnings.push('active topic has empty protocol_refs');
  }
  return { ok: errors.length === 0, errors, warnings, doc };
}
