import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';
import { cutLayerAtlas } from '../image-input/atlas-cutter.mjs';
import { validateLayerInput } from '../layer-input.mjs';
import { validatePackageManifest, writeSolvedPackage } from '../package-manifest.mjs';
import { decodePngRgba } from '../png-rgba.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { createNimi2DRenderPlan } from '../../runtime/index.mjs';
import { CODEX_IMAGE2_ARTIFACT_KIND } from './artifact.mjs';
import {
  buildAtlasSpec,
  defaultColumns,
  defaultRows,
  makeTransparentAtlas,
  normalizeAtlasBackground,
} from './layer-workflow-atlas.mjs';

const producerManifestKind = CODEX_IMAGE2_ARTIFACT_KIND;
const consumableProducerVerdicts = new Set(['admit', 'recorded_only']);
const workflowRunMarker = '.nimi2d-image2-layer-workflow-run';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = path.resolve(packageRoot, '..');

function usage() {
  return [
    'Usage:',
    '  nimi2d image2-layer-workflow \\',
    '    (--image <codex-image2-atlas.png> | --producer-manifest <codex-image2.artifact.yaml>) \\',
    '    --out-dir <artifact-dir>',
    '',
    'This command normalizes a Codex Image2 atlas into machine-cut chroma-key,',
    'writes an atlas spec, cuts layer PNGs, and validates the layer/package output.',
  ].join('\n');
}

function getFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function requireFlag(args, name) {
  const value = getFlag(args, name);
  if (!value) throw new Error(`Missing required flag: ${name}`);
  return value;
}

function sameResolvedPath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === 'win32') return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  return resolvedLeft === resolvedRight;
}

async function directoryExists(dirPath) {
  try {
    const info = await stat(dirPath);
    return info.isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function prepareWorkflowOutDir(outDir) {
  const resolved = path.resolve(outDir);
  const forbidden = [
    process.cwd(),
    packageRoot,
    repoRoot,
    path.parse(resolved).root,
  ];
  if (forbidden.some((item) => sameResolvedPath(resolved, item))) {
    throw new Error(`NIMI2D_IMAGE2_WORKFLOW_OUT_DIR_UNSAFE: refusing to clean protected directory ${resolved}`);
  }
  if (await directoryExists(resolved)) {
    const entries = await readdir(resolved);
    const hasMarker = entries.includes(workflowRunMarker);
    if (entries.length > 0 && !hasMarker) {
      throw new Error(`NIMI2D_IMAGE2_WORKFLOW_OUT_DIR_UNSAFE: refusing to clean non-workflow directory ${resolved}`);
    }
    if (hasMarker) {
      await rm(resolved, { recursive: true, force: true });
    }
  }
  await mkdir(resolved, { recursive: true });
  await writeFile(path.join(resolved, workflowRunMarker), 'owned by nimi2d image2-layer-workflow\n', 'utf8');
}

async function writeYaml(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, YAML.stringify(value), 'utf8');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateProducerManifest(manifest, manifestPath) {
  if (!isRecord(manifest)) {
    throw new Error(`NIMI2D_IMAGE2_PRODUCER_MANIFEST_INVALID: ${manifestPath} is not a YAML object.`);
  }
  if (manifest.verdict && !consumableProducerVerdicts.has(manifest.verdict)) {
    throw new Error(`NIMI2D_IMAGE2_PRODUCER_REJECTED: ${manifestPath} verdict is ${manifest.verdict}.`);
  }
  const issues = [];
  if (manifest.manifest_kind !== producerManifestKind) {
    issues.push(`manifest_kind must be ${producerManifestKind}`);
  }
  if (manifest.schema_version !== 1) {
    issues.push('schema_version must be 1');
  }
  if (!consumableProducerVerdicts.has(manifest.verdict)) {
    issues.push(`verdict must be one of ${[...consumableProducerVerdicts].join(', ')}`);
  }
  if (!isRecord(manifest.producer)) {
    issues.push('producer object is required');
  }
  if (!isRecord(manifest.artifact)) {
    issues.push('artifact object is required');
  } else {
    if (typeof manifest.artifact.path !== 'string' || manifest.artifact.path.length === 0) {
      issues.push('artifact.path is required');
    }
    if (manifest.artifact.format !== 'png') {
      issues.push('artifact.format must be png');
    }
    if (!Number.isInteger(manifest.artifact.width_px) || manifest.artifact.width_px <= 0) {
      issues.push('artifact.width_px must be a positive integer');
    }
    if (!Number.isInteger(manifest.artifact.height_px) || manifest.artifact.height_px <= 0) {
      issues.push('artifact.height_px must be a positive integer');
    }
    if (typeof manifest.artifact.file_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.artifact.file_sha256)) {
      issues.push('artifact.file_sha256 must be lowercase sha256 hex');
    }
    if (typeof manifest.artifact.decoded_pixel_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.artifact.decoded_pixel_sha256)) {
      issues.push('artifact.decoded_pixel_sha256 must be lowercase sha256 hex');
    }
  }
  if (issues.length > 0) {
    throw new Error(`NIMI2D_IMAGE2_PRODUCER_MANIFEST_INVALID: ${issues.join('; ')}`);
  }
}

async function readProducerManifest(manifestPath) {
  const absolutePath = path.resolve(manifestPath);
  const bytes = await readFile(absolutePath);
  const manifest = YAML.parse(bytes.toString('utf8'));
  validateProducerManifest(manifest, absolutePath);
  return {
    path: absolutePath,
    bytes,
    fileSha256: sha256(bytes),
    manifest,
  };
}

function assertProducerArtifactMatchesImage(producerRecord, sourceBytes, decoded) {
  if (!producerRecord) return;
  const artifact = producerRecord.manifest.artifact;
  const imageHash = sha256(sourceBytes);
  const issues = [];
  if (artifact.file_sha256 !== imageHash) {
    issues.push(`artifact.file_sha256 ${artifact.file_sha256} does not match image sha256 ${imageHash}`);
  }
  if (artifact.width_px !== decoded.width || artifact.height_px !== decoded.height) {
    issues.push(`artifact dimensions ${artifact.width_px}x${artifact.height_px} do not match decoded image ${decoded.width}x${decoded.height}`);
  }
  const decodedPixelSha = sha256(Buffer.from(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength));
  if (artifact.decoded_pixel_sha256 !== decodedPixelSha) {
    issues.push(`artifact.decoded_pixel_sha256 ${artifact.decoded_pixel_sha256} does not match decoded image sha256 ${decodedPixelSha}`);
  }
  if (issues.length > 0) {
    throw new Error(`NIMI2D_IMAGE2_PRODUCER_ARTIFACT_MISMATCH: ${issues.join('; ')}`);
  }
}

async function copyProducerManifest(producerRecord, sourceDir) {
  if (!producerRecord) return null;
  const outPath = path.join(sourceDir, 'codex-image2-producer-manifest.yaml');
  await writeFile(outPath, producerRecord.bytes);
  return outPath;
}

async function runCodexImage2LayerWorkflow(args) {
  const producerManifestPath = getFlag(args, '--producer-manifest');
  const producerRecord = producerManifestPath ? await readProducerManifest(producerManifestPath) : null;
  const imageFlag = getFlag(args, '--image');
  if (!imageFlag && !producerRecord) {
    throw new Error('Missing required flag: --image or --producer-manifest');
  }
  const imagePath = path.resolve(imageFlag ?? producerRecord.manifest.artifact.path);
  const outDir = path.resolve(requireFlag(args, '--out-dir'));

  await prepareWorkflowOutDir(outDir);
  const sourceDir = path.join(outDir, 'source');
  const atlasDir = path.join(outDir, 'atlas');
  const outputDir = path.join(outDir, 'output');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(atlasDir, { recursive: true });

  const sourceBytes = await readFile(imagePath);
  const imageHash = sha256(sourceBytes);
  const sourceCopyPath = path.join(sourceDir, 'codex-image2-atlas.png');
  await copyFile(imagePath, sourceCopyPath);

  const decoded = await decodePngRgba(imagePath);
  assertProducerArtifactMatchesImage(producerRecord, sourceBytes, decoded);
  const copiedProducerManifestPath = await copyProducerManifest(producerRecord, sourceDir);
  const normalized = normalizeAtlasBackground(decoded, defaultColumns, defaultRows);
  const atlasPng = encodePngRgba({
    width: normalized.width,
    height: normalized.height,
    rgba: normalized.rgba,
  });
  const normalizedAtlasPath = path.join(atlasDir, 'atlas.png');
  await writeFile(normalizedAtlasPath, atlasPng);
  const transparentAtlas = makeTransparentAtlas(normalized);
  const transparentAtlasPng = encodePngRgba({
    width: transparentAtlas.width,
    height: transparentAtlas.height,
    rgba: transparentAtlas.rgba,
  });
  const transparentAtlasPath = path.join(atlasDir, 'atlas-transparent.png');
  await writeFile(transparentAtlasPath, transparentAtlasPng);

  const spec = buildAtlasSpec({
    imageHash,
    cellWidth: normalized.cellWidth,
    cellHeight: normalized.cellHeight,
    cellStats: normalized.cellStats,
  });
  const atlasSpecPath = path.join(atlasDir, 'atlas-spec.yaml');
  await writeYaml(atlasSpecPath, spec);

  const layerInputDir = path.join(outputDir, 'layer-input');
  const cut = await cutLayerAtlas(atlasSpecPath, layerInputDir, { clean: true });
  if (cut.status !== 'ok') {
    return { ...cut, stage: 'atlas_cut' };
  }
  const layerInputManifestPath = cut.layerInputManifestPath;
  const layerValidation = await validateLayerInput(layerInputManifestPath);
  if (layerValidation.status !== 'ok') {
    return { ...layerValidation, stage: 'layer_input_validation' };
  }
  const packageManifestPath = path.join(layerInputDir, 'package.yaml');
  const solved = await writeSolvedPackage(layerInputManifestPath, packageManifestPath);
  if (solved.status !== 'ok') {
    return { ...solved, stage: 'package_solve' };
  }
  const packageValidation = await validatePackageManifest(packageManifestPath);
  if (packageValidation.status !== 'ok') {
    return { ...packageValidation, stage: 'package_validation' };
  }
  const renderPlan = createNimi2DRenderPlan({
    packageManifestRaw: YAML.stringify(packageValidation.value),
    packageManifestRef: packageManifestPath,
  });
  return {
    status: 'ok',
    kind: 'codex_image2_layer_workflow',
    outDir,
    sourceImagePath: sourceCopyPath,
    sourceImageSha256: imageHash,
    atlasSpecPath,
    normalizedAtlasPath,
    transparentAtlasPath,
    transparentPixelCount: transparentAtlas.transparentPixels,
    layerInputManifestPath,
    layerDir: path.join(layerInputDir, 'layers'),
    layerAssetCount: cut.layerAssetCount,
    packageManifestPath,
    renderLayerCount: renderPlan.renderLayers.length,
    producerManifestPath: copiedProducerManifestPath,
    producerVerdict: producerRecord?.manifest.verdict ?? 'not_recorded',
  };
}

async function runCodexImage2LayerWorkflowCli(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.length === 0) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await runCodexImage2LayerWorkflow(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'ok') {
    process.exitCode = 1;
  }
}

export {
  normalizeAtlasBackground,
  makeTransparentAtlas,
  buildAtlasSpec,
  readProducerManifest,
  runCodexImage2LayerWorkflow,
  runCodexImage2LayerWorkflowCli,
};
