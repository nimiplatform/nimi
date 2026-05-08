import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { loadTopicRuntimeContracts } from "./contracts.mjs";

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}

function normalizeAuthorityConvergencePolicy(parsed) {
  const policy = parsed?.authority_convergence_policy ?? {};
  const postUpdateReview = policy.post_update_review ?? {};
  return {
    triggerPacketKinds: stringList(policy.trigger_packet_kinds),
    triggerRefPrefixes: stringList(policy.trigger_ref_prefixes),
    triggerWorkTypes: stringList(policy.trigger_topic_fields?.work_type),
    requiredResultKind: typeof policy.required_result?.result_kind === "string"
      ? policy.required_result.result_kind
      : "audit",
    passVerdict: typeof policy.required_result?.pass_verdict === "string"
      ? policy.required_result.pass_verdict
      : "PASS",
    blockedVerdicts: stringList(policy.blocked_verdicts),
    postUpdateReview: {
      triggerPacketKinds: stringList(postUpdateReview.trigger_packet_kinds),
      triggerRefPrefixes: stringList(postUpdateReview.trigger_ref_prefixes),
      requiredResultKind: typeof postUpdateReview.required_result?.result_kind === "string"
        ? postUpdateReview.required_result.result_kind
        : "judgement",
      passVerdict: typeof postUpdateReview.required_result?.pass_verdict === "string"
        ? postUpdateReview.required_result.pass_verdict
        : "PASS",
    },
  };
}

export async function loadAuthorityConvergencePolicy(projectRoot) {
  const loaded = await loadTopicRuntimeContracts(projectRoot);
  return normalizeAuthorityConvergencePolicy(loaded.authorityConvergencePolicy.data);
}

export function needsAuthorityConvergenceAudit(topic, packet, policy) {
  if (policy.triggerPacketKinds.includes(String(packet.packet_kind ?? ""))) return true;
  if (policy.triggerWorkTypes.includes(String(topic.work_type ?? ""))) return true;
  const refs = [
    ...stringList(packet.authority_owner),
    ...stringList(packet.canonical_seams),
  ];
  return refs.some((ref) => policy.triggerRefPrefixes.some((prefix) => (
    ref === prefix.slice(0, -1) || ref.startsWith(prefix) || ref.includes(prefix)
  )));
}

export function needsPostUpdateReview(packet, policy) {
  const reviewPolicy = policy.postUpdateReview ?? {};
  if (reviewPolicy.triggerPacketKinds?.includes(String(packet.packet_kind ?? ""))) return true;
  const refs = [
    ...stringList(packet.authority_owner),
    ...stringList(packet.canonical_seams),
  ];
  return refs.some((ref) => reviewPolicy.triggerRefPrefixes?.some((prefix) => (
    ref === prefix.slice(0, -1) || ref.startsWith(prefix) || ref.includes(prefix)
  )));
}

export function latestResultOfKind(results, kind) {
  return [...results].reverse().find((entry) => entry.result?.result_kind === kind) ?? null;
}

function verifiedAtMs(resultEntry) {
  const value = resultEntry?.result?.verified_at;
  if (typeof value !== "string" || value.length === 0) return Number.NaN;
  return Date.parse(value);
}

export function hasFreshPassingPostUpdateReview(results, implementationResult, policy) {
  const reviewPolicy = policy.postUpdateReview ?? {};
  const implementationVerifiedAt = verifiedAtMs(implementationResult);
  if (!Number.isFinite(implementationVerifiedAt)) return false;
  return [...results].reverse().some((entry) => (
    entry.result?.result_kind === reviewPolicy.requiredResultKind
    && entry.result?.verdict === reviewPolicy.passVerdict
    && verifiedAtMs(entry) >= implementationVerifiedAt
  ));
}

function hasPlaceholder(value) {
  return /<[^>]+>/u.test(String(value ?? ""));
}

function concreteRef(value) {
  return typeof value === "string"
    && value.length > 0
    && !hasPlaceholder(value)
    && !path.isAbsolute(value)
    && !value.includes("..");
}

function refsAreConcrete(values) {
  return stringList(values).length > 0 && stringList(values).every(concreteRef);
}

async function readJsonRef(projectRoot, ref) {
  if (!concreteRef(ref)) return null;
  try {
    return JSON.parse(await readFile(path.join(projectRoot, ref), "utf8"));
  } catch {
    return null;
  }
}

function extractTopicValidationEvidenceRefs(sourceText, waveId) {
  const refs = new Set();
  const pattern = new RegExp(`\\.nimi/topics/[^\\s)\\]'"<>]+/evidence-validation-${waveId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^\\s)\\]'"<>]+\\.json`, "gu");
  for (const match of sourceText.matchAll(pattern)) {
    refs.add(match[0]);
  }
  return [...refs];
}

function extractPacketIdsFromSource(sourceText) {
  const ids = new Set();
  const patterns = [
    /^\s*packet_id:\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?\s*$/gimu,
    /\bpacket_id\s*[:=]\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?/gimu,
    /\bpacket\s+id\s*[:=]\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?/gimu,
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

function declaresPostUpdateAmbiguity(sourceText) {
  const ambiguityPattern = /\b(authority|scope|gate|product|semantic)\s+(ambiguity|ambiguous|fork|blocked|blocker|change required)\b/iu;
  const normalized = sourceText.replace(/\s+/gu, " ");
  for (const match of normalized.matchAll(new RegExp(ambiguityPattern.source, "giu"))) {
    const preceding = normalized.slice(0, match.index).toLowerCase();
    if (/\b(no|none|without)\b[^.!?\n]{0,120}$/u.test(preceding)) {
      continue;
    }
    return true;
  }
  return false;
}

function sourceContainsNegatedTerms(sourceText, terms) {
  const normalized = sourceText.replace(/\s+/gu, " ").toLowerCase();
  return terms.every((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\\ /gu, "\\s+");
    return new RegExp(`\\b(no|not|without)\\b[^.!?]{0,160}\\b${escaped}\\b`, "iu").test(normalized)
      || new RegExp(`\\b${escaped}\\b[^.!?]{0,80}\\b(not\\s+mutated|not\\s+introduced)\\b`, "iu").test(normalized);
  });
}

function hasRequiredPostUpdateNegativeDeclarations(sourceText) {
  return sourceContainsNegatedTerms(sourceText, [
    "source audit findings",
    "source sweep-design artifacts",
    "pseudo-success",
    "fallback success",
    "compatibility shim",
    "dual-read",
    "dual-write",
  ]);
}

async function latestWorkerPromptPacketId(topicDir, packetEntries) {
  const packetIds = new Set(packetEntries.map((entry) => entry.packet?.packet_id).filter(Boolean));
  if (!topicDir || packetIds.size === 0) return null;
  let entries = [];
  try {
    entries = await readdir(topicDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const prompts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("prompt-") || !entry.name.endsWith("-worker.md")) continue;
    const packetId = entry.name.slice("prompt-".length, -"-worker.md".length);
    if (!packetIds.has(packetId)) continue;
    const promptPath = path.join(topicDir, entry.name);
    try {
      const promptStat = await stat(promptPath);
      prompts.push({ packetId, mtimeMs: promptStat.mtimeMs, promptRefName: entry.name });
    } catch {
      return null;
    }
  }
  if (prompts.length === 0) return null;
  prompts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.promptRefName.localeCompare(right.promptRefName));
  if (prompts.length > 1 && prompts[0].mtimeMs === prompts[1].mtimeMs) return { ambiguous: true };
  return prompts[0];
}

async function workerPromptExists(topicDir, packetId) {
  if (!topicDir || !packetId) return false;
  try {
    const promptStat = await stat(path.join(topicDir, `prompt-${packetId}-worker.md`));
    return promptStat.isFile();
  } catch {
    return false;
  }
}

function passResultSourceRefSet(projectRoot, results, waveId) {
  const refs = new Set();
  for (const entry of results) {
    if (entry.result?.verdict !== "PASS") continue;
    if (entry.result?.wave_id && entry.result.wave_id !== waveId) continue;
    const sourceRef = entry.result?.source_ref;
    if (!concreteRef(sourceRef)) continue;
    refs.add(path.resolve(projectRoot, sourceRef));
  }
  return refs;
}

async function hasWaveRemediationArtifact(projectRoot, topicDir, waveId, results) {
  try {
    const passSourceRefs = passResultSourceRefSet(projectRoot, results, waveId);
    const entries = await readdir(topicDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name.startsWith(`packet-${waveId}-remediation-`)) return true;
      if (!entry.name.startsWith(`source-${waveId}-`) || !/remediat/iu.test(entry.name)) continue;
      const sourcePath = path.join(topicDir, entry.name);
      if (!passSourceRefs.has(path.resolve(sourcePath))) continue;
      const sourceText = await readFile(sourcePath, "utf8");
      if (
        /\bverdict:\s*PASS\b/iu.test(sourceText)
        && /\blocal_packet_authority_scope_remediation_only:\s*true\b/iu.test(sourceText)
        && /\bproduct_semantic_ambiguity:\s*false\b/iu.test(sourceText)
        && /\bsource_audit_findings_mutated:\s*false\b/iu.test(sourceText)
        && /\bsource_sweep_design_artifacts_mutated:\s*false\b/iu.test(sourceText)
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function selectPostUpdateProofPacket({ topicDir, wave, specUpdatingPackets, sourceText }) {
  if (specUpdatingPackets.length === 0) {
    return { ok: false, reason: "post-update proof requires a spec-updating packet" };
  }

  const packetIds = extractPacketIdsFromSource(sourceText);
  const matchingSourcePackets = packetIds
    .map((packetId) => specUpdatingPackets.find((entry) => entry.packet?.packet_id === packetId) ?? null)
    .filter(Boolean);
  const uniqueMatchingSourcePackets = [...new Map(matchingSourcePackets.map((entry) => [entry.packet.packet_id, entry])).values()];
  if (uniqueMatchingSourcePackets.length > 1) {
    return { ok: false, reason: "implementation source names multiple post-update packets" };
  }
  if (packetIds.length > 0 && uniqueMatchingSourcePackets.length === 0) {
    return { ok: false, reason: "implementation source packet_id does not match a current post-update packet" };
  }
  if (uniqueMatchingSourcePackets.length === 1) {
    return { ok: true, entry: uniqueMatchingSourcePackets[0], selectionSource: "implementation_source" };
  }

  const promptLineage = await latestWorkerPromptPacketId(topicDir, specUpdatingPackets);
  if (promptLineage?.ambiguous) {
    return { ok: false, reason: "latest worker prompt lineage is ambiguous" };
  }
  if (promptLineage?.packetId) {
    const promptPacket = specUpdatingPackets.find((entry) => entry.packet?.packet_id === promptLineage.packetId);
    if (promptPacket) return { ok: true, entry: promptPacket, selectionSource: "worker_prompt" };
  }

  if (specUpdatingPackets.length === 1) {
    return { ok: true, entry: specUpdatingPackets[0], selectionSource: "single_packet" };
  }

  return { ok: false, reason: "post-update packet lineage is ambiguous" };
}

async function mechanicalPostUpdateJudgementProof({ projectRoot, topicDir, wave, specUpdatingPackets, results, implementationResult }) {
  if (!projectRoot || !topicDir) {
    return { ok: false, reason: "mechanical proof requires project and topic roots" };
  }
  const implementationVerifiedAt = verifiedAtMs(implementationResult);
  if (!Number.isFinite(implementationVerifiedAt)) {
    return { ok: false, reason: "implementation result verified_at is not concrete" };
  }
  const requiredKinds = new Map([
    ["audit", "audit result must pass"],
    ["preflight", "preflight result must pass"],
    ["implementation", "implementation result must pass"],
  ]);
  for (const [kind, reason] of requiredKinds) {
    const result = latestResultOfKind(results, kind);
    if (result?.result?.verdict !== "PASS") {
      return { ok: false, reason };
    }
  }
  const laterBlockingResult = results.find((entry) => {
    const verifiedAt = verifiedAtMs(entry);
    return Number.isFinite(verifiedAt)
      && verifiedAt >= implementationVerifiedAt
      && entry.result?.verdict !== "PASS";
  });
  if (laterBlockingResult) {
    return { ok: false, reason: "a later non-PASS result exists" };
  }
  const sourceRef = implementationResult?.result?.source_ref;
  if (!concreteRef(sourceRef)) {
    return { ok: false, reason: "implementation source ref is missing or non-concrete" };
  }
  let sourceText = "";
  try {
    sourceText = await readFile(path.join(projectRoot, sourceRef), "utf8");
  } catch {
    return { ok: false, reason: "implementation source ref is not readable" };
  }
  const selectedPacket = await selectPostUpdateProofPacket({
    topicDir,
    wave,
    specUpdatingPackets,
    sourceText,
  });
  if (!selectedPacket.ok) {
    return { ok: false, reason: selectedPacket.reason };
  }
  const packet = selectedPacket.entry.packet;
  if (packet.status !== "dispatched") {
    return { ok: false, reason: "post-update proof packet is not the current dispatched packet" };
  }
  if (!refsAreConcrete(packet.authority_owner) || !refsAreConcrete(packet.canonical_seams)) {
    return { ok: false, reason: "packet authority refs are missing or non-concrete" };
  }
  const promptLineage = await latestWorkerPromptPacketId(topicDir, specUpdatingPackets);
  if (selectedPacket.selectionSource === "implementation_source") {
    if (!await workerPromptExists(topicDir, packet.packet_id)) {
      return { ok: false, reason: "implementation result packet_id does not have worker prompt lineage" };
    }
  } else if (promptLineage?.ambiguous) {
    return { ok: false, reason: "latest worker prompt lineage is ambiguous" };
  }
  if (promptLineage?.ambiguous) {
    return { ok: false, reason: "latest worker prompt lineage is ambiguous" };
  }
  if (promptLineage?.packetId && promptLineage.packetId !== packet.packet_id) {
    return { ok: false, reason: "implementation result packet_id is not the latest worker prompt lineage" };
  }
  const isMultiAuthority = stringList(packet.authority_owner).length > 1;
  if (isMultiAuthority) {
    const hasExplicitPacketLineage = selectedPacket.selectionSource === "implementation_source"
      && extractPacketIdsFromSource(sourceText).includes(packet.packet_id);
    if (!hasExplicitPacketLineage) {
      return { ok: false, reason: "multi-authority post-update proof requires implementation-source packet lineage" };
    }
    if (!await hasWaveRemediationArtifact(projectRoot, topicDir, wave.wave_id, results) || !/\bremediat(?:e|ed|ion)\b/iu.test(sourceText)) {
      return { ok: false, reason: "multi-authority post-update proof requires explicit remediation lineage" };
    }
  }
  const evidenceRefs = extractTopicValidationEvidenceRefs(sourceText, wave.wave_id);
  if (evidenceRefs.length === 0) {
    return { ok: false, reason: "implementation source does not cite topic-local validation evidence" };
  }
  for (const ref of evidenceRefs) {
    if (!ref.startsWith(`${path.relative(projectRoot, topicDir).split(path.sep).join("/")}/`)) {
      return { ok: false, reason: `validation evidence is outside the topic root: ${ref}` };
    }
    const evidence = await readJsonRef(projectRoot, ref);
    if (!evidence || evidence.status !== "pass" || evidence.exit_code !== 0) {
      return { ok: false, reason: `validation evidence is not a clean pass: ${ref}` };
    }
  }
  if (declaresPostUpdateAmbiguity(sourceText)) {
    return { ok: false, reason: "implementation source declares authority/scope/gate/product/semantic ambiguity" };
  }
  if (!hasRequiredPostUpdateNegativeDeclarations(sourceText)) {
    return { ok: false, reason: "implementation source does not declare required mutation and shortcut negative checks" };
  }
  return { ok: true, evidenceRefs, sourceRef, packetId: packet.packet_id };
}

export async function buildPostUpdateReviewDecision({ projectRoot, topicDir, topicId, wave, packets, results, policy, commandRef }) {
  const wavePackets = packets.filter((entry) => entry.packet?.wave_id === wave.wave_id);
  const specUpdatingPackets = wavePackets.filter((entry) => needsPostUpdateReview(entry.packet, policy));
  const specUpdatingPacket = specUpdatingPackets[0] ?? null;
  const implementationResult = latestResultOfKind(results, "implementation");
  if (
    !specUpdatingPacket
    || implementationResult?.result?.verdict !== "PASS"
    || hasFreshPassingPostUpdateReview(results, implementationResult, policy)
  ) {
    return null;
  }
  const reviewPolicy = policy.postUpdateReview ?? {};
  const mechanicalProof = await mechanicalPostUpdateJudgementProof({
    projectRoot,
    topicDir,
    wave,
    specUpdatingPackets,
    results,
    implementationResult,
  });
  if (mechanicalProof.ok) {
    return {
      stopClass: "continue",
      recommendedAction: "record_result",
      reasonCode: "mechanical_post_update_judgement_pass",
      recommendedDecision: "record_mechanical_post_update_judgement_pass",
      recommendationRationale: "Post-update evidence proves the implementation stayed inside packet authority and all cited validation checks passed.",
      expectedArtifacts: [`result-${wave.wave_id}-${reviewPolicy.requiredResultKind}.md`],
      nextCommandRef: commandRef([
        "result",
        "record",
        topicId,
        "--kind",
        reviewPolicy.requiredResultKind,
        "--verdict",
        reviewPolicy.passVerdict,
        "--from",
        mechanicalProof.sourceRef,
        "--verified-at",
        implementationResult.result.verified_at,
      ]),
    };
  }
  return {
    stopClass: "require_human_confirmation",
    recommendedAction: "record_result",
    reasonCode: "spec_update_review_required",
    recommendedDecision: "record_post_spec_update_judgement_before_wave_closeout",
    recommendationRationale: "This wave updated spec/authority truth; manager judgement is required before automatic wave closeout.",
    expectedArtifacts: [`result-${wave.wave_id}-${reviewPolicy.requiredResultKind}.md`],
    nextCommandRef: commandRef([
      "result",
      "record",
      topicId,
      "--kind",
      reviewPolicy.requiredResultKind,
      "--verdict",
      "<verdict>",
      "--from",
      "<path>",
      "--verified-at",
      "<utc>",
    ]),
    blockingChecks: [{
      ok: false,
      code: "mechanical_post_update_judgement_not_proven",
      message: mechanicalProof.reason,
    }],
  };
}

export function authorityConvergenceAuditInstructions(role) {
  return role === "audit"
    ? `
Authority Convergence Audit:
- Check implementation readiness, owner split, parallel truth, canonical vocabulary, and blocking deferred scope.
- Do not implement code, edit spec, or decide semantic acceptance.
- Return PASS, NEEDS_REVISION, or FAIL with blocking_findings, concerns, deferred_non_blockers, authority_refs, and ready_for_implementation.
`
    : "";
}

export function buildAuthorityConvergenceDecision({ topicId, wave, packet, auditResult, policy, commandRef }) {
  if (packet.status !== "dispatched") {
    return {
      stopClass: "continue",
      recommendedAction: "dispatch_audit",
      reasonCode: "authority_convergence_audit_required",
      recommendedDecision: "dispatch_authority_convergence_auditor",
      recommendationRationale: "This packet changes or anchors authority/spec truth.",
      expectedArtifacts: [`prompt-${packet.packet_id}-audit.md`],
      nextCommandRef: commandRef(["audit", "dispatch", topicId, "--packet", packet.packet_id]),
    };
  }
  if (auditResult?.result?.verdict === policy.passVerdict) {
    if (packet.packet_kind === "preflight") {
      return {
        stopClass: "require_human_confirmation",
        recommendedAction: "freeze_packet",
        reasonCode: "preflight_authority_audit_passed_requires_implementation_packet",
        recommendedDecision: "create_or_select_an_implementation_ready_packet_before_worker_dispatch",
        recommendationRationale: "The authority convergence audit passed for a preflight packet, but preflight evidence is not implementation admission.",
        expectedArtifacts: ["packet-<implementation-ready-packet-id>.md"],
        nextCommandRef: commandRef(["packet", "freeze", topicId, "--from", "<implementation-ready-draft-packet>"]),
      };
    }
    if (wave.state === "preflight_admitted") {
      return {
        stopClass: "continue",
        recommendedAction: "record_result",
        reasonCode: "implementation_admission_result_required",
        recommendedDecision: "record_preflight_pass_before_worker_dispatch",
        recommendationRationale: "The authority convergence audit passed, but the selected wave must explicitly enter implementation admission before worker dispatch.",
        expectedArtifacts: [`result-${wave.wave_id}-preflight.md`],
        nextCommandRef: commandRef([
          "result",
          "record",
          topicId,
          "--kind",
          "preflight",
          "--verdict",
          policy.passVerdict,
          "--from",
          auditResult.result.source_ref ?? "<authority-convergence-audit-source>",
          "--verified-at",
          auditResult.result.verified_at ?? "<utc>",
        ]),
      };
    }
    return {
      stopClass: "continue",
      recommendedAction: "dispatch_worker",
      reasonCode: "authority_convergence_audit_passed",
      recommendedDecision: "dispatch_the_selected_packet_to_the_worker",
      recommendationRationale: "The authority convergence audit passed.",
      expectedArtifacts: [`prompt-${packet.packet_id}-worker.md`],
      nextCommandRef: commandRef(["worker", "dispatch", topicId, "--packet", packet.packet_id]),
    };
  }
  if (auditResult && policy.blockedVerdicts.includes(auditResult.result?.verdict)) {
    return {
      stopClass: "blocked",
      recommendedAction: "open_remediation",
      reasonCode: "authority_convergence_audit_failed",
      recommendedDecision: "revise_authority_packet_before_implementation_dispatch",
      recommendationRationale: "The latest authority convergence audit result blocks implementation dispatch.",
      blockingChecks: [{
        id: "authority_convergence_audit_verdict",
        ok: false,
        reason: `audit verdict is ${auditResult.result?.verdict}`,
      }],
      nextCommandRef: commandRef([
        "remediation",
        "open",
        topicId,
        "--kind",
        "a",
        "--reason",
        "authority-convergence",
      ]),
    };
  }
  return {
    stopClass: "await_external_evidence",
    recommendedAction: "record_result",
    reasonCode: "awaiting_authority_convergence_audit_result",
    recommendedDecision: "record_the_authority_convergence_audit_result_when_available",
    recommendationRationale: "The authority convergence audit must be recorded before implementation dispatch.",
    expectedArtifacts: [`result-${wave.wave_id}-${policy.requiredResultKind}.md`],
    nextCommandRef: commandRef([
      "result",
      "record",
      topicId,
      "--kind",
      policy.requiredResultKind,
      "--verdict",
      "<verdict>",
      "--from",
      "<path>",
      "--verified-at",
      "<utc>",
    ]),
  };
}

function dispatchWorkerDecision(topicId, packet) {
  return {
    stopClass: "continue",
    recommendedAction: "dispatch_worker",
    reasonCode: "dispatchable_packet_available",
    recommendedDecision: "dispatch_the_selected_packet_to_the_worker",
    recommendationRationale: "A dispatchable packet exists for the admitted wave, so the next operational step is mechanical.",
    expectedArtifacts: [`prompt-${packet.packet_id}-worker.md`],
    nextCommandRef: null,
  };
}

function dispatchablePacketRank(packet) {
  const ranks = {
    candidate: 0,
    admitted: 1,
    preflight: 2,
    dispatched: 3,
  };
  return ranks[packet.status] ?? 99;
}

export async function buildPreImplementationDecision({
  projectRoot,
  loaded,
  wave,
  commandRef,
  listWavePackets,
  listWaveResults,
  findUniqueFreezableDraftPacket,
  loadTopicRuntimeAuthority,
}) {
  const packets = await listWavePackets(loaded.topicDir, wave.wave_id);
  const dispatchable = packets
    .filter((entry) => ["candidate", "admitted", "preflight", "dispatched"].includes(entry.packet.status))
    .sort((left, right) => (
      dispatchablePacketRank(left.packet) - dispatchablePacketRank(right.packet)
      || left.packetRefName.localeCompare(right.packetRefName)
    ))[0];
  if (dispatchable) {
    const policy = await loadAuthorityConvergencePolicy(projectRoot);
    if (wave.state === "preflight_admitted" && needsAuthorityConvergenceAudit(loaded.topic, dispatchable.packet, policy)) {
      const auditResult = latestResultOfKind(await listWaveResults(loaded.topicDir, wave.wave_id), policy.requiredResultKind);
      return buildAuthorityConvergenceDecision({
        topicId: loaded.topicId,
        wave,
        packet: dispatchable.packet,
        auditResult,
        policy,
        commandRef,
      });
    }
    if (wave.state === "preflight_admitted") {
      return {
        stopClass: "require_human_confirmation",
        recommendedAction: "record_result",
        reasonCode: "implementation_admission_result_required",
        recommendedDecision: "record_preflight_pass_before_worker_dispatch",
        recommendationRationale: "A dispatchable implementation packet exists, but worker dispatch requires explicit implementation admission evidence.",
        expectedArtifacts: [`result-${wave.wave_id}-preflight.md`],
        nextCommandRef: commandRef([
          "result",
          "record",
          loaded.topicId,
          "--kind",
          "preflight",
          "--verdict",
          "PASS",
          "--from",
          "<implementation-readiness-evidence>",
          "--verified-at",
          "<utc>",
        ]),
      };
    }
    const decision = dispatchWorkerDecision(loaded.topicId, dispatchable.packet);
    decision.nextCommandRef = commandRef(["worker", "dispatch", loaded.topicId, "--packet", dispatchable.packet.packet_id]);
    return decision;
  }

  const autoDraft = await findUniqueFreezableDraftPacket(
    projectRoot,
    loaded,
    wave,
    await loadTopicRuntimeAuthority(projectRoot),
  );
  return autoDraft.ok
    ? {
      stopClass: "continue",
      recommendedAction: "freeze_packet",
      reasonCode: "draft_packet_ready",
      recommendedDecision: "freeze_packet",
      recommendationRationale: "One draft is freezeable.",
      expectedArtifacts: [`packet-${autoDraft.packet.packet_id}.md`],
      nextCommandRef: commandRef(["packet", "freeze", loaded.topicId, "--from", autoDraft.draftRef]),
    }
    : {
      stopClass: "require_human_confirmation",
      recommendedAction: "freeze_packet",
      reasonCode: autoDraft.reasonCode,
      recommendedDecision: "select_or_create_draft",
      recommendationRationale: "Draft packet is missing or ambiguous.",
      expectedArtifacts: ["packet-<packet-id>.md"],
      nextCommandRef: commandRef(["packet", "freeze", loaded.topicId, "--from", "<draft-packet>"]),
    };
}

export function buildDispatchPrompt(packet, topicId, role) {
  const auditInstructions = authorityConvergenceAuditInstructions(role);
  return `# ${role === "worker" ? "Worker" : "Audit"} Dispatch
Topic: \`${topicId}\`
Packet: \`${packet.packet_id}\`
Wave: \`${packet.wave_id}\`
Packet Kind: \`${packet.packet_kind}\`
Role: \`${role}\`
Authority Owner:
${(Array.isArray(packet.authority_owner) ? packet.authority_owner : []).map((entry) => `- ${entry}`).join(`
`)}
Canonical Seams:
${(Array.isArray(packet.canonical_seams) ? packet.canonical_seams : []).map((entry) => `- ${entry}`).join(`
`)}
Forbidden Shortcuts:
${(Array.isArray(packet.forbidden_shortcuts) ? packet.forbidden_shortcuts : []).map((entry) => `- ${entry}`).join(`
`)}
Acceptance Invariants:
${(Array.isArray(packet.acceptance_invariants) ? packet.acceptance_invariants : []).map((entry) => `- ${entry}`).join(`
`)}
Negative Tests:
${(Array.isArray(packet.negative_tests) ? packet.negative_tests : []).map((entry) => `- ${entry}`).join(`
`)}
Reopen Conditions:
${(Array.isArray(packet.reopen_conditions) ? packet.reopen_conditions : []).map((entry) => `- ${entry}`).join(`
`)}
${auditInstructions}`;
}
