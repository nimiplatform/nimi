import path from "node:path";

import { buildValidatorCliReport, validateSpecTree } from "../lib/validators.mjs";
import { localize } from "../lib/ui.mjs";

export async function runValidateSpecTree(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  let targetRoot = ".nimi/spec";

  if (normalized.length > 1) {
    process.stderr.write(localize(
      "nimicoding validate-spec-tree refused: expected zero or one path argument.\n",
      "nimicoding validate-spec-tree 已拒绝：期望零个或一个路径参数。\n",
    ));
    return 2;
  }

  if (normalized.length === 1) {
    targetRoot = normalized[0];
  }

  const absoluteRoot = path.resolve(process.cwd(), targetRoot);
  const report = await validateSpecTree(absoluteRoot, { projectRoot: process.cwd() });
  const cliReport = buildValidatorCliReport("validate-spec-tree", absoluteRoot, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
