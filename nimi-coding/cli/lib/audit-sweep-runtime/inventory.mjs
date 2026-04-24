import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  AUDITABLE_EXTENSIONS,
  DEFAULT_CRITERIA,
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_MAX_FILES_PER_CHUNK,
  appendRunEvent,
  artifactPath,
  chunkRef,
  deriveSweepId,
  inputError,
  loadPlan,
  normalizeCsv,
  planRef,
  relPath,
  resolveInsideProject,
  runLedgerRef,
  safeSweepId,
  sha256Object,
  sha256Text,
  toPosix,
  writeYamlRef,
} from "./common.mjs";
import { pathExists } from "../fs-helpers.mjs";

const execFile = promisify(execFileCallback);

async function listGitFiles(projectRoot, targetRootRef) {
  try {
    const result = await execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "--", targetRootRef],
      { cwd: projectRoot },
    );
    return result.stdout.split(/\r?\n/).filter(Boolean).sort();
  } catch {
    return [];
  }
}

function isExcluded(fileRef, excludePatterns) {
  return excludePatterns.some((pattern) => {
    const normalized = pattern.replace(/\\/g, "/");
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith("/")) {
      return fileRef === normalized.slice(0, -1) || fileRef.startsWith(normalized);
    }
    return fileRef === normalized || fileRef.includes(normalized);
  });
}

async function listFallbackFiles(projectRoot, targetRootRef, excludePatterns) {
  const targetRoot = path.resolve(projectRoot, targetRootRef);
  const files = [];

  async function visit(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const fileRef = relPath(projectRoot, absolutePath);
      if (isExcluded(entry.isDirectory() ? `${fileRef}/` : fileRef, excludePatterns)) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(fileRef);
      }
    }
  }

  await visit(targetRoot);
  return files.sort();
}

function classifyFile(fileRef) {
  const extension = path.posix.extname(fileRef);
  if ([".md", ".yaml", ".yml", ".json"].includes(extension)) {
    return "contract-or-doc";
  }
  if ([".test.ts", ".test.js", ".spec.ts", ".spec.js"].some((suffix) => fileRef.endsWith(suffix))) {
    return "test";
  }
  return "implementation";
}

function ownerDomainForFile(fileRef, targetRootRef) {
  const normalizedTarget = targetRootRef === "." ? "" : `${targetRootRef.replace(/\/$/, "")}/`;
  const withoutTarget = normalizedTarget && fileRef.startsWith(normalizedTarget)
    ? fileRef.slice(normalizedTarget.length)
    : fileRef;
  const parts = withoutTarget.split("/");
  if (parts.length <= 1) {
    return targetRootRef === "." ? "root" : targetRootRef;
  }
  return path.posix.join(targetRootRef === "." ? "" : targetRootRef, parts[0]) || parts[0];
}

function isSpecAuthorityRoot(ref) {
  return ref === ".nimi/spec" || ref === ".nimi/spec/";
}

async function hasSpecAuthorityRoot(projectRoot) {
  const info = await pathExists(path.join(projectRoot, ".nimi", "spec"));
  return info?.isDirectory() === true;
}

function resolveChunkBasis(targetRootRef, requested, specRootPresent) {
  const normalized = requested ? String(requested).trim() : "auto";
  if (!["auto", "files", "spec"].includes(normalized)) {
    return { ok: false, error: "nimicoding audit-sweep refused: --chunk-basis must be auto, files, or spec.\n" };
  }
  if (normalized === "files") {
    return { ok: true, basis: "files" };
  }
  if (normalized === "spec") {
    return specRootPresent
      ? { ok: true, basis: "spec" }
      : { ok: false, error: "nimicoding audit-sweep refused: --chunk-basis spec requires .nimi/spec.\n" };
  }
  return { ok: true, basis: (targetRootRef === "." || isSpecAuthorityRoot(targetRootRef)) && specRootPresent ? "spec" : "files" };
}

async function buildInventoryEntry(projectRoot, fileRef, targetRootRef, excludePatterns) {
  const extension = path.posix.extname(fileRef);
  const excluded = isExcluded(fileRef, excludePatterns);
  const auditable = AUDITABLE_EXTENSIONS.has(extension);
  const absolutePath = artifactPath(projectRoot, fileRef);
  const fileStat = await stat(absolutePath);
  const contents = await readFile(absolutePath);
  const included = !excluded && auditable;

  return {
    file_ref: fileRef,
    sha256: sha256Text(contents),
    bytes: fileStat.size,
    extension: extension || "none",
    owner_domain: ownerDomainForFile(fileRef, targetRootRef),
    classification: classifyFile(fileRef),
    included,
    exclusion_reason: included
      ? null
      : (excluded ? "matched_exclude_pattern" : "extension_not_auditable"),
  };
}

function buildFileChunks(includedInventory, options) {
  const byOwner = new Map();
  for (const entry of includedInventory) {
    const files = byOwner.get(entry.owner_domain) ?? [];
    files.push(entry);
    byOwner.set(entry.owner_domain, files);
  }

  const chunks = [];
  for (const [ownerDomain, entries] of [...byOwner.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const sortedEntries = entries.sort((left, right) => left.file_ref.localeCompare(right.file_ref));
    for (let index = 0; index < sortedEntries.length; index += options.maxFilesPerChunk) {
      const chunkEntries = sortedEntries.slice(index, index + options.maxFilesPerChunk);
      chunks.push({
        chunk_id: `chunk-${String(chunks.length + 1).padStart(3, "0")}`,
        state: "planned",
        owner_domain: ownerDomain,
        criteria: options.criteria,
        files: chunkEntries.map((entry) => entry.file_ref),
        file_count: chunkEntries.length,
        finding_count: 0,
      });
    }
  }

  return chunks;
}

function specSurfaceForFile(fileRef) {
  const withoutRoot = fileRef.startsWith(".nimi/spec/")
    ? fileRef.slice(".nimi/spec/".length)
    : fileRef;
  const parts = withoutRoot.split("/");
  if (parts[0] === "_meta") {
    return { ownerDomain: "spec-meta", surface: path.posix.basename(fileRef, path.posix.extname(fileRef)) };
  }
  if (parts.length === 1) {
    return { ownerDomain: "spec-root", surface: path.posix.basename(fileRef, path.posix.extname(fileRef)) };
  }
  const domain = parts[0];
  if (parts[1] === "kernel" && parts[2] === "tables") {
    return { ownerDomain: domain, surface: "kernel-tables" };
  }
  if (parts[1] === "kernel" && parts[2] === "generated") {
    return { ownerDomain: domain, surface: "kernel-generated" };
  }
  if (parts[1] === "kernel") {
    return { ownerDomain: domain, surface: "kernel-contracts" };
  }
  return { ownerDomain: domain, surface: "domain-guides" };
}

function evidenceRootsForSpecOwner(ownerDomain, targetRootRef) {
  if (targetRootRef !== ".") {
    return [targetRootRef];
  }
  const repoWideEvidenceRoots = [
    ".github",
    "apps",
    "config",
    "kit",
    "nimi-coding",
    "nimi-cognition",
    "proto",
    "runtime",
    "scripts",
    "sdk",
    ".nimi/spec",
    ".nimi/contracts",
    ".nimi/methodology",
  ];
  const roots = {
    "spec-meta": repoWideEvidenceRoots,
    "spec-root": repoWideEvidenceRoots,
    cognition: ["nimi-cognition", ".nimi/spec/cognition"],
    desktop: ["apps/desktop", "kit", ".nimi/spec/desktop"],
    future: [".nimi/spec/future", ".nimi/topics"],
    platform: ["kit", "scripts", ".nimi/spec/platform"],
    realm: ["sdk/src/realm", "runtime/internal/protocol", ".nimi/spec/realm"],
    runtime: ["runtime", "proto/runtime/v1", "scripts", "config", ".nimi/spec/runtime"],
    sdk: ["sdk/src", "sdk/test", "scripts", ".nimi/spec/sdk"],
  };
  return roots[ownerDomain] ?? [ownerDomain, `.nimi/spec/${ownerDomain}`];
}

function slugPart(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "spec";
}

function buildSpecChunks(includedInventory, options) {
  const sortedEntries = [...includedInventory].sort((left, right) => left.file_ref.localeCompare(right.file_ref));
  return sortedEntries.map((entry, index) => {
    const surface = specSurfaceForFile(entry.file_ref);
    const chunkId = [
      `chunk-${String(index + 1).padStart(3, "0")}`,
      slugPart(surface.ownerDomain),
      slugPart(surface.surface),
      slugPart(path.posix.basename(entry.file_ref, path.posix.extname(entry.file_ref))),
    ].join("-");
    return {
      chunk_id: chunkId,
      state: "planned",
      owner_domain: surface.ownerDomain,
      planning_basis: "spec_authority",
      spec_surface: surface.surface,
      criteria: options.criteria,
      files: [entry.file_ref],
      authority_refs: [entry.file_ref],
      evidence_roots: evidenceRootsForSpecOwner(surface.ownerDomain, options.targetRootRef),
      file_count: 1,
      finding_count: 0,
    };
  });
}

async function listAuditableEntriesForRoot(projectRoot, rootRef, excludePatterns) {
  const rootInfo = await pathExists(artifactPath(projectRoot, rootRef));
  if (!rootInfo) {
    return [];
  }
  const gitFiles = await listGitFiles(projectRoot, rootRef);
  const allFileRefs = gitFiles.length > 0
    ? gitFiles.map((entry) => toPosix(entry))
    : (rootInfo.isDirectory() ? await listFallbackFiles(projectRoot, rootRef, excludePatterns) : [rootRef]);
  const entries = [];
  for (const fileRef of allFileRefs) {
    const normalizedRef = toPosix(fileRef);
    if (isExcluded(normalizedRef, excludePatterns)) {
      continue;
    }
    const extension = path.posix.extname(normalizedRef);
    if (!AUDITABLE_EXTENSIONS.has(extension)) {
      continue;
    }
    entries.push(await buildInventoryEntry(projectRoot, normalizedRef, ".", excludePatterns));
  }
  return entries.filter((entry) => entry.included);
}

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

function assignEvidenceInventory(evidenceEntries, chunks, options = {}) {
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
      return {
        ...chunk,
        evidence_inventory: enriched.evidence_inventory.sort(),
        coverage_contract: {
          authority_refs_required: true,
          evidence_inventory_required: true,
          evidence_files_must_cover_inventory: true,
        },
      };
    }),
    unmappedEvidenceFiles: unmapped.sort(),
  };
}

export async function createAuditSweepPlan(projectRoot, options) {
  const targetRoot = resolveInsideProject(projectRoot, options.root ?? ".", "--root");
  if (!targetRoot.ok) {
    return inputError(targetRoot.error);
  }
  const targetRootRef = targetRoot.ref || ".";

  const targetInfo = await pathExists(targetRoot.absolutePath);
  if (!targetInfo || !targetInfo.isDirectory()) {
    return inputError("nimicoding audit-sweep refused: --root must point to an existing directory.\n");
  }

  const sweepId = options.sweepId ? safeSweepId(options.sweepId) : deriveSweepId(targetRootRef);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id must be a safe id.\n");
  }

  const specRootPresent = await hasSpecAuthorityRoot(projectRoot);
  const chunkBasis = resolveChunkBasis(targetRootRef, options.chunkBasis, specRootPresent);
  if (!chunkBasis.ok) {
    return inputError(chunkBasis.error);
  }
  const inventoryRootRef = chunkBasis.basis === "spec" ? ".nimi/spec" : targetRootRef;
  const criteria = normalizeCsv(options.criteria, DEFAULT_CRITERIA);
  const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...normalizeCsv(options.exclude)];
  const maxFilesPerChunk = Number.isInteger(options.maxFilesPerChunk) && options.maxFilesPerChunk > 0
    ? options.maxFilesPerChunk
    : DEFAULT_MAX_FILES_PER_CHUNK;
  const gitFiles = await listGitFiles(projectRoot, inventoryRootRef);
  const allFileRefs = gitFiles.length > 0
    ? gitFiles.map((entry) => toPosix(entry))
    : await listFallbackFiles(projectRoot, inventoryRootRef, excludePatterns);
  const inventory = [];
  for (const fileRef of allFileRefs) {
    inventory.push(await buildInventoryEntry(projectRoot, fileRef, inventoryRootRef, excludePatterns));
  }

  const includedInventory = inventory.filter((entry) => entry.included);
  const authorityFileRefs = new Set(includedInventory.map((entry) => entry.file_ref));
  let chunks = chunkBasis.basis === "spec"
    ? buildSpecChunks(includedInventory, { criteria, targetRootRef })
    : buildFileChunks(includedInventory, { criteria, maxFilesPerChunk });
  let evidenceInventory = [];
  let unmappedEvidenceFiles = [];
  let evidenceInventoryHash = null;
  if (chunkBasis.basis === "spec") {
    const evidenceRoots = [...new Set(chunks.flatMap((chunk) => chunk.evidence_roots ?? []))].sort();
    const evidenceByFile = new Map();
    for (const rootRef of evidenceRoots) {
      const entries = await listAuditableEntriesForRoot(projectRoot, rootRef, excludePatterns);
      for (const entry of entries) {
        if (!authorityFileRefs.has(entry.file_ref)) {
          evidenceByFile.set(entry.file_ref, entry);
        }
      }
    }
    evidenceInventory = [...evidenceByFile.values()].sort((left, right) => left.file_ref.localeCompare(right.file_ref));
    const assigned = assignEvidenceInventory(evidenceInventory, chunks, {
      maxEvidenceFilesPerChunk: maxFilesPerChunk,
    });
    chunks = assigned.chunks;
    unmappedEvidenceFiles = assigned.unmappedEvidenceFiles;
    evidenceInventoryHash = sha256Object(evidenceInventory.map((entry) => ({
      file_ref: entry.file_ref,
      sha256: entry.sha256,
      included: entry.included,
      exclusion_reason: entry.exclusion_reason,
    })));
  }
  const createdAt = options.createdAt ?? new Date().toISOString();
  const inventoryHash = sha256Object(inventory.map((entry) => ({
    file_ref: entry.file_ref,
    sha256: entry.sha256,
    included: entry.included,
    exclusion_reason: entry.exclusion_reason,
  })));
  const plan = {
    version: 1,
    kind: "audit-plan",
    sweep_id: sweepId,
    target_root: targetRootRef,
    planning_basis: {
      mode: chunkBasis.basis === "spec" ? "spec_authority" : "file_inventory",
      authority_root: chunkBasis.basis === "spec" ? ".nimi/spec" : null,
      inventory_root: inventoryRootRef,
      evidence_root: targetRootRef,
      files_are_evidence_only: chunkBasis.basis === "spec",
    },
    criteria,
    max_files_per_chunk: maxFilesPerChunk,
    exclude_patterns: excludePatterns,
    inventory_hash: inventoryHash,
    ...(evidenceInventoryHash ? { evidence_inventory_hash: evidenceInventoryHash } : {}),
    inventory,
    ...(chunkBasis.basis === "spec" ? {
      evidence_inventory: evidenceInventory.map((entry) => ({
        file_ref: entry.file_ref,
        sha256: entry.sha256,
        bytes: entry.bytes,
        extension: entry.extension,
        owner_domain: entry.owner_domain,
        classification: entry.classification,
        included: entry.included,
        exclusion_reason: entry.exclusion_reason,
      })),
      unmapped_evidence_files: unmappedEvidenceFiles,
    } : {}),
    chunks,
    coverage: {
      total_files: inventory.length,
      included_files: includedInventory.length,
      excluded_files: inventory.length - includedInventory.length,
      ...(chunkBasis.basis === "spec" ? {
        authority_files: includedInventory.length,
        evidence_files: evidenceInventory.length,
        unmapped_evidence_files: unmappedEvidenceFiles.length,
      } : {}),
      chunk_count: chunks.length,
    },
    run_ledger_ref: runLedgerRef(sweepId),
    created_at: createdAt,
    updated_at: createdAt,
  };

  await writeYamlRef(projectRoot, planRef(sweepId), plan);
  for (const chunk of chunks) {
    const chunkInventory = includedInventory.filter((entry) => chunk.files.includes(entry.file_ref));
    const evidenceByFile = new Map(evidenceInventory.map((entry) => [entry.file_ref, entry]));
    await writeYamlRef(projectRoot, chunkRef(sweepId, chunk.chunk_id), {
      version: 1,
      kind: "audit-chunk",
      sweep_id: sweepId,
      chunk_id: chunk.chunk_id,
      state: "planned",
      owner_domain: chunk.owner_domain,
      criteria,
      files: chunk.files,
      ...(chunk.planning_basis ? { planning_basis: chunk.planning_basis } : {}),
      ...(chunk.spec_surface ? { spec_surface: chunk.spec_surface } : {}),
      ...(chunk.authority_refs ? { authority_refs: chunk.authority_refs } : {}),
      ...(chunk.evidence_roots ? { evidence_roots: chunk.evidence_roots } : {}),
      ...(chunk.evidence_inventory ? { evidence_inventory: chunk.evidence_inventory } : {}),
      ...(chunk.coverage_contract ? { coverage_contract: chunk.coverage_contract } : {}),
      file_count: chunk.files.length,
      file_hashes: Object.fromEntries(chunkInventory.map((entry) => [entry.file_ref, entry.sha256])),
      ...(chunk.evidence_inventory ? {
        evidence_file_hashes: Object.fromEntries(chunk.evidence_inventory.map((fileRef) => [fileRef, evidenceByFile.get(fileRef)?.sha256]).filter(([, hash]) => Boolean(hash))),
      } : {}),
      lifecycle: {
        planned_at: createdAt,
        dispatched_at: null,
        ingested_at: null,
        reviewed_at: null,
        frozen_at: null,
        failed_at: null,
        skipped_at: null,
      },
      evidence_ref: null,
      review: null,
      failure: null,
      finding_count: 0,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  const runRef = await appendRunEvent(projectRoot, sweepId, {
    event_type: "plan_created",
    plan_ref: planRef(sweepId),
    inventory_hash: inventoryHash,
    included_files: includedInventory.length,
    chunk_count: chunks.length,
  });

  return {
    ok: true,
    exitCode: 0,
    sweepId,
    planRef: planRef(sweepId),
    chunkRefs: chunks.map((chunk) => chunkRef(sweepId, chunk.chunk_id)),
    runLedgerRef: runRef,
    chunkCount: chunks.length,
    totalFiles: inventory.length,
    includedFiles: includedInventory.length,
    excludedFiles: inventory.length - includedInventory.length,
    ...(chunkBasis.basis === "spec" ? {
      evidenceFiles: evidenceInventory.length,
      unmappedEvidenceFiles: unmappedEvidenceFiles.length,
      evidenceInventoryHash,
    } : {}),
    inventoryHash,
    criteria,
    maxFilesPerChunk,
    chunkBasis: plan.planning_basis.mode,
  };
}

export async function getPlannedChunkRefs(projectRoot, sweepId) {
  const loaded = await loadPlan(projectRoot, sweepId);
  if (!loaded.ok) {
    return loaded;
  }
  return {
    ok: true,
    chunkRefs: loaded.plan.chunks.map((chunk) => chunkRef(sweepId, chunk.chunk_id)),
  };
}
