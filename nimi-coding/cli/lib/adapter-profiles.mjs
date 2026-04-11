import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ADAPTER_PACKAGE_PROFILE_REFS } from "../constants.mjs";
import { arraysEqual, isPlainObject, toStringArray } from "./value-helpers.mjs";
import { parseYamlText } from "./yaml-helpers.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const ADAPTER_PROFILE_EXPECTATIONS = {
  oh_my_codex: {
    hostClass: "external_execution_host",
    upstreamSeedProfile: "external_ai_host",
    semanticOwner: [
      ".nimi/methodology",
      ".nimi/spec",
      ".nimi/contracts",
      ".nimi/config",
    ],
    operationalOwner: [
      ".omx",
      ".nimi/local",
      ".nimi/cache",
    ],
    admittedSkillSurfaces: [
      "spec_reconstruction",
      "doc_spec_audit",
      "high_risk_execution",
    ],
    promptBootstrapSurface: [
      "nimicoding handoff --skill spec_reconstruction --prompt",
      "nimicoding handoff --skill doc_spec_audit --prompt",
      "nimicoding handoff --skill high_risk_execution --prompt",
    ],
    promptFutureSurface: [
      "nimicoding run-next-prompt",
    ],
    promptFutureSurfaceStatus: "future_only_not_packaged",
    outputHandoff: {
      workerOutputTarget: ".nimi/local/outputs/** candidate artifact",
      evidenceTarget: ".nimi/local/evidence/** candidate artifact",
      closeoutTarget: "local-only closeout payload unless later admitted",
    },
    hardConstraints: [
      "omx_must_not_become_semantic_owner",
      "omx_must_not_write_canonical_.nimi/spec_truth_directly_without_validator_admission",
      "omx_must_not_define_acceptance_disposition_or_finding_judgment",
      "omx_runtime_state_must_remain_operational_only",
      "unresolved_authority_or_missing_context_must_fail_closed",
    ],
  },
};

function buildInvalidProfile(adapterId, profileRef, reason) {
  return {
    ok: false,
    id: adapterId,
    profileRef,
    absolutePath: profileRef ? path.join(PACKAGE_ROOT, profileRef) : null,
    reason,
    version: null,
    hostClass: null,
    upstreamSeedProfile: null,
    purpose: null,
    semanticOwner: [],
    operationalOwner: [],
    admittedSkillSurfaces: [],
    promptHandoff: {
      bootstrapSurface: [],
      futureSurface: [],
      futureSurfaceStatus: null,
    },
    outputHandoff: {
      workerOutputTarget: null,
      evidenceTarget: null,
      closeoutTarget: null,
    },
    hardConstraints: [],
    currentGaps: [],
  };
}

function normalizeAdapterProfile(adapterId, profileRef, parsed) {
  const profile = parsed?.adapter_profile;
  if (!isPlainObject(profile)) {
    return buildInvalidProfile(adapterId, profileRef, "adapter profile YAML is missing adapter_profile");
  }

  return {
    ok: true,
    id: typeof profile.id === "string" ? profile.id : null,
    profileRef,
    absolutePath: path.join(PACKAGE_ROOT, profileRef),
    reason: null,
    version: parsed?.version ?? null,
    hostClass: typeof profile.host_class === "string" ? profile.host_class : null,
    upstreamSeedProfile: typeof profile.upstream_seed_profile === "string" ? profile.upstream_seed_profile : null,
    purpose: typeof profile.purpose === "string" ? profile.purpose.trim() : null,
    semanticOwner: toStringArray(profile.semantic_owner),
    operationalOwner: toStringArray(profile.operational_owner),
    admittedSkillSurfaces: toStringArray(profile.admitted_skill_surfaces),
    promptHandoff: {
      bootstrapSurface: toStringArray(profile.prompt_handoff?.bootstrap_surface),
      futureSurface: toStringArray(profile.prompt_handoff?.future_surface?.commands),
      futureSurfaceStatus: typeof profile.prompt_handoff?.future_surface?.status === "string"
        ? profile.prompt_handoff.future_surface.status
        : null,
    },
    outputHandoff: {
      workerOutputTarget: typeof profile.output_handoff?.worker_output_target === "string"
        ? profile.output_handoff.worker_output_target
        : null,
      evidenceTarget: typeof profile.output_handoff?.evidence_target === "string"
        ? profile.output_handoff.evidence_target
        : null,
      closeoutTarget: typeof profile.output_handoff?.closeout_target === "string"
        ? profile.output_handoff.closeout_target
        : null,
    },
    hardConstraints: toStringArray(profile.hard_constraints),
    currentGaps: toStringArray(profile.current_gaps),
  };
}

function validateAdapterProfile(profile) {
  const expectation = ADAPTER_PROFILE_EXPECTATIONS[profile.id];
  if (!expectation) {
    return {
      ok: false,
      reason: `no package-owned adapter profile expectation is declared for ${profile.id}`,
    };
  }

  const hardConstraintsOk = expectation.hardConstraints.every((entry) => profile.hardConstraints.includes(entry));
  const outputHandoffOk = profile.outputHandoff.workerOutputTarget === expectation.outputHandoff.workerOutputTarget
    && profile.outputHandoff.evidenceTarget === expectation.outputHandoff.evidenceTarget
    && profile.outputHandoff.closeoutTarget === expectation.outputHandoff.closeoutTarget;

  const ok = profile.version === 1
    && profile.id in ADAPTER_PACKAGE_PROFILE_REFS
    && profile.hostClass === expectation.hostClass
    && profile.upstreamSeedProfile === expectation.upstreamSeedProfile
    && Boolean(profile.purpose)
    && arraysEqual(profile.semanticOwner, expectation.semanticOwner)
    && arraysEqual(profile.operationalOwner, expectation.operationalOwner)
    && arraysEqual(profile.admittedSkillSurfaces, expectation.admittedSkillSurfaces)
    && arraysEqual(profile.promptHandoff.bootstrapSurface, expectation.promptBootstrapSurface)
    && arraysEqual(profile.promptHandoff.futureSurface, expectation.promptFutureSurface)
    && profile.promptHandoff.futureSurfaceStatus === expectation.promptFutureSurfaceStatus
    && outputHandoffOk
    && hardConstraintsOk;

  return {
    ok,
    reason: ok
      ? null
      : `${profile.profileRef} drifted away from the declared package-owned adapter overlay contract`,
  };
}

function serializeProfile(profile) {
  return {
    id: profile.id,
    profileRef: profile.profileRef,
    hostClass: profile.hostClass,
    upstreamSeedProfile: profile.upstreamSeedProfile,
    purpose: profile.purpose,
    semanticOwner: profile.semanticOwner,
    operationalOwner: profile.operationalOwner,
    admittedSkillSurfaces: profile.admittedSkillSurfaces,
    promptHandoff: profile.promptHandoff,
    outputHandoff: profile.outputHandoff,
    hardConstraints: profile.hardConstraints,
    currentGaps: profile.currentGaps,
    ok: profile.ok,
    reason: profile.reason,
  };
}

export async function loadAdapterProfile(adapterId) {
  const profileRef = ADAPTER_PACKAGE_PROFILE_REFS[adapterId] ?? null;
  if (!profileRef) {
    return buildInvalidProfile(adapterId, null, `no package-owned adapter profile is declared for ${adapterId}`);
  }

  let rawText;
  try {
    rawText = await readFile(path.join(PACKAGE_ROOT, profileRef), "utf8");
  } catch {
    return buildInvalidProfile(adapterId, profileRef, `cannot read package-owned adapter profile ${profileRef}`);
  }

  const parsed = parseYamlText(rawText);
  if (!parsed) {
    return buildInvalidProfile(adapterId, profileRef, `package-owned adapter profile ${profileRef} is invalid YAML`);
  }

  const normalized = normalizeAdapterProfile(adapterId, profileRef, parsed);
  if (!normalized.ok) {
    return normalized;
  }

  if (normalized.id !== adapterId) {
    return buildInvalidProfile(adapterId, profileRef, `${profileRef} declares adapter id ${normalized.id ?? "unknown"} instead of ${adapterId}`);
  }

  const validation = validateAdapterProfile(normalized);
  if (!validation.ok) {
    return {
      ...normalized,
      ok: false,
      reason: validation.reason,
    };
  }

  return normalized;
}

export async function loadAdmittedAdapterProfiles(adapterIds) {
  const profiles = [];

  for (const adapterId of adapterIds) {
    profiles.push(await loadAdapterProfile(adapterId));
  }

  return {
    admitted: profiles.map((profile) => serializeProfile(profile)),
    invalid: profiles.filter((profile) => !profile.ok).map((profile) => serializeProfile(profile)),
    selected: null,
  };
}

export function selectAdapterProfile(adapterProfiles, selectedAdapterId) {
  if (!selectedAdapterId || selectedAdapterId === "none") {
    return null;
  }

  return adapterProfiles.admitted.find((profile) => profile.id === selectedAdapterId) ?? null;
}
