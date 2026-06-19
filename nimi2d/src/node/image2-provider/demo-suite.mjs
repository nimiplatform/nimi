import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { encodePngRgba } from '../png-rgba-encode.mjs';
import { writeCodexImage2Plan, runCodexImage2Provider } from './provider-workflow.mjs';
import { runCodexImage2LayerWorkflow } from './layer-workflow.mjs';
import { summarizeRuns } from './distribution-report.mjs';

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

function setPixel(rgba, width, x, y, color) {
  const offset = ((y * width) + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function fillRect(rgba, width, area, color) {
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(width, Math.ceil(area.x + area.width));
  const y1 = Math.min(Math.floor(rgba.length / 4 / width), Math.ceil(area.y + area.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(rgba, width, x, y, color);
    }
  }
}

function fillEllipse(rgba, width, area, color) {
  const cx = area.x + (area.width / 2);
  const cy = area.y + (area.height / 2);
  const rx = area.width / 2;
  const ry = area.height / 2;
  for (let y = Math.floor(area.y); y < Math.ceil(area.y + area.height); y += 1) {
    for (let x = Math.floor(area.x); x < Math.ceil(area.x + area.width); x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if ((dx * dx) + (dy * dy) <= 1) {
        setPixel(rgba, width, x, y, color);
      }
    }
  }
}

function variantColor(variant, base) {
  return base.map((channel, index) => {
    const delta = ((variant * (17 + (index * 11))) % 46) - 18;
    return Math.max(8, Math.min(245, channel + delta));
  });
}

async function writePng(filePath, image) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encodePngRgba(image));
  return filePath;
}

async function writeDemoSourceImage(filePath, variant, mode = 'source') {
  const width = 512;
  const height = 768;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const background = mode === 'companion' ? [245, 248, 245, 255] : [250, 250, 244, 255];
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = background[0];
    rgba[offset + 1] = background[1];
    rgba[offset + 2] = background[2];
    rgba[offset + 3] = 255;
  }
  const skin = variantColor(variant, [232, 182, 145, 255]);
  const outfit = variantColor(variant, [40, 88, 165, 255]);
  const accent = variantColor(variant, [190, 54, 76, 255]);
  const hair = variantColor(variant, [178, 184, 208, 255]);
  if (mode === 'companion') {
    fillEllipse(rgba, width, { x: 156, y: 150, width: 200, height: 120 }, accent);
    fillRect(rgba, width, { x: 236, y: 255, width: 40, height: 300 }, accent);
    fillEllipse(rgba, width, { x: 168, y: 520, width: 176, height: 96 }, outfit);
    return writePng(filePath, { width, height, rgba });
  }
  fillEllipse(rgba, width, { x: 180, y: 70, width: 152, height: 148 }, skin);
  fillRect(rgba, width, { x: 216, y: 214, width: 80, height: 58 }, skin);
  fillRect(rgba, width, { x: 156, y: 270, width: 200, height: 250 }, outfit);
  fillRect(rgba, width, { x: 128, y: 286, width: 60, height: 250 }, outfit);
  fillRect(rgba, width, { x: 324, y: 286, width: 60, height: 250 }, outfit);
  fillRect(rgba, width, { x: 178, y: 512, width: 58, height: 180 }, [36, 38, 46, 255]);
  fillRect(rgba, width, { x: 276, y: 512, width: 58, height: 180 }, [36, 38, 46, 255]);
  fillRect(rgba, width, { x: 156, y: 686, width: 90, height: 36 }, [112, 82, 52, 255]);
  fillRect(rgba, width, { x: 266, y: 686, width: 90, height: 36 }, [112, 82, 52, 255]);
  fillEllipse(rgba, width, { x: 146, y: 36, width: 220, height: 210 }, hair);
  fillRect(rgba, width, { x: 132, y: 170, width: 48, height: 260 }, hair);
  fillRect(rgba, width, { x: 332, y: 170, width: 48, height: 260 }, hair);
  fillRect(rgba, width, { x: 204, y: 122, width: 34, height: 16 }, [35, 75, 145, 255]);
  fillRect(rgba, width, { x: 274, y: 122, width: 34, height: 16 }, [35, 75, 145, 255]);
  fillRect(rgba, width, { x: 232, y: 170, width: 48, height: 12 }, accent);
  if (mode === 'improved') {
    fillRect(rgba, width, { x: 156, y: 252, width: 200, height: 24 }, accent);
    fillRect(rgba, width, { x: 112, y: 416, width: 56, height: 28 }, skin);
    fillRect(rgba, width, { x: 344, y: 416, width: 56, height: 28 }, skin);
  }
  return writePng(filePath, { width, height, rgba });
}

function writeCellRect(rgba, width, column, row, localRect, color) {
  fillRect(rgba, width, {
    x: (column * 512) + localRect.x,
    y: (row * 512) + localRect.y,
    width: localRect.width,
    height: localRect.height,
  }, color);
}

function writeCellEllipse(rgba, width, column, row, localRect, color) {
  fillEllipse(rgba, width, {
    x: (column * 512) + localRect.x,
    y: (row * 512) + localRect.y,
    width: localRect.width,
    height: localRect.height,
  }, color);
}

async function writeDemoAtlas(filePath, variant) {
  const width = 1536;
  const height = 1024;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  const dx = ((variant % 5) - 2) * 6;
  const skin = variantColor(variant, [232, 184, 146, 255]);
  const body = variantColor(variant, [124, 100, 142, 255]);
  const outfit = variantColor(variant, [38, 88, 164, 255]);
  const hair = variantColor(variant, [176, 182, 205, 255]);
  const eye = variantColor(variant, [28, 86, 160, 255]);
  const mouth = variantColor(variant, [188, 58, 84, 255]);
  writeCellRect(rgba, width, 0, 0, { x: 210 + dx, y: 78, width: 92, height: 372 }, body);
  writeCellEllipse(rgba, width, 0, 0, { x: 198 + dx, y: 38, width: 116, height: 116 }, body);
  writeCellEllipse(rgba, width, 1, 0, { x: 184 + dx, y: 56, width: 144, height: 150 }, skin);
  writeCellEllipse(rgba, width, 2, 0, { x: 164 + dx, y: 28, width: 184, height: 220 }, hair);
  writeCellRect(rgba, width, 2, 0, { x: 152 + dx, y: 180, width: 48, height: 180 }, hair);
  writeCellRect(rgba, width, 2, 0, { x: 312 + dx, y: 180, width: 48, height: 180 }, hair);
  writeCellRect(rgba, width, 0, 1, { x: 178 + dx, y: 144, width: 156, height: 30 }, eye);
  writeCellRect(rgba, width, 1, 1, { x: 218 + dx, y: 190, width: 80, height: 20 }, mouth);
  writeCellRect(rgba, width, 2, 1, { x: 154 + dx, y: 118, width: 204, height: 340 }, outfit);
  writeCellRect(rgba, width, 2, 1, { x: 120 + dx, y: 145, width: 60, height: 220 }, outfit);
  writeCellRect(rgba, width, 2, 1, { x: 332 + dx, y: 145, width: 60, height: 220 }, outfit);
  return writePng(filePath, { width, height, rgba });
}

async function writeProviderResponse(responsePath, imagePath, summary) {
  await writeFile(responsePath, `${JSON.stringify({
    status: 'ok',
    image_path: imagePath,
    evidence_image_path: imagePath,
    summary,
    failure_reason: null,
  }, null, 2)}\n`, 'utf8');
}

async function createDemoProviderArtifact({
  workflow,
  outDir,
  description,
  sourceImage,
  targetKind,
  companionKind,
  slotKind,
  imageMode,
  variant,
}) {
  const planArgs = [
    '--workflow', workflow,
    '--description', description,
    '--out-dir', outDir,
  ];
  if (sourceImage) planArgs.push('--image', sourceImage);
  if (targetKind) planArgs.push('--target-kind', targetKind);
  if (companionKind) planArgs.push('--companion-kind', companionKind);
  if (slotKind) planArgs.push('--slot-kind', slotKind);
  const plan = await writeCodexImage2Plan(planArgs);
  if (imageMode === 'atlas') {
    await writeDemoAtlas(plan.expectedImagePath, variant);
  } else {
    await writeDemoSourceImage(plan.expectedImagePath, variant, imageMode);
  }
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeProviderResponse(responsePath, plan.expectedImagePath, `demo fixture for ${workflow}`);
  const run = await runCodexImage2Provider([
    '--request', plan.requestPath,
    '--response-file', responsePath,
    '--demo-fixture',
  ]);
  return { plan, run };
}

async function runCodexImage2DemoSuite(args) {
  const outDir = path.resolve(requireFlag(args, '--out-dir'));
  const sampleCount = integerFlag(args, '--sample-count', 11);
  const gridSize = integerFlag(args, '--grid-size', 4);
  await mkdir(outDir, { recursive: true });
  const workflowDir = path.join(outDir, 'provider-workflows');
  const runsDir = path.join(outDir, 'runs');

  const promptImage = await createDemoProviderArtifact({
    workflow: 'prompt-to-image',
    outDir: path.join(workflowDir, 'prompt-to-image'),
    description: 'Demo fully clothed Nimi2D courier avatar source image with crisp eyes, mouth, hands, shoes, hair, and outfit boundaries.',
    imageMode: 'source',
    variant: 1,
  });
  const improvedImage = await createDemoProviderArtifact({
    workflow: 'image-prompt-to-image',
    outDir: path.join(workflowDir, 'image-prompt-to-image'),
    sourceImage: promptImage.plan.expectedImagePath,
    description: 'Improve the demo Nimi2D source image for layer extraction while preserving identity, full-body framing, and outfit coverage.',
    imageMode: 'improved',
    variant: 2,
  });
  const companion = await createDemoProviderArtifact({
    workflow: 'companion-asset',
    outDir: path.join(workflowDir, 'companion-asset'),
    sourceImage: improvedImage.plan.expectedImagePath,
    description: 'Generate a crisp ribbon-and-satchel companion accessory source image for Nimi2D slot-bound companion asset testing.',
    targetKind: 'accessory_item',
    companionKind: 'accessory',
    slotKind: 'accessory_head',
    imageMode: 'companion',
    variant: 3,
  });

  const atlasRuns = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleId = `sample-${String(index + 1).padStart(2, '0')}`;
    const atlasArtifact = await createDemoProviderArtifact({
      workflow: 'image-to-layer-atlas',
      outDir: path.join(workflowDir, 'image-to-layer-atlas', sampleId),
      sourceImage: improvedImage.plan.expectedImagePath,
      description: `Generate Nimi2D registered layer atlas demo sample ${sampleId} with unique palette and identical cell registration.`,
      imageMode: 'atlas',
      variant: index + 10,
    });
    const runDir = path.join(runsDir, `codex-image2-demo-atlas-${sampleId}`);
    const layerRun = await runCodexImage2LayerWorkflow([
      '--producer-manifest', atlasArtifact.run.artifactManifestPath,
      '--out-dir', runDir,
      '--grid-size', String(gridSize),
    ]);
    atlasRuns.push({
      sample_id: sampleId,
      artifact_manifest_path: atlasArtifact.run.artifactManifestPath,
      run_dir: runDir,
      verdict: layerRun.verdict,
      repaired_workflow: layerRun.repairedWorkflowVerdict,
      source_to_layer_pipeline: layerRun.sourceToLayerPipelineVerdict,
      raw_provider_atlas_admission: layerRun.rawProviderAtlasAdmissionVerdict,
      formal_nimi2d_admission: layerRun.formalAdmissionVerdict,
    });
  }

  const distribution = await summarizeRuns(runsDir, {
    minSamples: sampleCount,
    gateMode: 'source_to_layer_pipeline',
  });
  const distributionPath = path.join(outDir, 'distribution-report.yaml');
  await writeFile(distributionPath, YAML.stringify(distribution), 'utf8');
  const suiteReport = {
    manifest_kind: 'nimi.nimi2d.codex-image2.demo-suite-report',
    schema_version: 1,
    verdict: distribution.decision.verdict === 'pass' ? 'pass' : 'fail',
    workflows: {
      prompt_to_image: {
        artifact_manifest_path: promptImage.run.artifactManifestPath,
        verdict: promptImage.run.artifactVerdict,
      },
      image_prompt_to_image: {
        artifact_manifest_path: improvedImage.run.artifactManifestPath,
        verdict: improvedImage.run.artifactVerdict,
      },
      companion_asset: {
        artifact_manifest_path: companion.run.artifactManifestPath,
        verdict: companion.run.artifactVerdict,
      },
      image_to_layer_atlas: {
        sample_count: sampleCount,
        passing_count: atlasRuns.filter((item) => item.source_to_layer_pipeline === 'pass').length,
        repaired_workflow_passing_count: atlasRuns.filter((item) => item.repaired_workflow === 'pass').length,
        source_to_layer_pipeline_passing_count: atlasRuns.filter((item) => item.source_to_layer_pipeline === 'pass').length,
        raw_provider_atlas_admission_passing_count: atlasRuns.filter((item) => item.raw_provider_atlas_admission === 'pass').length,
        formal_admission_passing_count: atlasRuns.filter((item) => item.formal_nimi2d_admission === 'pass').length,
        runs_dir: runsDir,
      },
    },
    distribution_report_path: distributionPath,
    distribution_decision: distribution.decision,
    note: 'Demo fixture artifacts are local deterministic source-to-layer regression evidence and must not be represented as live Codex Image2 generation or live distribution evidence.',
  };
  const suiteReportPath = path.join(outDir, 'demo-suite-report.yaml');
  await writeFile(suiteReportPath, YAML.stringify(suiteReport), 'utf8');
  return {
    status: suiteReport.verdict === 'pass' ? 'ok' : 'reject',
    kind: 'codex_image2_demo_suite',
    outDir,
    sampleCount,
    suiteReportPath,
    distributionReportPath: distributionPath,
    decision: distribution.decision,
    workflows: suiteReport.workflows,
  };
}

async function runCodexImage2DemoSuiteCli(argv = process.argv.slice(2)) {
  const result = await runCodexImage2DemoSuite(argv);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'ok') process.exitCode = 1;
}

export {
  runCodexImage2DemoSuite,
  runCodexImage2DemoSuiteCli,
  writeDemoAtlas,
  writeDemoSourceImage,
};
