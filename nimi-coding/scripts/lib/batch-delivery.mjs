import path from 'node:path';
import {
  exists,
  loadYamlFile,
  loadMarkdownDoc,
} from './doc-utils.mjs';
import {
  validateTopic,
  validateFindingLedger,
  validateAcceptance,
} from './validators.mjs';
import { attachEvidence } from './topic-ops.mjs';

export function batchPreflight(topicDir) {
  const errors = [];
  const warnings = [];
  const topicPath = path.join(topicDir, 'topic.index.yaml');

  if (!exists(topicPath)) {
    return { ok: false, errors: [`missing topic.index.yaml in ${topicDir}`], warnings };
  }

  const topic = loadYamlFile(topicPath);

  // 1. Topic status must be active
  if (topic.status !== 'active') {
    errors.push(`batch requires topic status=active, got ${topic.status}`);
  }

  // 2. Must have active_baseline
  if (!topic.active_baseline) {
    errors.push('batch requires active_baseline');
  }

  // 3. Baseline must be frozen
  if (topic.active_baseline) {
    const baselinePath = path.join(topicDir, topic.active_baseline);
    if (!exists(baselinePath)) {
      errors.push(`active_baseline target does not exist: ${topic.active_baseline}`);
    } else {
      const doc = loadMarkdownDoc(baselinePath);
      const baselineStatus = doc.frontmatter?.status;
      if (baselineStatus !== 'frozen') {
        errors.push(`batch requires baseline status=frozen, got ${baselineStatus}`);
      }
    }
  }

  // 4. Must have finding_ledger_ref
  if (!topic.finding_ledger_ref) {
    errors.push('batch requires finding_ledger_ref');
  } else {
    const ledgerPath = path.join(topicDir, topic.finding_ledger_ref);
    const ledgerReport = validateFindingLedger(ledgerPath, { topicDir });
    if (!ledgerReport.ok) {
      for (const e of ledgerReport.errors) {
        errors.push(`finding ledger invalid: ${e}`);
      }
    }
  }

  // 5. Must have protocol_refs
  if (!Array.isArray(topic.protocol_refs) || topic.protocol_refs.length === 0) {
    errors.push('batch requires non-empty protocol_refs');
  }

  // 6. Full topic validation must pass
  const topicReport = validateTopic(topicDir);
  if (!topicReport.ok) {
    for (const e of topicReport.errors) {
      errors.push(`topic validation: ${e}`);
    }
  }
  warnings.push(...topicReport.warnings);

  return { ok: errors.length === 0, errors, warnings };
}

export function batchPhaseDone(topicDir, options = {}) {
  const { phase, disposition, acceptance: acceptanceRelPath, evidence: evidenceRelPath } = options;
  const errors = [];

  if (!phase) {
    errors.push('--phase is required');
  }
  if (!disposition) {
    errors.push('--disposition is required');
  }
  if (!acceptanceRelPath) {
    errors.push('--acceptance is required');
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings: [] };
  }

  const validDispositions = new Set(['complete', 'partial', 'deferred']);
  if (!validDispositions.has(disposition)) {
    return { ok: false, errors: [`invalid disposition: ${disposition}`], warnings: [] };
  }

  // 1. Batch preconditions must still hold
  const preflight = batchPreflight(topicDir);
  if (!preflight.ok) {
    return {
      ok: false,
      errors: ['batch preconditions no longer met', ...preflight.errors],
      warnings: preflight.warnings,
    };
  }

  // 2. Validate acceptance artifact
  const acceptancePath = path.join(topicDir, acceptanceRelPath);
  const accReport = validateAcceptance(acceptancePath);
  if (!accReport.ok) {
    return {
      ok: false,
      errors: accReport.errors.map((e) => `acceptance invalid: ${e}`),
      warnings: accReport.warnings,
    };
  }

  // 3. Attach evidence if provided
  if (evidenceRelPath) {
    const evidenceReport = attachEvidence(topicDir, evidenceRelPath);
    if (!evidenceReport.ok) {
      return {
        ok: false,
        errors: evidenceReport.errors.map((e) => `evidence invalid: ${e}`),
        warnings: [...preflight.warnings, ...evidenceReport.warnings],
      };
    }
  }

  // 4. Post-validation: topic must still be valid
  const postReport = validateTopic(topicDir);
  if (postReport.errors.length > 0) {
    return {
      ok: false,
      errors: postReport.errors.map((e) => `post-validation: ${e}`),
      warnings: postReport.warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [...preflight.warnings, ...postReport.warnings],
    phase,
    disposition,
  };
}
