import path from 'node:path';
import { exists, loadYamlFile, loadMarkdownDoc, timestampNow } from './doc-utils.mjs';

export function topicSummary(topicDir) {
  const topicPath = path.join(topicDir, 'topic.index.yaml');
  if (!exists(topicPath)) {
    throw new Error(`missing topic.index.yaml in ${topicDir}`);
  }
  const topic = loadYamlFile(topicPath);
  const lines = [];
  lines.push(`topic_id: ${topic.topic_id}`);
  lines.push(`title: ${topic.title}`);
  lines.push(`status: ${topic.status}`);
  lines.push(`reason: ${topic.reason}`);
  lines.push(`owner: ${topic.owner}`);
  lines.push(`updated_at: ${topic.updated_at}`);
  lines.push('');
  lines.push(`active_baseline: ${topic.active_baseline || '(none)'}`);
  lines.push(`active_explores: ${(topic.active_explores || []).join(', ') || '(none)'}`);
  lines.push(`latest_evidence: ${topic.latest_evidence || '(none)'}`);
  lines.push(`final_evidence: ${topic.final_evidence || '(none)'}`);
  lines.push(`finding_ledger_ref: ${topic.finding_ledger_ref || '(none)'}`);
  lines.push('');
  lines.push(`spec_rule_refs: ${(topic.spec_rule_refs || []).join(', ') || '(none)'}`);
  lines.push(`protocol_refs: ${(topic.protocol_refs || []).join(', ') || '(none)'}`);

  if (topic.finding_ledger_ref) {
    const ledgerPath = path.join(topicDir, topic.finding_ledger_ref);
    if (exists(ledgerPath)) {
      const ledger = loadYamlFile(ledgerPath);
      const findings = ledger.findings || [];
      const counts = {};
      for (const f of findings) {
        counts[f.status] = (counts[f.status] || 0) + 1;
      }
      lines.push('');
      lines.push(`findings: ${findings.length} total`);
      for (const [status, count] of Object.entries(counts).sort()) {
        lines.push(`  ${status}: ${count}`);
      }
    }
  }
  return lines.join('\n');
}

export function unresolvedFindings(topicDir) {
  const topicPath = path.join(topicDir, 'topic.index.yaml');
  if (!exists(topicPath)) {
    throw new Error(`missing topic.index.yaml in ${topicDir}`);
  }
  const topic = loadYamlFile(topicPath);
  if (!topic.finding_ledger_ref) {
    throw new Error('topic has no finding_ledger_ref');
  }
  const ledgerPath = path.join(topicDir, topic.finding_ledger_ref);
  if (!exists(ledgerPath)) {
    throw new Error(`finding ledger not found: ${topic.finding_ledger_ref}`);
  }
  const ledger = loadYamlFile(ledgerPath);
  const unresolved = (ledger.findings || []).filter(
    (f) => f.status === 'active' || f.status === 'deferred',
  );
  if (unresolved.length === 0) {
    return 'No unresolved findings.';
  }
  const lines = [];
  for (const f of unresolved) {
    lines.push(`${f.finding_id}  [${f.status}]  phase=${f.phase}`);
    lines.push(`  title: ${f.title}`);
    lines.push(`  reason: ${f.reason}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function promptSkeleton(topicDir, options = {}) {
  const phase = options.phase;
  const goal = options.goal;
  if (!phase) {
    throw new Error('--phase is required');
  }
  if (!goal) {
    throw new Error('--goal is required');
  }

  const topicPath = path.join(topicDir, 'topic.index.yaml');
  if (!exists(topicPath)) {
    throw new Error(`missing topic.index.yaml in ${topicDir}`);
  }
  const topic = loadYamlFile(topicPath);

  const authorityReads = [];
  if (topic.active_baseline) {
    authorityReads.push(`- \`${topic.active_baseline}\``);
  }
  for (const explore of topic.active_explores || []) {
    authorityReads.push(`- \`${explore}\``);
  }
  if (topic.latest_evidence) {
    authorityReads.push(`- \`${topic.latest_evidence}\``);
  }
  if (topic.finding_ledger_ref) {
    authorityReads.push(`- \`${topic.finding_ledger_ref}\``);
  }
  const authoritySection = authorityReads.length > 0
    ? authorityReads.join('\n')
    : '- (fill in authority reads)';

  const confirmedLines = [];
  confirmedLines.push(`- Topic status: ${topic.status}`);
  if (topic.active_baseline) {
    confirmedLines.push(`- Active baseline: ${topic.active_baseline}`);
  }
  if (topic.latest_evidence) {
    confirmedLines.push(`- Latest evidence: ${topic.latest_evidence}`);
  }

  return [
    `# ${phase} Prompt`,
    '',
    '## Task Goal',
    '',
    goal,
    '',
    '## Authority Reads',
    '',
    authoritySection,
    '',
    '## Confirmed State',
    '',
    confirmedLines.join('\n'),
    '',
    '## Hard Constraints',
    '',
    '- (fill in hard constraints)',
    '',
    '## Must Complete',
    '',
    '1. (fill in must-complete items)',
    '',
    '## Explicit Non-Goals',
    '',
    '- (fill in non-goals)',
    '',
    '## Required Checks',
    '',
    '- (fill in required checks)',
    '',
    '## Required Final Output Format',
    '',
    '1. Findings',
    '2. Implementation summary',
    '3. Files changed',
    '4. Checks run',
    '5. Remaining gaps / risks',
    '',
    '## Blocker Escalation Rule',
    '',
    'If a blocker is found, escalate to manager before proceeding.',
    '',
  ].join('\n');
}

const VALID_DISPOSITIONS = new Set(['complete', 'partial', 'deferred']);

export function acceptanceSkeleton(options = {}) {
  const disposition = options.disposition;
  if (!disposition) {
    throw new Error('--disposition is required');
  }
  if (!VALID_DISPOSITIONS.has(disposition)) {
    throw new Error(`invalid disposition: ${disposition} (must be complete, partial, or deferred)`);
  }

  return [
    '---',
    `disposition: ${disposition}`,
    '---',
    '',
    '# Phase Acceptance',
    '',
    '## Findings',
    '',
    '- (fill in findings from worker output review)',
    '',
    '## Current Phase Disposition',
    '',
    `**${disposition}** — (fill in disposition rationale)`,
    '',
    '## Next Step or Reopen Condition',
    '',
    '- (fill in next step or condition for reopening)',
    '',
  ].join('\n');
}
