import { readFile } from "node:fs/promises";

import {
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
  loadChunk,
  loadFindings,
  loadPlan,
  loadYamlRef,
  runLedgerRef,
  safeSweepId,
  sha256Object,
} from "./common.mjs";
import { ensureClusterStore } from "./risk-budget.mjs";
import {
  validateClusterShape,
  deriveLedgerSnapshotId,
  validateLatestLedger,
  validateRemediationMap,
} from "./validators-ledger.mjs";
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

export { deriveLedgerSnapshotId };

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

function sortedArrayEquals(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
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
  if (plan.planning_basis?.mode === "spec_authority") {
    const evidenceInventoryOk = Array.isArray(plan.evidence_inventory)
      && Array.isArray(plan.unmapped_evidence_files)
      && nonEmptyString(plan.evidence_inventory_hash);
    check(checks, "plan_spec_evidence_inventory_present", evidenceInventoryOk, "spec-authority plan declares evidence inventory and unmapped evidence files");
    const evidenceInventoryEntriesOk = Array.isArray(plan.evidence_inventory) && plan.evidence_inventory.every((entry) => isPlainObject(entry)
      && hasRequiredFields(entry, ["file_ref", "sha256", "bytes", "extension", "owner_domain", "classification", "included", "exclusion_reason"])
      && nonEmptyString(entry.file_ref)
      && nonEmptyString(entry.sha256)
      && nonNegativeInteger(entry.bytes)
      && entry.included === true
      && entry.exclusion_reason === null);
    check(checks, "plan_spec_evidence_inventory_entries_valid", evidenceInventoryEntriesOk, "spec-authority evidence inventory entries are complete included files");
    const recomputedEvidenceInventoryHash = Array.isArray(plan.evidence_inventory)
      ? sha256Object(plan.evidence_inventory.map((entry) => ({
        file_ref: entry.file_ref,
        sha256: entry.sha256,
        included: entry.included,
        exclusion_reason: entry.exclusion_reason,
      })))
      : null;
    check(checks, "plan_spec_evidence_inventory_hash_matches", plan.evidence_inventory_hash === recomputedEvidenceInventoryHash, "spec-authority plan evidence_inventory_hash covers all evidence entries");
    const specChunksOk = plan.chunks.every((chunk) => Array.isArray(chunk.authority_refs)
      && chunk.authority_refs.length === chunk.files.length
      && chunk.authority_refs.every((fileRef) => chunk.files.includes(fileRef))
      && Array.isArray(chunk.evidence_roots)
      && Array.isArray(chunk.evidence_inventory)
      && (chunk.evidence_inventory.length > 0
        || (chunk.evidence_inventory_status === "empty" && nonEmptyString(chunk.evidence_inventory_empty_reason)))
      && isPlainObject(chunk.coverage_contract)
      && chunk.coverage_contract.authority_refs_required === true
      && chunk.coverage_contract.evidence_inventory_required === true
      && chunk.coverage_contract.evidence_files_must_cover_inventory === true
      && chunk.coverage_contract.empty_evidence_inventory_requires_reason === true
      && nonEmptyString(chunk.spec_surface));
    check(checks, "plan_spec_authority_chunks_valid", specChunksOk, "spec-authority audit chunks declare authority refs, evidence roots, empty-evidence posture, and coverage contract");
    const appSliceAdmissions = Array.isArray(plan.app_slice_admissions) ? plan.app_slice_admissions : [];
    const appAdmissionByRef = new Map(appSliceAdmissions
      .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.admission_ref))
      .map((entry) => [entry.admission_ref, entry]));
    const appAuthorityChunks = plan.chunks.filter((chunk) => (
      chunk.authority_kind === "admitted_app_slice"
      || (Array.isArray(chunk.authority_refs) && chunk.authority_refs.some((fileRef) => String(fileRef).startsWith("apps/")))
    ));
    const appAuthorityChunksOk = appAuthorityChunks.every((chunk) => {
      const admission = appAdmissionByRef.get(chunk.admission_ref);
      return chunk.authority_kind === "admitted_app_slice"
        && nonEmptyString(chunk.app_id)
        && nonEmptyString(chunk.admission_ref)
        && nonEmptyString(chunk.authority_root)
        && admission
        && admission.app_id === chunk.app_id
        && admission.authority_root === chunk.authority_root
        && Array.isArray(admission.evidence_roots)
        && sortedArrayEquals(chunk.evidence_roots, admission.evidence_roots)
        && chunk.authority_refs.every((fileRef) => String(fileRef).startsWith(`${chunk.authority_root}/`));
    });
    check(checks, "plan_spec_app_slice_authority_admitted", appAuthorityChunksOk, "app-local authority chunks are admitted through .nimi/spec app-slice admissions");
    const packageAuthorityAdmissions = Array.isArray(plan.package_authority_admissions) ? plan.package_authority_admissions : [];
    const packageAdmissionByRef = new Map(packageAuthorityAdmissions
      .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.admission_ref))
      .map((entry) => [entry.admission_ref, entry]));
    const packageAuthorityChunks = plan.chunks.filter((chunk) => (
      chunk.authority_kind === "admitted_package_authority"
      || (Array.isArray(chunk.authority_refs) && chunk.authority_refs.some((fileRef) => String(fileRef).includes("/spec/") && !String(fileRef).startsWith(".nimi/spec/") && !String(fileRef).startsWith("apps/")))
    ));
    const packageAuthorityChunksOk = packageAuthorityChunks.every((chunk) => {
      const admission = packageAdmissionByRef.get(chunk.admission_ref);
      const declaredProjections = Array.isArray(admission?.host_authority_projection_refs)
        ? admission.host_authority_projection_refs
        : [];
      const declaredProjectionByHost = new Map(declaredProjections
        .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.host_ref) && nonEmptyString(entry.package_ref))
        .map((entry) => [entry.host_ref, entry.package_ref]));
      const chunkProjections = Array.isArray(chunk.host_authority_projection_refs) ? chunk.host_authority_projection_refs : [];
      const chunkProjectionByHost = new Map(chunkProjections
        .filter((entry) => isPlainObject(entry) && nonEmptyString(entry.host_ref) && nonEmptyString(entry.package_ref))
        .map((entry) => [entry.host_ref, entry.package_ref]));
      const chunkProjectionRefsOk = chunkProjections.every((entry) => isPlainObject(entry)
        && nonEmptyString(entry.host_ref)
        && nonEmptyString(entry.package_ref)
        && declaredProjectionByHost.get(entry.host_ref) === entry.package_ref
        && chunk.authority_refs.includes(entry.host_ref)
        && chunk.authority_refs.includes(entry.package_ref));
      return chunk.authority_kind === "admitted_package_authority"
        && nonEmptyString(chunk.package_authority_id)
        && nonEmptyString(chunk.admission_ref)
        && nonEmptyString(chunk.authority_root)
        && admission
        && admission.id === chunk.package_authority_id
        && admission.authority_root === chunk.authority_root
        && Array.isArray(admission.evidence_roots)
        && sortedArrayEquals(chunk.evidence_roots, admission.evidence_roots)
        && chunkProjectionRefsOk
        && chunk.authority_refs.every((fileRef) => (
          String(fileRef).startsWith(`${chunk.authority_root}/`)
          || chunkProjectionByHost.get(String(fileRef)) === declaredProjectionByHost.get(String(fileRef))
        ));
    });
    check(checks, "plan_spec_package_authority_admitted", packageAuthorityChunksOk, "package-local authority chunks are admitted through .nimi/spec package authority admissions");
    const evidenceRootAdmissionsOk = plan.chunks.every((chunk) => (
      !Array.isArray(chunk.evidence_root_admission_refs)
      || chunk.evidence_root_admission_refs.every((ref) => (
        nonEmptyString(ref)
        && ref.startsWith(".nimi/spec/")
        && ref.includes("/kernel/tables/audit-evidence-roots.yaml#")
      ))
    ));
    check(checks, "plan_spec_evidence_root_admissions_valid", evidenceRootAdmissionsOk, "authority-specific evidence roots are admitted through .nimi/spec audit evidence root tables");
    const evidenceInventoryFiles = Array.isArray(plan.evidence_inventory) ? plan.evidence_inventory.map((entry) => entry.file_ref) : [];
    const unmappedEvidenceFiles = Array.isArray(plan.unmapped_evidence_files) ? plan.unmapped_evidence_files : [];
    const mappedEvidenceFiles = plan.chunks.flatMap((chunk) => Array.isArray(chunk.evidence_inventory) ? chunk.evidence_inventory : []);
    const mappedEvidenceSet = new Set(mappedEvidenceFiles);
    const expectedMappedFiles = evidenceInventoryFiles.filter((fileRef) => !unmappedEvidenceFiles.includes(fileRef));
    check(checks, "plan_spec_evidence_inventory_mapped", expectedMappedFiles.every((fileRef) => mappedEvidenceSet.has(fileRef))
      && mappedEvidenceFiles.every((fileRef) => evidenceInventoryFiles.includes(fileRef)), "every mapped evidence inventory file belongs to at least one chunk");
    check(checks, "plan_spec_unmapped_evidence_declared", unmappedEvidenceFiles.every((fileRef) => evidenceInventoryFiles.includes(fileRef)), "unmapped evidence files belong to the evidence inventory");
    check(checks, "plan_spec_unmapped_evidence_fail_closed", unmappedEvidenceFiles.length === 0, "spec-authority plans have no unmapped evidence files");
    check(checks, "plan_spec_coverage_counts_match", plan.coverage?.authority_files === includedFiles.length
      && plan.coverage?.evidence_files === evidenceInventoryFiles.length
      && plan.coverage?.unmapped_evidence_files === unmappedEvidenceFiles.length
      && plan.coverage?.authority_chunks_without_evidence_inventory === plan.chunks.filter((chunk) => (chunk.evidence_inventory ?? []).length === 0).length,
    "spec-authority coverage counts split authority and evidence inventory");
  }
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
  if (chunk.planning_basis === "spec_authority") {
    const specChunkOk = Array.isArray(chunk.authority_refs)
      && chunk.authority_refs.length === chunk.files.length
      && chunk.authority_refs.every((fileRef) => chunk.files.includes(fileRef))
      && Array.isArray(chunk.evidence_roots)
      && Array.isArray(chunk.evidence_inventory)
      && (chunk.evidence_inventory.length > 0
        || (chunk.evidence_inventory_status === "empty" && nonEmptyString(chunk.evidence_inventory_empty_reason)))
      && isPlainObject(chunk.coverage_contract)
      && chunk.coverage_contract.authority_refs_required === true
      && chunk.coverage_contract.evidence_inventory_required === true
      && chunk.coverage_contract.evidence_files_must_cover_inventory === true
      && chunk.coverage_contract.empty_evidence_inventory_requires_reason === true
      && nonEmptyString(chunk.spec_surface);
    check(checks, `chunk_${chunk.chunk_id}_spec_authority_fields`, specChunkOk, "spec-authority chunk declares authority refs, evidence inventory, empty-evidence posture, and coverage contract");
    check(checks, `chunk_${chunk.chunk_id}_evidence_inventory_matches_plan`, planChunk !== null
      && sortedArrayEquals(chunk.evidence_inventory, planChunk.evidence_inventory), "spec-authority chunk evidence inventory matches plan");
    const evidenceInventoryByFile = new Map((plan.evidence_inventory ?? []).map((entry) => [entry.file_ref, entry]));
    const evidenceHashesOk = Array.isArray(chunk.evidence_inventory)
      && isPlainObject(chunk.evidence_file_hashes)
      && chunk.evidence_inventory.every((fileRef) => chunk.evidence_file_hashes[fileRef] === evidenceInventoryByFile.get(fileRef)?.sha256);
    check(checks, `chunk_${chunk.chunk_id}_evidence_hashes_match_inventory`, evidenceHashesOk, "spec-authority chunk evidence hashes match evidence inventory");
  }
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

function validateSpecAuthorityCoverageEnvelope(evidence, chunk) {
  if (!isPlainObject(evidence) || evidence.chunk_id !== chunk.chunk_id) {
    return { ok: false, reason: "audit evidence chunk_id matches chunk" };
  }
  if (!isPlainObject(evidence.coverage)) {
    return { ok: false, reason: "audit evidence coverage is an object" };
  }
  if (!Array.isArray(evidence.coverage.authority_refs)) {
    return { ok: false, reason: "spec-authority evidence declares authority_refs" };
  }
  const coveredAuthority = [...evidence.coverage.authority_refs].sort();
  const expectedAuthority = [...(chunk.authority_refs ?? chunk.files)].sort();
  if (coveredAuthority.length !== expectedAuthority.length || coveredAuthority.some((fileRef, index) => fileRef !== expectedAuthority[index])) {
    return { ok: false, reason: "spec-authority evidence covers exactly the chunk authority refs" };
  }
  if (!Array.isArray(evidence.coverage.files) || !sortedArrayEquals(evidence.coverage.files, expectedAuthority)) {
    return { ok: false, reason: "spec-authority evidence coverage.files matches authority_refs only" };
  }
  if (!Array.isArray(evidence.coverage.evidence_files)) {
    return { ok: false, reason: "spec-authority evidence declares examined evidence_files" };
  }
  const evidenceFiles = evidence.coverage.evidence_files.map((fileRef) => typeof fileRef === "string" ? fileRef.replace(/\\/g, "/") : fileRef);
  if (evidenceFiles.some((fileRef) => typeof fileRef !== "string")) {
    return { ok: false, reason: "spec-authority evidence_files are file refs" };
  }
  if (!sortedArrayEquals(evidenceFiles, chunk.evidence_inventory ?? [])) {
    return { ok: false, reason: "spec-authority evidence_files exactly cover chunk evidence inventory" };
  }
  if (!Array.isArray(evidence.coverage.authority_outcomes)) {
    return { ok: false, reason: "spec-authority evidence declares authority_outcomes" };
  }
  const expectedAuthoritySet = new Set(expectedAuthority);
  const seenAuthorityRefs = new Set();
  for (const outcome of evidence.coverage.authority_outcomes) {
    if (!isPlainObject(outcome)) {
      return { ok: false, reason: "authority_outcomes entries are objects" };
    }
    const authorityRef = typeof outcome.authority_ref === "string" ? outcome.authority_ref.replace(/\\/g, "/") : "";
    if (!expectedAuthoritySet.has(authorityRef) || seenAuthorityRefs.has(authorityRef)) {
      return { ok: false, reason: "authority_outcomes map one-to-one to chunk authority refs" };
    }
    seenAuthorityRefs.add(authorityRef);
    if (!["audited", "blocked", "not_applicable"].includes(outcome.status)) {
      return { ok: false, reason: "authority_outcomes status is valid" };
    }
    if (!Array.isArray(outcome.evidence_refs)) {
      return { ok: false, reason: "authority_outcomes evidence_refs are arrays" };
    }
    for (const evidenceRef of outcome.evidence_refs) {
      if (typeof evidenceRef !== "string" || !chunkAllowsFindingFile(chunk, evidenceRef.replace(/\\/g, "/"))) {
        return { ok: false, reason: "authority_outcomes evidence_refs belong to authority refs or evidence inventory" };
      }
    }
    if (outcome.status === "audited" && outcome.evidence_refs.length === 0) {
      return { ok: false, reason: "audited authority_outcomes declare evidence_refs" };
    }
    if (outcome.status !== "audited" && !nonEmptyString(outcome.reason)) {
      return { ok: false, reason: "non-audited authority_outcomes declare reason" };
    }
  }
  return {
    ok: seenAuthorityRefs.size === expectedAuthority.length,
    reason: "spec-authority evidence declares one authority outcome per authority ref",
  };
}

async function validateChunkEvidenceArtifact(projectRoot, chunk, checks) {
  if (!["ingested", "reviewed", "frozen", "failed"].includes(chunk.state)) {
    return;
  }
  if (!nonEmptyString(chunk.evidence_ref)) {
    return;
  }
  let evidence = null;
  try {
    evidence = JSON.parse(await readFile(artifactPath(projectRoot, chunk.evidence_ref), "utf8"));
  } catch {
    check(checks, `chunk_${chunk.chunk_id}_evidence_json_valid`, false, "chunk evidence artifact is valid JSON");
    return;
  }
  check(checks, `chunk_${chunk.chunk_id}_evidence_json_valid`, true, "chunk evidence artifact is valid JSON");
  if (chunk.planning_basis === "spec_authority") {
    const coverageCheck = validateSpecAuthorityCoverageEnvelope(evidence, chunk);
    check(checks, `chunk_${chunk.chunk_id}_spec_authority_evidence_coverage`, coverageCheck.ok, coverageCheck.reason);
  }
}

function isInsideRef(rootRef, fileRef) {
  const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
  return fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`);
}

function chunkAllowsFindingFile(chunk, fileRef) {
  if (chunk?.files?.includes(fileRef)) {
    return true;
  }
  if (chunk?.planning_basis !== "spec_authority") {
    return false;
  }
  return Array.isArray(chunk.evidence_inventory) && chunk.evidence_inventory.includes(fileRef);
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
    && chunkAllowsFindingFile(chunk, finding.location.file), "audit finding location belongs to its source chunk");
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
    const dispatchRequired = chunk.state !== "planned";
    const ingestRequired = ["ingested", "reviewed", "frozen", "failed"].includes(chunk.state);
    const terminalRequired = ["frozen", "failed", "skipped"].includes(chunk.state);
    check(checks, `run_replay_${chunk.chunk_id}_dispatch`, !dispatchRequired || dispatched, dispatchRequired ? `run ledger records dispatch for ${chunk.chunk_id}` : `run ledger dispatch not required for planned chunk ${chunk.chunk_id}`);
    check(checks, `run_replay_${chunk.chunk_id}_ingest`, !ingestRequired || ingested, ingestRequired ? `run ledger records ingest for ${chunk.chunk_id}` : `run ledger ingest not required for ${chunk.state} chunk ${chunk.chunk_id}`);
    check(checks, `run_replay_${chunk.chunk_id}_terminal`, !terminalRequired || ((chunk.state !== "frozen" || frozen) && (chunk.state !== "failed" || failed) && (chunk.state !== "skipped" || skipped)), terminalRequired ? `run ledger records terminal state for ${chunk.chunk_id}` : `run ledger terminal event not required for ${chunk.state} chunk ${chunk.chunk_id}`);
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
  check(checks, "audit_closeout_coverage_status", closeout.coverage_status !== "full"
    || ledgerInfo.ledger?.status === "candidate_ready", "audit closeout full coverage requires candidate_ready ledger");
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
      await validateChunkEvidenceArtifact(projectRoot, chunk, checks);
    }
  }

  const findingsResult = await loadFindings(projectRoot, sweepId);
  ensureClusterStore(findingsResult.store);
  const findings = findingsResult.store.findings;
  const clusters = findingsResult.store.clusters;
  if (scope === "findings" || scope === "rerun" || scope === "all") {
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    check(checks, "findings_store_valid", findingsResult.store.kind === "audit-findings" && findingsResult.store.sweep_id === sweepId && Array.isArray(findings), "findings store is valid");
    for (const finding of findings) {
      validateFindingShape(finding, chunksById, checks);
    }
    const findingIds = new Set(findings.map((finding) => finding.id));
    for (const cluster of clusters) {
      validateClusterShape(cluster, findingIds, checks);
    }
    await validateEvidenceRefs(projectRoot, [findingsResult.findingsRef, ...findings.map((finding) => finding.evidence_ref), ...findings.map((finding) => finding.resolution?.evidence_ref).filter(Boolean)], checks, "finding_ref");
  }
  if (scope === "findings" || scope === "rerun") {
    return validationResult(sweepId, scope, checks);
  }

  const events = await loadRunLedgerEvents(projectRoot, sweepId, checks);
  const ledgerInfo = scope === "ledger" || scope === "remediation" || scope === "closeout" || scope === "all"
    ? await validateLatestLedger(projectRoot, sweepId, planResult.plan, chunks, findings, clusters, checks)
    : null;
  validateRunLedgerReplay(events, planResult.plan, chunks, findings, ledgerInfo, checks);
  if (scope === "ledger") {
    return validationResult(sweepId, scope, checks);
  }

  const remediationInfo = scope === "remediation" || scope === "closeout" || scope === "all"
    ? await validateRemediationMap(projectRoot, sweepId, ledgerInfo, findings, clusters, checks)
    : null;
  if (scope === "remediation") {
    return validationResult(sweepId, scope, checks);
  }

  if (scope === "closeout" || scope === "all") {
    await validateCloseoutArtifact(projectRoot, sweepId, ledgerInfo, remediationInfo, findings, checks);
  }
  return validationResult(sweepId, scope, checks);
}
