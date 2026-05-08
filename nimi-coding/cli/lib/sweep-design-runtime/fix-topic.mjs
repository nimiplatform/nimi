import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { addWaveToTopic, admitWaveInTopic, createTopic, selectWaveInTopic } from "../topic.mjs";
import { sweepDesignWaveAuthorityRefs } from "../topic-authority-coverage.mjs";
import { assertDesignArtifact, designRef, inputError, nowIso, requireRunId } from "./common.mjs";

function inventoryRef(runId) {
  return designRef(runId, "inventory.yaml");
}

function ledgerRef(runId) {
  return designRef(runId, "revision-ledger.yaml");
}

function finalStateReportRef(runId) {
  return designRef(runId, "final-state-report.yaml");
}

function wavePlanRef(runId) {
  return designRef(runId, "wave-plan.yaml");
}

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function stableSlug(value, fallback = "sweep-fix") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || fallback;
}

function titleFromSlug(value) {
  return stableSlug(value)
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function topicWaveFromSweepDesignWave(wave, context) {
  const authorityRefs = sweepDesignWaveAuthorityRefs(wave);
  return {
    wave_id: wave.wave_id,
    slug: stableSlug(wave.wave_id.replace(/^wave-/, ""), wave.wave_id),
    state: "candidate",
    primary_closure_goal: wave.scope,
    deps: Array.isArray(wave.dependencies) ? wave.dependencies : [],
    owner_domain: wave.owner_domain,
    parallelizable_after: [],
    selected: false,
    source_sweep_design: {
      run_id: context.runId,
      wave_plan_ref: context.wavePlanRef,
      final_state_report_ref: context.finalStateReportRef,
      source_revision_ledger_ref: context.sourceRevisionLedgerRef,
      source_inventory_ref: context.sourceInventoryRef,
      source_design_packet_refs: wave.source_design_packet_refs ?? [],
      design_auditor_result_refs: wave.design_auditor_result_refs ?? [],
      revision_ledger_entry_refs: wave.revision_ledger_entry_refs ?? [],
      finding_ids: wave.finding_ids ?? [],
      merged_cluster_ids: wave.merged_cluster_ids ?? [],
      merged_root_cause_keys: wave.merged_root_cause_keys ?? [],
      authority_owner: authorityRefs.length > 0 ? authorityRefs : wave.authority_owner,
      source_authority_refs: authorityRefs,
      source_authority_coverage_policy: "authority_owner_and_canonical_seams_must_cover_union_of_source_sweep_design_authority_refs",
      preflight_ref: wave.preflight_ref,
      validation_commands: wave.validation_commands ?? [],
      negative_checks: wave.negative_checks ?? [],
      drift_resistance_checks: wave.drift_resistance_checks ?? [],
      closeout_criteria: wave.closeout_criteria ?? [],
      blocked_gate_refs: wave.blocked_gate_refs ?? [],
      non_goals: wave.non_goals ?? [],
      consolidation_rationale: wave.consolidation_rationale ?? null,
      isolation_justification: wave.isolation_justification ?? null,
      source_design_auditor_result_ref: wave.source_design_auditor_result_ref ?? null,
    },
  };
}

function buildSweepFixReadme(topicId, title, context) {
  return `# ${title}

State: generated sweep-fix topic

This topic was materialized from a completed sweep design run. It is the implementation carrier for the deterministic waves produced by the LLM sweep-design process.

## Source

- Topic id: ${topicId}
- Sweep design run: ${context.runId}
- Final state report: ${context.finalStateReportRef}
- Wave plan: ${context.wavePlanRef}
- Wave count: ${context.waveCount}
- Source findings mutation: forbidden

## Contract

The source audit findings remain immutable evidence. This topic owns implementation planning and execution state only. Each wave in topic.yaml carries a source_sweep_design block, and sweep-fix-wave-catalog.yaml preserves the full wave-plan payload for review, packet creation, validation, and closeout.
`;
}

function buildSweepFixDesign(topicId, context) {
  return `# Sweep Fix Design

Topic: ${topicId}

## Product Shape

This topic is generated from sweep design, not hand-authored from a prose summary. The source run has already produced final finding outcomes and deterministic implementation waves.

## Authority Boundary

- Source findings are read-only input evidence.
- Implementation state belongs to this topic.
- Wave execution must use the wave's source_sweep_design provenance, validation commands, negative checks, and closeout criteria.
- No compatibility or legacy migration surface is implied by this generated topic.

## Source Artifacts

- Inventory: ${context.sourceInventoryRef}
- Final state report: ${context.finalStateReportRef}
- Revision ledger: ${context.sourceRevisionLedgerRef}
- Wave plan: ${context.wavePlanRef}
`;
}

function buildSweepFixPreflight(topicId, context) {
  return `# Preflight

Topic: ${topicId}

## Spec Status

- preflight-required

## Authority Owner

- Selected-wave authority owner is read from topic.yaml waves[].source_sweep_design.authority_owner.
- Topic-wide authority input is .nimi/spec/** plus each generated wave's source_sweep_design block.

## Work Type

- redesign

## Status

This topic contains ${context.waveCount} generated sweep-fix waves from sweep design run ${context.runId}.

## Admission Rule

Wave admission is handled by nimicoding topic. A generated wave may move from candidate to preflight_admitted only when its dependencies are closed and its packet/preflight evidence has been frozen from source_sweep_design.

## Stop Line

- Do not mutate source audit findings.
- Do not dispatch implementation from the sweep design run directory.
- Do not treat sweep-fix-wave-catalog.yaml as a parallel topic state; topic.yaml is the lifecycle registry.
- Do not drop validation commands, negative checks, drift checks, or closeout criteria when freezing packets.

## Human Gates

- Product, authority, semantic, or evidence forks must stop for human decision before the affected wave can close.
- All-mode execution may queue independent gates, but gated waves remain pending or blocked until the decision is recorded.

## Validation Commands

- node nimi-coding/bin/nimicoding.mjs topic validate ${topicId} --json
- node nimi-coding/bin/nimicoding.mjs topic validate graph ${topicId} --json
- node nimi-coding/bin/nimicoding.mjs topic goal ${topicId} --json is expected to emit a goal once a selected wave reaches preflight_admitted or a later execution-stage state.
`;
}

function buildSweepFixWaves(topicId, waves) {
  const rows = waves
    .map((wave) => {
      const deps = Array.isArray(wave.dependencies) && wave.dependencies.length > 0 ? wave.dependencies.join(", ") : "none";
      const findings = Array.isArray(wave.finding_ids) ? wave.finding_ids.length : 0;
      return `| ${wave.wave_id} | ${wave.owner_domain} | ${findings} | ${deps} |`;
    })
    .join("\n");
  return `# Waves

Topic: ${topicId}

The machine lifecycle registry lives in topic.yaml. Full source design context lives in sweep-fix-wave-catalog.yaml.

| Wave | Owner | Findings | Dependencies |
|---|---|---:|---|
${rows}
`;
}

function buildSweepFixCandidateWavePlan(topicId, context) {
  return `# Candidate Wave Plan

Topic: ${topicId}

The candidate wave set is generated from ${context.wavePlanRef}. There are ${context.waveCount} candidate implementation waves. The first executable wave should be selected by nimicoding topic after dependency checks and packet freeze, not by editing the source sweep-design artifacts.
`;
}

function buildSweepFixCloseout(topicId) {
  return `# Closeout

Topic: ${topicId}

## Wave-1 Closeout Requirements

- complete: selected wave has implementation result lineage, validation evidence, negative-check evidence, drift-resistance evidence, and source_sweep_design provenance.
- partial: selected wave has bounded residual work recorded with explicit downstream wave refs.
- blocked: selected wave has unresolved product, authority, semantic, or evidence gates.
- pending: selected wave is waiting on external evidence or human decision.

## Wave Closeout

Each wave must close with packet lineage, implementation result lineage, validation command evidence, negative check evidence, drift resistance evidence, and source_sweep_design provenance retained.

## Topic Closeout

The topic may close only after all generated waves are closed, retired by explicit supersession, or blocked with a recorded human decision.
`;
}

function buildSweepFixImplementationDoctrine(topicId) {
  return `# Implementation Doctrine

Topic: ${topicId}

Implementation must be hard-cut, complete, and authority-aligned. No pseudo-success, compatibility shim, legacy alias, app-local shadow truth, or partial closure is acceptable. Runtime/SDK/Desktop/Web boundaries remain governed by repository authority and by each wave's validation and closeout criteria.
`;
}

function buildSweepFixAdmissionChecklists(topicId) {
  return `# Admission Checklists

Topic: ${topicId}

## Before Admitting A Wave

- The wave exists in topic.yaml.
- All dependencies are closed.
- source_sweep_design includes design packet refs, auditor result refs, revision ledger refs, validation commands, negative checks, drift checks, and closeout criteria.
- Any blocked gate refs have recorded human decisions.
- A packet/preflight artifact has been frozen for this wave.
`;
}

function buildSweepFixManagerSessionProtocol(topicId) {
  return `# Manager Session Protocol

Topic: ${topicId}

1. Use nimicoding topic to select, admit, run, and close waves.
2. Read sweep-fix-wave-catalog.yaml and the selected wave's source_sweep_design before freezing a packet.
3. Stop for human confirmation only on product, authority, semantic, or evidence forks.
4. In all-mode execution, queue human decisions and continue independent waves; resolve queued decisions before closing affected waves.
`;
}

function buildSweepFixManagerPrompts(topicId) {
  return `# Manager Prompts

Topic: ${topicId}

## Packet Freeze Prompt

Use the selected topic wave and its source_sweep_design block to produce an implementation packet. Preserve the source design packet refs, auditor result refs, revision ledger refs, validation commands, negative checks, drift checks, closeout criteria, non-goals, and blocked gates. Do not mutate source findings.
`;
}

async function writeSweepFixTopicArtifacts(topicDir, topicId, title, context, waves) {
  await mkdir(path.join(topicDir, "sweep-fix"), { recursive: true });
  const catalog = {
    version: 1,
    kind: "sweep-fix-wave-catalog",
    topic_id: topicId,
    source_sweep_design_run_id: context.runId,
    source_inventory_ref: context.sourceInventoryRef,
    source_final_state_report_ref: context.finalStateReportRef,
    source_revision_ledger_ref: context.sourceRevisionLedgerRef,
    source_wave_plan_ref: context.wavePlanRef,
    source_findings_mutation_policy: "read_only_never_update_from_sweep_fix_topic",
    wave_count: waves.length,
    waves,
    created_at: context.createdAt,
  };
  const source = {
    version: 1,
    kind: "sweep-fix-topic-source",
    topic_id: topicId,
    source_sweep_design_run_id: context.runId,
    source_inventory_ref: context.sourceInventoryRef,
    source_final_state_report_ref: context.finalStateReportRef,
    source_revision_ledger_ref: context.sourceRevisionLedgerRef,
    source_wave_plan_ref: context.wavePlanRef,
    source_findings_mutation_policy: "read_only_never_update_from_sweep_fix_topic",
    final_state_complete: true,
    wave_count: waves.length,
    created_at: context.createdAt,
  };
  const files = new Map([
    ["README.md", buildSweepFixReadme(topicId, title, context)],
    ["design.md", buildSweepFixDesign(topicId, context)],
    ["preflight.md", buildSweepFixPreflight(topicId, context)],
    ["waves.md", buildSweepFixWaves(topicId, waves)],
    ["candidate-wave-plan.md", buildSweepFixCandidateWavePlan(topicId, context)],
    ["closeout.md", buildSweepFixCloseout(topicId)],
    ["implementation-doctrine.md", buildSweepFixImplementationDoctrine(topicId)],
    ["admission-checklists.md", buildSweepFixAdmissionChecklists(topicId)],
    ["manager-session-protocol.md", buildSweepFixManagerSessionProtocol(topicId)],
    ["manager-prompts.md", buildSweepFixManagerPrompts(topicId)],
    ["sweep-fix/source.yaml", YAML.stringify(source)],
    ["sweep-fix/wave-catalog.yaml", YAML.stringify(catalog)],
  ]);
  for (const [fileName, contents] of files.entries()) {
    await writeFile(path.join(topicDir, fileName), contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  }
}

async function loadInventory(projectRoot, runId) {
  return assertDesignArtifact(projectRoot, inventoryRef(runId), "sweep-design-inventory", "inventory");
}

export async function runFixTopic(projectRoot, options) {
  const run = requireRunId(options);
  if (!run.ok) return run;
  const inventory = await loadInventory(projectRoot, run.runId);
  if (!inventory.ok) return inventory;
  const finalReport = await assertDesignArtifact(projectRoot, finalStateReportRef(run.runId), "sweep-design-final-state-report", "final state report");
  if (!finalReport.ok) return finalReport;
  if (finalReport.value.complete !== true) {
    return inputError("nimicoding sweep design fix-topic refused: final-state-report is not complete.\n");
  }
  const wavePlan = await assertDesignArtifact(projectRoot, wavePlanRef(run.runId), "sweep-design-wave-plan", "wave plan");
  if (!wavePlan.ok) return wavePlan;
  const waves = Array.isArray(wavePlan.value.waves) ? wavePlan.value.waves : [];
  if (waves.length === 0) return inputError("nimicoding sweep design fix-topic refused: wave-plan contains no implementation waves.\n");
  if (wavePlan.value.wave_count !== waves.length) {
    return inputError("nimicoding sweep design fix-topic refused: wave-plan wave_count does not match waves[].\n");
  }
  const waveIds = new Set();
  for (const wave of waves) {
    if (waveIds.has(wave.wave_id)) return inputError(`nimicoding sweep design fix-topic refused: duplicate wave id ${wave.wave_id}.\n`);
    waveIds.add(wave.wave_id);
  }
  const slug = stableSlug(options.slug ?? `sweep-fix-${run.runId}`, `sweep-fix-${run.runId}`);
  const title = options.title ?? titleFromSlug(slug);
  const now = options.verifiedAt ? new Date(options.verifiedAt) : new Date();
  if (Number.isNaN(now.getTime())) return inputError("nimicoding sweep design fix-topic refused: --verified-at must be an ISO timestamp.\n");
  const created = await createTopic(projectRoot, {
    slug,
    title,
    now,
    mode: "landed",
    posture: "no_legacy_hard_cut",
    designPolicy: "complete_contract_first",
    parallelTruth: "forbidden",
    layering: "ontology",
    risk: "high",
    applicability: "complex_remediation",
    justification: `sweep design run ${run.runId} produced a complete final-state report and ${waves.length} deterministic implementation waves`,
    executionMode: "manager_worker_auditor",
  });
  if (!created.ok) return created;
  const context = {
    runId: run.runId,
    sourceInventoryRef: inventory.ref,
    finalStateReportRef: finalReport.ref,
    sourceRevisionLedgerRef: wavePlan.value.source_revision_ledger_ref ?? finalReport.value.source_revision_ledger_ref ?? ledgerRef(run.runId),
    wavePlanRef: wavePlan.ref,
    waveCount: waves.length,
    createdAt: options.verifiedAt ?? nowIso(),
  };
  const topicWaves = waves.map((wave) => topicWaveFromSweepDesignWave(wave, context));
  for (const topicWave of topicWaves) {
    const added = await addWaveToTopic(projectRoot, created.topicId, topicWave);
    if (!added.ok) return added;
  }
  await writeSweepFixTopicArtifacts(created.topicDir, created.topicId, title, context, waves);
  let admittedWaveId = null;
  let finalTopicRef = created.topicRef;
  let finalTopicState = created.state;
  const admitWaveId = options.admitWaveId ?? (options.admitFirstWave ? topicWaves.find((wave) => wave.deps.length === 0)?.wave_id : null);
  if (admitWaveId) {
    if (!waveIds.has(admitWaveId)) return inputError(`nimicoding sweep design fix-topic refused: --admit-wave-id does not exist in the generated wave plan: ${admitWaveId}.\n`);
    const selected = await selectWaveInTopic(projectRoot, created.topicId, admitWaveId);
    if (!selected.ok) return selected;
    const admitted = await admitWaveInTopic(projectRoot, created.topicId, admitWaveId);
    if (!admitted.ok) return admitted;
    admittedWaveId = admitted.waveId;
    finalTopicRef = admitted.topicRef;
    finalTopicState = admitted.state;
  }
  return {
    ok: true,
    exitCode: 0,
    runId: run.runId,
    topicId: created.topicId,
    topicRef: finalTopicRef,
    state: finalTopicState,
    sourceRef: toPortableRelativePath(path.join(finalTopicRef, "sweep-fix", "source.yaml")),
    waveCatalogRef: toPortableRelativePath(path.join(finalTopicRef, "sweep-fix", "wave-catalog.yaml")),
    wavePlanRef: wavePlan.ref,
    waveCount: waves.length,
    materializedWaveIds: topicWaves.map((wave) => wave.wave_id),
    admittedWaveId,
  };
}
