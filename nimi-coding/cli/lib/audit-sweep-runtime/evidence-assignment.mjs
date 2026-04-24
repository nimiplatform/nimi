import { DEFAULT_MAX_FILES_PER_CHUNK } from "./common.mjs";
import { specSurfaceForFile } from "./admissions.mjs";

function chunkMatchesEvidenceFile(chunk, fileRef) {
  return Array.isArray(chunk.evidence_roots)
    && chunk.evidence_roots.some((rootRef) => {
      const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
      return fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`);
    });
}

function findChunkBySurface(chunks, ownerDomain, specSurface) {
  return chunks.find((chunk) => chunk.owner_domain === ownerDomain && chunk.spec_surface === specSurface) ?? null;
}

const GENERIC_EVIDENCE_MATCH_TOKENS = new Set([
  "agent",
  "app",
  "apps",
  "audit",
  "contract",
  "contracts",
  "domain",
  "generated",
  "go",
  "guides",
  "index",
  "internal",
  "js",
  "json",
  "kernel",
  "md",
  "mjs",
  "nimi",
  "platform",
  "root",
  "schema",
  "spec",
  "src",
  "table",
  "tables",
  "test",
  "ts",
  "tsx",
  "yaml",
  "yml",
]);

function matchTokens(value) {
  return new Set(String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split(/[^a-zA-Z0-9]+/g)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 && !GENERIC_EVIDENCE_MATCH_TOKENS.has(token)));
}

function scoreEvidenceChunk(entry, chunk) {
  const evidenceTokens = matchTokens(entry.file_ref);
  const authorityTokens = matchTokens((chunk.authority_refs ?? chunk.files ?? []).join("/"));
  let score = 0;
  for (const token of evidenceTokens) {
    if (authorityTokens.has(token)) {
      score += 10;
    }
  }
  if (chunk.spec_surface === "kernel-contracts") {
    score += 3;
  } else if (chunk.spec_surface === "domain-guides") {
    score += 2;
  }
  return score;
}

function topLevelEvidenceDocForRoot(rootRef, fileRef) {
  const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalizedRoot || !(fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`))) {
    return false;
  }
  const relative = fileRef === normalizedRoot ? "" : fileRef.slice(normalizedRoot.length + 1);
  return !relative.includes("/") && /^(README|AGENTS)(?:\.[^.]+)?$/i.test(relative);
}

function pickSpecificOwnerEvidenceChunk(entry, candidates, currentCounts, maxEvidenceFilesPerChunk) {
  const ownerDomain = candidates[0]?.owner_domain;
  if (!ownerDomain) {
    return null;
  }
  if (entry.file_ref.startsWith(".nimi/spec/")) {
    const surface = specSurfaceForFile(entry.file_ref);
    return candidates.find((chunk) => (chunk.authority_refs ?? []).includes(entry.file_ref))
      ?? findChunkBySurface(candidates, surface.ownerDomain, surface.surface);
  }
  if (candidates.some((chunk) => (
    chunk.owner_domain === ownerDomain
    && chunk.spec_surface === "domain-guides"
    && (chunk.evidence_roots ?? []).some((rootRef) => topLevelEvidenceDocForRoot(rootRef, entry.file_ref))
  ))) {
    return findChunkBySurface(candidates, ownerDomain, "domain-guides");
  }
  const ranked = candidates
    .map((chunk) => ({ chunk, score: scoreEvidenceChunk(entry, chunk) }))
    .sort((left, right) => (
      right.score - left.score
      || (currentCounts.get(left.chunk.chunk_id) ?? 0) - (currentCounts.get(right.chunk.chunk_id) ?? 0)
      || left.chunk.chunk_id.localeCompare(right.chunk.chunk_id)
    ));
  return ranked.find((entry) => (currentCounts.get(entry.chunk.chunk_id) ?? 0) < maxEvidenceFilesPerChunk)?.chunk
    ?? ranked
      .sort((left, right) => (
        (currentCounts.get(left.chunk.chunk_id) ?? 0) - (currentCounts.get(right.chunk.chunk_id) ?? 0)
        || right.score - left.score
        || left.chunk.chunk_id.localeCompare(right.chunk.chunk_id)
      ))[0]?.chunk
    ?? candidates[0];
}

function pickBroadOwnerEvidenceChunk(entry, candidates, currentCounts, maxEvidenceFilesPerChunk) {
  const ranked = candidates
    .map((chunk) => ({ chunk, score: scoreEvidenceChunk(entry, chunk) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || (currentCounts.get(left.chunk.chunk_id) ?? 0) - (currentCounts.get(right.chunk.chunk_id) ?? 0)
      || left.chunk.chunk_id.localeCompare(right.chunk.chunk_id)
    ));
  if (ranked.length === 0) {
    return null;
  }
  return ranked.find((entry) => (currentCounts.get(entry.chunk.chunk_id) ?? 0) < maxEvidenceFilesPerChunk)?.chunk
    ?? ranked[0].chunk;
}

function deriveEmptyEvidenceInventoryReason(chunk) {
  if (chunk.spec_surface === "kernel-generated" || String(chunk.spec_surface ?? "").includes("generated")) {
    return "generated_projection_authority_no_direct_implementation_evidence";
  }
  if (chunk.spec_surface === "kernel-tables" || String(chunk.spec_surface ?? "").includes("tables")) {
    return "structured_fact_authority_no_direct_implementation_evidence";
  }
  if (chunk.spec_surface === "domain-guides" || String(chunk.spec_surface ?? "").endsWith("guides")) {
    return "domain_guide_authority_no_direct_implementation_evidence";
  }
  return "no_matching_evidence_files_after_spec_authority_assignment";
}

export function assignEvidenceInventory(evidenceEntries, chunks, options = {}) {
  const maxEvidenceFilesPerChunk = Number.isInteger(options.maxEvidenceFilesPerChunk) && options.maxEvidenceFilesPerChunk > 0
    ? options.maxEvidenceFilesPerChunk
    : DEFAULT_MAX_FILES_PER_CHUNK;
  const broadOwnerDomains = new Set(["spec-meta", "spec-root"]);
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, { ...chunk, evidence_inventory: [] }]));
  const currentCounts = new Map(chunks.map((chunk) => [chunk.chunk_id, 0]));
  const unmapped = [];

  for (const entry of evidenceEntries.sort((left, right) => left.file_ref.localeCompare(right.file_ref))) {
    const candidates = chunks.filter((chunk) => chunkMatchesEvidenceFile(chunk, entry.file_ref));
    if (candidates.length === 0) {
      unmapped.push(entry.file_ref);
      continue;
    }
    const preferred = candidates.filter((chunk) => !broadOwnerDomains.has(chunk.owner_domain));
    const pool = (preferred.length > 0 ? preferred : candidates)
      .sort((left, right) => left.chunk_id.localeCompare(right.chunk_id));
    const selected = preferred.length > 0
      ? pickSpecificOwnerEvidenceChunk(entry, pool, currentCounts, maxEvidenceFilesPerChunk)
      : pickBroadOwnerEvidenceChunk(entry, pool, currentCounts, maxEvidenceFilesPerChunk);
    if (!selected) {
      unmapped.push(entry.file_ref);
      continue;
    }
    chunksById.get(selected.chunk_id).evidence_inventory.push(entry.file_ref);
    currentCounts.set(selected.chunk_id, (currentCounts.get(selected.chunk_id) ?? 0) + 1);
  }

  return {
    chunks: chunks.map((chunk) => {
      const enriched = chunksById.get(chunk.chunk_id);
      const evidenceInventory = enriched.evidence_inventory.sort();
      const evidenceInventoryEmpty = evidenceInventory.length === 0;
      return {
        ...chunk,
        evidence_inventory: evidenceInventory,
        evidence_inventory_status: evidenceInventoryEmpty ? "empty" : "mapped",
        ...(evidenceInventoryEmpty ? {
          evidence_inventory_empty_reason: deriveEmptyEvidenceInventoryReason(chunk),
        } : {}),
        coverage_contract: {
          authority_refs_required: true,
          evidence_inventory_required: true,
          evidence_files_must_cover_inventory: true,
          empty_evidence_inventory_requires_reason: true,
        },
      };
    }),
    unmappedEvidenceFiles: unmapped.sort(),
  };
}
