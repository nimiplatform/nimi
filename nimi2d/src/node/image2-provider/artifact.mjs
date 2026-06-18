import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { decodePngRgba } from '../png-rgba.mjs';
import { encodePngRgba } from '../png-rgba-encode.mjs';
import { sha256 } from '../common-utils.mjs';

const CODEX_IMAGE2_ARTIFACT_KIND = 'nimi.nimi2d.codex-image2.artifact';
const acceptedSurfaces = new Set(['codex_app', 'codex_cli', 'codex_sdk', 'manual_handoff', 'demo_fixture']);

function usage() {
  return [
    'Usage:',
    '  nimi2d image2-register-output \\',
    '    --image <png> --out <manifest.yaml> --surface <codex_app|codex_cli|codex_sdk|manual_handoff|demo_fixture> \\',
    '    [--request <provider-request.yaml>] [--prompt-file <prompt.md>] [--evidence-image <png>] [--source-note <text>] \\',
    '    [--model <actual-selected-model>] [--model-hint <hint>]',
    '',
    '  nimi2d image2-compare-pixels \\',
    '    --left <png> --right <png> --out <report.yaml>',
    '',
    '  nimi2d image2-postprocess \\',
    '    --input <png> --out <png> --report <report.yaml> \\',
    '    [--transparent-background none|corner|color] [--key-color #rrggbb] [--tolerance <0-255>] \\',
    '    [--crop-alpha] [--padding <px>]',
  ].join('\n');
}

function getFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function requireFlag(args, name) {
  const value = getFlag(args, name);
  if (!value) throw new Error(`Missing required flag: ${name}`);
  return value;
}

function parseIntFlag(args, name, fallback) {
  const raw = getFlag(args, name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new Error(`Expected integer for ${name}: ${raw}`);
  return value;
}

async function readPngRecord(filePath) {
  const absolutePath = path.resolve(filePath);
  const bytes = await readFile(absolutePath);
  const decoded = await decodePngRgba(absolutePath);
  return {
    path: absolutePath,
    bytes,
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.rgba,
    file_sha256: sha256(bytes),
    byte_size: bytes.length,
    decoded_pixel_sha256: sha256(Buffer.from(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength)),
  };
}

function compareDecodedPixels(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    return {
      status: 'fail',
      dimensions_match: false,
      left_dimensions: { width: left.width, height: left.height },
      right_dimensions: { width: right.width, height: right.height },
      diff_pixels: null,
      diff_sum_rgba_abs: null,
      max_pixel_rgba_abs_sum: null,
    };
  }
  let diffPixels = 0;
  let diffSum = 0;
  let maxPixelDiff = 0;
  for (let index = 0; index < left.rgba.length; index += 4) {
    const diff = Math.abs(left.rgba[index] - right.rgba[index])
      + Math.abs(left.rgba[index + 1] - right.rgba[index + 1])
      + Math.abs(left.rgba[index + 2] - right.rgba[index + 2])
      + Math.abs(left.rgba[index + 3] - right.rgba[index + 3]);
    if (diff !== 0) {
      diffPixels += 1;
      diffSum += diff;
      if (diff > maxPixelDiff) maxPixelDiff = diff;
    }
  }
  return {
    status: diffPixels === 0 ? 'pass' : 'fail',
    dimensions_match: true,
    left_dimensions: { width: left.width, height: left.height },
    right_dimensions: { width: right.width, height: right.height },
    diff_pixels: diffPixels,
    diff_sum_rgba_abs: diffSum,
    max_pixel_rgba_abs_sum: maxPixelDiff,
  };
}

function imageSummary(record) {
  return {
    path: record.path,
    format: 'png',
    width_px: record.width,
    height_px: record.height,
    byte_size: record.byte_size,
    file_sha256: record.file_sha256,
    decoded_pixel_sha256: record.decoded_pixel_sha256,
  };
}

function producerIdentity(surface, input = {}) {
  if (surface === 'demo_fixture') {
    return {
      family: 'codex_image2_demo_fixture',
      model_hint: 'local_deterministic_fixture',
      selected_model: 'local_deterministic_fixture',
      selected_model_source: 'deterministic_fixture',
      auth_route: 'none',
    };
  }
  return {
    family: 'codex_image2',
    model_hint: input.modelHint ?? 'gpt-image-2',
    selected_model: input.selectedModel ?? null,
    selected_model_source: input.selectedModel ? (input.selectedModelSource ?? 'unknown') : 'not_recorded',
    auth_route: 'chatgpt_subscription',
  };
}

async function writeYaml(outPath, value) {
  const absolutePath = path.resolve(outPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, YAML.stringify(value), 'utf8');
  return absolutePath;
}

function parseHexColor(raw) {
  if (typeof raw !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`Expected #rrggbb color, got: ${raw}`);
  }
  return {
    r: Number.parseInt(raw.slice(1, 3), 16),
    g: Number.parseInt(raw.slice(3, 5), 16),
    b: Number.parseInt(raw.slice(5, 7), 16),
  };
}

function cornerColor(image) {
  const samples = [
    0,
    (image.width - 1) * 4,
    ((image.height - 1) * image.width) * 4,
    (((image.height - 1) * image.width) + image.width - 1) * 4,
  ];
  const sum = { r: 0, g: 0, b: 0 };
  for (const offset of samples) {
    sum.r += image.rgba[offset];
    sum.g += image.rgba[offset + 1];
    sum.b += image.rgba[offset + 2];
  }
  return {
    r: Math.round(sum.r / samples.length),
    g: Math.round(sum.g / samples.length),
    b: Math.round(sum.b / samples.length),
  };
}

function colorDistance(pixel, keyColor) {
  return Math.max(
    Math.abs(pixel.r - keyColor.r),
    Math.abs(pixel.g - keyColor.g),
    Math.abs(pixel.b - keyColor.b),
  );
}

function applyTransparency(image, mode, keyColor, tolerance) {
  if (mode === 'none') return { rgba: new Uint8ClampedArray(image.rgba), transparent_pixels: 0, key_color_rgb: null };
  const rgba = new Uint8ClampedArray(image.rgba);
  const resolvedKey = mode === 'corner' ? cornerColor(image) : keyColor;
  let transparentPixels = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const distance = colorDistance({ r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] }, resolvedKey);
    if (distance <= tolerance) {
      rgba[offset + 3] = 0;
      transparentPixels += 1;
    }
  }
  return {
    rgba,
    transparent_pixels: transparentPixels,
    key_color_rgb: resolvedKey,
  };
}

function alphaBounds(width, height, rgba) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[((y * width) + x) * 4 + 3];
      if (alpha === 0) continue;
      visiblePixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (visiblePixels === 0) return { visiblePixels, bounds: null };
  return {
    visiblePixels,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

function cropRgba(width, height, rgba, bounds) {
  const output = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = (((bounds.y + y) * width) + bounds.x) * 4;
    const targetStart = y * bounds.width * 4;
    output.set(rgba.subarray(sourceStart, sourceStart + bounds.width * 4), targetStart);
  }
  return { width: bounds.width, height: bounds.height, rgba: output };
}

function expandBounds(bounds, width, height, padding) {
  return {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: Math.min(width, bounds.x + bounds.width + padding) - Math.max(0, bounds.x - padding),
    height: Math.min(height, bounds.y + bounds.height + padding) - Math.max(0, bounds.y - padding),
  };
}

async function commandCompare(args) {
  const left = await readPngRecord(requireFlag(args, '--left'));
  const right = await readPngRecord(requireFlag(args, '--right'));
  const comparison = compareDecodedPixels(left, right);
  const report = {
    manifest_kind: 'nimi.nimi2d.codex-image2.pixel-identity-report',
    schema_version: 1,
    verdict: comparison.status,
    left: imageSummary(left),
    right: imageSummary(right),
    comparison,
    conclusion: comparison.status === 'pass'
      ? 'decoded pixels are identical; byte-level PNG differences are container or encoding differences'
      : 'decoded pixels differ; do not treat these files as the same Image Gen artifact',
  };
  const outPath = await writeYaml(requireFlag(args, '--out'), report);
  process.stdout.write(JSON.stringify({ status: 'ok', outPath, verdict: report.verdict }, null, 2));
  process.stdout.write('\n');
}

async function registerCodexImage2Artifact(input) {
  const surface = input.surface;
  if (!acceptedSurfaces.has(surface)) {
    throw new Error(`Unsupported surface ${surface}; expected one of ${[...acceptedSurfaces].join(', ')}`);
  }
  const image = await readPngRecord(input.imagePath);
  const evidence = input.evidenceImagePath ? await readPngRecord(input.evidenceImagePath) : null;
  const pixelIdentity = evidence ? compareDecodedPixels(image, evidence) : null;
  const prompt = input.promptFile ? {
    path: path.resolve(input.promptFile),
    sha256: sha256(await readFile(path.resolve(input.promptFile))),
  } : null;
  const request = input.requestPath ? {
    path: path.resolve(input.requestPath),
    sha256: sha256(await readFile(path.resolve(input.requestPath))),
  } : null;
  const manifest = {
    manifest_kind: CODEX_IMAGE2_ARTIFACT_KIND,
    schema_version: 1,
    verdict: evidence ? (pixelIdentity.status === 'pass' ? 'admit' : 'reject') : 'recorded_only',
    producer: {
      ...producerIdentity(surface, {
        modelHint: input.modelHint,
        selectedModel: input.selectedModel,
        selectedModelSource: input.selectedModelSource,
      }),
      surface,
      request,
      prompt,
      source_note: input.sourceNote ?? '',
    },
    artifact: imageSummary(image),
    evidence: evidence ? {
      image: imageSummary(evidence),
      pixel_identity: pixelIdentity,
    } : {
      image: null,
      pixel_identity: {
        status: 'not_provided',
        note: 'manifest records the artifact for traceability but cannot prove pixel identity against UI/output evidence',
      },
    },
    policy: {
      accepted_persistence: [
        'official generated-image attachment/download path',
        'official local generated-image path',
        'local persistence whose decoded pixels are proven identical to Image Gen output evidence',
      ],
      rejected_persistence: [
        'prompt reconstruction',
        'blank-canvas semantic redraw',
        'screenshot/downsample/crop unless explicitly marked as preview-derived',
        'any fallback that changes decoded pixels',
      ],
      system_drawing_rule: 'allowed only as a persistence/encoding step when it reads Image Gen pixels and preserves decoded pixels',
    },
  };
  const outPath = await writeYaml(input.outPath, manifest);
  return {
    status: manifest.verdict === 'reject' ? 'reject' : 'ok',
    kind: 'codex_image2_artifact_register',
    outPath,
    verdict: manifest.verdict,
    manifest,
  };
}

async function commandRegister(args) {
  const result = await registerCodexImage2Artifact({
    imagePath: requireFlag(args, '--image'),
    evidenceImagePath: getFlag(args, '--evidence-image'),
    promptFile: getFlag(args, '--prompt-file'),
    requestPath: getFlag(args, '--request'),
    surface: requireFlag(args, '--surface'),
    modelHint: getFlag(args, '--model-hint'),
    selectedModel: getFlag(args, '--model'),
    selectedModelSource: getFlag(args, '--model') ? 'cli_argument' : undefined,
    sourceNote: getFlag(args, '--source-note', ''),
    outPath: requireFlag(args, '--out'),
  });
  process.stdout.write(JSON.stringify({ status: result.status, outPath: result.outPath, verdict: result.verdict }, null, 2));
  process.stdout.write('\n');
  if (result.status !== 'ok') process.exitCode = 1;
}

async function commandPostprocess(args) {
  const input = await readPngRecord(requireFlag(args, '--input'));
  const mode = getFlag(args, '--transparent-background', 'none');
  if (!['none', 'corner', 'color'].includes(mode)) {
    throw new Error(`Unsupported --transparent-background ${mode}`);
  }
  const tolerance = parseIntFlag(args, '--tolerance', 10);
  if (tolerance < 0 || tolerance > 255) throw new Error('--tolerance must be between 0 and 255');
  const keyColor = mode === 'color' ? parseHexColor(requireFlag(args, '--key-color')) : null;
  const transparency = applyTransparency(input, mode, keyColor, tolerance);
  const beforeBounds = alphaBounds(input.width, input.height, input.rgba);
  const afterBoundsRaw = alphaBounds(input.width, input.height, transparency.rgba);
  let outputImage = { width: input.width, height: input.height, rgba: transparency.rgba };
  let cropBounds = null;
  if (hasFlag(args, '--crop-alpha')) {
    if (!afterBoundsRaw.bounds) throw new Error('Cannot crop alpha: no visible pixels remain after transparency processing.');
    const padding = parseIntFlag(args, '--padding', 0);
    if (padding < 0) throw new Error('--padding must be non-negative');
    cropBounds = expandBounds(afterBoundsRaw.bounds, input.width, input.height, padding);
    outputImage = cropRgba(input.width, input.height, transparency.rgba, cropBounds);
  }
  const encoded = encodePngRgba(outputImage);
  const outPath = path.resolve(requireFlag(args, '--out'));
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, encoded);
  const output = await readPngRecord(outPath);
  const report = {
    manifest_kind: 'nimi.nimi2d.codex-image2.postprocess-report',
    schema_version: 1,
    verdict: 'ok',
    input: imageSummary(input),
    output: imageSummary(output),
    operations: {
      transparent_background: {
        mode,
        tolerance,
        key_color_rgb: transparency.key_color_rgb,
        transparent_pixels_written: transparency.transparent_pixels,
      },
      crop_alpha: {
        enabled: hasFlag(args, '--crop-alpha'),
        crop_bounds_px: cropBounds,
      },
    },
    alpha: {
      before: {
        visible_pixels: beforeBounds.visiblePixels,
        visible_bounds_px: beforeBounds.bounds,
      },
      after_before_crop: {
        visible_pixels: afterBoundsRaw.visiblePixels,
        visible_bounds_px: afterBoundsRaw.bounds,
      },
      output: alphaBounds(output.width, output.height, output.rgba),
    },
  };
  const reportPath = await writeYaml(requireFlag(args, '--report'), report);
  process.stdout.write(JSON.stringify({ status: 'ok', outPath, reportPath }, null, 2));
  process.stdout.write('\n');
}

async function runCodexImage2AdapterCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = command ? 0 : 2;
    return;
  }
  if (command === 'compare-pixels') return commandCompare(args);
  if (command === 'register') return commandRegister(args);
  if (command === 'postprocess') return commandPostprocess(args);
  throw new Error(`Unknown command: ${command}`);
}

export {
  CODEX_IMAGE2_ARTIFACT_KIND,
  acceptedSurfaces,
  readPngRecord,
  compareDecodedPixels,
  imageSummary,
  commandCompare,
  commandRegister,
  commandPostprocess,
  registerCodexImage2Artifact,
  runCodexImage2AdapterCli,
};
