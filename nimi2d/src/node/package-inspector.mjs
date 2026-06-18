import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { probeNimi2DVisualFrame } from '../proof/index.mjs';
import {
  createNimi2DAmplitudeMouthLane,
  createNimi2DComposer,
  createNimi2DRenderPlan,
} from '../runtime/index.mjs';
import {
  runNimi2DReferenceActionBench,
  runNimi2DReferenceActionStress,
} from '../reference-player/index.mjs';
import { validatePackageManifest } from './package-manifest.mjs';
import { decodePngRgba } from './png-rgba.mjs';

function defaultOutfit(renderPlan) {
  return renderPlan.manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === renderPlan.manifest.wardrobe.default_outfit_ref,
  ) ?? null;
}

function defaultOutfitLayerRefs(renderPlan) {
  return defaultOutfit(renderPlan)?.layer_refs ?? [];
}

async function runReferenceActionBench(renderPlan) {
  const composer = createNimi2DComposer();
  const mouthLane = createNimi2DAmplitudeMouthLane({ composer });
  let now = 0;
  const bench = await runNimi2DReferenceActionBench({
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
  const stress = await runNimi2DReferenceActionStress({
    backendKind: 'nimi2d',
    layerRefs: renderPlan.renderLayers.map((layer) => layer.layerRef),
    defaultOutfitLayerRefs: defaultOutfitLayerRefs(renderPlan),
  });
  return { bench, stress };
}

function packageSummary(manifest, manifestPath) {
  if (!manifest) {
    return {
      path: path.resolve(manifestPath),
      package_id: null,
      package_kind: null,
      requested_tier: null,
      proven_tier: null,
      default_outfit_ref: null,
      asset_count: null,
      render_layer_count: null,
    };
  }
  return {
    path: path.resolve(manifestPath),
    package_id: manifest.package_id ?? null,
    package_kind: manifest.package_kind ?? null,
    requested_tier: manifest.capability?.requested_tier ?? null,
    proven_tier: manifest.capability?.proven_tier ?? null,
    default_outfit_ref: manifest.wardrobe?.default_outfit_ref ?? null,
    asset_count: Array.isArray(manifest.assets) ? manifest.assets.length : null,
    render_layer_count: Array.isArray(manifest.render_layers) ? manifest.render_layers.length : null,
  };
}

function passFail(value) {
  return value ? 'pass' : 'fail';
}

async function writeReport(outPath, report) {
  if (!outPath) return null;
  const absoluteOut = path.resolve(outPath);
  await mkdir(path.dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, YAML.stringify(report), 'utf8');
  return absoluteOut;
}

export async function inspectPackage(manifestPath, options = {}) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifestPath);
  const packageValidation = await validatePackageManifest(absoluteManifestPath);
  const manifest = packageValidation.value ?? null;
  const capabilityProfileRaw = options.capabilityProfilePath
    ? await readFile(path.resolve(options.capabilityProfilePath), 'utf8')
    : null;
  const report = {
    manifest_kind: 'nimi.nimi2d.package-inspection-report',
    schema_version: 1,
    package: packageSummary(manifest, absoluteManifestPath),
    validation: {
      status: packageValidation.status,
      codes: packageValidation.codes,
      issues: packageValidation.issues,
    },
    render_plan: {
      status: 'not_run',
      render_layer_refs: [],
      default_outfit_layer_refs: [],
      base_body_layer_refs: [],
      error: null,
    },
    visual_proof: {
      status: 'not_run',
      stats: null,
      error: null,
    },
    reference_action: {
      status: 'not_run',
      bench_verdict: null,
      stress_verdict: null,
      failures: [],
      closes_production_avatar_readiness: false,
      note: 'Reference action replay is package readiness proof only, not production Avatar runtime readiness.',
    },
    decision: {
      verdict: 'fail',
      reason: 'Package validation failed.',
    },
  };

  let renderPlan = null;
  if (packageValidation.status === 'ok') {
    try {
      renderPlan = createNimi2DRenderPlan({
        packageManifestRaw: YAML.stringify(packageValidation.value),
        capabilityProfileRaw,
        packageManifestRef: absoluteManifestPath,
      });
      report.render_plan = {
        status: 'pass',
        render_layer_refs: renderPlan.renderLayers.map((layer) => layer.layerRef),
        default_outfit_layer_refs: defaultOutfitLayerRefs(renderPlan),
        base_body_layer_refs: renderPlan.manifest.base_body?.layer_refs ?? [],
        error: null,
      };
    } catch (error) {
      report.render_plan = {
        ...report.render_plan,
        status: 'fail',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (renderPlan) {
    try {
      const stats = await probeNimi2DVisualFrame({
        renderPlan,
        gridSize: options.gridSize,
        decodeImage: async ({ src }) => decodePngRgba(path.resolve(manifestDir, src)),
      });
      report.visual_proof = {
        status: stats.defaultOutfitVisiblePixels > 0 ? 'pass' : 'fail',
        stats,
        error: null,
      };
    } catch (error) {
      report.visual_proof = {
        status: 'fail',
        stats: error?.stats ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const referenceAction = await runReferenceActionBench(renderPlan);
    report.reference_action = {
      ...report.reference_action,
      status: referenceAction.bench.verdict === 'pass_minimal_tier1'
        && referenceAction.stress.verdict === 'pass_stream_stress_tier1'
        ? 'pass'
        : 'fail',
      bench_verdict: referenceAction.bench.verdict,
      stress_verdict: referenceAction.stress.verdict,
      failures: [
        ...referenceAction.bench.failures,
        ...referenceAction.stress.failures,
      ],
    };
  }

  const gates = {
    package_valid: packageValidation.status === 'ok',
    render_plan_built: report.render_plan.status === 'pass',
    default_outfit_renderable: report.render_plan.default_outfit_layer_refs.length > 0,
    visual_proof_passed: report.visual_proof.status === 'pass',
    reference_action_passed: report.reference_action.status === 'pass',
    tier1_proven: report.package.proven_tier === 'tier-1_agent_basic',
  };
  const passed = Object.values(gates).every(Boolean);
  report.gates = Object.fromEntries(Object.entries(gates).map(([key, value]) => [key, passFail(value)]));
  report.decision = {
    verdict: passed ? 'pass' : 'fail',
    reason: passed
      ? 'Package passed validation, render plan, visual proof, and reference action readiness checks.'
      : 'One or more package readiness gates failed.',
  };
  const outPath = await writeReport(options.outPath, report);
  return {
    status: passed ? 'ok' : 'reject',
    kind: 'package_inspection',
    outPath,
    decision: report.decision,
    report,
    codes: passed ? [] : ['NIMI2D_PACKAGE_INSPECTION_FAILED'],
    issues: passed ? [] : [{
      code: 'NIMI2D_PACKAGE_INSPECTION_FAILED',
      path: '$.decision',
      message: report.decision.reason,
    }],
  };
}
