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

export function buildPostUpdateReviewDecision({ topicId, wave, packets, results, policy, commandRef }) {
  const specUpdatingPacket = packets.find((entry) => needsPostUpdateReview(entry.packet, policy));
  const implementationResult = latestResultOfKind(results, "implementation");
  if (
    !specUpdatingPacket
    || implementationResult?.result?.verdict !== "PASS"
    || hasFreshPassingPostUpdateReview(results, implementationResult, policy)
  ) {
    return null;
  }
  const reviewPolicy = policy.postUpdateReview ?? {};
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
