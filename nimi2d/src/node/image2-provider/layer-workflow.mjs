import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

import { sha256 } from '../common-utils.mjs';
import { runImageInputWorkflowBench } from '../image-input/workflow-bench.mjs';
import { runAtlasQualityGate } from '../image-input/atlas-quality.mjs';
import { ATLAS_SPEC_KIND } from '../image-input/atlas-spec.mjs';
import { decodePngRgba } from '../png-rgba.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { CODEX_IMAGE2_ARTIFACT_KIND } from './artifact.mjs';

const key = [0, 255, 0, 255];
const defaultColumns = 3;
const defaultRows = 2;
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

function pixelOffset(width, x, y) {
  return ((y * width) + x) * 4;
}

function isExactKey(rgba, offset) {
  return rgba[offset] === key[0]
    && rgba[offset + 1] === key[1]
    && rgba[offset + 2] === key[2]
    && rgba[offset + 3] === key[3];
}

function isGreenScreenCandidate(rgba, offset) {
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  return green >= 140 && green - red >= 20 && green - blue >= 20;
}

function isLightDividerCandidate(rgba, offset) {
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  return red >= 210 && green >= 210 && blue >= 210 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 55;
}

function isNearCellEdge(x, y, cell, inset = 4) {
  return x - cell.x < inset
    || y - cell.y < inset
    || (cell.x + cell.width - 1) - x < inset
    || (cell.y + cell.height - 1) - y < inset;
}

function isBackgroundCandidate(rgba, offset, x, y, cell) {
  return isGreenScreenCandidate(rgba, offset)
    || (isNearCellEdge(x, y, cell) && isLightDividerCandidate(rgba, offset));
}

function seedCellEdges(cell) {
  const seeds = [];
  for (let x = cell.x; x < cell.x + cell.width; x += 1) {
    seeds.push([x, cell.y]);
    seeds.push([x, cell.y + cell.height - 1]);
  }
  for (let y = cell.y; y < cell.y + cell.height; y += 1) {
    seeds.push([cell.x, y]);
    seeds.push([cell.x + cell.width - 1, y]);
  }
  return seeds;
}

function floodNormalizeCell(inputRgba, outputRgba, imageWidth, cell) {
  const visited = new Uint8Array(cell.width * cell.height);
  const stack = seedCellEdges(cell);
  let normalizedPixels = 0;

  const localIndex = (x, y) => ((y - cell.y) * cell.width) + (x - cell.x);
  while (stack.length > 0) {
    const point = stack.pop();
    const x = point[0];
    const y = point[1];
    if (x < cell.x || y < cell.y || x >= cell.x + cell.width || y >= cell.y + cell.height) {
      continue;
    }
    const index = localIndex(x, y);
    if (visited[index]) {
      continue;
    }
    visited[index] = 1;
    const offset = pixelOffset(imageWidth, x, y);
    if (!isBackgroundCandidate(inputRgba, offset, x, y, cell)) {
      continue;
    }
    outputRgba[offset] = key[0];
    outputRgba[offset + 1] = key[1];
    outputRgba[offset + 2] = key[2];
    outputRgba[offset + 3] = key[3];
    normalizedPixels += 1;
    stack.push([x - 1, y]);
    stack.push([x + 1, y]);
    stack.push([x, y - 1]);
    stack.push([x, y + 1]);
  }
  return { normalizedPixels };
}

function measureCellQuality(rgba, imageWidth, cell) {
  const foregroundBounds = {
    minX: cell.x + cell.width,
    minY: cell.y + cell.height,
    maxX: -1,
    maxY: -1,
  };
  let keyPixels = 0;
  let foregroundPixels = 0;
  for (let y = cell.y; y < cell.y + cell.height; y += 1) {
    for (let x = cell.x; x < cell.x + cell.width; x += 1) {
      const offset = pixelOffset(imageWidth, x, y);
      if (isExactKey(rgba, offset)) {
        keyPixels += 1;
        continue;
      }
      foregroundPixels += 1;
      if (x < foregroundBounds.minX) foregroundBounds.minX = x;
      if (y < foregroundBounds.minY) foregroundBounds.minY = y;
      if (x > foregroundBounds.maxX) foregroundBounds.maxX = x;
      if (y > foregroundBounds.maxY) foregroundBounds.maxY = y;
    }
  }

  return {
    keyPixels,
    foregroundPixels,
    foregroundBounds: foregroundPixels === 0 ? null : {
      x: foregroundBounds.minX,
      y: foregroundBounds.minY,
      width: foregroundBounds.maxX - foregroundBounds.minX + 1,
      height: foregroundBounds.maxY - foregroundBounds.minY + 1,
    },
  };
}

function cellFor(column, row, cellWidth, cellHeight) {
  return {
    column,
    row,
    x: column * cellWidth,
    y: row * cellHeight,
    width: cellWidth,
    height: cellHeight,
  };
}

function localBounds(bounds, cell) {
  if (!bounds) return null;
  return {
    x: bounds.x - cell.x,
    y: bounds.y - cell.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function boundsCenter(bounds) {
  if (!bounds) return null;
  return {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2),
  };
}

function pointInsideBounds(point, bounds, pad = 0) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x - pad
    && point.x <= bounds.x + bounds.width + pad
    && point.y >= bounds.y - pad
    && point.y <= bounds.y + bounds.height + pad;
}

function overlapsOnX(left, right) {
  if (!left || !right) return false;
  return Math.max(left.x, right.x) <= Math.min(left.x + left.width, right.x + right.width);
}

function skinLikePixel(rgba, offset) {
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  return red >= 165 && red <= 255
    && green >= 105 && green <= 230
    && blue >= 75 && blue <= 210
    && red >= green
    && green >= blue - 18;
}

function meanSkinColor(image, cell) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = cell.y; y < cell.y + cell.height; y += 1) {
    for (let x = cell.x; x < cell.x + cell.width; x += 1) {
      const offset = pixelOffset(image.width, x, y);
      if (isGreenScreenCandidate(image.rgba, offset) || isLightDividerCandidate(image.rgba, offset) || !skinLikePixel(image.rgba, offset)) {
        continue;
      }
      sum[0] += image.rgba[offset];
      sum[1] += image.rgba[offset + 1];
      sum[2] += image.rgba[offset + 2];
      count += 1;
    }
  }
  return {
    pixelCount: count,
    meanRgb: count === 0 ? null : sum.map((channel) => Math.round(channel / count)),
  };
}

function colorDistance(left, right) {
  if (!left || !right) return null;
  return Math.max(
    Math.abs(left[0] - right[0]),
    Math.abs(left[1] - right[1]),
    Math.abs(left[2] - right[2]),
  );
}

function rawCellMeasurement(image, cell) {
  const foregroundBounds = {
    minX: cell.x + cell.width,
    minY: cell.y + cell.height,
    maxX: -1,
    maxY: -1,
  };
  let exactKeyPixels = 0;
  let greenBackgroundPixels = 0;
  let lightDividerPixels = 0;
  let foregroundPixels = 0;
  for (let y = cell.y; y < cell.y + cell.height; y += 1) {
    for (let x = cell.x; x < cell.x + cell.width; x += 1) {
      const offset = pixelOffset(image.width, x, y);
      if (isExactKey(image.rgba, offset)) exactKeyPixels += 1;
      const background = isGreenScreenCandidate(image.rgba, offset);
      const divider = isLightDividerCandidate(image.rgba, offset);
      if (background) greenBackgroundPixels += 1;
      if (divider) lightDividerPixels += 1;
      if (background || divider) {
        continue;
      }
      foregroundPixels += 1;
      if (x < foregroundBounds.minX) foregroundBounds.minX = x;
      if (y < foregroundBounds.minY) foregroundBounds.minY = y;
      if (x > foregroundBounds.maxX) foregroundBounds.maxX = x;
      if (y > foregroundBounds.maxY) foregroundBounds.maxY = y;
    }
  }
  const total = cell.width * cell.height;
  const bounds = foregroundPixels === 0 ? null : {
    x: foregroundBounds.minX,
    y: foregroundBounds.minY,
    width: foregroundBounds.maxX - foregroundBounds.minX + 1,
    height: foregroundBounds.maxY - foregroundBounds.minY + 1,
  };
  return {
    exactKeyPct: Number(((exactKeyPixels / total) * 100).toFixed(2)),
    greenBackgroundPct: Number(((greenBackgroundPixels / total) * 100).toFixed(2)),
    lightDividerPct: Number(((lightDividerPixels / total) * 100).toFixed(2)),
    foregroundPct: Number(((foregroundPixels / total) * 100).toFixed(2)),
    foregroundBounds: bounds,
    localForegroundBounds: localBounds(bounds, cell),
  };
}

function detectLightDividerLines(image) {
  const horizontal = [];
  const vertical = [];
  for (let y = 0; y < image.height; y += 1) {
    let lightPixels = 0;
    for (let x = 0; x < image.width; x += 1) {
      if (isLightDividerCandidate(image.rgba, pixelOffset(image.width, x, y))) {
        lightPixels += 1;
      }
    }
    if (lightPixels >= image.width * 0.8) {
      horizontal.push({ y, coveragePct: Number(((lightPixels / image.width) * 100).toFixed(2)) });
    }
  }
  for (let x = 0; x < image.width; x += 1) {
    let lightPixels = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (isLightDividerCandidate(image.rgba, pixelOffset(image.width, x, y))) {
        lightPixels += 1;
      }
    }
    if (lightPixels >= image.height * 0.8) {
      vertical.push({ x, coveragePct: Number(((lightPixels / image.height) * 100).toFixed(2)) });
    }
  }
  return { horizontal, vertical };
}

function cleanDetectedDividerLines(rgba, width, height) {
  const lines = detectLightDividerLines({ width, height, rgba });
  let cleanedPixels = 0;
  for (const line of lines.horizontal) {
    const y = line.y;
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset(width, x, y);
      if (!isLightDividerCandidate(rgba, offset)) continue;
      rgba[offset] = key[0];
      rgba[offset + 1] = key[1];
      rgba[offset + 2] = key[2];
      rgba[offset + 3] = key[3];
      cleanedPixels += 1;
    }
  }
  for (const line of lines.vertical) {
    const x = line.x;
    for (let y = 0; y < height; y += 1) {
      const offset = pixelOffset(width, x, y);
      if (!isLightDividerCandidate(rgba, offset)) continue;
      rgba[offset] = key[0];
      rgba[offset + 1] = key[1];
      rgba[offset + 2] = key[2];
      rgba[offset + 3] = key[3];
      cleanedPixels += 1;
    }
  }
  return { cleanedPixels, lines };
}

function gate(status, detail, metrics = {}) {
  return { status, detail, metrics };
}

function upstreamDecision(gates) {
  const statuses = Object.values(gates).map((item) => item.status);
  if (statuses.includes('fail')) {
    return { verdict: 'fail', reason: 'One or more upstream Image2 atlas quality gates failed.' };
  }
  if (statuses.includes('warn')) {
    return { verdict: 'warn', reason: 'Upstream Image2 atlas is usable but leaves measurable quality headroom.' };
  }
  return { verdict: 'pass', reason: 'Upstream Image2 atlas quality gates passed.' };
}

function normalizedDecision(gates) {
  const statuses = Object.values(gates).map((item) => item.status);
  if (statuses.includes('fail')) {
    return { verdict: 'fail', reason: 'Normalized atlas is not safe for machine cutting.' };
  }
  if (statuses.includes('warn')) {
    return { verdict: 'warn', reason: 'Normalized atlas is usable but should be reviewed.' };
  }
  return { verdict: 'pass', reason: 'Normalized atlas is safe for machine cutting.' };
}

function analyzeAtlasUpstreamQuality(image, columns, rows) {
  if (image.width % columns !== 0 || image.height % rows !== 0) {
    return {
      kind: 'nimi2d.codex_image2.upstream_atlas_quality.v1',
      decision: { verdict: 'fail', reason: 'Atlas dimensions are not divisible by the expected grid.' },
      gates: {
        dimensions_divisible: gate('fail', 'Image dimensions must be divisible by atlas grid.', { width: image.width, height: image.height, columns, rows }),
      },
    };
  }
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;
  const cells = {
    body: cellFor(0, 0, cellWidth, cellHeight),
    head: cellFor(1, 0, cellWidth, cellHeight),
    hair: cellFor(2, 0, cellWidth, cellHeight),
    eye: cellFor(0, 1, cellWidth, cellHeight),
    mouth: cellFor(1, 1, cellWidth, cellHeight),
    outfit: cellFor(2, 1, cellWidth, cellHeight),
  };
  const measurements = Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name, rawCellMeasurement(image, cell)]));
  let exactKeyPixels = 0;
  let greenBackgroundPixels = 0;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    if (isExactKey(image.rgba, offset)) exactKeyPixels += 1;
    if (isGreenScreenCandidate(image.rgba, offset)) greenBackgroundPixels += 1;
  }
  const totalPixels = image.width * image.height;
  const exactKeyPct = Number(((exactKeyPixels / totalPixels) * 100).toFixed(2));
  const greenBackgroundPct = Number(((greenBackgroundPixels / totalPixels) * 100).toFixed(2));
  const dividerLines = detectLightDividerLines(image);

  const headBounds = measurements.head.localForegroundBounds;
  const hairBounds = measurements.hair.localForegroundBounds;
  const eyeCenter = boundsCenter(measurements.eye.localForegroundBounds);
  const mouthCenter = boundsCenter(measurements.mouth.localForegroundBounds);
  const bodyCenter = boundsCenter(measurements.body.localForegroundBounds);
  const outfitCenter = boundsCenter(measurements.outfit.localForegroundBounds);
  const centerDelta = bodyCenter && outfitCenter ? Math.abs(bodyCenter.x - outfitCenter.x) : null;
  const heightRatio = measurements.body.localForegroundBounds && measurements.outfit.localForegroundBounds
    ? Number((measurements.outfit.localForegroundBounds.height / measurements.body.localForegroundBounds.height).toFixed(3))
    : null;
  const skin = {
    head: meanSkinColor(image, cells.head),
    outfitVisible: meanSkinColor(image, cells.outfit),
  };
  const skinDelta = colorDistance(skin.head.meanRgb, skin.outfitVisible.meanRgb);

  const foregroundPresent = Object.entries(measurements).every(([name, item]) => {
    const minimum = name === 'mouth' ? 0.05 : name === 'eye' ? 0.5 : 1;
    return item.foregroundPct >= minimum;
  });
  const alignmentPass = pointInsideBounds(eyeCenter, headBounds, cellWidth * 0.08)
    && pointInsideBounds(mouthCenter, headBounds, cellWidth * 0.08)
    && overlapsOnX(hairBounds, headBounds);
  const silhouetteStatus = centerDelta === null || heightRatio === null
    ? 'fail'
    : centerDelta <= cellWidth * 0.18 && heightRatio >= 0.65 && heightRatio <= 1.45
      ? 'pass'
      : 'warn';
  const gates = {
    dimensions_divisible: gate('pass', 'Image dimensions match the expected 3x2 atlas grid.', { width: image.width, height: image.height, cellWidth, cellHeight }),
    pure_chroma_key_background: gate(
      exactKeyPct >= 90 ? 'pass' : exactKeyPct >= 75 ? 'warn' : 'fail',
      'Raw Image2 atlas should use exact #00ff00 for empty areas before normalization.',
      { exactKeyPct, greenBackgroundPct },
    ),
    no_visible_grid_lines: gate(
      dividerLines.horizontal.length === 0 && dividerLines.vertical.length === 0 ? 'pass' : 'fail',
      'Generated atlas should not draw visible row/column separator lines.',
      { horizontalLines: dividerLines.horizontal, verticalLines: dividerLines.vertical },
    ),
    cell_foreground_present: gate(
      foregroundPresent ? 'pass' : 'fail',
      'Each semantic cell must contain measurable foreground pixels.',
      Object.fromEntries(Object.entries(measurements).map(([name, item]) => [name, item.foregroundPct])),
    ),
    facial_feature_registration: gate(
      alignmentPass ? 'pass' : 'fail',
      'Eyes, mouth, and hair must register against the head cell in the same local canvas.',
      { headBounds, hairBounds, eyeCenter, mouthCenter },
    ),
    silhouette_outfit_registration: gate(
      silhouetteStatus,
      'Registration silhouette and default outfit should occupy compatible avatar geometry.',
      { bodyBounds: measurements.body.localForegroundBounds, outfitBounds: measurements.outfit.localForegroundBounds, centerDeltaPx: centerDelta, heightRatio },
    ),
    visible_skin_palette: gate(
      skin.head.pixelCount >= 64 ? (skinDelta === null || skinDelta <= 55 ? 'pass' : 'warn') : 'fail',
      'Visible skin palette is measured inside the atlas; source-image color preservation requires a source reference.',
      { headSkin: skin.head, outfitVisibleSkin: skin.outfitVisible, skinDelta },
    ),
  };

  return {
    kind: 'nimi2d.codex_image2.upstream_atlas_quality.v1',
    decision: upstreamDecision(gates),
    raw_image: {
      width_px: image.width,
      height_px: image.height,
      cell_width_px: cellWidth,
      cell_height_px: cellHeight,
    },
    gates,
    measurements,
  };
}

function analyzeNormalizedAtlasQuality(normalized) {
  const image = {
    width: normalized.width,
    height: normalized.height,
    rgba: normalized.rgba,
  };
  const dividerLines = detectLightDividerLines(image);
  const foregroundPcts = normalized.quality.cellStats.map((item) => item.foregroundPct);
  const hasForegroundInEveryCell = foregroundPcts.every((value) => value > 0.05);
  const totalPixels = normalized.width * normalized.height;
  const foregroundPixels = normalized.quality.cellStats.reduce((sum, item) => sum + item.foregroundPixels, 0);
  const unclassifiedPixels = Math.max(0, totalPixels - normalized.quality.exactKeyPixels - foregroundPixels);
  const unclassifiedPct = Number(((unclassifiedPixels / totalPixels) * 100).toFixed(2));
  const gates = {
    pure_chroma_key_background: gate(
      unclassifiedPct <= 0.25 ? 'pass' : unclassifiedPct <= 1 ? 'warn' : 'fail',
      'Normalized atlas should contain exact #00ff00 background pixels for deterministic cutting.',
      {
        exactKeyPct: normalized.quality.exactKeyPct,
        exactKeyPixels: normalized.quality.exactKeyPixels,
        foregroundPixels,
        unclassifiedPixels,
        unclassifiedPct,
      },
    ),
    no_visible_grid_lines: gate(
      dividerLines.horizontal.length === 0 && dividerLines.vertical.length === 0 ? 'pass' : 'fail',
      'Normalized atlas should not retain visible row/column separator lines.',
      { horizontalLines: dividerLines.horizontal, verticalLines: dividerLines.vertical },
    ),
    cell_foreground_retained: gate(
      hasForegroundInEveryCell ? 'pass' : 'fail',
      'Normalization must preserve foreground content in every semantic cell.',
      Object.fromEntries(normalized.quality.cellStats.map((item) => [item.cell, item.foregroundPct])),
    ),
  };
  return {
    kind: 'nimi2d.codex_image2.normalized_atlas_quality.v1',
    decision: normalizedDecision(gates),
    normalized_image: {
      width_px: normalized.width,
      height_px: normalized.height,
      cell_width_px: normalized.cellWidth,
      cell_height_px: normalized.cellHeight,
    },
    gates,
    cell_stats: normalized.quality.cellStats,
  };
}

function makeTransparentAtlas(normalized) {
  const rgba = new Uint8ClampedArray(normalized.rgba);
  let transparentPixels = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (!isExactKey(rgba, offset)) continue;
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 0;
    transparentPixels += 1;
  }
  const totalPixels = normalized.width * normalized.height;
  return {
    width: normalized.width,
    height: normalized.height,
    rgba,
    report: {
      kind: 'nimi2d.codex_image2.transparent_atlas_report.v1',
      decision: {
        verdict: transparentPixels > 0 ? 'pass' : 'fail',
        reason: transparentPixels > 0
          ? 'Exact #00ff00 normalized atlas pixels were converted to alpha.'
          : 'No exact #00ff00 pixels were available for alpha conversion.',
      },
      transparent_background: {
        source_key_rgb: [0, 255, 0],
        tolerance: 0,
        transparent_pixels: transparentPixels,
        transparent_pct: Number(((transparentPixels / totalPixels) * 100).toFixed(2)),
      },
    },
  };
}

function normalizeAtlasBackground(image, columns, rows) {
  if (image.width % columns !== 0 || image.height % rows !== 0) {
    throw new Error(`Atlas dimensions ${image.width}x${image.height} are not divisible by ${columns}x${rows}.`);
  }
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;
  const outputRgba = new Uint8ClampedArray(image.rgba);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = {
        column,
        row,
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      floodNormalizeCell(image.rgba, outputRgba, image.width, cell);
    }
  }
  const dividerCleanup = cleanDetectedDividerLines(outputRgba, image.width, image.height);
  const cellStats = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = {
        column,
        row,
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      const stats = measureCellQuality(outputRgba, image.width, cell);
      cellStats.push({
        cell: `r${row}c${column}`,
        ...stats,
        foregroundPct: Number(((stats.foregroundPixels / (cellWidth * cellHeight)) * 100).toFixed(2)),
      });
    }
  }
  let exactKeyPixels = 0;
  for (let offset = 0; offset < outputRgba.length; offset += 4) {
    if (isExactKey(outputRgba, offset)) exactKeyPixels += 1;
  }
  return {
    width: image.width,
    height: image.height,
    cellWidth,
    cellHeight,
    rgba: outputRgba,
    quality: {
      exactKeyPixels,
      exactKeyPct: Number(((exactKeyPixels / (image.width * image.height)) * 100).toFixed(2)),
      gridLineCleanedPixels: dividerCleanup.cleanedPixels,
      cleanedDividerLines: dividerCleanup.lines,
      cellStats,
    },
  };
}

function rect(x, y, width, height) {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

const layerBlueprints = [
  ['layer_body', 0, 0, ['body', 'torso']],
  ['layer_head', 1, 0, ['head', 'face']],
  ['layer_hair', 2, 0, ['hair']],
  ['layer_eye', 0, 1, ['eye', 'brow']],
  ['layer_mouth', 1, 1, ['mouth']],
  ['layer_outfit', 2, 1, ['outfit']],
];

function cellStatsByName(cellStats) {
  return new Map((cellStats ?? []).map((item) => [item.cell, item]));
}

function measuredLocalBounds(cellStats, column, row, cellWidth, cellHeight) {
  const stats = cellStatsByName(cellStats).get(`r${row}c${column}`);
  const cell = cellFor(column, row, cellWidth, cellHeight);
  return localBounds(stats?.foregroundBounds ?? null, cell);
}

function boundsOrFull(bounds, cellWidth, cellHeight) {
  return bounds ?? rect(0, 0, cellWidth, cellHeight);
}

function measuredBoundsByLayer(cellStats, cellWidth, cellHeight) {
  return Object.fromEntries(layerBlueprints.map(([layerId, column, row]) => [
    layerId,
    measuredLocalBounds(cellStats, column, row, cellWidth, cellHeight),
  ]));
}

function pointInBounds(bounds, xRatio, yRatio) {
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - 1, Math.round(bounds.x + (bounds.width * xRatio)))),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - 1, Math.round(bounds.y + (bounds.height * yRatio)))),
  };
}

function subRect(bounds, xRatio, yRatio, widthRatio, heightRatio) {
  return rect(
    bounds.x + (bounds.width * xRatio),
    bounds.y + (bounds.height * yRatio),
    bounds.width * widthRatio,
    bounds.height * heightRatio,
  );
}

function layerDefinitions(cellWidth, cellHeight, cellStats = []) {
  const full = rect(0, 0, cellWidth, cellHeight);
  const measured = measuredBoundsByLayer(cellStats, cellWidth, cellHeight);
  return layerBlueprints.map(([layerId, column, row, semanticLabels]) => ({
    layer_id: layerId,
    cell: { column, row },
    semantic_labels: semanticLabels,
    placement_px: { x: 0, y: 0 },
    texture_bounds_px: full,
    visible_bounds_px: boundsOrFull(measured[layerId], cellWidth, cellHeight),
    occlusion_fill: 'not_applicable',
  }));
}

function anchorHints(cellWidth, cellHeight, cellStats = []) {
  const measured = measuredBoundsByLayer(cellStats, cellWidth, cellHeight);
  const body = boundsOrFull(measured.layer_body, cellWidth, cellHeight);
  const head = boundsOrFull(measured.layer_head, cellWidth, cellHeight);
  const eye = boundsOrFull(measured.layer_eye, cellWidth, cellHeight);
  const mouth = boundsOrFull(measured.layer_mouth, cellWidth, cellHeight);
  return [
    ['body_root', pointInBounds(body, 0.5, 0.94)],
    ['neck_base', pointInBounds(body, 0.5, 0.22)],
    ['head_center', pointInBounds(head, 0.5, 0.5)],
    ['face_center', pointInBounds(head, 0.5, 0.58)],
    ['left_eye_center', pointInBounds(eye, 0.35, 0.5)],
    ['right_eye_center', pointInBounds(eye, 0.65, 0.5)],
    ['mouth_center', pointInBounds(mouth, 0.5, 0.5)],
  ].map(([kind, point]) => ({
    anchor_id: `anchor_${kind}`,
    kind,
    point_px: point,
    source: 'codex_image2_layer_workflow',
  }));
}

function slotHints(cellWidth, cellHeight, cellStats = []) {
  const measured = measuredBoundsByLayer(cellStats, cellWidth, cellHeight);
  const body = boundsOrFull(measured.layer_body, cellWidth, cellHeight);
  const outfit = boundsOrFull(measured.layer_outfit, cellWidth, cellHeight);
  return [
    ['torso', subRect(body, 0.15, 0.28, 0.7, 0.35)],
    ['hip', subRect(body, 0.2, 0.7, 0.6, 0.18)],
    ['outfit_upper', subRect(outfit, 0.08, 0.2, 0.84, 0.35)],
    ['outfit_lower', subRect(outfit, 0.1, 0.55, 0.8, 0.4)],
    ['outfit_full', outfit],
  ].map(([kind, bounds]) => ({
    slot_hint_id: `slot_${kind}`,
    kind,
    bounds_px: bounds,
    source: 'codex_image2_layer_workflow',
  }));
}

function buildAtlasSpec(input) {
  const atlasToken = input.imageHash.slice(0, 12);
  return {
    manifest_kind: ATLAS_SPEC_KIND,
    schema_version: 1,
    atlas_id: `codex_image2_atlas_${atlasToken}`,
    atlas_image_ref: 'atlas.png',
    input_id: `n2d_layer_input_codex_image2_${atlasToken}`,
    input_kind: 'character_skin',
    canvas: {
      width_px: input.cellWidth,
      height_px: input.cellHeight,
      background: 'transparent',
    },
    cell: {
      width_px: input.cellWidth,
      height_px: input.cellHeight,
      columns: defaultColumns,
      rows: defaultRows,
      origin_px: { x: 0, y: 0 },
      gap_px: { x: 0, y: 0 },
    },
    background: {
      kind: 'chroma_key',
      chroma_key_rgb: [0, 255, 0],
      tolerance: 0,
    },
    source_evidence: {
      layer_generation_ref: `upstream.codex_image2.${atlasToken}.generated_png`,
      identity_preservation_ref: `upstream.codex_image2.${atlasToken}.source_sha256.${input.imageHash}`,
      content_admission_ref: `upstream.codex_image2.${atlasToken}.workflow_intake`,
    },
    layers: layerDefinitions(input.cellWidth, input.cellHeight, input.cellStats),
    draw_order: ['layer_body', 'layer_head', 'layer_hair', 'layer_eye', 'layer_mouth', 'layer_outfit'],
    global_anchor_hints: anchorHints(input.cellWidth, input.cellHeight, input.cellStats),
    global_slot_hints: slotHints(input.cellWidth, input.cellHeight, input.cellStats),
  };
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
    authority_boundary: 'Upstream producer evidence records persistence and pixel identity only; Nimi2D formal admission starts at the layer-input manifest.',
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
  const repairedWorkflowVerdict = bench.decision?.verdict === 'pass'
    && normalizedQuality.decision?.verdict === 'pass'
    && transparentAtlas.report.decision?.verdict === 'pass'
    && atlasQuality.decision?.verdict === 'pass'
    ? 'pass'
    : 'fail';
  const formalAdmissionVerdict = formalProducerVerdicts.has(upstreamProducer.verdict)
    && upstreamQuality.decision?.verdict === 'pass'
    && repairedWorkflowVerdict === 'pass'
    ? 'pass'
    : 'fail';
  const qualitySummary = {
    upstream_producer: upstreamProducer.verdict,
    upstream_image2_atlas: upstreamQuality.decision.verdict,
    normalized_atlas: normalizedQuality.decision.verdict,
    transparent_atlas: transparentAtlas.report.decision.verdict,
    atlas_quality: atlasQuality.decision?.verdict ?? 'fail',
    repaired_workflow: repairedWorkflowVerdict,
    formal_nimi2d_admission: formalAdmissionVerdict,
  };
  const manifest = {
    manifest_kind: 'nimi.nimi2d.codex-image2.layer-workflow-run',
    schema_version: 1,
    verdict: formalAdmissionVerdict,
    quality_summary: qualitySummary,
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
    outputs: {
      layer_input_manifest_path: path.join(outputDir, 'layer-input', 'layer-input.yaml'),
      layer_dir: path.join(outputDir, 'layer-input', 'layers'),
      corpus_path: path.join(outputDir, 'corpus.yaml'),
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
