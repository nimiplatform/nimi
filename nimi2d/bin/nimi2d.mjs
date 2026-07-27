#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  cutLayerAtlas,
  solvePackageFromLayerInput,
  validateAtlasSpec,
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

function usage() {
  return [
    'Usage:',
    '  nimi2d validate-layer-input <manifest>',
    '  nimi2d solve-package <layer-input-manifest> --out <package-manifest>',
    '  nimi2d validate-package <manifest>',
  '  nimi2d render-plan <package-manifest> [--capability-profile <profile>]',
  '  nimi2d prove-visual-frame <package-manifest> [--capability-profile <profile>] [--grid-size <n>]',
    '  nimi2d run-reference-action-bench <package-manifest> [--capability-profile <profile>]',
    '  nimi2d run-reference-action-stress <package-manifest> [--capability-profile <profile>]',
    '  nimi2d validate-atlas-spec <atlas-spec>',
    '  nimi2d cut-layer-atlas <atlas-spec> --out <output-dir>',
    '  nimi2d image2-provider-plan --workflow <workflow> --out-dir <dir> [--description <text>] [--description-file <file>] [--image <png>]',
    '  nimi2d image2-provider-run --request <provider-request.yaml> [--adapter codex_cli] [--dry-run|--execute|--response-file <json>] [--codex-bin <cmd>] [--model <model>] [--timeout-ms <ms>] [--attempts <n>]',
    '  nimi2d image2-register-output --image <png> --out <manifest.yaml> --surface codex_cli [--request <provider-request.yaml>] [--evidence-image <png>] [--model <model>] [--model-hint <hint>]',
    '  nimi2d image2-compare-pixels --left <png> --right <png> --out <report.yaml>',
    '  nimi2d image2-postprocess --input <png> --out <png> --report <report.yaml> [--transparent-background none|corner|color]',
    '  nimi2d image2-layer-workflow (--image <atlas.png>|--producer-manifest <artifact.yaml>) --out-dir <dir>',
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
    if (output.status !== 'ok') process.exitCode = 1;
    return;
  }

  if (!manifestPath) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  let output;
  if (command === 'validate-layer-input') {
    output = await validateLayerInput(manifestPath);
  } else if (command === 'solve-package') {
    const outPath = getFlag(rest, '--out');
    const packageId = getFlag(rest, '--package-id') ?? undefined;
    if (outPath) {
      output = await writeSolvedPackage(manifestPath, outPath, { packageId });
    } else {
      output = await solvePackageFromLayerInput(manifestPath, { packageId });
    }
  } else if (command === 'validate-package') {
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
  } else if (command === 'run-reference-action-bench') {
    output = await runReferenceActionBench(manifestPath, rest);
  } else if (command === 'run-reference-action-stress') {
    output = await runReferenceActionStress(manifestPath, rest);
  } else if (command === 'validate-atlas-spec') {
    output = await validateAtlasSpec(manifestPath);
  } else if (command === 'cut-layer-atlas') {
    const outPath = getFlag(rest, '--out');
    if (!outPath) {
      process.stderr.write(`${usage()}\n`);
      process.exitCode = 2;
      return;
    }
    output = await cutLayerAtlas(manifestPath, outPath, { clean: true });
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
