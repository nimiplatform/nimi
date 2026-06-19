import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateLayerInput } from './layer-input.mjs';
import { solvePackageFromLayerInput, validatePackageManifest } from './package-manifest.mjs';
import { inspectPackage } from './package-inspector.mjs';

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function relativeReportPath(fromDir, targetPath) {
  const relative = path.relative(fromDir, path.resolve(targetPath)).replaceAll('\\', '/');
  return relative.length === 0 ? '.' : relative;
}

function ensureContained(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Ref escapes output directory: ${targetPath}`);
  }
  return target;
}

async function copyLayerAssets(layerInputPath, layerInput, outputRoot) {
  const layerInputDir = path.dirname(path.resolve(layerInputPath));
  const copied = [];
  const refs = [...new Set(layerInput.layers.map((layer) => layer.asset.ref))];
  for (const ref of refs) {
    const sourcePath = path.resolve(layerInputDir, ref);
    const targetPath = ensureContained(outputRoot, path.resolve(outputRoot, ref));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    copied.push(relativeReportPath(outputRoot, targetPath));
  }
  return copied;
}

function packageSolveSummary(solved) {
  return {
    status: solved?.status ?? 'skipped',
    codes: solved?.codes ?? [],
    package_id: solved?.manifest?.package_id ?? null,
    requested_tier: solved?.manifest?.capability?.requested_tier ?? null,
    proven_tier: solved?.manifest?.capability?.proven_tier ?? null,
  };
}

function validationSummary(result) {
  return {
    status: result?.status ?? 'skipped',
    codes: result?.codes ?? [],
    issue_count: result?.issues?.length ?? 0,
  };
}

async function inspectLayerInput(layerInputPath, options = {}) {
  if (!options.outputDir) {
    throw new Error('inspectLayerInput requires options.outputDir.');
  }
  const outputRoot = path.resolve(options.outputDir);
  await mkdir(outputRoot, { recursive: true });

  const absoluteLayerInputPath = path.resolve(layerInputPath);
  const packagePath = path.join(outputRoot, 'package.yaml');
  const packageInspectionPath = path.join(outputRoot, 'package-inspection.yaml');
  const reportPath = path.join(outputRoot, 'layer-input-full-chain-report.yaml');

  const layerValidation = await validateLayerInput(absoluteLayerInputPath);
  let solved = null;
  let assetCopies = [];
  let packageValidation = null;
  let packageInspection = null;

  if (layerValidation.status === 'ok') {
    solved = await solvePackageFromLayerInput(absoluteLayerInputPath, {
      packageId: options.packageId,
      requestedTier: options.requestedTier,
    });
    if (solved.status === 'ok') {
      assetCopies = await copyLayerAssets(absoluteLayerInputPath, layerValidation.value, outputRoot);
      await writeFile(packagePath, YAML.stringify(solved.manifest), 'utf8');
      packageValidation = await validatePackageManifest(packagePath);
      packageInspection = await inspectPackage(packagePath, {
        capabilityProfilePath: options.capabilityProfilePath,
        gridSize: options.gridSize,
        outPath: packageInspectionPath,
      });
    }
  }

  const inspectionReport = packageInspection?.report ?? null;
  const gates = {
    layer_input_valid: passFail(layerValidation.status === 'ok'),
    package_solved: passFail(solved?.status === 'ok'),
    package_valid: passFail(packageValidation?.status === 'ok'),
    package_inspection_passed: passFail(packageInspection?.decision?.verdict === 'pass'),
    render_plan_built: passFail(inspectionReport?.render_plan?.status === 'pass'),
    default_outfit_renderable: passFail((inspectionReport?.render_plan?.default_outfit_layer_refs ?? []).length > 0),
    visual_proof_passed: passFail(inspectionReport?.visual_proof?.status === 'pass'),
    reference_action_passed: passFail(inspectionReport?.reference_action?.status === 'pass'),
    tier1_proven: passFail(inspectionReport?.package?.proven_tier === 'tier-1_agent_basic'),
  };
  const passed = Object.values(gates).every((status) => status === 'pass');
  const report = {
    manifest_kind: 'nimi.nimi2d.layer-input-full-chain-report',
    schema_version: 1,
    layer_input: {
      path: absoluteLayerInputPath,
      input_id: layerValidation.value?.input_id ?? null,
      input_kind: layerValidation.value?.input_kind ?? null,
    },
    outputs: {
      output_dir: '.',
      copied_asset_refs: assetCopies,
      package_manifest_path: relativeReportPath(outputRoot, packagePath),
      package_inspection_report_path: relativeReportPath(outputRoot, packageInspectionPath),
    },
    boundary: {
      closes_production_avatar_readiness: false,
      note: 'Layer-input full-chain inspection is Nimi2D package proof only. Production Avatar embodiment remains Avatar/Runtime-owned.',
    },
    validation: validationSummary(layerValidation),
    package_solve: packageSolveSummary(solved),
    package_validation: validationSummary(packageValidation),
    package_inspection: inspectionReport,
    gates,
    decision: {
      verdict: passed ? 'pass' : 'fail',
      reason: passed
        ? 'Layer input solved into a Nimi2D package and passed package inspection, visual proof, and reference action readiness checks.'
        : 'One or more layer-input full-chain readiness gates failed.',
    },
  };
  await writeFile(reportPath, YAML.stringify(report), 'utf8');
  return {
    status: passed ? 'ok' : 'reject',
    kind: 'layer_input_full_chain_inspection',
    outPath: reportPath,
    decision: report.decision,
    report,
    codes: passed ? [] : ['NIMI2D_LAYER_INPUT_FULL_CHAIN_FAILED'],
    issues: passed ? [] : [{
      code: 'NIMI2D_LAYER_INPUT_FULL_CHAIN_FAILED',
      path: '$.decision',
      message: report.decision.reason,
    }],
  };
}

export { inspectLayerInput };
