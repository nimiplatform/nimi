import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  appendRunEvent,
  chunkRef,
  ensureIsoTimestamp,
  inputError,
  loadChunk,
  loadPlan,
  packetRef,
  safeSweepId,
  withAuditSweepMutationLock,
  writeYamlRef,
} from "./common.mjs";
import { buildP0P1RecallProfile, criteriaEnableP0P1Recall } from "./p0p1-profile.mjs";
import { budgetBlockForChunk } from "./risk-budget.mjs";

const HIGH_RISK_TERMS = new Set([
  "auth",
  "authn",
  "authz",
  "jwt",
  "token",
  "session",
  "security",
  "permission",
  "capability",
  "delegation",
  "approval",
  "boundary",
  "bridge",
  "ipc",
  "runtime",
  "sdk",
  "hook",
  "destructive",
  "provider",
  "model",
  "secret",
  "revocation",
  "firewall",
]);

const GENERATED_TERMS = new Set([
  "generated",
  "codegen",
  "table",
  "tables",
  "index",
  "registry",
  "manifest",
]);

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "contract",
  "kernel",
  "spec",
  "nimi",
  "desktop",
  "runtime",
  "source",
]);

export function updatePlanChunk(plan, chunkId, patch) {
  return {
    ...plan,
    chunks: plan.chunks.map((chunk) => chunk.chunk_id === chunkId ? { ...chunk, ...patch } : chunk),
  };
}

function uniqueSorted(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.replace(/\\/g, "/")))].sort();
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function readProjectFileText(projectRoot, fileRef, byteLimit = 65536) {
  if (!projectRoot || typeof fileRef !== "string") {
    return "";
  }
  const absolutePath = path.resolve(projectRoot, fileRef);
  if (!absolutePath.startsWith(path.resolve(projectRoot) + path.sep) && absolutePath !== path.resolve(projectRoot)) {
    return "";
  }
  if (!existsSync(absolutePath)) {
    return "";
  }
  try {
    return readFileSync(absolutePath, "utf8").slice(0, byteLimit);
  } catch {
    return "";
  }
}

function adaptiveDepthForChunk(chunk) {
  const surface = [
    chunk.chunk_id,
    chunk.owner_domain,
    chunk.spec_surface,
    ...(chunk.files ?? []),
    ...(chunk.authority_refs ?? []),
  ].join(" ").toLowerCase();
  const tokens = new Set(tokenize(surface));
  const generated = [...GENERATED_TERMS].some((term) => tokens.has(term) || surface.includes(`/${term}`) || surface.includes(`-${term}`));
  if (generated) {
    return {
      level: "shallow",
      selected_limit: 16,
      reason: "generated_table_index_or_registry_surface",
      codex_posture: "audit authority invariants against a compact representative implementation slice; do not expand to the full generated inventory unless a P0/P1 signal requires it",
    };
  }
  const highRisk = [...HIGH_RISK_TERMS].some((term) => tokens.has(term))
    || ["runtime", "sdk", "security", "boundary"].includes(chunk.owner_domain);
  if (highRisk) {
    return {
      level: "deep",
      selected_limit: 96,
      reason: "high_risk_runtime_sdk_security_boundary_or_capability_surface",
      codex_posture: "inspect the selected implementation slice deeply for P0/P1 recall before deciding no-finding",
    };
  }
  return {
    level: "normal",
    selected_limit: 48,
    reason: "ordinary_spec_authority_surface",
    codex_posture: "inspect the selected implementation slice semantically with normal depth",
  };
}

function relativeImportTargets(sourceRef, sourceText, inventorySet) {
  const targets = [];
  const imports = [
    ...sourceText.matchAll(/\b(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/gu),
    ...sourceText.matchAll(/\brequire\(["'`]([^"'`]+)["'`]\)/gu),
  ].map((match) => match[1]);
  const sourceDir = path.posix.dirname(sourceRef);
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".json", ".yaml", ".yml"];
  for (const specifier of imports) {
    if (typeof specifier !== "string" || !specifier.startsWith(".")) {
      continue;
    }
    const base = path.posix.normalize(path.posix.join(sourceDir, specifier));
    const candidates = [
      ...extensions.map((extension) => `${base}${extension}`),
      ...extensions.filter(Boolean).map((extension) => `${base}/index${extension}`),
    ];
    const target = candidates.find((candidate) => inventorySet.has(candidate));
    if (target) {
      targets.push(target);
    }
  }
  return uniqueSorted(targets);
}

function buildRetrievalPrepass({ projectRoot, chunk, depth }) {
  const evidenceInventory = uniqueSorted(chunk.evidence_inventory ?? []);
  const authorityRefs = uniqueSorted(chunk.authority_refs ?? chunk.files ?? []);
  if (evidenceInventory.length === 0) {
    return {
      mode: "compact_selected_slice",
      selected_implementation_refs: [],
      selected_count: 0,
      full_inventory_count: 0,
      omitted_inventory_count: 0,
      omitted_inventory_sha256: sha256Json([]),
      omitted_inventory_canonicalization: "sorted_json_array_of_project_relative_refs",
      selection_signals: ["empty_evidence_inventory"],
      import_graph_edges: [],
    };
  }

  const authorityText = [
    chunk.chunk_id,
    chunk.owner_domain,
    chunk.spec_surface,
    ...authorityRefs,
    ...authorityRefs.map((ref) => readProjectFileText(projectRoot, ref)),
  ].join("\n");
  const authorityTokens = new Set(tokenize(authorityText));
  const ownerTokens = new Set(tokenize([chunk.owner_domain, chunk.spec_surface, chunk.chunk_id].join(" ")));
  const inventorySet = new Set(evidenceInventory);
  const scores = new Map(evidenceInventory.map((ref) => [ref, {
    ref,
    score: 0,
    signals: [],
  }]));

  for (const ref of evidenceInventory) {
    const entry = scores.get(ref);
    const refText = ref.toLowerCase();
    const refTokens = new Set(tokenize(ref));
    const tokenHits = [...authorityTokens].filter((token) => refTokens.has(token) || refText.includes(token));
    if (tokenHits.length > 0) {
      entry.score += Math.min(24, tokenHits.length * 4);
      entry.signals.push(`authority_keywords:${tokenHits.slice(0, 8).join(",")}`);
    }
    const ownerHits = [...ownerTokens].filter((token) => refTokens.has(token) || refText.includes(token));
    if (ownerHits.length > 0) {
      entry.score += Math.min(9, ownerHits.length * 3);
      entry.signals.push(`owner_domain:${ownerHits.slice(0, 4).join(",")}`);
    }
    if (/(^|[/_.-])(test|tests|spec|e2e)([/_.-]|$)/u.test(refText) || /(_test|\.test|\.spec)\.[a-z0-9]+$/u.test(refText)) {
      entry.score += 3;
      entry.signals.push("test_or_spec_file");
    }
    if (/(^|[/_.-])(index|registry|table|tables|generated|codegen)([/_.-]|$)/u.test(refText)) {
      entry.score += depth.level === "shallow" ? 2 : -2;
      entry.signals.push("generated_table_index_surface");
    }
  }

  const importGraphEdges = [];
  const scanLimit = Math.min(evidenceInventory.length, depth.level === "deep" ? 240 : depth.level === "normal" ? 120 : 60);
  for (const ref of evidenceInventory.slice(0, scanLimit)) {
    const text = readProjectFileText(projectRoot, ref, 32768);
    if (!text) {
      continue;
    }
    const targets = relativeImportTargets(ref, text, inventorySet);
    for (const target of targets) {
      importGraphEdges.push({ from: ref, to: target });
      scores.get(ref).score += 2;
      scores.get(ref).signals.push("import_graph_source");
      scores.get(target).score += 3;
      scores.get(target).signals.push("import_graph_target");
    }
  }

  const ranked = [...scores.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.ref.localeCompare(right.ref);
  });
  const initialSelected = ranked.slice(0, Math.min(depth.selected_limit, ranked.length)).map((entry) => entry.ref);
  const selectedSet = new Set(initialSelected);
  for (const selected of initialSelected) {
    const selectedDir = path.posix.dirname(selected);
    const selectedStem = path.posix.basename(selected).replace(/(\.test|\.spec|_test)?\.[^.]+$/u, "");
    for (const ref of evidenceInventory) {
      if (selectedSet.size >= depth.selected_limit) {
        break;
      }
      if (selectedSet.has(ref)) {
        continue;
      }
      const sameDir = path.posix.dirname(ref) === selectedDir;
      const sameStem = path.posix.basename(ref).includes(selectedStem);
      const isNearbyTest = sameDir && (sameStem || /(\.test|\.spec|_test)\./u.test(ref));
      if (isNearbyTest) {
        selectedSet.add(ref);
        scores.get(ref).signals.push("nearby_file_or_test");
      }
    }
  }
  const selected = uniqueSorted([...selectedSet]);
  const selectedSignals = selected.map((ref) => ({
    ref,
    score: scores.get(ref)?.score ?? 0,
    signals: uniqueSorted(scores.get(ref)?.signals ?? []).slice(0, 8),
  }));
  return {
    mode: "compact_selected_slice",
    selected_implementation_refs: selected,
    selected_count: selected.length,
    full_inventory_count: evidenceInventory.length,
    omitted_inventory_count: Math.max(0, evidenceInventory.length - selected.length),
    omitted_inventory_sha256: sha256Json(evidenceInventory),
    omitted_inventory_canonicalization: "sorted_json_array_of_project_relative_refs",
    selection_signals: [
      "authority_keywords",
      "owner_domain",
      "import_graph",
      "tests",
      "nearby_files",
    ],
    selected_ref_signals: selectedSignals,
    import_graph_edges: importGraphEdges.slice(0, 200),
  };
}

export function buildAuditorPacket(sweepId, chunk, auditor, dispatchedAt, plan, options = {}) {
  const specAuthority = chunk.planning_basis === "spec_authority";
  const p0p1RecallProfile = criteriaEnableP0P1Recall(chunk.criteria)
    ? buildP0P1RecallProfile({ chunk, plan })
    : null;
  const p0p1RuleCheckRequiredIds = [
    "fail_open_or_pseudo_success",
    "partial_coverage_misrepresented_as_complete",
    "authority_boundary_or_private_import_bypass",
    "permission_or_capability_bypass",
    "ungated_destructive_action",
    "provider_or_model_hardcoding",
    "app_local_shadow_truth",
  ];
  const auditDepth = adaptiveDepthForChunk(chunk);
  const retrievalPrepass = buildRetrievalPrepass({ projectRoot: options.projectRoot, chunk, depth: auditDepth });
  const selectedImplementationRefs = retrievalPrepass.selected_implementation_refs;
  return {
    version: 1,
    kind: "audit-auditor-packet",
    sweep_id: sweepId,
    chunk_id: chunk.chunk_id,
    auditor,
    planning_basis: chunk.planning_basis ?? "file_inventory",
    spec_surface: chunk.spec_surface ?? null,
    criteria: chunk.criteria,
    owner_domain: chunk.owner_domain,
    audit_depth: auditDepth,
    files: chunk.files,
    authority_refs: chunk.authority_refs ?? chunk.files,
    host_authority_projection_refs: chunk.host_authority_projection_refs ?? [],
    evidence_roots: chunk.evidence_roots ?? [],
    admitted_evidence_roots: chunk.admitted_evidence_roots ?? [],
    evidence_inventory: selectedImplementationRefs,
    selected_implementation_refs: selectedImplementationRefs,
    retrieval_prepass: retrievalPrepass,
    omitted_evidence_inventory: {
      manager_owned: true,
      full_inventory_count: retrievalPrepass.full_inventory_count,
      selected_count: retrievalPrepass.selected_count,
      omitted_count: retrievalPrepass.omitted_inventory_count,
      sha256: retrievalPrepass.omitted_inventory_sha256,
      canonicalization: retrievalPrepass.omitted_inventory_canonicalization,
      source: "chunk.evidence_inventory",
    },
    evidence_inventory_status: chunk.evidence_inventory_status ?? null,
    evidence_inventory_empty_reason: chunk.evidence_inventory_empty_reason ?? null,
    coverage_contract: chunk.coverage_contract ?? null,
    risk_budget_policy: plan.risk_budget_policy ?? null,
    risk_budget_status: plan.risk_budget_status ?? null,
    audit_strategy: p0p1RecallProfile ? {
      mode: "p0_p1_triage_then_deep",
      profile: p0p1RecallProfile,
    } : {
      mode: specAuthority ? "spec_first_full_audit" : "file_inventory_audit",
    },
    audit_instructions: specAuthority ? {
      posture: "spec_first_full_audit",
      authority_source: ".nimi/spec/**",
      auditor_goal: "Find all material issues. Missing an issue is worse than a false positive.",
      required_categories: [
        "security",
        "logic-error",
        "error-handling",
        "code-quality",
        "performance",
        "consistency",
        "type-safety",
        "resource-leak",
        "race-condition",
        "spec-drift",
        "boundary",
        "contract",
        "architecture",
      ],
      required_flow: [
        "read every authority_ref first",
        "use selected_implementation_refs/evidence_inventory as the compact implementation slice selected by the manager retrieval prepass",
        "do not ask for or reconstruct the omitted full evidence_inventory; audit-codex validates cited refs against the manager-owned full chunk inventory",
        "inspect and cite the implementation refs needed for semantic authority and P0/P1 reasoning",
        `use audit_depth=${auditDepth.level}: ${auditDepth.codex_posture}`,
        "evaluate inspected implementation evidence against the authority_refs",
        "if evidence_inventory is empty, treat evidence_inventory_empty_reason as an auditable planning assertion rather than proof of correctness",
        "emit auditor.id, auditor.mode, auditor.methodology_ref, and auditor.provenance with kind=semantic_audit, packet_ref, and session_ref or transcript_ref or review_ref",
        "do not author coverage.files, coverage.authority_refs, or coverage.evidence_files; audit-codex mechanically populates them from the packet before ingest",
        "emit one authority_outcome per authority_ref",
        `emit coverage.p0p1_rule_checks with exactly these ids and no aliases: ${p0p1RuleCheckRequiredIds.join(", ")}`,
        "each P0/P1 rule check must include id, status, implementation_refs, and chunk-specific negative_reasoning",
        "use status=checked with at least one in-scope implementation_ref when implementation evidence was inspected",
        "use status=not_applicable only when there is no implementation surface and explain why in negative_reasoning",
        "emit coverage.p0p1_evidence_refs for implementation refs actually inspected",
        "emit every finding that satisfies the audit-finding contract",
      ],
      p0p1_recall: p0p1RecallProfile,
    } : null,
    output_contract: {
      format: "json",
      required_top_level_fields: ["chunk_id", "auditor", "coverage", "findings"],
      auditor_required_shape: {
        required_fields: ["id", "mode", "methodology_ref", "provenance"],
        provenance_required: {
          kind: "semantic_audit",
          packet_ref: packetRef(sweepId, chunk.chunk_id),
          one_of: ["session_ref", "transcript_ref", "review_ref"],
        },
      },
      raw_coverage_required_fields: [
        "authority_outcomes",
        "p0p1_evidence_refs",
        "p0p1_rule_checks",
      ],
      manager_owned_coverage_fields: [
        "files",
        "authority_refs",
        "evidence_files",
      ],
      manager_owned_coverage_population: {
        coverage_files_from_chunk_files: chunk.files,
        coverage_authority_refs_from_chunk_authority_refs: chunk.authority_refs ?? chunk.files,
        coverage_evidence_files_from_chunk_evidence_inventory: specAuthority ? "manager_owned_chunk.evidence_inventory" : null,
        codex_cited_implementation_refs_must_belong_to_evidence_inventory: true,
      },
      spec_authority_coverage_requires_authority_outcomes: specAuthority,
      authority_outcome_required_fields: [
        "authority_ref",
        "status",
        "inspected_implementation_refs_or_implementation_evidence_refs_or_implementation_not_applicable_reason",
        "negative_reasoning",
      ],
      authority_outcome_manager_owned_fields: [
        "evidence_refs",
      ],
      authority_outcome_status_semantics: {
        audited: "The authority ref and available implementation evidence were inspected. Use this even when findings were discovered.",
        blocked: "The auditor could not inspect required evidence and must explain the blocker in reason.",
        not_applicable: "No implementation surface applies and the auditor must explain why in reason.",
      },
      spec_authority_normalized_evidence_requires_evidence_files: specAuthority,
      p0p1_negative_reasoning_required_when_no_critical_or_high_findings: Boolean(p0p1RecallProfile),
      p0p1_negative_reasoning_field: p0p1RecallProfile ? "coverage.p0p1_negative_reasoning" : null,
      p0p1_evidence_refs_field: p0p1RecallProfile ? "coverage.p0p1_evidence_refs" : null,
      p0p1_rule_checks_field: p0p1RecallProfile ? "coverage.p0p1_rule_checks" : null,
      p0p1_rule_check_required_ids: p0p1RecallProfile ? p0p1RuleCheckRequiredIds : [],
      p0p1_rule_check_id_policy: {
        exact_ids_required: true,
        aliases_rejected_fail_closed: true,
        required_ids_source: "output_contract.p0p1_rule_check_required_ids",
      },
      p0p1_rule_check_required_fields: ["id", "status", "implementation_refs", "negative_reasoning"],
      p0p1_rule_check_status_enum: ["checked", "not_applicable"],
      p0p1_rule_check_semantics: {
        checked_requires_in_scope_implementation_refs: true,
        checked_refs_should_come_from_selected_implementation_refs: true,
        not_applicable_requires_negative_reasoning: true,
        missing_status_or_negative_reasoning_rejected_before_ingest: true,
      },
      finding_locations_must_belong_to_chunk_files_or_evidence_inventory: true,
      authority_only_finding_location_policy: "when no implementation surface exists, findings[].location.file must be the in-scope authority_ref that contains the defect",
      finding_contract_ref: ".nimi/contracts/audit-finding.schema.yaml",
      ingest_command: `nimicoding sweep audit chunk ingest --sweep-id ${sweepId} --chunk-id ${chunk.chunk_id} --from <audit-output.json> --verified-at <ISO-8601-UTC>`,
    },
    hard_constraints: [
      "do_not_sample_out_files_from_this_chunk",
      "for_spec_authority_chunks_audit_the_authority_refs_first_and_use_evidence_roots_for_implementation_evidence",
      "for_spec_authority_chunks_emit_one_authority_outcome_per_authority_ref",
      "for_spec_authority_chunks_cite_only_inspected_implementation_refs_from_selected_implementation_refs",
      "audit_codex_populates_full_coverage_evidence_files_from_manager_owned_chunk_inventory",
      "full_evidence_inventory_is_manager_owned_and_not_exposed_to_codex",
      "if_no_implementation_surface_exists_mark_the_authority_outcome_not_applicable_with_reason",
      "do_not_return_pseudo_success",
      "do_not_emit_findings_outside_chunk_files_or_declared_evidence_inventory",
      "fail_closed_if_a_file_cannot_be_audited",
    ],
    created_at: dispatchedAt,
  };
}

export async function dispatchAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding sweep audit refused: --sweep-id and --chunk-id are required.\n");
  }

  const timestampError = ensureIsoTimestamp(options.dispatchedAt, "--dispatched-at");
  if (timestampError) {
    return timestampError;
  }

  return withAuditSweepMutationLock(projectRoot, sweepId, "chunk dispatch", async () => {
  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }

  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }

  if (chunkResult.chunk.state !== "planned") {
    return inputError("nimicoding sweep audit refused: chunk dispatch requires planned state.\n");
  }
  const budgetBlock = budgetBlockForChunk(planResult.plan, chunkResult.chunk);
  if (budgetBlock) {
    return inputError(`nimicoding sweep audit refused: ${budgetBlock}; build or admit remediation bundles before continuing discovery.\n`);
  }

  const updatedChunk = {
    ...chunkResult.chunk,
    state: "dispatched",
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      dispatched_at: options.dispatchedAt,
    },
    dispatch: {
      auditor: options.auditor ?? "external_auditor",
      criteria: chunkResult.chunk.criteria,
      files: chunkResult.chunk.files,
      authority_refs: chunkResult.chunk.authority_refs ?? chunkResult.chunk.files,
      host_authority_projection_refs: chunkResult.chunk.host_authority_projection_refs ?? [],
      evidence_roots: chunkResult.chunk.evidence_roots ?? [],
      admitted_evidence_roots: chunkResult.chunk.admitted_evidence_roots ?? [],
      evidence_inventory: chunkResult.chunk.evidence_inventory ?? [],
      evidence_inventory_status: chunkResult.chunk.evidence_inventory_status ?? null,
      evidence_inventory_empty_reason: chunkResult.chunk.evidence_inventory_empty_reason ?? null,
    },
    updated_at: options.dispatchedAt,
  };
  const packet = buildAuditorPacket(sweepId, chunkResult.chunk, updatedChunk.dispatch.auditor, options.dispatchedAt, planResult.plan, { projectRoot });
  const auditorPacketRef = packetRef(sweepId, options.chunkId);
  await writeYamlRef(projectRoot, auditorPacketRef, packet);
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: "dispatched" }),
    updated_at: options.dispatchedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_dispatched",
    chunk_id: options.chunkId,
    chunk_ref: chunkRef(sweepId, options.chunkId),
    packet_ref: auditorPacketRef,
    auditor: updatedChunk.dispatch.auditor,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "dispatched",
    chunkRef: chunkResult.chunkRef,
    packetRef: auditorPacketRef,
    runLedgerRef: runRef,
  };
  });
}

export async function reviewAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding sweep audit refused: --sweep-id and --chunk-id are required.\n");
  }

  const timestampError = ensureIsoTimestamp(options.reviewedAt, "--reviewed-at");
  if (timestampError) {
    return timestampError;
  }

  if (!["pass", "fail"].includes(options.verdict)) {
    return inputError("nimicoding sweep audit refused: --verdict must be pass or fail.\n");
  }

  return withAuditSweepMutationLock(projectRoot, sweepId, "chunk review", async () => {
  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }

  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }

  if (chunkResult.chunk.state !== "ingested") {
    return inputError("nimicoding sweep audit refused: chunk review requires ingested state.\n");
  }
  if (options.verdict === "pass" && chunkResult.chunk.audit_validity?.posture === "invalid") {
    return inputError("nimicoding sweep audit refused: manager review cannot freeze invalid no-finding evidence as pass.\n");
  }

  const nextState = options.verdict === "pass" ? "frozen" : "failed";
  const updatedChunk = {
    ...chunkResult.chunk,
    state: nextState,
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      reviewed_at: options.reviewedAt,
      frozen_at: options.verdict === "pass" ? options.reviewedAt : chunkResult.chunk.lifecycle.frozen_at,
      failed_at: options.verdict === "fail" ? options.reviewedAt : chunkResult.chunk.lifecycle.failed_at,
    },
    review: {
      verdict: options.verdict,
      reviewer: options.reviewer ?? "nimicoding_manager",
      summary: options.summary ?? null,
      reviewed_at: options.reviewedAt,
    },
    failure: options.verdict === "fail"
      ? { reason: options.summary ?? "manager_review_failed", failed_at: options.reviewedAt }
      : chunkResult.chunk.failure,
    updated_at: options.reviewedAt,
  };
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: nextState }),
    updated_at: options.reviewedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: options.verdict === "pass" ? "chunk_frozen" : "chunk_failed",
    chunk_id: options.chunkId,
    chunk_ref: chunkResult.chunkRef,
    reviewer: updatedChunk.review.reviewer,
    summary: updatedChunk.review.summary,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: nextState,
    chunkRef: chunkResult.chunkRef,
    runLedgerRef: runRef,
  };
  });
}

export async function skipAuditSweepChunk(projectRoot, options) {
  const sweepId = safeSweepId(options.sweepId);
  if (!sweepId || typeof options.chunkId !== "string") {
    return inputError("nimicoding sweep audit refused: --sweep-id and --chunk-id are required.\n");
  }
  const timestampError = ensureIsoTimestamp(options.skippedAt, "--skipped-at");
  if (timestampError) {
    return timestampError;
  }
  if (typeof options.reason !== "string" || !options.reason.trim()) {
    return inputError("nimicoding sweep audit refused: --reason is required when skipping a chunk.\n");
  }

  return withAuditSweepMutationLock(projectRoot, sweepId, "chunk skip", async () => {
  const planResult = await loadPlan(projectRoot, sweepId);
  if (!planResult.ok) {
    return inputError(planResult.error);
  }
  const chunkResult = await loadChunk(projectRoot, sweepId, options.chunkId);
  if (!chunkResult.ok) {
    return inputError(chunkResult.error);
  }
  if (chunkResult.chunk.state === "frozen") {
    return inputError("nimicoding sweep audit refused: frozen chunks cannot be skipped.\n");
  }

  const updatedChunk = {
    ...chunkResult.chunk,
    state: "skipped",
    lifecycle: {
      ...chunkResult.chunk.lifecycle,
      skipped_at: options.skippedAt,
    },
    skip: {
      reason: options.reason,
      skipped_at: options.skippedAt,
    },
    updated_at: options.skippedAt,
  };
  await writeYamlRef(projectRoot, chunkResult.chunkRef, updatedChunk);
  await writeYamlRef(projectRoot, planResult.planRef, {
    ...updatePlanChunk(planResult.plan, options.chunkId, { state: "skipped" }),
    updated_at: options.skippedAt,
  });
  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "chunk_skipped",
    chunk_id: options.chunkId,
    chunk_ref: chunkResult.chunkRef,
    reason: options.reason,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    chunkId: options.chunkId,
    state: "skipped",
    chunkRef: chunkResult.chunkRef,
    runLedgerRef: runRef,
  };
  });
}
