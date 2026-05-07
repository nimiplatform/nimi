import { runAuditSweep } from "./audit-sweep.mjs";
import { runSweepDesign } from "./sweep-design.mjs";
import { localize } from "../lib/ui.mjs";

export async function runSweep(args) {
  const [command] = args;
  const rest = args.slice(1);

  if (command === "audit") {
    return runAuditSweep(rest);
  }

  if (command === "design") {
    return runSweepDesign(rest);
  }

  process.stderr.write(localize(
    "nimicoding sweep refused: expected `audit` or `design`.\n",
    "nimicoding sweep 已拒绝：需要使用 `audit` 或 `design`。\n",
  ));
  return 2;
}
