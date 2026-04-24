import { readFile } from "node:fs/promises";

import {
  ACTIVE_CHUNK_STATES,
  CHUNK_STATES,
  FINDING_ACTIONABILITY,
  FINDING_CONFIDENCE,
  FINDING_DISPOSITION,
  FINDING_SEVERITY,
  RERUN_VERDICT,
  artifactPath,
  auditCloseoutRef,
  chunkRef,
  findingsRef,
  inputError,
  ledgerRef,
  loadChunk,
  loadFindings,
  loadLatestLedger,
  loadPlan,
  loadYamlRef,
  remediationMapRef,
  runLedgerRef,
  safeSweepId,
  sha256Object,
} from "./common.mjs";
import { pathExists } from "../fs-helpers.mjs";
import { isIsoUtcTimestamp, isPlainObject } from "../value-helpers.mjs";

const RUN_EVENT_TYPES = new Set([
  "plan_created",
  "chunk_dispatched",
  "chunk_ingested",
  "chunk_reviewed",
  "chunk_frozen",
  "chunk_failed",
  "chunk_skipped",
  "ledger_snapshot_created",
  "remediation_map_created",
  "remediation_map_admitted",
  "finding_resolved",
  "closeout_summary_projected",
]);

const VALIDATION_SCOPES = new Set(["all", "plan", "chunks", "findings", "ledger", "remediation", "rerun", "closeout"]);

function check(checks, id, ok, reason) {
  checks.push({ id, ok, reason });
}

function validationResult(sweepId, scope, checks) {
  const ok = checks.every((entry) => entry.ok);
  return {
    ok,
    exitCode: ok ? 0 : 2,
    sweepId,
    scope,
    checks,
  };
}

async function refExists(projectRoot, ref) {
  const info = await pathExists(artifactPath(projectRoot, ref));
  return Boolean(info?.isFile());
}

function hasRequiredFields(value, fields) {
  return fields.every((field) => field in value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function deriveLedgerSnapshotId(sweepId, plan, chunks, findings) {
  const snapshotSeed = {
    sweepId,
    inventoryHash: plan.inventory_hash,
    chunkStates: chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      state: chunk.state,
      evidence_ref: chunk.evidence_ref ?? null,
      finding_count: chunk.finding_count ?? 0,
    })),
    findings: findings.map((finding) => ({
      id: finding.id,
      fingerprint: finding.fingerprint,
      disposition: finding.disposition,
      resolution_evidence_ref: finding.resolution?.evidence_ref ?? null,
    })),
  };
  return `ledger-${sha256Object(snapshotSeed).slice(0, 16)}`;
}

function validatePlanShape(plan, sweepId, checks) {
  const required = [
    "version",
    "kind",
    "sweep_id",
    "target_root",
    "inventory_hash",
    "inventory",
    "chunks",
    "coverage",
    "created_at",
    "updated_at",
  ];
  check(checks, "plan_required_fields", isPlainObject(plan) && hasRequiredFields(plan, required), "audit plan has required top-level fields");
  if (!isPlainObject(plan)) {
    return;
  }
  check(checks, "plan_identity", plan.kind === "audit-plan" && plan.sweep_id === sweepId, "audit plan kind and sweep_id match");
  check(checks, "plan_timestamps", isIsoUtcTimestamp(plan.created_at) && isIsoUtcTimestamp(plan.updated_at), "audit plan timestamps are ISO UTC");
  check(checks, "plan_arrays", Array.isArray(plan.inventory) && Array.isArray(plan.chunks), "audit plan inventory and chunks are arrays");
  if (!Array.isArray(plan.inventory) || !Array.isArray(plan.chunks)) {
    return;
  }

  const inventoryFieldsOk = plan.inventory.every((entry) => isPlainObject(entry)
    && hasRequiredFields(entry, ["file_ref", "sha256", "bytes", "extension", "owner_domain", "classification", "included", "exclusion_reason"])
    && nonEmptyString(entry.file_ref)
    && nonEmptyString(entry.sha256)
    && nonNegativeInteger(entry.bytes)
    && typeof entry.included === "boolean"
    && (entry.included ? entry.exclusion_reason === null : nonEmptyString(entry.exclusion_reason)));
  check(checks, "plan_inventory_entries_valid", inventoryFieldsOk, "audit plan inventory entries are complete and explicit");

  const recomputedInventoryHash = sha256Object(plan.inventory.map((entry) => ({
    file_ref: entry.file_ref,
    sha256: entry.sha256,
    included: entry.included,
    exclusion_reason: entry.exclusion_reason,
  })));
  check(checks, "plan_inventory_hash_matches", plan.inventory_hash === recomputedInventoryHash, "audit plan inventory_hash covers all inventory entries");

  const includedFiles = plan.inventory.filter((entry) => entry.included).map((entry) => entry.file_ref);
  const chunkFiles = plan.chunks.flatMap((chunk) => Array.isArray(chunk.files) ? chunk.files : []);
  check(checks, "plan_included_files_mapped_once", new Set(chunkFiles).size === chunkFiles.length
    && includedFiles.length === chunkFiles.length
    && includedFiles.every((fileRef) => chunkFiles.includes(fileRef)), "every included file belongs to exactly one chunk");
  check(checks, "plan_coverage_counts_match", plan.coverage?.total_files === plan.inventory.length
    && plan.coverage?.included_files === includedFiles.length
    && plan.coverage?.excluded_files === plan.inventory.length - includedFiles.length
    && plan.coverage?.chunk_count === plan.chunks.length, "audit plan coverage counts match inventory and chunks");

  const chunkSummariesOk = plan.chunks.every((chunk) => isPlainObject(chunk)
    && hasRequiredFields(chunk, ["chunk_id", "state", "owner_domain", "criteria", "files", "file_count"])
    && nonEmptyString(chunk.chunk_id)
    && CHUNK_STATES.has(chunk.state)
    && Array.isArray(chunk.criteria)
    && Array.isArray(chunk.files)
    && chunk.file_count === chunk.files.length);
  check(checks, "plan_chunk_summaries_valid", chunkSummariesOk, "audit plan chunk summaries are valid");
}

function validateChunkShape(chunk, plan, checks) {
  const required = [
    "version",
    "kind",
    "sweep_id",
    "chunk_id",
    "state",
    "owner_domain",
    "criteria",
    "files",
    "file_hashes",
    "lifecycle",
    "created_at",
    "updated_at",
  ];
  check(checks, `chunk_${chunk?.chunk_id ?? "unknown"}_required_fields`, isPlainObject(chunk) && hasRequiredFields(chunk, required), "audit chunk has required top-level fields");
  if (!isPlainObject(chunk)) {
    return;
  }
  const planChunk = plan.chunks.find((entry) => entry.chunk_id === chunk.chunk_id) ?? null;
  check(checks, `chunk_${chunk.chunk_id}_plan_link`, chunk.kind === "audit-chunk" && planChunk !== null && planChunk.state === chunk.state, "audit chunk links back to plan state");
  check(checks, `chunk_${chunk.chunk_id}_state_valid`, CHUNK_STATES.has(chunk.state), "audit chunk state is valid");
  check(checks, `chunk_${chunk.chunk_id}_files_match_plan`, Array.isArray(chunk.files)
    && chunk.file_count === chunk.files.length
    && planChunk !== null
    && JSON.stringify([...chunk.files].sort()) === JSON.stringify([...planChunk.files].sort()), "audit chunk files match plan");
  const inventoryByFile = new Map(plan.inventory.map((entry) => [entry.file_ref, entry]));
  const hashesOk = Array.isArray(chunk.files) && isPlainObject(chunk.file_hashes)
    && chunk.files.every((fileRef) => chunk.file_hashes[fileRef] === inventoryByFile.get(fileRef)?.sha256);
  check(checks, `chunk_${chunk.chunk_id}_hashes_match_inventory`, hashesOk, "audit chunk file hashes match inventory");
  const lifecycle = chunk.lifecycle;
  const lifecycleOk = isPlainObject(lifecycle)
    && ["planned_at", "dispatched_at", "ingested_at", "reviewed_at", "frozen_at", "failed_at", "skipped_at"].every((field) => field in lifecycle)
    && isIsoUtcTimestamp(lifecycle.planned_at);
  check(checks, `chunk_${chunk.chunk_id}_lifecycle_valid`, lifecycleOk, "audit chunk lifecycle is explicit");
  check(checks, `chunk_${chunk.chunk_id}_dispatch_posture`, chunk.state === "planned" || isPlainObject(chunk.dispatch), "non-planned chunks have dispatch packet posture");
  check(checks, `chunk_${chunk.chunk_id}_ingest_posture`, !["ingested", "reviewed", "frozen", "failed"].includes(chunk.state) || nonEmptyString(chunk.evidence_ref), "ingested or later chunks reference audit evidence");
  check(checks, `chunk_${chunk.chunk_id}_frozen_review`, chunk.state !== "frozen" || chunk.review?.verdict === "pass", "frozen chunks have passing manager review");
  check(checks, `chunk_${chunk.chunk_id}_failure_or_skip_reason`, !["failed", "skipped"].includes(chunk.state)
    || nonEmptyString(chunk.failure?.reason)
    || nonEmptyString(chunk.skip?.reason)
    || nonEmptyString(chunk.review?.summary), "failed or skipped chunks have an explicit reason");
}

function validateFindingShape(finding, chunksById, checks) {
  const required = [
    "id",
    "sweep_id",
    "chunk_id",
    "fingerprint",
    "severity",
    "category",
    "actionability",
    "confidence",
    "impact",
    "location",
    "title",
    "description",
    "evidence",
    "disposition",
    "evidence_ref",
  ];
  check(checks, `finding_${finding?.id ?? "unknown"}_required_fields`, isPlainObject(finding) && hasRequiredFields(finding, required), "audit finding has required fields");
  if (!isPlainObject(finding)) {
    return;
  }
  const chunk = chunksById.get(finding.chunk_id) ?? null;
  check(checks, `finding_${finding.id}_enums_valid`, FINDING_SEVERITY.has(finding.severity)
    && FINDING_ACTIONABILITY.has(finding.actionability)
    && FINDING_CONFIDENCE.has(finding.confidence)
    && FINDING_DISPOSITION.has(finding.disposition), "audit finding enums are valid");
  check(checks, `finding_${finding.id}_location_in_chunk`, chunk !== null
    && nonEmptyString(finding.location?.file)
    && chunk.files.includes(finding.location.file), "audit finding location belongs to its source chunk");
  check(checks, `finding_${finding.id}_evidence_valid`, nonEmptyString(finding.evidence?.summary)
    && nonEmptyString(finding.evidence?.auditor_reasoning)
    && nonEmptyString(finding.evidence_ref), "audit finding evidence is explicit");
  check(checks, `finding_${finding.id}_resolution_required`, finding.disposition === "open" || isPlainObject(finding.resolution), "non-open findings have resolution evidence");
  if (finding.disposition !== "open" && isPlainObject(finding.resolution)) {
    const rerun = finding.resolution.rerun;
    check(checks, `finding_${finding.id}_rerun_valid`, nonEmptyString(finding.resolution.evidence_ref)
      && isPlainObject(rerun)
      && Array.isArray(rerun.covered_files)
      && rerun.covered_files.includes(finding.location.file)
      && RERUN_VERDICT.has(rerun.verdict), "resolved finding has valid rerun evidence");
    check(checks, `finding_${finding.id}_rerun_disposition_match`, finding.disposition !== "remediated" || rerun?.verdict === "not_reproduced", "remediated findings require not_reproduced rerun verdict");
  }
}

async function loadChunksForPlan(projectRoot, sweepId, plan, checks) {
  const chunks = [];
  for (const chunkSummary of Array.isArray(plan.chunks) ? plan.chunks : []) {
    const loaded = await loadChunk(projectRoot, sweepId, chunkSummary.chunk_id);
    check(checks, `chunk_${chunkSummary.chunk_id}_artifact_exists`, loaded.ok, `chunk artifact exists for ${chunkSummary.chunk_id}`);
    if (loaded.ok) {
      chunks.push(loaded.chunk);
    }
  }
  return chunks;
}

async function loadRunLedgerEvents(projectRoot, sweepId, checks) {
  const ref = runLedgerRef(sweepId);
  let text = "";
  try {
    text = await readFile(artifactPath(projectRoot, ref), "utf8");
  } catch {
    check(checks, "run_ledger_exists", false, "audit run ledger exists");
    return [];
  }
  const events = [];
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    try {
      const event = JSON.parse(line);
      const valid = event.sweep_id === sweepId
        && RUN_EVENT_TYPES.has(event.event_type)
        && nonEmptyString(event.event_id)
        && isIsoUtcTimestamp(event.recorded_at);
      check(checks, `run_ledger_event_${index + 1}_valid`, valid, `run ledger event ${index + 1} is structurally valid`);
      events.push(event);
    } catch {
      check(checks, `run_ledger_event_${index + 1}_valid`, false, `run ledger event ${index + 1} is valid JSON`);
    }
  }
  check(checks, "run_ledger_non_empty", events.length > 0, "audit run ledger has events");
  return events;
}

function validateRunLedgerReplay(events, plan, chunks, findings, latestLedger, checks) {
  const eventsByType = new Map();
  for (const event of events) {
    const list = eventsByType.get(event.event_type) ?? [];
    list.push(event);
    eventsByType.set(event.event_type, list);
  }
  check(checks, "run_replay_plan_created", eventsByType.get("plan_created")?.some((event) => event.plan_ref === planRefFromPlan(plan)) === true, "run ledger records plan_created for this plan");
  for (const chunk of chunks) {
    const dispatched = eventsByType.get("chunk_dispatched")?.some((event) => event.chunk_id === chunk.chunk_id) === true;
    const ingested = eventsByType.get("chunk_ingested")?.some((event) => event.chunk_id === chunk.chunk_id && event.evidence_ref === chunk.evidence_ref) === true;
    const frozen = eventsByType.get("chunk_frozen")?.some((event) => event.chunk_id === chunk.chunk_id) === true;
    const failed = eventsByType.get("chunk_failed")?.some((event) => event.chunk_id === chunk.chunk_id) === true;
    const skipped = eventsByType.get("chunk_skipped")?.some((event) => event.chunk_id === chunk.chunk_id) === true;
    check(checks, `run_replay_${chunk.chunk_id}_dispatch`, chunk.state === "planned" || dispatched, `run ledger records dispatch for ${chunk.chunk_id}`);
    check(checks, `run_replay_${chunk.chunk_id}_ingest`, !["ingested", "reviewed", "frozen", "failed"].includes(chunk.state) || ingested, `run ledger records ingest for ${chunk.chunk_id}`);
    check(checks, `run_replay_${chunk.chunk_id}_terminal`, (chunk.state !== "frozen" || frozen) && (chunk.state !== "failed" || failed) && (chunk.state !== "skipped" || skipped), `run ledger records terminal state for ${chunk.chunk_id}`);
  }
  for (const finding of findings.filter((entry) => entry.disposition !== "open")) {
    check(checks, `run_replay_${finding.id}_resolution`, eventsByType.get("finding_resolved")?.some((event) => event.finding_id === finding.id && event.evidence_ref === finding.resolution?.evidence_ref) === true, `run ledger records resolution for ${finding.id}`);
  }
  if (latestLedger) {
    check(checks, "run_replay_latest_ledger", eventsByType.get("ledger_snapshot_created")?.some((event) => event.ledger_ref === latestLedger.ledger_ref && event.snapshot_id === latestLedger.snapshot_id) === true, "run ledger records latest ledger snapshot");
  }
}

function planRefFromPlan(plan) {
  return `.nimi/local/audit/plans/${plan.sweep_id}.yaml`;
}

async function validateEvidenceRefs(projectRoot, refs, checks, prefix) {
  for (const ref of refs.filter((entry) => typeof entry === "string" && entry.trim())) {
    check(checks, `${prefix}_${ref.replace(/[^a-zA-Z0-9]+/g, "_")}_exists`, await refExists(projectRoot, ref), `referenced artifact exists: ${ref}`);
  }
}

function buildLedgerExpectedCounts(plan, chunks, findings) {
  const auditedFiles = new Set(chunks.filter((chunk) => chunk.state === "frozen").flatMap((chunk) => chunk.files));
  const findingPosture = {
    open: findings.filter((finding) => finding.disposition === "open").length,
    remediated: findings.filter((finding) => finding.disposition === "remediated").length,
    accepted_risk: findings.filter((finding) => finding.disposition === "accepted-risk").length,
    false_positive: findings.filter((finding) => finding.disposition === "false-positive").length,
    deferred_backlog: findings.filter((finding) => finding.disposition === "deferred-backlog").length,
  };
  return {
    coverage: {
      total_files: plan.coverage.total_files,
      included_files: plan.coverage.included_files,
      audited_files: auditedFiles.size,
      frozen_chunks: chunks.filter((chunk) => chunk.state === "frozen").length,
      failed_chunks: chunks.filter((chunk) => chunk.state === "failed").length,
      skipped_chunks: chunks.filter((chunk) => chunk.state === "skipped").length,
      active_chunks: chunks.filter((chunk) => ACTIVE_CHUNK_STATES.has(chunk.state)).length,
    },
    findingPosture,
  };
}

async function validateLatestLedger(projectRoot, sweepId, plan, chunks, findings, checks) {
  const latest = await loadLatestLedger(projectRoot, sweepId);
  check(checks, "latest_ledger_loadable", latest.ok, "latest ledger pointer and ledger are loadable");
  if (!latest.ok) {
    return null;
  }
  const ledger = latest.ledger;
  const expectedSnapshotId = deriveLedgerSnapshotId(sweepId, plan, chunks, findings);
  check(checks, "ledger_snapshot_id_content_hash", ledger.snapshot_id === expectedSnapshotId && latest.ledgerRef === ledgerRef(sweepId, expectedSnapshotId), "ledger snapshot id is content-derived and current");
  const expected = buildLedgerExpectedCounts(plan, chunks, findings);
  check(checks, "ledger_coverage_counts_match", JSON.stringify(ledger.coverage) === JSON.stringify(expected.coverage), "ledger coverage counts match plan and chunks");
  check(checks, "ledger_finding_counts_match", ledger.finding_count === findings.length
    && ledger.unresolved_finding_count === expected.findingPosture.open
    && JSON.stringify(ledger.finding_posture) === JSON.stringify(expected.findingPosture), "ledger finding counts match findings store");
  check(checks, "ledger_latest_pointer_matches", latest.ledgerRef === ledgerRef(sweepId, ledger.snapshot_id), "latest pointer references the immutable ledger snapshot");
  check(checks, "ledger_status_valid", ["candidate_ready", "partial", "blocked"].includes(ledger.status), "ledger status is valid");
  check(checks, "ledger_candidate_ready_strict", ledger.status !== "candidate_ready"
    || (ledger.coverage.included_files > 0 && ledger.coverage.audited_files === ledger.coverage.included_files && ledger.coverage.active_chunks === 0 && ledger.coverage.failed_chunks === 0 && ledger.coverage.skipped_chunks === 0), "candidate_ready requires all included files audited and all chunks frozen");
  await validateEvidenceRefs(projectRoot, [
    ledger.plan_ref,
    ...(Array.isArray(ledger.chunk_refs) ? ledger.chunk_refs : []),
    ledger.findings_ref,
    ...(Array.isArray(ledger.evidence_refs) ? ledger.evidence_refs : []),
    ledger.report_ref,
    ledger.run_ledger_ref,
  ], checks, "ledger_ref");
  return { ledger, ledger_ref: latest.ledgerRef, snapshot_id: ledger.snapshot_id };
}

async function validateRemediationMap(projectRoot, sweepId, ledgerInfo, findings, checks) {
  if (!ledgerInfo) {
    check(checks, "remediation_map_ledger_available", false, "remediation map validation requires latest ledger");
    return null;
  }
  const mapRef = remediationMapRef(sweepId, ledgerInfo.snapshot_id);
  const remediationMap = await loadYamlRef(projectRoot, mapRef);
  const openFindings = findings.filter((finding) => finding.disposition === "open");
  if (!isPlainObject(remediationMap)) {
    check(checks, "remediation_map_required", false, "remediation map exists for the latest ledger");
    return null;
  }
  check(checks, "remediation_map_identity", remediationMap.kind === "audit-remediation-map" && remediationMap.sweep_id === sweepId && remediationMap.source_ledger_ref === ledgerInfo.ledger_ref, "remediation map references latest ledger");
  const findingIds = new Set(findings.map((finding) => finding.id));
  const mappedIds = new Set();
  const wavesOk = Array.isArray(remediationMap.waves) && remediationMap.waves.every((wave) => {
    if (!isPlainObject(wave) || !nonEmptyString(wave.wave_id) || !Array.isArray(wave.finding_ids) || !Array.isArray(wave.write_set)) {
      return false;
    }
    for (const findingId of wave.finding_ids) {
      mappedIds.add(findingId);
    }
    return wave.finding_ids.every((findingId) => findingIds.has(findingId));
  });
  check(checks, "remediation_map_waves_valid", wavesOk, "remediation map waves reference known findings");
  check(checks, "remediation_map_open_findings_covered", openFindings.every((finding) => mappedIds.has(finding.id)), "all open findings are covered by remediation map waves");
  return { remediationMap, remediation_map_ref: mapRef };
}

async function validateCloseoutArtifact(projectRoot, sweepId, ledgerInfo, remediationInfo, findings, checks) {
  if (!ledgerInfo) {
    check(checks, "closeout_ledger_available", false, "closeout validation requires latest ledger");
    return null;
  }
  const closeoutRef = auditCloseoutRef(sweepId, ledgerInfo.snapshot_id);
  const closeout = await loadYamlRef(projectRoot, closeoutRef);
  if (!isPlainObject(closeout)) {
    check(checks, "audit_closeout_exists", false, "audit closeout artifact exists");
    return null;
  }
  const openCount = findings.filter((finding) => finding.disposition === "open").length;
  check(checks, "audit_closeout_identity", closeout.kind === "audit-closeout"
    && closeout.sweep_id === sweepId
    && closeout.ledger_ref === ledgerInfo.ledger_ref
    && closeout.remediation_map_ref === remediationInfo?.remediation_map_ref
    && closeout.audit_closeout_ref === closeoutRef, "audit closeout references latest ledger and remediation map");
  check(checks, "audit_closeout_posture", closeout.closeout_posture === (openCount > 0 ? "audit_complete_findings_open" : "audit_complete_all_findings_postured"), "audit closeout posture matches finding state");
  check(checks, "audit_closeout_verified_at", isIsoUtcTimestamp(closeout.verified_at), "audit closeout verified_at is ISO UTC");
  return { closeout, audit_closeout_ref: closeoutRef };
}

export async function validateAuditSweepArtifacts(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id is required.\n");
  }
  const scope = options.scope ?? "all";
  if (!VALIDATION_SCOPES.has(scope)) {
    return inputError("nimicoding audit-sweep refused: --scope must be one of all, plan, chunks, findings, ledger, remediation, rerun, closeout.\n");
  }

  const checks = [];
  const planResult = await loadPlan(projectRoot, sweepId);
  check(checks, "plan_loadable", planResult.ok, "audit plan is loadable");
  if (!planResult.ok) {
    return validationResult(sweepId, scope, checks);
  }

  validatePlanShape(planResult.plan, sweepId, checks);
  if (scope === "plan") {
    return validationResult(sweepId, scope, checks);
  }

  const chunks = await loadChunksForPlan(projectRoot, sweepId, planResult.plan, checks);
  if (scope === "chunks" || scope === "all") {
    for (const chunk of chunks) {
      validateChunkShape(chunk, planResult.plan, checks);
    }
  }

  const findingsResult = await loadFindings(projectRoot, sweepId);
  const findings = findingsResult.store.findings;
  if (scope === "findings" || scope === "rerun" || scope === "all") {
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    check(checks, "findings_store_valid", findingsResult.store.kind === "audit-findings" && findingsResult.store.sweep_id === sweepId && Array.isArray(findings), "findings store is valid");
    for (const finding of findings) {
      validateFindingShape(finding, chunksById, checks);
    }
    await validateEvidenceRefs(projectRoot, [findingsResult.findingsRef, ...findings.map((finding) => finding.evidence_ref), ...findings.map((finding) => finding.resolution?.evidence_ref).filter(Boolean)], checks, "finding_ref");
  }
  if (scope === "findings" || scope === "rerun") {
    return validationResult(sweepId, scope, checks);
  }

  const events = await loadRunLedgerEvents(projectRoot, sweepId, checks);
  const ledgerInfo = scope === "ledger" || scope === "remediation" || scope === "closeout" || scope === "all"
    ? await validateLatestLedger(projectRoot, sweepId, planResult.plan, chunks, findings, checks)
    : null;
  validateRunLedgerReplay(events, planResult.plan, chunks, findings, ledgerInfo, checks);
  if (scope === "ledger") {
    return validationResult(sweepId, scope, checks);
  }

  const remediationInfo = scope === "remediation" || scope === "closeout" || scope === "all"
    ? await validateRemediationMap(projectRoot, sweepId, ledgerInfo, findings, checks)
    : null;
  if (scope === "remediation") {
    return validationResult(sweepId, scope, checks);
  }

  if (scope === "closeout" || scope === "all") {
    await validateCloseoutArtifact(projectRoot, sweepId, ledgerInfo, remediationInfo, findings, checks);
  }
  return validationResult(sweepId, scope, checks);
}
