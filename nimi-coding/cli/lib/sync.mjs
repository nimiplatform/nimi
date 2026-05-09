import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBootstrapSeedEntries } from "../seeds/bootstrap.mjs";
import { pathExists, readTextIfFile } from "./fs-helpers.mjs";

export const SYNC_MODE = {
  DRY_RUN: "dry_run",
  APPLY: "apply",
  CHECK: "check",
};

const STATUS = {
  IN_SYNC: "in_sync",
  CREATED: "created",
  UPDATED: "updated",
  WOULD_CREATE: "would_create",
  WOULD_UPDATE: "would_update",
  DRIFTED_PRESERVED: "drifted_preserved",
  MISSING_PACKAGE_CANONICAL: "missing_package_canonical",
  MISSING_HOST_STATE_SEED: "missing_host_state_seed",
  DRIFTED_PACKAGE_CANONICAL: "drifted_package_canonical",
};

async function evaluateSeedEntry(projectRoot, entry, mode) {
  const absolutePath = path.join(projectRoot, entry.outputRelativePath);
  const info = await pathExists(absolutePath);
  const fileExists = Boolean(info && info.isFile());

  if (!fileExists) {
    if (mode === SYNC_MODE.APPLY) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, entry.content, "utf8");
      return {
        outputRelativePath: entry.outputRelativePath,
        ownership: entry.ownership,
        status: STATUS.CREATED,
        detail: "missing host file was seeded from package source",
      };
    }
    return {
      outputRelativePath: entry.outputRelativePath,
      ownership: entry.ownership,
      status: entry.ownership === "host_state_seed"
        ? STATUS.MISSING_HOST_STATE_SEED
        : STATUS.MISSING_PACKAGE_CANONICAL,
      detail: mode === SYNC_MODE.CHECK
        ? "host file is missing"
        : "host file is missing and would be seeded on --apply",
    };
  }

  const actual = await readTextIfFile(absolutePath);
  if (actual === entry.content) {
    return {
      outputRelativePath: entry.outputRelativePath,
      ownership: entry.ownership,
      status: STATUS.IN_SYNC,
      detail: "host file matches package source byte-for-byte",
    };
  }

  if (entry.ownership === "host_state_seed") {
    return {
      outputRelativePath: entry.outputRelativePath,
      ownership: entry.ownership,
      status: STATUS.DRIFTED_PRESERVED,
      detail: "host_state_seed: host owns canonical content; sync preserves host copy",
    };
  }

  if (mode === SYNC_MODE.APPLY) {
    await writeFile(absolutePath, entry.content, "utf8");
    return {
      outputRelativePath: entry.outputRelativePath,
      ownership: entry.ownership,
      status: STATUS.UPDATED,
      detail: "drifted package_canonical file rewritten to package source",
    };
  }

  return {
    outputRelativePath: entry.outputRelativePath,
    ownership: entry.ownership,
    status: mode === SYNC_MODE.CHECK
      ? STATUS.DRIFTED_PACKAGE_CANONICAL
      : STATUS.WOULD_UPDATE,
    detail: "host file diverges from package_canonical source",
  };
}

export async function runSeedSync(projectRoot, mode = SYNC_MODE.DRY_RUN) {
  const entries = await getBootstrapSeedEntries();
  const results = [];
  for (const entry of entries) {
    results.push(await evaluateSeedEntry(projectRoot, entry, mode));
  }

  const summary = {
    total: results.length,
    in_sync: 0,
    created: 0,
    updated: 0,
    would_create: 0,
    would_update: 0,
    drifted_preserved: 0,
    missing_host_state_seed: 0,
    missing_package_canonical: 0,
    drifted_package_canonical: 0,
  };

  for (const result of results) {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
  }

  // Re-derive dry-run status counters when no apply happened.
  if (mode === SYNC_MODE.DRY_RUN) {
    summary.would_create = results.filter((r) =>
      r.status === STATUS.MISSING_HOST_STATE_SEED || r.status === STATUS.MISSING_PACKAGE_CANONICAL,
    ).length;
    summary.would_update = results.filter((r) => r.status === STATUS.WOULD_UPDATE).length;
  }

  const checkFailures = mode === SYNC_MODE.CHECK
    ? results.filter((r) =>
      r.status === STATUS.MISSING_PACKAGE_CANONICAL
      || r.status === STATUS.MISSING_HOST_STATE_SEED
      || r.status === STATUS.DRIFTED_PACKAGE_CANONICAL,
    )
    : [];

  return {
    mode,
    summary,
    results,
    ok: mode === SYNC_MODE.CHECK ? checkFailures.length === 0 : true,
    checkFailures,
  };
}

export const SYNC_RESULT_STATUS = STATUS;
