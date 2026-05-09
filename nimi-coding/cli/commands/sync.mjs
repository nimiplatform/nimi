import { runSeedSync, SYNC_MODE, SYNC_RESULT_STATUS } from "../lib/sync.mjs";
import { localize } from "../lib/ui.mjs";

function parseSyncOptions(args) {
  const options = {
    mode: SYNC_MODE.DRY_RUN,
    json: false,
  };
  let modeSet = false;

  for (const arg of args) {
    if (arg === "--apply") {
      if (modeSet) {
        return {
          ok: false,
          error: localize(
            "nimicoding sync refused: --apply, --check, and --dry-run are mutually exclusive.\n",
            "nimicoding sync 拒绝执行：--apply、--check、--dry-run 互斥。\n",
          ),
        };
      }
      options.mode = SYNC_MODE.APPLY;
      modeSet = true;
      continue;
    }
    if (arg === "--check") {
      if (modeSet) {
        return {
          ok: false,
          error: localize(
            "nimicoding sync refused: --apply, --check, and --dry-run are mutually exclusive.\n",
            "nimicoding sync 拒绝执行：--apply、--check、--dry-run 互斥。\n",
          ),
        };
      }
      options.mode = SYNC_MODE.CHECK;
      modeSet = true;
      continue;
    }
    if (arg === "--dry-run") {
      if (modeSet) {
        return {
          ok: false,
          error: localize(
            "nimicoding sync refused: --apply, --check, and --dry-run are mutually exclusive.\n",
            "nimicoding sync 拒绝执行：--apply、--check、--dry-run 互斥。\n",
          ),
        };
      }
      options.mode = SYNC_MODE.DRY_RUN;
      modeSet = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    return {
      ok: false,
      error: localize(
        `nimicoding sync refused: unknown option ${arg}.\n`,
        `nimicoding sync 拒绝执行：未知选项 ${arg}。\n`,
      ),
    };
  }

  return { ok: true, options };
}

function formatHumanReport(result) {
  const lines = [];
  lines.push(localize(
    `nimicoding sync (${result.mode})`,
    `nimicoding sync (${result.mode})`,
  ));
  lines.push("");
  lines.push(localize("Summary:", "概览："));
  lines.push(`  total: ${result.summary.total}`);
  lines.push(`  in_sync: ${result.summary.in_sync}`);
  if (result.mode === SYNC_MODE.APPLY) {
    lines.push(`  created: ${result.summary.created}`);
    lines.push(`  updated: ${result.summary.updated}`);
  } else {
    lines.push(`  would_create: ${result.summary.would_create}`);
    lines.push(`  would_update: ${result.summary.would_update}`);
  }
  lines.push(`  drifted_preserved (host_state_seed): ${result.summary.drifted_preserved}`);
  if (result.mode === SYNC_MODE.CHECK) {
    lines.push(`  missing_package_canonical: ${result.summary.missing_package_canonical}`);
    lines.push(`  missing_host_state_seed: ${result.summary.missing_host_state_seed}`);
    lines.push(`  drifted_package_canonical: ${result.summary.drifted_package_canonical}`);
  }

  const noteworthy = result.results.filter((entry) => entry.status !== SYNC_RESULT_STATUS.IN_SYNC);
  if (noteworthy.length > 0) {
    lines.push("");
    lines.push(localize("Per-file status:", "逐文件状态："));
    for (const entry of noteworthy) {
      lines.push(`  [${entry.status}] (${entry.ownership}) ${entry.outputRelativePath}`);
    }
  }

  if (result.mode === SYNC_MODE.CHECK && !result.ok) {
    lines.push("");
    lines.push(localize(
      "FAIL: package_canonical drift or missing seed detected; run `nimicoding sync --apply` to refresh.",
      "FAIL：检测到 package_canonical drift 或缺失 seed；执行 `nimicoding sync --apply` 以刷新。",
    ));
  }

  return `${lines.join("\n")}\n`;
}

export async function runSync(args) {
  const parsed = parseSyncOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const result = await runSeedSync(process.cwd(), parsed.options.mode);

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanReport(result));
  }

  return result.ok ? 0 : 1;
}

export { parseSyncOptions };
