import {
  SEVERITY_RANK,
  appendRunEvent,
  ensureIsoTimestamp,
  inputError,
  loadFindings,
  loadLatestLedger,
  loadYamlRef,
  remediationMapRef,
  safeSweepId,
  writeYamlRef,
} from "./common.mjs";
import {
  addWaveToTopic,
  admitWaveInTopic,
  selectWaveInTopic,
} from "../topic.mjs";

function priorityFor(findings) {
  const rank = Math.min(...findings.map((finding) => SEVERITY_RANK[finding.severity] ?? 99));
  if (rank <= 1) {
    return "P0";
  }
  if (rank === 2) {
    return "P1";
  }
  return "P2";
}

function buildAdmissionChecklist(actionability) {
  return {
    authority_closed: false,
    semantic_closed: false,
    consumer_closed: false,
    drift_resistance_closed: false,
    manager_decision_required: actionability === "needs-decision",
    re_audit_required: true,
  };
}

function groupOpenFindings(findings, maxFindingsPerWave) {
  const groups = new Map();
  const openFindings = findings
    .filter((finding) => finding.disposition === "open")
    .sort((left, right) => {
      const severityDiff = (SEVERITY_RANK[left.severity] ?? 99) - (SEVERITY_RANK[right.severity] ?? 99);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return left.id.localeCompare(right.id);
    });

  for (const finding of openFindings) {
    const fileParts = finding.location.file.split("/");
    const ownerDomain = finding.owner_domain ?? (fileParts.length > 1 ? fileParts[0] : "root");
    const key = `${ownerDomain}:${finding.actionability}`;
    const group = groups.get(key) ?? {
      ownerDomain,
      actionability: finding.actionability,
      findings: [],
    };
    group.findings.push(finding);
    groups.set(key, group);
  }

  const waves = [];
  for (const group of [...groups.values()].sort((left, right) => left.ownerDomain.localeCompare(right.ownerDomain))) {
    for (let index = 0; index < group.findings.length; index += maxFindingsPerWave) {
      const waveFindings = group.findings.slice(index, index + maxFindingsPerWave);
      const writeSet = [...new Set(waveFindings.map((finding) => finding.location.file))].sort();
      waves.push({
        wave_id: `remediation-wave-${String(waves.length + 1).padStart(3, "0")}`,
        status: "proposed",
        owner_domain: group.ownerDomain,
        priority: priorityFor(waveFindings),
        actionability: group.actionability,
        finding_ids: waveFindings.map((finding) => finding.id),
        source_chunks: [...new Set(waveFindings.map((finding) => finding.chunk_id))].sort(),
        files: writeSet,
        write_set: writeSet,
        depends_on: [],
        admission_checklist: buildAdmissionChecklist(group.actionability),
      });
    }
  }

  return waves;
}

export async function buildAuditSweepRemediationMap(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id is required.\n");
  }
  const timestampError = options.verifiedAt ? ensureIsoTimestamp(options.verifiedAt) : null;
  if (timestampError) {
    return timestampError;
  }
  const verifiedAt = options.verifiedAt ?? new Date().toISOString();

  const ledgerResult = await loadLatestLedger(projectRoot, sweepId);
  if (!ledgerResult.ok) {
    return inputError(ledgerResult.error);
  }
  const { findingsRef, store } = await loadFindings(projectRoot, sweepId);
  const maxFindingsPerWave = Number.isInteger(options.maxFindingsPerWave) && options.maxFindingsPerWave > 0
    ? options.maxFindingsPerWave
    : 10;
  const waves = groupOpenFindings(store.findings, maxFindingsPerWave);
  const mappedFindingIds = new Set(waves.flatMap((wave) => wave.finding_ids));
  const mapRef = remediationMapRef(sweepId, ledgerResult.ledger.snapshot_id);
  const remediationMap = {
    version: 1,
    kind: "audit-remediation-map",
    sweep_id: sweepId,
    source_ledger_ref: ledgerResult.ledgerRef,
    source_findings_ref: findingsRef,
    grouping_policy: {
      owner_domain: "finding_owner_domain_or_first_two_path_segments",
      split_by_actionability: true,
      split_by_write_set: true,
      max_findings_per_wave: maxFindingsPerWave,
      preserve_source_ledger: true,
    },
    waves,
    unmapped_findings: store.findings
      .filter((finding) => finding.disposition === "open" && !mappedFindingIds.has(finding.id))
      .map((finding) => finding.id),
    status: waves.length > 0 ? "proposed" : "empty",
    created_at: verifiedAt,
    updated_at: verifiedAt,
  };

  await writeYamlRef(projectRoot, mapRef, remediationMap);
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "remediation_map_created",
    remediation_map_ref: mapRef,
    source_ledger_ref: ledgerResult.ledgerRef,
    wave_count: waves.length,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    ledgerRef: ledgerResult.ledgerRef,
    findingsRef,
    remediationMapRef: mapRef,
    runLedgerRef: runRef,
    waveCount: waves.length,
    mappedFindingCount: mappedFindingIds.size,
    unmappedFindingCount: remediationMap.unmapped_findings.length,
    waves,
  };
}

function topicWaveIdForRemediationWave(wave) {
  const suffix = String(wave.wave_id ?? "")
    .replace(/^remediation-wave-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "001";
  return `wave-audit-remediation-${suffix}`;
}

function topicWaveFromRemediationWave(wave, ledgerRef, remediationMapRefValue) {
  const waveId = topicWaveIdForRemediationWave(wave);
  return {
    wave_id: waveId,
    slug: waveId.replace(/^wave-/, ""),
    state: "candidate",
    primary_closure_goal: `Resolve audit findings: ${wave.finding_ids.join(", ")}`,
    deps: Array.isArray(wave.depends_on) ? wave.depends_on.map((dep) => topicWaveIdForRemediationWave({ wave_id: dep })) : [],
    owner_domain: wave.owner_domain,
    parallelizable_after: [],
    selected: false,
    source_audit_sweep: {
      source_remediation_wave_id: wave.wave_id,
      source_ledger_ref: ledgerRef,
      remediation_map_ref: remediationMapRefValue,
      finding_ids: wave.finding_ids,
      source_chunks: wave.source_chunks,
      write_set: wave.write_set,
      actionability: wave.actionability,
      priority: wave.priority,
      admission_checklist: wave.admission_checklist,
    },
  };
}

export async function admitAuditSweepRemediationMap(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.topicId !== "string" || !options.topicId.trim()) {
    return inputError("nimicoding audit-sweep refused: --sweep-id and --topic-id are required.\n");
  }

  const ledgerResult = await loadLatestLedger(projectRoot, sweepId);
  if (!ledgerResult.ok) {
    return inputError(ledgerResult.error);
  }
  const mapRef = remediationMapRef(sweepId, ledgerResult.ledger.snapshot_id);
  const remediationMap = await loadYamlRef(projectRoot, mapRef);
  if (!remediationMap || remediationMap.kind !== "audit-remediation-map" || remediationMap.source_ledger_ref !== ledgerResult.ledgerRef || !Array.isArray(remediationMap.waves)) {
    return inputError("nimicoding audit-sweep refused: latest remediation map is missing or malformed.\n");
  }

  const materialized = [];
  const admitted = [];
  const managerDecisionRequired = [];
  for (const remediationWave of remediationMap.waves) {
    const topicWave = topicWaveFromRemediationWave(remediationWave, ledgerResult.ledgerRef, mapRef);
    const addResult = await addWaveToTopic(projectRoot, options.topicId, topicWave);
    if (!addResult.ok) {
      return {
        ok: false,
        inputError: true,
        exitCode: 1,
        error: `nimicoding audit-sweep refused: remediation wave admission failed: ${addResult.error}\n`,
      };
    }
    materialized.push(topicWave.wave_id);

    if (remediationWave.admission_checklist?.manager_decision_required === true || remediationWave.actionability === "needs-decision") {
      managerDecisionRequired.push(topicWave.wave_id);
      continue;
    }

    const selectResult = await selectWaveInTopic(projectRoot, options.topicId, topicWave.wave_id);
    if (!selectResult.ok) {
      return {
        ok: false,
        inputError: true,
        exitCode: 1,
        error: `nimicoding audit-sweep refused: remediation wave selection failed: ${selectResult.error}\n`,
      };
    }
    const admitResult = await admitWaveInTopic(projectRoot, options.topicId, topicWave.wave_id);
    if (!admitResult.ok) {
      return {
        ok: false,
        inputError: true,
        exitCode: 1,
        error: `nimicoding audit-sweep refused: remediation wave admission failed: ${admitResult.error}\n`,
      };
    }
    admitted.push(topicWave.wave_id);
  }

  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "remediation_map_admitted",
    remediation_map_ref: mapRef,
    source_ledger_ref: ledgerResult.ledgerRef,
    topic_id: options.topicId,
    materialized_wave_ids: materialized,
    admitted_wave_ids: admitted,
    manager_decision_required_wave_ids: managerDecisionRequired,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    topicId: options.topicId,
    ledgerRef: ledgerResult.ledgerRef,
    remediationMapRef: mapRef,
    runLedgerRef: runRef,
    materializedWaveIds: materialized,
    admittedWaveIds: admitted,
    managerDecisionRequiredWaveIds: managerDecisionRequired,
  };
}
