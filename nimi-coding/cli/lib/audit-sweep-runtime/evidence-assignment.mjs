function chunkMatchesEvidenceFile(chunk, fileRef) {
  const roots = Array.isArray(chunk.admitted_evidence_roots) && chunk.admitted_evidence_roots.length > 0
    ? chunk.admitted_evidence_roots
    : chunk.evidence_roots;
  return Array.isArray(roots)
    && roots.some((rootRef) => {
      const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
      return fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`);
    });
}

function chunkHasExactAdmittedEvidenceRef(chunk, fileRef) {
  return Array.isArray(chunk.evidence_root_admission_refs)
    && Array.isArray(chunk.admitted_evidence_roots)
    && chunk.admitted_evidence_roots.some((rootRef) => rootRef.replace(/\\/g, "/").replace(/\/$/, "") === fileRef);
}

function topLevelEvidenceDocForRoot(rootRef, fileRef) {
  const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalizedRoot || !(fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`))) {
    return false;
  }
  const relative = fileRef === normalizedRoot ? "" : fileRef.slice(normalizedRoot.length + 1);
  return !relative.includes("/") && /^(README|AGENTS)(?:\.[^.]+)?$/i.test(relative);
}

function chunkAcceptsEvidenceFile(chunk, fileRef) {
  const surface = String(chunk.spec_surface ?? "");
  const roots = Array.isArray(chunk.admitted_evidence_roots) && chunk.admitted_evidence_roots.length > 0
    ? chunk.admitted_evidence_roots
    : chunk.evidence_roots;
  const isTopLevelDoc = (roots ?? []).some((rootRef) => topLevelEvidenceDocForRoot(rootRef, fileRef));
  if (isTopLevelDoc) {
    return surface === "domain-guides" || surface === "app-domain-guides" || surface === "package-root" || surface === "INDEX";
  }
  if (surface === "kernel-contracts" || surface === "app-kernel-contracts") {
    return true;
  }
  if (surface === "spec-generation-audit" || surface === "high-risk-admissions" || surface === "package-meta" || surface === "package-root") {
    return true;
  }
  return false;
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
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, { ...chunk, evidence_inventory: [] }]));
  const unmapped = [];

  for (const entry of evidenceEntries.sort((left, right) => left.file_ref.localeCompare(right.file_ref))) {
    const candidates = chunks.filter((chunk) => chunkMatchesEvidenceFile(chunk, entry.file_ref));
    if (candidates.length === 0) {
      unmapped.push(entry.file_ref);
      continue;
    }
    const exactAdmissionCandidates = candidates.filter((chunk) => chunkHasExactAdmittedEvidenceRef(chunk, entry.file_ref));
    const selectedChunks = (exactAdmissionCandidates.length > 0 ? exactAdmissionCandidates : candidates.filter((chunk) => chunkAcceptsEvidenceFile(chunk, entry.file_ref)))
      .sort((left, right) => left.chunk_id.localeCompare(right.chunk_id));
    if (selectedChunks.length === 0) {
      unmapped.push(entry.file_ref);
      continue;
    }
    for (const selected of selectedChunks) {
      chunksById.get(selected.chunk_id).evidence_inventory.push(entry.file_ref);
    }
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
