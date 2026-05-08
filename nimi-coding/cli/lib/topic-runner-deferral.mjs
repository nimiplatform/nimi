import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function projectRef(projectRoot, absolutePath) {
  return toPortablePath(path.relative(projectRoot, absolutePath));
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function isTerminalWave(wave) {
  return ["closed", "retired", "superseded"].includes(wave?.state);
}

function getTopicWaves(topic) {
  return Array.isArray(topic?.waves) ? topic.waves : [];
}

function findDeferredBlockerNextWave(topic, blockedWaveId) {
  const waves = getTopicWaves(topic);
  const terminalIds = new Set(waves.filter(isTerminalWave).map((wave) => wave.wave_id));
  const ready = waves.filter((wave) => {
    if (wave.wave_id === blockedWaveId) return false;
    if (isTerminalWave(wave)) return false;
    if (!["candidate", "preflight_draft"].includes(wave.state)) return false;
    const deps = Array.isArray(wave.deps) ? wave.deps : [];
    if (deps.includes(blockedWaveId)) return false;
    return deps.every((dep) => terminalIds.has(dep));
  });
  return ready.length > 0 ? ready[0] : null;
}

function decisionText(decision) {
  return JSON.stringify({
    reason_code: decision?.reason_code,
    recommended_action: decision?.recommended_action,
    recommended_decision: decision?.recommended_decision,
    recommendation_rationale: decision?.recommendation_rationale,
    blocking_checks: decision?.blocking_checks ?? [],
  }).toLowerCase();
}

function isDisallowedGlobalBlocker(decision) {
  const text = decisionText(decision);
  return [
    "global topic",
    "global_topic",
    "topic contract",
    "topic_contract",
    "contract-changing",
    "contract changing",
    "source audit",
    "source_audit",
    "source sweep",
    "source_sweep_design",
    "sweep-design artifact",
    "lowered gate",
    "lower gate",
    "destructive evidence deletion",
    "evidence deletion",
    "product semantics",
    "semantic fork",
    "authority/scope decision",
    "explicit human decision",
  ].some((pattern) => text.includes(pattern));
}

function isDisallowedWaveBlocker(wave) {
  const text = JSON.stringify({
    owner_domain: wave?.owner_domain,
    goal: wave?.goal,
    blocker_scope: wave?.blocker_scope,
    source_sweep_design: wave?.source_sweep_design,
  }).toLowerCase();
  if (
    Array.isArray(wave?.source_sweep_design?.blocked_gate_refs) &&
    wave.source_sweep_design.blocked_gate_refs.length > 0
  ) {
    return true;
  }
  return [
    "global topic",
    "global_topic",
    "topic contract",
    "topic_contract",
    "contract-changing",
    "contract changing",
    "lowered gate",
    "lower gate",
    "destructive evidence deletion",
    "product semantics",
    "semantic fork",
  ].some((pattern) => text.includes(pattern));
}

function isDeferrableLocalWaveDecision(topic, decision) {
  if (!decision || decision.stop_class !== "blocked") {
    return { ok: false, reason: "decision_not_blocked" };
  }
  if (decision.recommended_action !== "open_remediation") {
    return { ok: false, reason: "not_open_remediation" };
  }
  const wave = getTopicWaves(topic).find((entry) => entry.wave_id === decision.wave_id);
  if (!wave) {
    return { ok: false, reason: "blocked_wave_not_found" };
  }
  if (wave.state !== "needs_revision") {
    return { ok: false, reason: "blocked_wave_not_needs_revision" };
  }
  if (isDisallowedGlobalBlocker(decision) || isDisallowedWaveBlocker(wave)) {
    return { ok: false, reason: "global_or_contract_blocker" };
  }
  const nextWave = findDeferredBlockerNextWave(topic, wave.wave_id);
  if (!nextWave) {
    return { ok: false, reason: "no_independent_ready_wave" };
  }
  return { ok: true, wave, nextWave };
}

function evidenceFlagPattern(name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*:\\s*${value}`, "i");
}

function hasFalseEvidenceFlag(text, names) {
  return names.some((name) => evidenceFlagPattern(name, "false").test(text));
}

function hasTrueEvidenceFlag(text, names) {
  return names.some((name) => evidenceFlagPattern(name, "true").test(text));
}

function cleanStructuredListItem(value) {
  return String(value ?? "")
    .replace(/\s+#.*$/u, "")
    .trim()
    .replace(/^[-\s]+/u, "")
    .replace(/^["'`]+|["'`]+$/gu, "")
    .trim();
}

function parseInlineStructuredList(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map(cleanStructuredListItem)
      .filter(Boolean);
  }
  return [cleanStructuredListItem(trimmed)].filter(Boolean);
}

function extractStructuredListValues(text, fieldNames) {
  const escapedNames = fieldNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fieldPattern = new RegExp(`^\\s*(?:${escapedNames.join("|")})\\s*:\\s*(.*)$`, "iu");
  const lines = text.split(/\r?\n/u);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(fieldPattern);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) {
      values.push(...parseInlineStructuredList(inline));
      continue;
    }
    const baseIndent = line.match(/^\s*/u)?.[0].length ?? 0;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const nextLine = lines[scan];
      if (!nextLine.trim()) continue;
      const nextIndent = nextLine.match(/^\s*/u)?.[0].length ?? 0;
      const item = nextLine.match(/^\s*-\s+(.+)$/u);
      if (item) {
        values.push(cleanStructuredListItem(item[1]));
        continue;
      }
      if (nextIndent <= baseIndent && /^\s*\S/u.test(nextLine)) break;
      if (/^\s*[a-zA-Z0-9_.-]+\s*:/u.test(nextLine)) break;
    }
  }
  return [...new Set(values.filter(Boolean))];
}

function isConcreteAuthorityRef(value) {
  const ref = cleanStructuredListItem(value);
  if (!ref) return false;
  if (path.isAbsolute(ref)) return false;
  if (/[<>{}]|\.\.\./u.test(ref)) return false;
  if (/\s/u.test(ref)) return false;
  if (!ref.includes("/")) return false;
  if (/(^|[/_.-])(tbd|todo|placeholder|unknown|none|null)([/_.-]|$)/iu.test(ref)) return false;
  if (ref.startsWith(".nimi/local/audit/") || ref.startsWith(".nimi/local/sweep-design/")) return false;
  return /\.(?:md|ya?ml|json|toml)$/iu.test(ref);
}

function extractConcreteMissingAuthorityRefs(text) {
  return extractStructuredListValues(text, [
    "missing_authority_refs",
    "missing_authority_owner_refs",
    "missing_canonical_seam_refs",
  ]).filter(isConcreteAuthorityRef);
}

function evidenceDeclaresDisallowedBlocker(text) {
  const normalized = text.toLowerCase();
  if (
    hasTrueEvidenceFlag(normalized, [
      "source_audit_mutated",
      "source_audit_findings_mutated",
      "source_sweep_design_mutated",
      "source_sweep_design_artifacts_mutated",
      "lowered_gate",
      "lowered_gates",
      "requires_lowered_gate",
      "topic_global_contract_change_required",
      "topic_contract_change_required",
      "global_contract_change_required",
      "requires_global_contract_change",
      "source_evidence_mutated",
      "source_evidence_change_required",
      "requires_source_evidence_change",
      "product_semantic_ambiguity",
      "unresolved_authority_scope_gate_product_semantic_ambiguity",
      "unresolved_authority_conflict",
      "authority_conflict",
      "implementation_conflict",
      "destructive_evidence_deletion",
      "destructive_evidence_deletion_required",
      "requires_destructive_evidence_deletion",
      "explicit_human_product_decision_required",
      "explicit_human_decision_packet",
      "product_semantic_decision_required",
      "requires_product_semantic_decision",
      "explicit_human_decision_required",
      "requires_explicit_human_decision",
    ])
  ) {
    return true;
  }
  const disallowedPatterns = [
    "lowered gate required",
    "lowered validation gate",
    "global topic contract change",
    "topic contract change required",
    "source evidence change required",
    "source audit finding mutation required",
    "source sweep-design artifact mutation required",
    "destructive evidence deletion",
    "product semantics fork",
    "semantic fork",
    "unresolved authority conflict",
    "authority conflict",
    "explicit human decision",
  ];
  return normalized.split(/\r?\n\s*\r?\n/u).some((block) => {
    if (!disallowedPatterns.some((pattern) => block.includes(pattern))) {
      return false;
    }
    return !/\b(no|not|false|without)\b|does not|do not|isn't|is not|aren't|are not/u.test(block);
  });
}

function evidenceDeclaresBroadAmbiguity(text) {
  return hasTrueEvidenceFlag(text.toLowerCase(), [
    "unresolved_authority_scope_gate_product_semantic_ambiguity",
  ]);
}

function evidenceHasPositiveLocalOnlyProof(text) {
  return hasTrueEvidenceFlag(text.toLowerCase(), [
    "local_packet_authority_scope_remediation_only",
  ]);
}

function evidenceHasNoProductSemanticAmbiguityProof(text) {
  return hasFalseEvidenceFlag(text.toLowerCase(), [
    "product_semantic_ambiguity",
  ]);
}

function missingRequiredFalseEvidenceFlagReason(text) {
  const normalized = text.toLowerCase();
  const required = [
    {
      names: ["source_audit_mutated", "source_audit_findings_mutated"],
      reason: "missing_source_audit_non_mutation_evidence",
    },
    {
      names: ["source_sweep_design_mutated", "source_sweep_design_artifacts_mutated"],
      reason: "missing_source_sweep_design_non_mutation_evidence",
    },
    {
      names: ["lowered_gate", "lowered_gates", "requires_lowered_gate"],
      reason: "missing_no_lowered_gate_evidence",
    },
    {
      names: [
        "topic_global_contract_change_required",
        "topic_contract_change_required",
        "global_contract_change_required",
        "requires_global_contract_change",
      ],
      reason: "missing_no_global_contract_change_evidence",
    },
    {
      names: ["source_evidence_mutated", "source_evidence_change_required", "requires_source_evidence_change"],
      reason: "missing_no_source_evidence_change_evidence",
    },
    {
      names: [
        "destructive_evidence_deletion",
        "destructive_evidence_deletion_required",
        "requires_destructive_evidence_deletion",
      ],
      reason: "missing_no_destructive_evidence_deletion_evidence",
    },
    {
      names: [
        "explicit_human_product_decision_required",
        "explicit_human_decision_required",
        "explicit_human_decision_packet",
        "requires_explicit_human_decision",
        "product_semantic_decision_required",
        "requires_product_semantic_decision",
      ],
      reason: "missing_no_explicit_human_product_decision_evidence",
    },
  ];
  const missing = required.find((entry) => !hasFalseEvidenceFlag(normalized, entry.names));
  return missing?.reason ?? null;
}

function evidenceDeclaresLocalPacketAuthorityScopeRemediation(text) {
  const normalized = text.toLowerCase();
  return [
    "required_remediation: local wave packet authority/scope remediation only",
    "local wave packet authority/scope remediation only",
    "local packet authority/scope remediation",
    "authority/scope mismatch in the packet metadata",
    "authority/scope mismatch in packet metadata",
    "packet authority omission",
    "packet metadata omission",
    "regenerate or remediate the topic-local implementation packet",
    "regenerate or remediate the topic-local",
  ].some((pattern) => normalized.includes(pattern));
}

function resultVerifiedAtMs(text) {
  const match = text.match(/\bverified_at\s*:\s*["']?([^"'\n\r]+)["']?/iu);
  if (!match) return Number.NaN;
  const parsed = Date.parse(match[1].trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isNonDeferrableEvidenceReason(reason) {
  return [
    "blocking_result_declares_non_deferrable_gate",
    "unresolved_ambiguity_not_local_deferrable",
  ].includes(reason);
}

async function evaluateDeferrableLocalWaveEvidence(projectRoot, resultRefs) {
  if (resultRefs.length === 0) {
    return { ok: false, reason: "missing_blocking_result_evidence" };
  }
  const candidates = [];
  for (const [index, ref] of resultRefs.entries()) {
    const text = await readFile(path.join(projectRoot, ref), "utf8");
    if (!/verdict:\s*NEEDS_REVISION/i.test(text)) continue;
    const evidence = evaluateDeferrableLocalWaveEvidenceText(text);
    candidates.push({
      evidence,
      index,
      ref,
      verifiedAtMs: resultVerifiedAtMs(text),
    });
  }
  if (candidates.length === 0) {
    return { ok: false, reason: "missing_blocking_result_evidence" };
  }
  const nonDeferrable = candidates.find((candidate) => (
    !candidate.evidence.ok && isNonDeferrableEvidenceReason(candidate.evidence.reason)
  ));
  if (nonDeferrable) {
    return nonDeferrable.evidence;
  }
  candidates.sort((left, right) => {
    const leftTime = Number.isFinite(left.verifiedAtMs) ? left.verifiedAtMs : -Infinity;
    const rightTime = Number.isFinite(right.verifiedAtMs) ? right.verifiedAtMs : -Infinity;
    return rightTime - leftTime || right.index - left.index;
  });
  const latest = candidates[0];
  return latest.evidence.ok
    ? { ...latest.evidence, resultRefs: [latest.ref] }
    : latest.evidence;
}

function evaluateDeferrableLocalWaveEvidenceText(text) {
  if (!/verdict:\s*NEEDS_REVISION/i.test(text)) {
    return { ok: false, reason: "blocking_result_not_needs_revision" };
  }
  const missingFalseFlagReason = missingRequiredFalseEvidenceFlagReason(text);
  if (missingFalseFlagReason) {
    return { ok: false, reason: missingFalseFlagReason };
  }
  if (evidenceDeclaresDisallowedBlocker(text)) {
    return { ok: false, reason: "blocking_result_declares_non_deferrable_gate" };
  }
  if (evidenceDeclaresBroadAmbiguity(text)) {
    return { ok: false, reason: "unresolved_ambiguity_not_local_deferrable" };
  }
  if (!evidenceHasPositiveLocalOnlyProof(text)) {
    return { ok: false, reason: "missing_structured_local_only_evidence" };
  }
  if (!evidenceHasNoProductSemanticAmbiguityProof(text)) {
    return { ok: false, reason: "missing_product_semantic_non_ambiguity_evidence" };
  }
  if (!evidenceDeclaresLocalPacketAuthorityScopeRemediation(text)) {
    return { ok: false, reason: "missing_local_wave_remediation_evidence" };
  }
  const missingAuthorityRefs = extractConcreteMissingAuthorityRefs(text);
  if (missingAuthorityRefs.length === 0) {
    return { ok: false, reason: "missing_concrete_missing_authority_refs" };
  }
  return { ok: true, missingAuthorityRefs };
}

async function collectWaveResultRefs(projectRoot, loaded, waveId) {
  const files = await readdir(loaded.topicDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("result-") && name.includes(waveId))
    .sort()
    .map((name) => projectRef(projectRoot, path.join(loaded.topicDir, name)));
}

async function writeDeferredBlockerArtifact(
  projectRoot,
  loaded,
  decision,
  decisionRef,
  nextWave,
  resultRefs,
  evidence,
  recordedAt,
) {
  const waveId = decision.wave_id;
  const reasonCode = decision.reason_code ?? "local_wave_blocker";
  const blockerPath = path.join(
    loaded.topicDir,
    `deferred-blocker-${safeSegment(waveId)}-${safeSegment(reasonCode)}.md`,
  );
  const blocker = {
    deferred_blocker_id: `deferred-${waveId}-${safeSegment(reasonCode)}`,
    topic_id: loaded.topicId,
    wave_id: waveId,
    status: "active",
    deferrable_scope: "local_wave",
    reason_code: reasonCode,
    stop_class: decision.stop_class,
    recommended_action: decision.recommended_action,
    decision_ref: decisionRef,
    blocking_result_refs: resultRefs,
    missing_authority_refs: evidence.missingAuthorityRefs,
    next_wave_id: nextWave.wave_id,
    required_manager_decision: decision.recommended_decision ?? "remediate selected wave before true-close",
    remediation_summary:
      decision.recommendation_rationale ??
      "Local wave remediation is deferred so independent dependency-ready waves can continue.",
    deferral_rationale:
      "The blocker is scoped to this wave, no global contract/source-evidence/lowered-gate change is requested, and an independent dependency-ready wave exists.",
    source_audit_findings_mutated: false,
    source_sweep_design_artifacts_mutated: false,
    product_semantic_ambiguity: false,
    local_packet_authority_scope_remediation_only: true,
    recorded_at: recordedAt,
  };
  await writeFile(
    blockerPath,
    `---\n${YAML.stringify(blocker).trimEnd()}\n---\n\n# Deferred Blocker ${waveId}\n`,
    "utf8",
  );
  return projectRef(projectRoot, blockerPath);
}

export async function deferLocalWaveBlocker(projectRoot, loaded, decision, decisionRef, recordedAt) {
  const deferrable = isDeferrableLocalWaveDecision(loaded.topic, decision);
  if (!deferrable.ok) {
    return deferrable;
  }
  const resultRefs = await collectWaveResultRefs(projectRoot, loaded, deferrable.wave.wave_id);
  const evidence = await evaluateDeferrableLocalWaveEvidence(projectRoot, resultRefs);
  if (!evidence.ok) {
    return evidence;
  }

  const blockerRef = await writeDeferredBlockerArtifact(
    projectRoot,
    loaded,
    decision,
    decisionRef,
    deferrable.nextWave,
    evidence.resultRefs,
    evidence,
    recordedAt,
  );
  const waves = getTopicWaves(loaded.topic).map((wave) => ({
    ...wave,
    selected: wave.wave_id === deferrable.nextWave.wave_id,
  }));
  loaded.topic.waves = waves;
  loaded.topic.selected_next_target = deferrable.nextWave.wave_id;
  loaded.topic.last_transition_at = recordedAt.slice(0, 10);
  loaded.topic.last_transition_reason = `deferred_local_blocker_${deferrable.wave.wave_id}`;
  await writeFile(loaded.topicYamlPath, YAML.stringify(loaded.topic), "utf8");

  return {
    ok: true,
    blockerRef,
    wave: deferrable.wave,
    nextWave: deferrable.nextWave,
  };
}
