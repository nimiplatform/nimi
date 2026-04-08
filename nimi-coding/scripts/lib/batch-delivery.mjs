import path from 'node:path';
import {
  exists,
  loadYamlFile,
  loadMarkdownDoc,
} from './doc-utils.mjs';
import {
  validateTopic,
  validateExecutionPacket,
  validateFindingLedger,
  validateAcceptance,
} from './validators.mjs';
import { attachEvidence } from './topic-ops.mjs';

function normalizeNextPhaseId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function phaseView(packet, phase, routeIndex) {
  return {
    packet_id: packet.packet_id,
    phase_id: phase.phase_id,
    route_index: routeIndex,
    goal: phase.goal,
    authority_refs: phase.authority_refs,
    write_scope: phase.write_scope,
    read_scope: phase.read_scope,
    required_checks: phase.required_checks,
    completion_criteria: phase.completion_criteria,
    escalation_conditions: phase.escalation_conditions,
    next_on_success: normalizeNextPhaseId(phase.next_on_success),
    stop_on_failure: phase.stop_on_failure,
  };
}

function inspectPacketRoute(packet) {
  const errors = [];
  const phases = Array.isArray(packet.phases) ? packet.phases : [];
  const phaseById = new Map();
  const predecessorCount = new Map();

  for (const phase of phases) {
    phaseById.set(phase.phase_id, phase);
    predecessorCount.set(phase.phase_id, 0);
  }

  for (const phase of phases) {
    const nextPhaseId = normalizeNextPhaseId(phase.next_on_success);
    if (nextPhaseId === null) {
      continue;
    }
    if (!phaseById.has(nextPhaseId)) {
      errors.push(`packet route invalid: phase ${phase.phase_id} points to missing next_on_success target ${nextPhaseId}`);
      continue;
    }
    predecessorCount.set(nextPhaseId, (predecessorCount.get(nextPhaseId) || 0) + 1);
  }

  const entryPhaseId = String(packet.entry_phase_id || '');
  if (!entryPhaseId || !phaseById.has(entryPhaseId)) {
    errors.push(`packet route invalid: entry_phase_id does not resolve to a phase: ${packet.entry_phase_id}`);
    return { ok: false, errors, phaseById, orderedPhaseIds: [] };
  }

  if ((predecessorCount.get(entryPhaseId) || 0) !== 0) {
    errors.push('packet route invalid: entry phase must not have a predecessor');
  }

  for (const [phaseId, count] of predecessorCount.entries()) {
    if (phaseId === entryPhaseId) {
      continue;
    }
    if (count !== 1) {
      errors.push(`packet route invalid: phase ${phaseId} must have exactly one predecessor, got ${count}`);
    }
  }

  const orderedPhaseIds = [];
  const seen = new Set();
  let currentPhaseId = entryPhaseId;
  while (currentPhaseId !== null) {
    if (seen.has(currentPhaseId)) {
      errors.push(`packet route invalid: cycle detected at phase ${currentPhaseId}`);
      break;
    }
    seen.add(currentPhaseId);
    orderedPhaseIds.push(currentPhaseId);
    const currentPhase = phaseById.get(currentPhaseId);
    currentPhaseId = currentPhase ? normalizeNextPhaseId(currentPhase.next_on_success) : null;
  }

  if (seen.size !== phaseById.size) {
    const unreachable = Array.from(phaseById.keys()).filter((phaseId) => !seen.has(phaseId));
    if (unreachable.length > 0) {
      errors.push(`packet route invalid: unreachable phase(s): ${unreachable.join(', ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    phaseById,
    orderedPhaseIds,
  };
}

function loadBatchContext(topicDir, options = {}) {
  const errors = [];
  const warnings = [];
  const topicPath = path.join(topicDir, 'topic.index.yaml');

  if (!exists(topicPath)) {
    return { ok: false, errors: [`missing topic.index.yaml in ${topicDir}`], warnings };
  }

  const topic = loadYamlFile(topicPath) || {};

  if (options.requireActiveTopic !== false && topic.status !== 'active') {
    errors.push(`batch requires topic status=active, got ${topic.status}`);
  }

  if (!topic.active_baseline) {
    errors.push('batch requires active_baseline');
  }

  let baselineStatus = null;
  if (topic.active_baseline) {
    const baselinePath = path.join(topicDir, topic.active_baseline);
    if (!exists(baselinePath)) {
      errors.push(`active_baseline target does not exist: ${topic.active_baseline}`);
    } else {
      const doc = loadMarkdownDoc(baselinePath);
      baselineStatus = doc.frontmatter?.status;
      if (baselineStatus !== 'frozen') {
        errors.push(`batch requires baseline status=frozen, got ${baselineStatus}`);
      }
    }
  }

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

  if (!Array.isArray(topic.protocol_refs) || topic.protocol_refs.length === 0) {
    errors.push('batch requires non-empty protocol_refs');
  } else if (!topic.protocol_refs.includes('execution-packet.v1')) {
    errors.push('batch requires protocol_refs to include execution-packet.v1');
  }

  if (!topic.execution_packet_ref) {
    errors.push('batch requires execution_packet_ref');
  }

  let packet = null;
  let route = null;
  if (topic.execution_packet_ref) {
    const packetPath = path.join(topicDir, topic.execution_packet_ref);
    const packetReport = validateExecutionPacket(packetPath, { topicDir });
    if (!packetReport.ok) {
      for (const error of packetReport.errors) {
        errors.push(`execution packet invalid: ${error}`);
      }
    } else {
      packet = packetReport.doc;
      if (packet.status !== 'frozen') {
        errors.push(`batch requires execution packet status=frozen, got ${packet.status}`);
      }
      if (topic.active_baseline && packet.baseline_ref !== topic.active_baseline) {
        errors.push(`execution packet baseline_ref must match active_baseline, got ${packet.baseline_ref}`);
      }
      if (packet.topic_id !== topic.topic_id) {
        errors.push(`execution packet topic_id must match topic topic_id, got ${packet.topic_id}`);
      }
      route = inspectPacketRoute(packet);
      if (!route.ok) {
        for (const error of route.errors) {
          errors.push(error);
        }
      }
    }
  }

  const topicReport = validateTopic(topicDir);
  if (!topicReport.ok) {
    for (const e of topicReport.errors) {
      errors.push(`topic validation: ${e}`);
    }
  }
  warnings.push(...topicReport.warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    topic,
    packet,
    baselineStatus,
    route,
  };
}

export function batchPreflight(topicDir) {
  const context = loadBatchContext(topicDir);
  if (!context.ok) {
    return context;
  }

  const entryPhase = context.route.phaseById.get(context.packet.entry_phase_id);
  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    entry_phase_id: context.packet.entry_phase_id,
    phase_count: context.route.orderedPhaseIds.length,
    entry_phase: phaseView(context.packet, entryPhase, 0),
  };
}

export function batchNextPhase(topicDir, options = {}) {
  const context = loadBatchContext(topicDir);
  if (!context.ok) {
    return context;
  }

  const afterPhaseId = options.afterPhase ? String(options.afterPhase) : null;
  let selectionMode = 'entry';
  let selectedPhaseId = context.packet.entry_phase_id;

  if (afterPhaseId) {
    const currentPhase = context.route.phaseById.get(afterPhaseId);
    if (!currentPhase) {
      return {
        ok: false,
        errors: [`unknown phase in packet route: ${afterPhaseId}`],
        warnings: context.warnings,
      };
    }
    selectionMode = 'next-on-success';
    selectedPhaseId = normalizeNextPhaseId(currentPhase.next_on_success);
    if (selectedPhaseId === null) {
      return {
        ok: true,
        errors: [],
        warnings: context.warnings,
        topic_id: context.topic.topic_id,
        packet_id: context.packet.packet_id,
        selection_mode: selectionMode,
        requested_after_phase: afterPhaseId,
        terminal: true,
        next_phase: null,
      };
    }
  }

  const selectedPhase = context.route.phaseById.get(selectedPhaseId);
  const routeIndex = context.route.orderedPhaseIds.indexOf(selectedPhaseId);
  return {
    ok: true,
    errors: [],
    warnings: context.warnings,
    topic_id: context.topic.topic_id,
    packet_id: context.packet.packet_id,
    selection_mode: selectionMode,
    requested_after_phase: afterPhaseId,
    terminal: false,
    next_phase: phaseView(context.packet, selectedPhase, routeIndex),
  };
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

  const context = loadBatchContext(topicDir);
  if (!context.ok) {
    return {
      ok: false,
      errors: ['batch preconditions no longer met', ...context.errors],
      warnings: context.warnings,
    };
  }

  const currentPhase = context.route.phaseById.get(phase);
  if (!currentPhase) {
    return {
      ok: false,
      errors: [`phase is not present in execution packet route: ${phase}`],
      warnings: context.warnings,
    };
  }

  const acceptancePath = path.join(topicDir, acceptanceRelPath);
  const accReport = validateAcceptance(acceptancePath);
  if (!accReport.ok) {
    return {
      ok: false,
      errors: accReport.errors.map((e) => `acceptance invalid: ${e}`),
      warnings: accReport.warnings,
    };
  }
  const acceptanceDoc = loadMarkdownDoc(acceptancePath);
  const acceptanceDisposition = acceptanceDoc.frontmatter?.disposition;
  if (acceptanceDisposition && acceptanceDisposition !== disposition) {
    return {
      ok: false,
      errors: [`acceptance disposition mismatch: frontmatter=${acceptanceDisposition} cli=${disposition}`],
      warnings: [...context.warnings, ...accReport.warnings],
    };
  }

  if (evidenceRelPath) {
    const evidenceReport = attachEvidence(topicDir, evidenceRelPath);
    if (!evidenceReport.ok) {
      return {
        ok: false,
        errors: evidenceReport.errors.map((e) => `evidence invalid: ${e}`),
        warnings: [...context.warnings, ...evidenceReport.warnings],
      };
    }
  }

  const postReport = validateTopic(topicDir);
  if (postReport.errors.length > 0) {
    return {
      ok: false,
      errors: postReport.errors.map((e) => `post-validation: ${e}`),
      warnings: postReport.warnings,
    };
  }

  const nextPhaseId = disposition === 'complete' ? normalizeNextPhaseId(currentPhase.next_on_success) : null;
  const nextPhase = nextPhaseId ? context.route.phaseById.get(nextPhaseId) : null;
  const terminal = nextPhaseId === null;

  return {
    ok: true,
    errors: [],
    warnings: [...context.warnings, ...postReport.warnings],
    phase,
    disposition,
    packet_id: context.packet.packet_id,
    terminal,
    next_phase: nextPhase
      ? phaseView(context.packet, nextPhase, context.route.orderedPhaseIds.indexOf(nextPhaseId))
      : null,
    required_human_action: terminal
      ? (disposition === 'complete' ? 'final-confirmation' : 'manager-review')
      : 'dispatch-next-phase',
  };
}

export {
  inspectPacketRoute,
  loadBatchContext,
  normalizeNextPhaseId,
  phaseView,
};
