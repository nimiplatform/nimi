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

function buildChunks(includedInventory, options) {
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

export async function createAuditSweepPlan(projectRoot, options) {
  const targetRoot = resolveInsideProject(projectRoot, options.root ?? ".", "--root");
  if (!targetRoot.ok) {
    return inputError(targetRoot.error);
  }

  const targetInfo = await pathExists(targetRoot.absolutePath);
  if (!targetInfo || !targetInfo.isDirectory()) {
    return inputError("nimicoding audit-sweep refused: --root must point to an existing directory.\n");
  }

  const sweepId = options.sweepId ? safeSweepId(options.sweepId) : deriveSweepId(targetRoot.ref);
  if (!sweepId) {
    return inputError("nimicoding audit-sweep refused: --sweep-id must be a safe id.\n");
  }

  const criteria = normalizeCsv(options.criteria, DEFAULT_CRITERIA);
  const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...normalizeCsv(options.exclude)];
  const maxFilesPerChunk = Number.isInteger(options.maxFilesPerChunk) && options.maxFilesPerChunk > 0
    ? options.maxFilesPerChunk
    : DEFAULT_MAX_FILES_PER_CHUNK;
  const gitFiles = await listGitFiles(projectRoot, targetRoot.ref);
  const allFileRefs = gitFiles.length > 0
    ? gitFiles.map((entry) => toPosix(entry))
    : await listFallbackFiles(projectRoot, targetRoot.ref, excludePatterns);
  const inventory = [];
  for (const fileRef of allFileRefs) {
    inventory.push(await buildInventoryEntry(projectRoot, fileRef, targetRoot.ref, excludePatterns));
  }

  const includedInventory = inventory.filter((entry) => entry.included);
  const chunks = buildChunks(includedInventory, { criteria, maxFilesPerChunk });
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
    target_root: targetRoot.ref,
    criteria,
    max_files_per_chunk: maxFilesPerChunk,
    exclude_patterns: excludePatterns,
    inventory_hash: inventoryHash,
    inventory,
    chunks,
    coverage: {
      total_files: inventory.length,
      included_files: includedInventory.length,
      excluded_files: inventory.length - includedInventory.length,
      chunk_count: chunks.length,
    },
    run_ledger_ref: runLedgerRef(sweepId),
    created_at: createdAt,
    updated_at: createdAt,
  };

  await writeYamlRef(projectRoot, planRef(sweepId), plan);
  for (const chunk of chunks) {
    const chunkInventory = includedInventory.filter((entry) => chunk.files.includes(entry.file_ref));
    await writeYamlRef(projectRoot, chunkRef(sweepId, chunk.chunk_id), {
      version: 1,
      kind: "audit-chunk",
      sweep_id: sweepId,
      chunk_id: chunk.chunk_id,
      state: "planned",
      owner_domain: chunk.owner_domain,
      criteria,
      files: chunk.files,
      file_count: chunk.files.length,
      file_hashes: Object.fromEntries(chunkInventory.map((entry) => [entry.file_ref, entry.sha256])),
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
    inventoryHash,
    criteria,
    maxFilesPerChunk,
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
