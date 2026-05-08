import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { readTextIfFile } from "./fs-helpers.mjs";
import {
  packetAuthorityCoverage,
  packetAuthorityCoverageError,
  sourceSweepDesignAuthorityRefs,
} from "./topic-authority-coverage.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

function toPortableRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function parsePacketDraft(text) {
  if (!text) return null;
  if (text.startsWith("---\n")) {
    const closing = text.indexOf("\n---\n", 4);
    if (closing !== -1) {
      return parseYamlText(text.slice(4, closing));
    }
  }
  return parseYamlText(text);
}

function nonEmptyStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
}

function singleStringList(value) {
  return typeof value === "string" && value.length > 0 ? [value] : nonEmptyStringArray(value);
}

function missingSweepDraftFields(wave) {
  const source = wave?.source_sweep_design;
  if (!source || typeof source !== "object") {
    return ["source_sweep_design"];
  }
  const missing = [];
  if (singleStringList(source.authority_owner).length === 0) missing.push("source_sweep_design.authority_owner");
  if (nonEmptyStringArray(source.validation_commands).length === 0) missing.push("source_sweep_design.validation_commands");
  if (nonEmptyStringArray(source.negative_checks).length === 0) missing.push("source_sweep_design.negative_checks");
  if (nonEmptyStringArray(source.closeout_criteria).length === 0) missing.push("source_sweep_design.closeout_criteria");
  if (nonEmptyStringArray(source.source_design_packet_refs).length === 0) missing.push("source_sweep_design.source_design_packet_refs");
  if (nonEmptyStringArray(source.design_auditor_result_refs).length === 0) missing.push("source_sweep_design.design_auditor_result_refs");
  if (nonEmptyStringArray(source.revision_ledger_entry_refs).length === 0) missing.push("source_sweep_design.revision_ledger_entry_refs");
  if (nonEmptyStringArray(source.blocked_gate_refs).length > 0) missing.push("source_sweep_design.blocked_gate_refs_empty");
  return missing;
}

async function maybeGenerateSweepFixDraft(projectRoot, loaded, wave) {
  const missing = missingSweepDraftFields(wave);
  if (missing.length > 0) {
    return {
      ok: false,
      reasonCode: missing.includes("source_sweep_design.blocked_gate_refs_empty")
        ? "admitted_wave_has_blocked_gate_refs"
        : missing.includes("source_sweep_design.validation_commands")
          ? "admitted_wave_missing_validation_commands"
          : "admitted_wave_requires_packet",
      missing,
    };
  }

  const draftPath = path.join(loaded.topicDir, `draft-${wave.wave_id}-implementation.yaml`);
  if (await readTextIfFile(draftPath) !== null) {
    return {
      ok: false,
      reasonCode: "admitted_wave_has_ambiguous_draft_packets",
    };
  }

  const source = wave.source_sweep_design;
  const sourceAuthorityRefs = sourceSweepDesignAuthorityRefs(source);
  const packet = {
    packet_id: `${wave.wave_id}-implementation`,
    topic_id: loaded.topicId,
    wave_id: wave.wave_id,
    packet_kind: "implementation",
    status: "draft",
    authority_owner: sourceAuthorityRefs.length > 0 ? sourceAuthorityRefs : singleStringList(source.authority_owner),
    canonical_seams: [
      ...(sourceAuthorityRefs.length > 0 ? sourceAuthorityRefs : singleStringList(source.authority_owner)),
      ...nonEmptyStringArray(source.source_design_packet_refs),
      ...nonEmptyStringArray(source.design_auditor_result_refs),
      ...nonEmptyStringArray(source.revision_ledger_entry_refs),
    ],
    forbidden_shortcuts: nonEmptyStringArray(loaded.topic?.forbidden_shortcuts),
    acceptance_invariants: [
      ...nonEmptyStringArray(source.closeout_criteria),
      ...nonEmptyStringArray(source.validation_commands).map((command) => `validation command required: ${command}`),
    ],
    negative_tests: nonEmptyStringArray(source.negative_checks),
    reopen_conditions: [
      ...nonEmptyStringArray(source.drift_resistance_checks),
      "source_sweep_design provenance changes require packet regeneration",
    ],
    source_sweep_design_run_id: source.run_id ?? null,
    source_authority_refs: sourceAuthorityRefs,
    source_authority_coverage_policy: "authority_owner_and_canonical_seams_cover_union_of_source_sweep_design_authority_refs",
    source_design_packet_refs: nonEmptyStringArray(source.source_design_packet_refs),
    design_auditor_result_refs: nonEmptyStringArray(source.design_auditor_result_refs),
    revision_ledger_entry_refs: nonEmptyStringArray(source.revision_ledger_entry_refs),
    validation_commands: nonEmptyStringArray(source.validation_commands),
    closeout_criteria: nonEmptyStringArray(source.closeout_criteria),
  };
  if (packet.forbidden_shortcuts.length === 0) {
    return {
      ok: false,
      reasonCode: "admitted_wave_requires_packet",
      missing: ["topic.forbidden_shortcuts"],
    };
  }
  await writeFile(draftPath, YAML.stringify(packet), "utf8");
  return {
    ok: true,
    packet,
    draftRef: toPortableRelativePath(path.relative(projectRoot, draftPath)),
    generated: true,
  };
}

export async function findUniqueFreezableDraftPacket(projectRoot, loaded, wave, authority) {
  const matches = [];
  for (const entry of await readdir(loaded.topicDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^draft.*\.(ya?ml|md)$/u.test(entry.name.toLowerCase())) continue;
    const draftPath = path.join(loaded.topicDir, entry.name);
    const packet = parsePacketDraft(await readTextIfFile(draftPath) ?? "");
    if (!packet || typeof packet !== "object") continue;
    if (packet.topic_id !== loaded.topicId || packet.wave_id !== wave.wave_id) continue;
    if (!authority.packetFreezeAllowedStatuses.includes(packet.status)) continue;
    if (authority.packetRequiredFields.some((field) => {
      const value = packet[field];
      return value == null || value === "" || (Array.isArray(value) && value.length === 0);
    })) continue;
    const coverage = packetAuthorityCoverage(packet, wave);
    if (!coverage.ok) {
      return {
        ok: false,
        reasonCode: "admitted_wave_packet_authority_coverage_incomplete",
        missing: [
          ...coverage.missingAuthorityOwnerRefs.map((ref) => `authority_owner:${ref}`),
          ...coverage.missingCanonicalSeamRefs.map((ref) => `canonical_seams:${ref}`),
        ],
        error: packetAuthorityCoverageError(coverage),
      };
    }
    matches.push({
      packet,
      draftRef: toPortableRelativePath(path.relative(projectRoot, draftPath)),
    });
  }
  if (matches.length === 1) {
    return { ok: true, ...matches[0] };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reasonCode: "admitted_wave_has_ambiguous_draft_packets",
    };
  }
  return maybeGenerateSweepFixDraft(projectRoot, loaded, wave);
}
