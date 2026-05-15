import {
  classifySpecSurface,
  parseSurfaceValidatorOptions,
  validateDomainAdmission,
  validateGuidanceBodies,
  validatePlacement,
  validateProjectionEdges,
  validateTableFamily,
  validateTrackedOutputAdmission,
  writeInventoryIfRequested,
} from "../lib/internal/surface-taxonomy-validators.mjs";
import { localize } from "../lib/ui.mjs";

const VALIDATORS = {
  "classify-spec-tree": classifySpecSurface,
  "validate-placement": validatePlacement,
  "validate-table-family": validateTableFamily,
  "validate-projection-edges": validateProjectionEdges,
  "validate-guidance-bodies": validateGuidanceBodies,
  "validate-domain-admission": validateDomainAdmission,
  "validate-tracked-output-admission": validateTrackedOutputAdmission,
};

export async function runSurfaceValidatorCommand(args, validatorName) {
  const parsed = parseSurfaceValidatorOptions(args);
  if (!parsed.ok) {
    process.stderr.write(localize(
      `nimicoding ${validatorName} refused: ${parsed.error}\n`,
      `nimicoding ${validatorName} 已拒绝：${parsed.error}\n`,
    ));
    return 2;
  }

  const validator = VALIDATORS[validatorName];
  if (!validator) {
    process.stderr.write(localize(
      `nimicoding ${validatorName} refused: unknown surface validator.\n`,
      `nimicoding ${validatorName} 已拒绝：未知 surface validator。\n`,
    ));
    return 2;
  }

  const report = await validator(process.cwd(), parsed.options);
  if (validatorName === "classify-spec-tree") {
    await writeInventoryIfRequested(report, parsed.options.emit, process.cwd());
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
