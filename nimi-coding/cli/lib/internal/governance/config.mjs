import path from "node:path";

import { readTextIfFile } from "../../fs-helpers.mjs";
import { parseYamlText } from "../../yaml-helpers.mjs";
import { isPlainObject } from "../../value-helpers.mjs";

const GOVERNANCE_CONFIG_RELATIVE_PATH = ".nimi/config/governance.yaml";

function normalizeAgentsTarget(entry) {
  if (!isPlainObject(entry) || typeof entry.rel !== "string") {
    return null;
  }

  return {
    rel: entry.rel.trim(),
    maxLines: Number(entry.max_lines ?? entry.maxLines ?? 0),
  };
}

function normalizeGovernanceConfig(parsed) {
  if (!isPlainObject(parsed)) {
    return null;
  }

  const profileId = typeof parsed.profile_id === "string" ? parsed.profile_id.trim() : null;
  const specGovernance = isPlainObject(parsed.spec_governance) ? parsed.spec_governance : {};
  const aiGovernance = isPlainObject(parsed.ai_governance) ? parsed.ai_governance : {};
  const agentsFreshness = isPlainObject(aiGovernance.agents_freshness)
    ? aiGovernance.agents_freshness
    : {};

  function normalizeCommandMap(section) {
    if (!isPlainObject(section)) {
      return {};
    }

    const output = {};
    for (const [key, value] of Object.entries(section)) {
      if (Array.isArray(value)) {
        output[key] = value.map((entry) => String(entry || "").trim()).filter(Boolean);
      } else if (typeof value === "string" && value.trim().length > 0) {
        output[key] = [value.trim()];
      }
    }
    return output;
  }

  const normalized = {
    profileId,
    specGovernance: {
      canonicalRoot: typeof specGovernance.canonical_root === "string"
        ? specGovernance.canonical_root.trim()
        : ".nimi/spec",
      domainChecks: isPlainObject(specGovernance.domain_checks)
        ? specGovernance.domain_checks
        : {},
      validateCommands: normalizeCommandMap(specGovernance.validate_commands),
      generateCommands: normalizeCommandMap(specGovernance.generate_commands),
      singleSource: isPlainObject(specGovernance.single_source)
        ? specGovernance.single_source
        : {},
      realmAlignment: isPlainObject(specGovernance.realm_alignment)
        ? specGovernance.realm_alignment
        : {},
      legacyVocabulary: isPlainObject(specGovernance.legacy_vocabulary)
        ? specGovernance.legacy_vocabulary
        : {},
    },
    aiGovernance: {
      agentsFreshness: {
        targets: Array.isArray(agentsFreshness.targets)
          ? agentsFreshness.targets.map(normalizeAgentsTarget).filter(Boolean)
          : [],
        requiredSections: Array.isArray(agentsFreshness.required_sections)
          ? agentsFreshness.required_sections
              .map((entry) => String(entry || "").trim())
              .filter(Boolean)
          : [],
        staleTokens: Array.isArray(agentsFreshness.stale_tokens)
          ? agentsFreshness.stale_tokens.map((entry) => String(entry || "").trim()).filter(Boolean)
          : [],
      },
      contextBudget: isPlainObject(aiGovernance.context_budget)
        ? aiGovernance.context_budget
        : {},
      structureBudget: isPlainObject(aiGovernance.structure_budget)
        ? aiGovernance.structure_budget
        : {},
      highRiskDocMetadata: isPlainObject(aiGovernance.high_risk_doc_metadata)
        ? aiGovernance.high_risk_doc_metadata
        : {},
    },
  };

  if (!normalized.profileId) {
    return null;
  }

  return normalized;
}

export async function loadGovernanceConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, GOVERNANCE_CONFIG_RELATIVE_PATH);
  const text = await readTextIfFile(configPath);

  if (text === null) {
    return {
      ok: false,
      path: configPath,
      reason: "missing governance config",
      config: null,
    };
  }

  const parsed = parseYamlText(text);
  const normalized = normalizeGovernanceConfig(parsed);

  if (!normalized) {
    return {
      ok: false,
      path: configPath,
      reason: "invalid governance config",
      config: null,
    };
  }

  return {
    ok: true,
    path: configPath,
    reason: null,
    config: normalized,
  };
}

export function requireProfile(governanceConfig, requestedProfile) {
  const effectiveProfile = requestedProfile || governanceConfig.profileId;
  if (effectiveProfile !== governanceConfig.profileId) {
    return {
      ok: false,
      error: `governance profile mismatch: expected ${governanceConfig.profileId} but received ${effectiveProfile}`,
      profile: effectiveProfile,
    };
  }

  return {
    ok: true,
    error: null,
    profile: effectiveProfile,
  };
}
