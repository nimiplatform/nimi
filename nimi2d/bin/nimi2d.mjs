#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  generateDemoCorpus,
  certifyBenchCorpus,
  generateDemoAtlas,
  cutLayerAtlas,
  runAtlasQualityGate,
  runGenerationBench,
  runImageInputWorkflowBench,
  auditReleaseCandidate,
  buildReleaseReviewPacket,
  validateReleaseReviewPacket,
  validateReleaseProductEvidence,
  runRuntimeProofMatrix,
  inspectLayerInput,
  inspectPackage,
  solvePackageFromLayerInput,
  validateAtlasSpec,
  validateBenchCorpus,
  validateBenchResult,
  validateLayerInput,
  validatePackageManifest,
  writeSolvedPackage,
} from '../src/index.mjs';
import {
  createNimi2DAmplitudeMouthLane,
  createNimi2DComposer,
  createNimi2DRenderPlan,
} from '../src/runtime/index.mjs';
import {
  runNimi2DReferenceActionBench,
  runNimi2DReferenceActionStress,
} from '../src/reference-player/index.mjs';
import { probeNimi2DVisualFrame } from '../src/proof/index.mjs';
import { decodePngRgba } from '../src/node/png-rgba.mjs';
import { runCodexImage2ArtifactCli } from '../src/node/image2-provider/artifact.mjs';
import {
  runCodexImage2Provider,
  writeCodexImage2Plan,
} from '../src/node/image2-provider/provider-workflow.mjs';
import { runCodexImage2LayerWorkflow } from '../src/node/image2-provider/layer-workflow.mjs';
import { runCodexImage2DistributionReportCli } from '../src/node/image2-provider/distribution-report.mjs';
import { runCodexImage2DemoSuite } from '../src/node/image2-provider/demo-suite.mjs';

function usage() {
  return [
    'Usage:',
    '  nimi2d validate-layer-input <manifest>',
    '  nimi2d admit-layer-input <manifest>',
    '  nimi2d solve-package <layer-input-manifest> --out <package-manifest>',
    '  nimi2d validate-package <manifest>',
    '  nimi2d admit-package <manifest>',
  '  nimi2d render-plan <package-manifest> [--capability-profile <profile>]',
  '  nimi2d prove-visual-frame <package-manifest> [--capability-profile <profile>] [--grid-size <n>]',
  '  nimi2d inspect-package <package-manifest> [--capability-profile <profile>] [--grid-size <n>] [--out <report.yaml>]',
  '  nimi2d inspect-layer-input <layer-input-manifest> --out-dir <dir> [--capability-profile <profile>] [--grid-size <n>] [--package-id <id>]',
  '  nimi2d audit-release-candidate --distribution-report <report.yaml> --certified-corpus-report <report.yaml> --generation-bench-result <result.yaml> --runtime-proof-matrix <result.json|yaml> [--manual-correction-report <report.yaml>] [--product-review-report <report.yaml>] [--out <report.yaml>]',
  '  nimi2d validate-release-product-evidence --manual-correction-report <report.yaml> --product-review-report <report.yaml> [--generation-bench-result <result.yaml>] [--out <report.yaml>]',
  '  nimi2d build-release-review-packet --corpus <corpus.yaml> --release-candidate-audit <audit.yaml> --out-dir <dir> [--source-references <refs.yaml>]',
  '  nimi2d validate-release-review-packet --packet-dir <dir> [--out <report.yaml>]',
  '  nimi2d validate-bench-corpus <manifest>',
  '  nimi2d certify-corpus <corpus-manifest> [--out <report.yaml>] [--min-certified <n>] [--min-invalid <n>]',
    '  nimi2d validate-bench-result <manifest>',
    '  nimi2d run-generation-bench <corpus-manifest> --out <result>',
    '  nimi2d run-runtime-proof-matrix <corpus-manifest> [--grid-size <n>]',
    '  nimi2d run-reference-action-bench <package-manifest> [--capability-profile <profile>]',
    '  nimi2d run-reference-action-stress <package-manifest> [--capability-profile <profile>]',
    '  nimi2d generate-demo-corpus <output-dir>',
    '  nimi2d validate-atlas-spec <atlas-spec>',
    '  nimi2d generate-demo-atlas <output-dir>',
    '  nimi2d cut-layer-atlas <atlas-spec> --out <output-dir>',
    '  nimi2d run-atlas-quality-gate <atlas-spec> [--out <quality-report>]',
    '  nimi2d run-image-input-workflow-bench <atlas-spec> --out <output-dir> [--grid-size <n>]',
    '  nimi2d image2-provider-plan --workflow <workflow> --out-dir <dir> [--description <text>] [--description-file <file>] [--image <png>]',
    '  nimi2d image2-provider-run --request <provider-request.yaml> [--adapter codex_cli] [--dry-run|--execute|--response-file <json>] [--codex-bin <cmd>] [--model <model>] [--timeout-ms <ms>] [--attempts <n>]',
    '  nimi2d image2-register-output --image <png> --out <manifest.yaml> --surface codex_cli [--request <provider-request.yaml>] [--evidence-image <png>] [--model <model>] [--model-hint <hint>]',
    '  nimi2d image2-compare-pixels --left <png> --right <png> --out <report.yaml>',
    '  nimi2d image2-postprocess --input <png> --out <png> --report <report.yaml> [--transparent-background none|corner|color]',
    '  nimi2d image2-layer-workflow (--image <atlas.png>|--producer-manifest <artifact.yaml>) --out-dir <dir>',
    '  nimi2d image2-distribution-report --runs-dir <dir> --out <report.yaml> [--min-samples <n>] [--min-underlying-sources <n>] [--require-layer-input-full-chain] [--source-surface <surface>] [--gate-mode source_to_layer_pipeline|repaired_workflow|raw_provider_atlas|formal_admission]',
    '  nimi2d image2-demo-suite --out-dir <dir> [--sample-count <n>] [--grid-size <n>]',
  ].join('\n');
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function createRenderPlanFromCli(packageManifestPath, args) {
  const packageManifestRaw = await readFile(packageManifestPath, 'utf8');
  const capabilityProfilePath = getFlag(args, '--capability-profile');
  const capabilityProfileRaw = capabilityProfilePath
    ? await readFile(path.resolve(capabilityProfilePath), 'utf8')
    : null;
  return createNimi2DRenderPlan({
    packageManifestRaw,
    capabilityProfileRaw,
    packageManifestRef: path.resolve(packageManifestPath),
  });
}

function defaultOutfitLayerRefs(renderPlan) {
  const defaultOutfit = renderPlan.manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === renderPlan.manifest.wardrobe.default_outfit_ref,
  );
  return defaultOutfit?.layer_refs ?? [];
}

async function proveVisualFrame(packageManifestPath, args) {
  const renderPlan = await createRenderPlanFromCli(packageManifestPath, args);
  const manifestDir = path.dirname(path.resolve(packageManifestPath));
  const gridSizeFlag = getFlag(args, '--grid-size');
  const gridSize = gridSizeFlag ? Number(gridSizeFlag) : undefined;
  const stats = await probeNimi2DVisualFrame({
    renderPlan,
    gridSize,
    decodeImage: async ({ src }) => decodePngRgba(path.resolve(manifestDir, src)),
  });
  return { status: 'ok', kind: 'visual_frame_proof', stats };
}

async function runReferenceActionBench(packageManifestPath, args) {
  const renderPlan = await createRenderPlanFromCli(packageManifestPath, args);
  const composer = createNimi2DComposer();
  const mouthLane = createNimi2DAmplitudeMouthLane({ composer });
  let now = 0;
  const result = await runNimi2DReferenceActionBench({
    backendKind: 'nimi2d',
    defaultOutfitLayerRefs: defaultOutfitLayerRefs(renderPlan),
    projection: composer,
    nowMs: () => now,
    async flush() {
      now += 16;
      composer.advanceFrame(16);
    },
    mouth: {
      setAmplitude(value) {
        mouthLane.setAmplitude(value);
      },
      async attach() {},
      silent() {
        mouthLane.silent();
      },
    },
    captureFrame() {
      const snapshot = composer.snapshot();
      return {
        timestampMs: now,
        layerRefs: renderPlan.renderLayers.map((layer) => layer.layerRef),
        activity: snapshot.activity,
        expression: snapshot.expression,
        motion: snapshot.motion,
        mouthOpen: snapshot.mouthOpen,
      };
    },
  });
  return {
    status: result.verdict === 'fail' ? 'reject' : 'ok',
    kind: 'reference_action_bench_run',
    result,
    codes: result.failures,
    issues: result.failures.map((failure) => ({
      code: failure,
      path: '$',
      message: failure,
    })),
  };
}

async function runReferenceActionStress(packageManifestPath, args) {
  const renderPlan = await createRenderPlanFromCli(packageManifestPath, args);
  const result = await runNimi2DReferenceActionStress({
    backendKind: 'nimi2d',
    layerRefs: renderPlan.renderLayers.map((layer) => layer.layerRef),
    defaultOutfitLayerRefs: defaultOutfitLayerRefs(renderPlan),
  });
  return {
    status: result.verdict === 'fail' ? 'reject' : 'ok',
    kind: 'reference_action_stress_run',
    result,
    codes: result.failures,
    issues: result.failures.map((failure) => ({
      code: failure,
      path: '$',
      message: failure,
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const [command, manifestPath, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'image2-register-output') {
    await runCodexImage2ArtifactCli(['register', manifestPath, ...rest].filter(Boolean));
    return;
  }
  if (command === 'image2-compare-pixels') {
    await runCodexImage2ArtifactCli(['compare-pixels', manifestPath, ...rest].filter(Boolean));
    return;
  }
  if (command === 'image2-postprocess') {
    await runCodexImage2ArtifactCli(['postprocess', manifestPath, ...rest].filter(Boolean));
    return;
  }
  if (command === 'image2-provider-plan') {
    const output = await writeCodexImage2Plan([manifestPath, ...rest].filter(Boolean));
    printJson(output);
    return;
  }
  if (command === 'image2-provider-run') {
    const output = await runCodexImage2Provider([manifestPath, ...rest].filter(Boolean));
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }
  if (command === 'image2-layer-workflow') {
    const output = await runCodexImage2LayerWorkflow([manifestPath, ...rest].filter(Boolean));
    printJson(output);
    if (output.status !== 'ok' || output.verdict !== 'pass') process.exitCode = 1;
    return;
  }
  if (command === 'image2-distribution-report') {
    await runCodexImage2DistributionReportCli([manifestPath, ...rest].filter(Boolean));
    return;
  }
  if (command === 'image2-demo-suite') {
    const output = await runCodexImage2DemoSuite([manifestPath, ...rest].filter(Boolean));
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }
  if (command === 'audit-release-candidate') {
    const auditArgs = [manifestPath, ...rest].filter(Boolean);
    const output = await auditReleaseCandidate({
      distributionReportPath: getFlag(auditArgs, '--distribution-report'),
      corpusCertificationReportPath: getFlag(auditArgs, '--certified-corpus-report'),
      generationBenchResultPath: getFlag(auditArgs, '--generation-bench-result'),
      runtimeProofMatrixPath: getFlag(auditArgs, '--runtime-proof-matrix'),
      manualCorrectionReportPath: getFlag(auditArgs, '--manual-correction-report') ?? undefined,
      productReviewReportPath: getFlag(auditArgs, '--product-review-report') ?? undefined,
      outPath: getFlag(auditArgs, '--out') ?? undefined,
    });
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }
  if (command === 'validate-release-product-evidence') {
    const evidenceArgs = [manifestPath, ...rest].filter(Boolean);
    const output = await validateReleaseProductEvidence({
      manualCorrectionReportPath: getFlag(evidenceArgs, '--manual-correction-report'),
      productReviewReportPath: getFlag(evidenceArgs, '--product-review-report'),
      generationBenchResultPath: getFlag(evidenceArgs, '--generation-bench-result') ?? undefined,
      outPath: getFlag(evidenceArgs, '--out') ?? undefined,
    });
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }
  if (command === 'build-release-review-packet') {
    const packetArgs = [manifestPath, ...rest].filter(Boolean);
    const output = await buildReleaseReviewPacket({
      corpusPath: getFlag(packetArgs, '--corpus'),
      releaseCandidateAuditPath: getFlag(packetArgs, '--release-candidate-audit'),
      outputDir: getFlag(packetArgs, '--out-dir'),
      sourceReferencesPath: getFlag(packetArgs, '--source-references') ?? undefined,
    });
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }
  if (command === 'validate-release-review-packet') {
    const packetArgs = [manifestPath, ...rest].filter(Boolean);
    const output = await validateReleaseReviewPacket({
      packetDir: getFlag(packetArgs, '--packet-dir'),
      outPath: getFlag(packetArgs, '--out') ?? undefined,
    });
    printJson(output);
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }

  if (!manifestPath) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  let output;
  if (command === 'validate-layer-input' || command === 'admit-layer-input') {
    output = await validateLayerInput(manifestPath);
  } else if (command === 'solve-package') {
    const outPath = getFlag(rest, '--out');
    const packageId = getFlag(rest, '--package-id') ?? undefined;
    if (outPath) {
      output = await writeSolvedPackage(manifestPath, outPath, { packageId });
    } else {
      output = await solvePackageFromLayerInput(manifestPath, { packageId });
    }
  } else if (command === 'validate-package' || command === 'admit-package') {
    output = await validatePackageManifest(manifestPath);
  } else if (command === 'render-plan') {
    const renderPlan = await createRenderPlanFromCli(manifestPath, rest);
    output = {
      status: 'ok',
      kind: 'render_plan',
      renderPlan,
    };
  } else if (command === 'prove-visual-frame') {
    output = await proveVisualFrame(manifestPath, rest);
  } else if (command === 'inspect-package') {
    const gridSizeFlag = getFlag(rest, '--grid-size');
    const gridSize = gridSizeFlag ? Number(gridSizeFlag) : undefined;
    output = await inspectPackage(manifestPath, {
      capabilityProfilePath: getFlag(rest, '--capability-profile') ?? undefined,
      gridSize,
      outPath: getFlag(rest, '--out') ?? undefined,
    });
  } else if (command === 'inspect-layer-input') {
    const outDir = getFlag(rest, '--out-dir');
    if (!outDir) {
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 2;
      return;
    }
    const gridSizeFlag = getFlag(rest, '--grid-size');
    const gridSize = gridSizeFlag ? Number(gridSizeFlag) : undefined;
    output = await inspectLayerInput(manifestPath, {
      outputDir: outDir,
      capabilityProfilePath: getFlag(rest, '--capability-profile') ?? undefined,
      gridSize,
      packageId: getFlag(rest, '--package-id') ?? undefined,
    });
  } else if (command === 'validate-bench-corpus') {
    output = await validateBenchCorpus(manifestPath);
  } else if (command === 'certify-corpus') {
    const minCertifiedFlag = getFlag(rest, '--min-certified');
    const minInvalidFlag = getFlag(rest, '--min-invalid');
    output = await certifyBenchCorpus(manifestPath, {
      minCertifiedCases: minCertifiedFlag ? Number(minCertifiedFlag) : undefined,
      minInvalidCases: minInvalidFlag ? Number(minInvalidFlag) : undefined,
      outPath: getFlag(rest, '--out') ?? undefined,
    });
  } else if (command === 'validate-bench-result') {
    output = await validateBenchResult(manifestPath);
  } else if (command === 'run-generation-bench') {
    const outPath = getFlag(rest, '--out') ?? undefined;
    output = await runGenerationBench(manifestPath, { outPath });
  } else if (command === 'run-runtime-proof-matrix') {
    const gridSizeFlag = getFlag(rest, '--grid-size');
    const gridSize = gridSizeFlag ? Number(gridSizeFlag) : undefined;
    output = await runRuntimeProofMatrix(manifestPath, { gridSize });
  } else if (command === 'run-reference-action-bench') {
    output = await runReferenceActionBench(manifestPath, rest);
  } else if (command === 'run-reference-action-stress') {
    output = await runReferenceActionStress(manifestPath, rest);
  } else if (command === 'generate-demo-corpus') {
    output = await generateDemoCorpus(manifestPath);
  } else if (command === 'validate-atlas-spec') {
    output = await validateAtlasSpec(manifestPath);
  } else if (command === 'generate-demo-atlas') {
    output = await generateDemoAtlas(manifestPath);
  } else if (command === 'cut-layer-atlas') {
    const outPath = getFlag(rest, '--out');
    if (!outPath) {
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 2;
      return;
    }
    output = await cutLayerAtlas(manifestPath, outPath, { clean: true });
  } else if (command === 'run-atlas-quality-gate') {
    const outPath = getFlag(rest, '--out') ?? undefined;
    output = await runAtlasQualityGate(manifestPath, { outPath });
  } else if (command === 'run-image-input-workflow-bench') {
    const outPath = getFlag(rest, '--out');
    if (!outPath) {
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 2;
      return;
    }
    const gridSizeFlag = getFlag(rest, '--grid-size');
    const gridSize = gridSizeFlag ? Number(gridSizeFlag) : undefined;
    output = await runImageInputWorkflowBench(manifestPath, outPath, { gridSize });
  } else {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  printJson(output);
  if (output.status !== 'ok') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  printJson({
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
