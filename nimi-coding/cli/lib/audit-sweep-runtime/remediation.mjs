import {
  SEVERITY_RANK,
  appendRunEvent,
  ensureIsoTimestamp,
  inputError,
  loadFindings,
  loadLatestLedger,
  loadPlan,
  loadYamlRef,
  remediationMapRef,
  safeSweepId,
  nowIso,
  writeYamlRef,
} from "./common.mjs";
import { ensureClusterStore } from "./risk-budget.mjs";
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

function clusterForFinding(clustersByFindingId, findingId) {
  return clustersByFindingId.get(findingId) ?? null;
}

function remediationBundleForWave(waveId, waveFindings, clustersByFindingId) {
  const clusters = [];
  const seenClusters = new Set();
  for (const finding of waveFindings) {
    const cluster = clusterForFinding(clustersByFindingId, finding.id);
    if (cluster && !seenClusters.has(cluster.cluster_id)) {
      clusters.push(cluster);
      seenClusters.add(cluster.cluster_id);
    }
  }
  return {
    bundle_id: `bundle-${waveId.replace(/^remediation-wave-/, "")}`,
    cluster_ids: clusters.map((cluster) => cluster.cluster_id),
    representative_finding_ids: clusters.map((cluster) => cluster.representative_finding_id),
    canonical_finding_ids: [...new Set(waveFindings.map((finding) => finding.id))].sort(),
    duplicate_symptom_count: clusters.reduce((total, cluster) => total + (cluster.duplicate_symptom_count ?? 0), 0),
    source_chunks: [...new Set([
      ...waveFindings.map((finding) => finding.chunk_id),
      ...clusters.flatMap((cluster) => cluster.source_chunks ?? []),
    ])].sort(),
    authority_refs: [...new Set(clusters.map((cluster) => cluster.authority_ref).filter(Boolean))].sort(),
    evidence_roots: [...new Set(clusters.map((cluster) => cluster.evidence_root).filter(Boolean))].sort(),
    contract_seams: [...new Set(clusters.map((cluster) => cluster.contract_seam).filter(Boolean))].sort(),
    repair_targets: [...new Set(clusters.map((cluster) => cluster.repair_target).filter(Boolean))].sort(),
  };
}

function groupOpenFindings(findings, clusters, maxFindingsPerWave) {
  const groups = new Map();
  const clustersByFindingId = new Map();
  for (const cluster of clusters) {
    for (const findingId of cluster.canonical_finding_ids ?? []) {
      clustersByFindingId.set(findingId, cluster);
    }
  }
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
      const waveId = `remediation-wave-${String(waves.length + 1).padStart(3, "0")}`;
      const writeSet = [...new Set(waveFindings.map((finding) => finding.location.file))].sort();
      const remediationBundle = remediationBundleForWave(waveId, waveFindings, clustersByFindingId);
      waves.push({
        wave_id: waveId,
        status: "proposed",
        owner_domain: group.ownerDomain,
        priority: priorityFor(waveFindings),
        actionability: group.actionability,
        finding_ids: waveFindings.map((finding) => finding.id),
        cluster_ids: remediationBundle.cluster_ids,
        clustered_symptom_count: remediationBundle.duplicate_symptom_count,
        source_chunks: [...new Set(waveFindings.map((finding) => finding.chunk_id))].sort(),
        files: writeSet,
        write_set: writeSet,
        depends_on: [],
        remediation_bundle: remediationBundle,
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
  ensureClusterStore(store);
  const maxFindingsPerWave = Number.isInteger(options.maxFindingsPerWave) && options.maxFindingsPerWave > 0
    ? options.maxFindingsPerWave
    : 10;
  const waves = groupOpenFindings(store.findings, store.clusters, maxFindingsPerWave);
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
      cluster_policy: "root_cause_authority_evidence_repair_target",
      split_by_actionability: true,
      split_by_write_set: true,
      max_findings_per_wave: maxFindingsPerWave,
      duplicate_symptoms_count_as_remediation_obligations: false,
      preserve_source_ledger: true,
    },
    remediation_bundles: waves.map((wave) => wave.remediation_bundle),
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
    remediationBundleCount: remediationMap.remediation_bundles.length,
    clusteredSymptomCount: remediationMap.remediation_bundles.reduce((total, bundle) => total + bundle.duplicate_symptom_count, 0),
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
      cluster_ids: wave.cluster_ids ?? [],
      source_chunks: wave.source_chunks,
      write_set: wave.write_set,
      remediation_bundle: wave.remediation_bundle ?? null,
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
  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const { findingsRef, store } = await loadFindings(projectRoot, sweepId);
  ensureClusterStore(store);

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

  const acceptedClusterIds = new Set(remediationMap.waves.flatMap((wave) => wave.cluster_ids ?? []));
  const acceptedAt = nowIso();
  for (const cluster of store.clusters) {
    if (!acceptedClusterIds.has(cluster.cluster_id)) {
      continue;
    }
    cluster.acceptance = {
      topic_id: options.topicId,
      remediation_map_ref: mapRef,
      source_ledger_ref: ledgerResult.ledgerRef,
      source_inventory_hash: planResult.plan.inventory_hash,
      source_evidence_inventory_hash: planResult.plan.evidence_inventory_hash ?? null,
      accepted_at: acceptedAt,
    };
    cluster.updated_at = acceptedAt;
  }
  store.updated_at = acceptedAt;
  await writeYamlRef(projectRoot, findingsRef, store);

  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "remediation_map_admitted",
    remediation_map_ref: mapRef,
    source_ledger_ref: ledgerResult.ledgerRef,
    topic_id: options.topicId,
    materialized_wave_ids: materialized,
    admitted_wave_ids: admitted,
    manager_decision_required_wave_ids: managerDecisionRequired,
    accepted_cluster_ids: [...acceptedClusterIds].sort(),
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
