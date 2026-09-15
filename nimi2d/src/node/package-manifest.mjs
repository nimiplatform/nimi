import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateLayerInput } from './layer-input.mjs';
import {
  readManifest,
  issue,
  result,
  isObject,
} from './common.mjs';
import { validatePackageObject } from './package-validator.mjs';

export async function validatePackageManifest(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifest);
  const { value, parseError } = await readManifest(absoluteManifest);
  if (parseError || !isObject(value)) {
    const issues = [];
    issues.push(issue('NIMI2D_PACKAGE_MANIFEST_INVALID', '$', 'Package manifest cannot parse as an object.'));
    return result('package_manifest', absoluteManifest, issues);
  }
  return await validatePackageObject(value, { manifestPath: absoluteManifest, manifestDir });
}

// @nimi-authority: rule.nimi.nimi2d.asset-package.r014
// @nimi-authority: rule.nimi.nimi2d.asset-package.r023
export async function solvePackageFromLayerInput(layerInputPath) {
  const layerResult = await validateLayerInput(layerInputPath);
  if (layerResult.status !== 'ok') {
    return { status: 'reject', kind: 'package_solve', issues: layerResult.issues, codes: layerResult.codes };
  }
  if (layerResult.value.input_kind !== 'character_skin') {
    const issues = [issue('NIMI2D_SOLVE_UNSUPPORTED_INPUT_KIND', '$.input_kind', 'The package solver accepts only character_skin inputs.')];
    return { status: 'reject', kind: 'package_solve', issues, codes: ['NIMI2D_SOLVE_UNSUPPORTED_INPUT_KIND'] };
  }
  // The closed layer-input wire contains hints, not solved topology. There
  // is currently no owner implementation producing the required skeleton,
  // morphology, deformation and action data. A complete hint list does not
  // supply that missing data, and no package or proven tier may be minted.
  const code = 'NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE';
  return {
    status: 'reject', kind: 'package_solve', codes: [code],
    issues: [issue(code, '$', 'Character package solving is unavailable: layer hints do not provide the required solved skeleton, morphology, deformation and action topology.')],
  };
}

export async function writeSolvedPackage(layerInputPath, outPath, options = {}) {
  const solved = await solvePackageFromLayerInput(layerInputPath, options);
  if (solved.status !== 'ok') return solved;
  await writeFile(outPath, YAML.stringify(solved.manifest), 'utf8');
  return { ...solved, outPath: path.resolve(outPath) };
}
