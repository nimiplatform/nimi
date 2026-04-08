import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, loadYamlFile, timestampNow, writeYamlFile } from './doc-utils.mjs';
import { validateFindingLedgerData, validateOrchestrationStateData, validateTopicData } from './validators.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateAndWriteTopic(topicDir, nextTopic) {
  const report = validateTopicData(topicDir, nextTopic);
  if (!report.ok) {
    return report;
  }
  writeYamlFile(path.join(topicDir, 'topic.index.yaml'), nextTopic);
  return report;
}

function validateAndWriteLedger(topicDir, nextLedger) {
  const ledgerPath = path.join(topicDir, 'finding-ledger.yaml');
  const report = validateFindingLedgerData(ledgerPath, nextLedger, { topicDir });
  if (!report.ok) {
    return report;
  }
  writeYamlFile(ledgerPath, nextLedger);
  return report;
}

function validateAndWriteState(topicDir, stateRelPath, nextState) {
  const statePath = path.join(topicDir, stateRelPath);
  const report = validateOrchestrationStateData(statePath, nextState, { topicDir });
  if (!report.ok) {
    return report;
  }
  writeYamlFile(statePath, nextState);
  return report;
}

export function initTopic(dirPath, options = {}) {
  const topicId = options.topicId || path.basename(dirPath);
  const title = options.title || topicId;
  const owner = options.owner || 'coding';
  const now = timestampNow();

  ensureDir(dirPath);

  const topicIndex = {
    topic_id: topicId,
    title,
    status: 'exploring',
    reason: 'Topic initialized for local exploration.',
    owner,
    updated_at: now,
    active_baseline: null,
    active_explores: ['overview.explore.md'],
    latest_evidence: null,
    final_evidence: null,
    finding_ledger_ref: 'finding-ledger.yaml',
    spec_rule_refs: [],
    protocol_refs: [],
  };
  writeYamlFile(path.join(dirPath, 'topic.index.yaml'), topicIndex);

  const explore = `---\n`
    + `title: ${title}\n`
    + `doc_type: explore\n`
    + `status: active\n`
    + `reason: Initial topic exploration.\n`
    + `owner: ${owner}\n`
    + `updated_at: ${now}\n`
    + `---\n\n`
    + `# ${title}\n\n`
    + `## Question / Scope\n\n`
    + `Define the scope of this topic.\n\n`
    + `## Current Understanding\n\n`
    + `Initial understanding is pending.\n\n`
    + `## Options\n\n`
    + `1. Continue exploration.\n\n`
    + `## Recommendation or Current Lean\n\n`
    + `Continue exploration until a baseline is ready.\n\n`
    + `## Open Questions\n\n`
    + `- What should become the first active baseline?\n`;
  fs.writeFileSync(path.join(dirPath, 'overview.explore.md'), explore, 'utf8');

  const ledger = {
    topic_id: topicId,
    updated_at: now,
    owner,
    findings: [],
  };
  writeYamlFile(path.join(dirPath, 'finding-ledger.yaml'), ledger);
}

export function attachEvidence(topicDir, evidenceRelPath, options = {}) {
  const topic = clone(loadYamlFile(path.join(topicDir, 'topic.index.yaml')));
  topic.latest_evidence = evidenceRelPath;
  if (options.final) {
    topic.final_evidence = evidenceRelPath;
  }
  topic.updated_at = timestampNow();
  return validateAndWriteTopic(topicDir, topic);
}

export function closeTopic(topicDir, options = {}) {
  const topic = clone(loadYamlFile(path.join(topicDir, 'topic.index.yaml')));
  topic.status = 'closed';
  topic.latest_evidence = options.finalEvidenceRef;
  topic.final_evidence = options.finalEvidenceRef;
  if (options.reason) {
    topic.reason = options.reason;
  }
  topic.updated_at = timestampNow();
  return validateAndWriteTopic(topicDir, topic);
}

export function setTopicStatus(topicDir, status, options = {}) {
  const topic = clone(loadYamlFile(path.join(topicDir, 'topic.index.yaml')));
  topic.status = status;
  if (options.reason) {
    topic.reason = options.reason;
  }
  topic.updated_at = timestampNow();
  return validateAndWriteTopic(topicDir, topic);
}

export function setBaseline(topicDir, baselineRelPath) {
  const topic = clone(loadYamlFile(path.join(topicDir, 'topic.index.yaml')));
  topic.active_baseline = baselineRelPath || null;
  topic.updated_at = timestampNow();
  return validateAndWriteTopic(topicDir, topic);
}

export function setFindingStatus(topicDir, findingId, nextStatus, options = {}) {
  const ledger = clone(loadYamlFile(path.join(topicDir, 'finding-ledger.yaml')));
  const finding = (ledger.findings || []).find((row) => row.finding_id === findingId);
  if (!finding) {
    throw new Error(`finding not found: ${findingId}`);
  }
  const now = timestampNow();
  finding.status = nextStatus;
  finding.reason = options.reason || finding.reason;
  if (Object.prototype.hasOwnProperty.call(options, 'evidenceRef')) {
    finding.evidence_ref = options.evidenceRef;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'supersededBy')) {
    finding.superseded_by = options.supersededBy;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'baselineRef')) {
    finding.baseline_ref = options.baselineRef;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'protocolRef')) {
    finding.protocol_ref = options.protocolRef;
  }
  finding.updated_at = now;
  ledger.updated_at = now;
  return validateAndWriteLedger(topicDir, ledger);
}

export function setOrchestrationState(topicDir, stateRelPath, nextState) {
  const topic = clone(loadYamlFile(path.join(topicDir, 'topic.index.yaml')));
  const stateReport = validateAndWriteState(topicDir, stateRelPath, nextState);
  if (!stateReport.ok) {
    return stateReport;
  }
  topic.orchestration_state_ref = stateRelPath;
  topic.updated_at = timestampNow();
  const topicReport = validateAndWriteTopic(topicDir, topic);
  if (!topicReport.ok) {
    return topicReport;
  }
  return {
    ok: true,
    errors: [],
    warnings: [...stateReport.warnings, ...topicReport.warnings],
  };
}
