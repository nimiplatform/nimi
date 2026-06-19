import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';
import { runImageInputWorkflowBench } from '../image-input/workflow-bench.mjs';
import { runAtlasQualityGate } from '../image-input/atlas-quality.mjs';
import { inspectLayerInput } from '../layer-input-inspector.mjs';
import { decodePngRgba } from '../png-rgba.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { CODEX_IMAGE2_ARTIFACT_KIND } from './artifact.mjs';
import {
  analyzeAtlasUpstreamQuality,
  analyzeNormalizedAtlasQuality,
  buildAtlasSpec,
  defaultColumns,
  defaultRows,
  makeTransparentAtlas,
  normalizeAtlasBackground,
} from './layer-workflow-atlas.mjs';

const producerManifestKind = CODEX_IMAGE2_ARTIFACT_KIND;
const consumableProducerVerdicts = new Set(['admit', 'recorded_only']);
const formalProducerVerdicts = new Set(['admit']);
const workflowRunMarker = '.nimi2d-image2-layer-workflow-run';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = path.resolve(packageRoot, '..');

function usage() {
  return [
    'Usage:',
    '  nimi2d image2-layer-workflow \\',
    '    (--image <codex-image2-atlas.png> | --producer-manifest <codex-image2.artifact.yaml>) \\',
    '    --out-dir <artifact-dir> \\',
    '    [--prompt-file <prompt.md>] [--surface <codex_app|codex_cli|codex_sdk|manual_handoff>] [--grid-size <n>]',
    '',
    'This command normalizes a Codex Image2 atlas into machine-cut chroma-key,',
    'writes an atlas spec, cuts layer PNGs, and runs the image-input workflow bench.',
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

function integerFlag(args, name, fallback) {
  const raw = getFlag(args, name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected positive integer for ${name}: ${raw}`);
  }
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

function resolvePromptFile(explicitPromptFile, producerRecord) {
  if (explicitPromptFile) return explicitPromptFile;
  const promptPath = producerRecord?.manifest?.producer?.prompt?.path;
  return typeof promptPath === 'string' && promptPath.length > 0 ? promptPath : null;
}

function resolveSurface(explicitSurface, producerRecord) {
  if (explicitSurface) return explicitSurface;
  const surface = producerRecord?.manifest?.producer?.surface;
  return typeof surface === 'string' && surface.length > 0 ? surface : 'manual_handoff';
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

function producerSummary(producerRecord, copiedManifestPath) {
  if (!producerRecord) {
    return {
      verdict: 'not_recorded',
      reason: 'No Codex Image2 artifact manifest was supplied.',
    };
  }
  const { manifest } = producerRecord;
  return {
    manifest_kind: manifest.manifest_kind,
    schema_version: manifest.schema_version,
    verdict: manifest.verdict,
    manifest_path: copiedManifestPath,
    manifest_sha256: producerRecord.fileSha256,
    family: manifest.producer?.family ?? null,
    model: manifest.producer?.model ?? null,
    surface: manifest.producer?.surface ?? null,
    artifact: {
      path: manifest.artifact.path,
      format: manifest.artifact.format,
      width_px: manifest.artifact.width_px,
      height_px: manifest.artifact.height_px,
      byte_size: manifest.artifact.byte_size ?? null,
      file_sha256: manifest.artifact.file_sha256,
      decoded_pixel_sha256: manifest.artifact.decoded_pixel_sha256 ?? null,
    },
    evidence: {
      image_path: manifest.evidence?.image?.path ?? null,
      pixel_identity_status: manifest.evidence?.pixel_identity?.status ?? null,
    },
    authority_boundary: 'Provider evidence admits provenance, not raw-only package input. Nimi2D source-to-layer admission requires admitted producer evidence plus deterministic repaired layer gates.',
  };
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
  const promptFile = resolvePromptFile(getFlag(args, '--prompt-file'), producerRecord);
  const surface = resolveSurface(getFlag(args, '--surface'), producerRecord);
  const gridSize = integerFlag(args, '--grid-size', 4);

  await prepareWorkflowOutDir(outDir);
  const sourceDir = path.join(outDir, 'source');
  const atlasDir = path.join(outDir, 'atlas');
  const qualityDir = path.join(outDir, 'quality');
  const outputDir = path.join(outDir, 'output');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(atlasDir, { recursive: true });
  await mkdir(qualityDir, { recursive: true });

  const sourceBytes = await readFile(imagePath);
  const imageHash = sha256(sourceBytes);
  const sourceCopyPath = path.join(sourceDir, 'codex-image2-atlas.png');
  await copyFile(imagePath, sourceCopyPath);

  const decoded = await decodePngRgba(imagePath);
  assertProducerArtifactMatchesImage(producerRecord, sourceBytes, decoded);
  const copiedProducerManifestPath = await copyProducerManifest(producerRecord, sourceDir);
  const upstreamProducer = producerSummary(producerRecord, copiedProducerManifestPath);
  const upstreamQuality = analyzeAtlasUpstreamQuality(decoded, defaultColumns, defaultRows);
  const upstreamQualityPath = path.join(qualityDir, 'upstream-quality.yaml');
  await writeYaml(upstreamQualityPath, upstreamQuality);
  const normalized = normalizeAtlasBackground(decoded, defaultColumns, defaultRows);
  const normalizedQuality = analyzeNormalizedAtlasQuality(normalized);
  const normalizedQualityPath = path.join(qualityDir, 'normalized-quality.yaml');
  await writeYaml(normalizedQualityPath, normalizedQuality);
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
  const transparentAtlasReportPath = path.join(qualityDir, 'transparent-atlas.yaml');
  await writeFile(transparentAtlasPath, transparentAtlasPng);
  await writeYaml(transparentAtlasReportPath, transparentAtlas.report);

  const spec = buildAtlasSpec({
    imageHash,
    cellWidth: normalized.cellWidth,
    cellHeight: normalized.cellHeight,
    cellStats: normalized.quality.cellStats,
  });
  const atlasSpecPath = path.join(atlasDir, 'atlas-spec.yaml');
  await writeYaml(atlasSpecPath, spec);

  const atlasQualityPath = path.join(qualityDir, 'atlas-quality.yaml');
  const atlasQuality = await runAtlasQualityGate(atlasSpecPath, { outPath: atlasQualityPath });
  const bench = await runImageInputWorkflowBench(atlasSpecPath, outputDir, { gridSize });
  const layerInputManifestPath = path.join(outputDir, 'layer-input', 'layer-input.yaml');
  const layerInputFullChain = await inspectLayerInput(layerInputManifestPath, {
    outputDir: path.join(outputDir, 'full-chain'),
    gridSize,
  });
  const repairedWorkflowVerdict = bench.decision?.verdict === 'pass'
    && normalizedQuality.decision?.verdict === 'pass'
    && transparentAtlas.report.decision?.verdict === 'pass'
    && atlasQuality.decision?.verdict === 'pass'
    ? 'pass'
    : 'fail';
  const rawProviderAtlasAdmissionVerdict = formalProducerVerdicts.has(upstreamProducer.verdict)
    && upstreamQuality.decision?.verdict === 'pass'
    ? 'pass'
    : 'fail';
  const sourceToLayerPipelineVerdict = formalProducerVerdicts.has(upstreamProducer.verdict)
    && repairedWorkflowVerdict === 'pass'
    ? 'pass'
    : 'fail';
  const formalAdmissionVerdict = sourceToLayerPipelineVerdict;
  const qualitySummary = {
    upstream_producer: upstreamProducer.verdict,
    upstream_image2_atlas: upstreamQuality.decision.verdict,
    raw_provider_atlas_admission: rawProviderAtlasAdmissionVerdict,
    normalized_atlas: normalizedQuality.decision.verdict,
    transparent_atlas: transparentAtlas.report.decision.verdict,
    atlas_quality: atlasQuality.decision?.verdict ?? 'fail',
    repaired_workflow: repairedWorkflowVerdict,
    layer_input_full_chain: layerInputFullChain.decision?.verdict ?? 'fail',
    source_to_layer_pipeline: sourceToLayerPipelineVerdict,
    formal_admission_model: 'raw_plus_repaired_evidence',
    formal_nimi2d_admission: formalAdmissionVerdict,
  };
  const manifest = {
    manifest_kind: 'nimi.nimi2d.codex-image2.layer-workflow-run',
    schema_version: 1,
    verdict: formalAdmissionVerdict,
    quality_summary: qualitySummary,
    admission_model: {
      kind: 'raw_plus_repaired_evidence',
      producer_evidence_requirement: 'decoded_pixel_identity_admitted',
      raw_atlas_quality_role: 'diagnostic_not_blocking_when_repaired_pipeline_passes',
      repair_pipeline_requirement: 'deterministic_normalization_transparency_atlas_quality_and_workflow_bench',
      pass_condition: 'admitted_producer_evidence_and_source_to_layer_pipeline_pass',
    },
    source: {
      image_path: sourceCopyPath,
      file_sha256: imageHash,
      surface,
      prompt_file: promptFile ? path.resolve(promptFile) : null,
      producer_manifest_path: copiedProducerManifestPath,
      producer_manifest_sha256: producerRecord?.fileSha256 ?? null,
    },
    upstream_producer: upstreamProducer,
    normalized_atlas: {
      path: normalizedAtlasPath,
      file_sha256: sha256(atlasPng),
      width_px: normalized.width,
      height_px: normalized.height,
      cell_width_px: normalized.cellWidth,
      cell_height_px: normalized.cellHeight,
      background_key_rgb: [0, 255, 0],
      quality: normalized.quality,
    },
    transparent_atlas: {
      path: transparentAtlasPath,
      file_sha256: sha256(transparentAtlasPng),
      report_path: transparentAtlasReportPath,
      decision: transparentAtlas.report.decision,
      transparent_background: transparentAtlas.report.transparent_background,
    },
    atlas_spec_path: atlasSpecPath,
    upstream_quality: {
      report_path: upstreamQualityPath,
      decision: upstreamQuality.decision,
      gates: upstreamQuality.gates,
    },
    normalized_quality: {
      report_path: normalizedQualityPath,
      decision: normalizedQuality.decision,
      gates: normalizedQuality.gates,
    },
    atlas_quality: {
      report_path: atlasQualityPath,
      status: atlasQuality.status,
      decision: atlasQuality.decision ?? null,
      failure_attribution: atlasQuality.result?.failure_attribution ?? {},
    },
    workflow_bench: {
      status: bench.status,
      report_path: bench.reportPath ?? null,
      decision: bench.decision ?? null,
    },
    layer_input_full_chain: {
      status: layerInputFullChain.status,
      report_path: layerInputFullChain.outPath,
      decision: layerInputFullChain.decision,
      boundary: layerInputFullChain.report.boundary,
    },
    outputs: {
      layer_input_manifest_path: layerInputManifestPath,
      layer_dir: path.join(outputDir, 'layer-input', 'layers'),
      corpus_path: path.join(outputDir, 'corpus.yaml'),
      layer_input_full_chain_report_path: layerInputFullChain.outPath,
    },
  };
  const manifestPath = path.join(outDir, 'codex-image2-layer-workflow.yaml');
  await writeYaml(manifestPath, manifest);
  return {
    status: 'ok',
    kind: 'codex_image2_layer_workflow',
    verdict: manifest.verdict,
    manifestPath,
    atlasSpecPath,
    normalizedAtlasPath,
    transparentAtlasPath,
    workflowReportPath: bench.reportPath ?? null,
    layerInputFullChainReportPath: layerInputFullChain.outPath,
    layerInputFullChainVerdict: layerInputFullChain.decision?.verdict ?? 'fail',
    atlasQualityReportPath: atlasQualityPath,
    atlasQualityVerdict: atlasQuality.decision?.verdict ?? 'fail',
    upstreamQualityReportPath: upstreamQualityPath,
    upstreamQualityVerdict: upstreamQuality.decision.verdict,
    normalizedQualityReportPath: normalizedQualityPath,
    normalizedQualityVerdict: normalizedQuality.decision.verdict,
    transparentAtlasReportPath,
    transparentAtlasVerdict: transparentAtlas.report.decision.verdict,
    producerManifestPath: copiedProducerManifestPath,
    producerVerdict: upstreamProducer.verdict,
    repairedWorkflowVerdict,
    sourceToLayerPipelineVerdict,
    rawProviderAtlasAdmissionVerdict,
    formalAdmissionVerdict: qualitySummary.formal_nimi2d_admission,
    qualitySummary,
  };
}

async function runCodexImage2LayerWorkflowCli(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.length === 0) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await runCodexImage2LayerWorkflow(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.verdict !== 'pass') {
    process.exitCode = 1;
  }
}

export {
  analyzeAtlasUpstreamQuality,
  normalizeAtlasBackground,
  analyzeNormalizedAtlasQuality,
  makeTransparentAtlas,
  buildAtlasSpec,
  readProducerManifest,
  runCodexImage2LayerWorkflow,
  runCodexImage2LayerWorkflowCli,
};
