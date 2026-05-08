function stringArray(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAuthorityRef(value) {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  return (
    ref.startsWith(".nimi/spec/")
    || ref.startsWith("apps/") && ref.includes("/spec/")
    || ref.startsWith("nimi-coding/spec/")
    || ref.startsWith("nimi-coding/contracts/")
    || ref.startsWith("nimi-coding/methodology/")
    || ref.startsWith("nimi-coding/config/")
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function sourceSweepDesignAuthorityRefs(source) {
  if (!source || typeof source !== "object") return [];
  return unique([
    ...stringArray(source.authority_owner),
    ...stringArray(source.authority_refs),
    ...stringArray(source.authority_refs_considered),
    ...stringArray(source.merged_root_cause_keys).filter(isAuthorityRef),
  ]);
}

export function sweepDesignWaveAuthorityRefs(wave) {
  if (!wave || typeof wave !== "object") return [];
  return sourceSweepDesignAuthorityRefs(wave);
}

export function packetAuthorityCoverage(packet, wave) {
  const required = sourceSweepDesignAuthorityRefs(wave?.source_sweep_design);
  if (required.length === 0) {
    return {
      ok: true,
      requiredAuthorityRefs: [],
      missingAuthorityOwnerRefs: [],
      missingCanonicalSeamRefs: [],
    };
  }
  const owners = new Set(stringArray(packet?.authority_owner));
  const seams = new Set(stringArray(packet?.canonical_seams));
  const missingAuthorityOwnerRefs = required.filter((ref) => !owners.has(ref));
  const missingCanonicalSeamRefs = required.filter((ref) => !seams.has(ref));
  return {
    ok: missingAuthorityOwnerRefs.length === 0 && missingCanonicalSeamRefs.length === 0,
    requiredAuthorityRefs: required,
    missingAuthorityOwnerRefs,
    missingCanonicalSeamRefs,
  };
}

export function packetAuthorityCoverageError(coverage) {
  const parts = [];
  if (coverage.missingAuthorityOwnerRefs?.length) {
    parts.push(`authority_owner missing ${coverage.missingAuthorityOwnerRefs.join(", ")}`);
  }
  if (coverage.missingCanonicalSeamRefs?.length) {
    parts.push(`canonical_seams missing ${coverage.missingCanonicalSeamRefs.join(", ")}`);
  }
  return `Draft packet authority coverage is incomplete: ${parts.join("; ")}`;
}
