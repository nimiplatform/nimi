#!/usr/bin/env node
// Wave 2 of topic 2026-04-30-avatar-vrm-backend-branch (design-08 / packet
// acceptance_invariant 18). Downloads representative VRM samples to
// apps/avatar/.cache/assets/vrm-models/. Idempotent: skips redownload
// when an existing file already meets `expectedMinBytes`.
//
// Asset attribution: see apps/avatar/assets/vrm-models/THIRD_PARTY_LICENSES.md
//
// Pattern reference: apps/desktop/scripts/run-macos-smoke-helpers.mjs
// (`ensureVrmSample` + `VRM_SAMPLE_CATALOG`). The shape is mirrored;
// no module imports cross app boundaries (apps/avatar self-contained
// policy enforced by `pnpm check:apps-avatar-isolation`).
//
// CLI usage:
//   node apps/avatar/scripts/fetch-vrm-models.mjs            # all samples
//   node apps/avatar/scripts/fetch-vrm-models.mjs --id <id>  # one sample
//
// Network: uses node:https.get directly (no curl/wget shell-out, no
// fetch dependency) and follows up to MAX_REDIRECTS HTTP 3xx hops to
// resolve GitHub raw → S3 redirects.

import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import https from 'node:https';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(APP_ROOT, '.cache/assets/vrm-models');

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Catalog of admitted representative VRM samples. Mirror of the
 * desktop helper's `VRM_SAMPLE_CATALOG` shape, but app-local and
 * indexed by stable sample id (not scenario id) so multiple scenarios
 * can reuse one sample.
 */
export const VRM_SAMPLE_DEFINITIONS = {
  'vrm1-constraint-twist': {
    id: 'vrm1-constraint-twist',
    filename: 'VRM1_Constraint_Twist_Sample.vrm',
    sourceUrl:
      'https://raw.githubusercontent.com/pixiv/three-vrm/release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm',
    license: 'MIT',
    upstream: 'pixiv/three-vrm',
    displayName: 'VRM1 Constraint Twist Sample (pixiv/three-vrm)',
    // Sanity check: the actual file is ~10.7 MB. Anything smaller is
    // a redirect-page leak / partial download.
    expectedMinBytes: 9_000_000,
  },
  'vroid-hair-sample-female-cc0': {
    id: 'vroid-hair-sample-female-cc0',
    filename: 'HairSample_Female.vrm',
    sourceUrl:
      'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/HairSample_Female.vrm',
    license: 'CC0-1.0',
    upstream: 'VRoid Studio sample model via madjin/vrm-samples mirror',
    displayName: 'VRoid HairSample Female (CC0)',
    expectedMinBytes: 17_000_000,
  },
  'vroid-hair-sample-male-cc0': {
    id: 'vroid-hair-sample-male-cc0',
    filename: 'HairSample_Male.vrm',
    sourceUrl:
      'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/HairSample_Male.vrm',
    license: 'CC0-1.0',
    upstream: 'VRoid Studio sample model via madjin/vrm-samples mirror',
    displayName: 'VRoid HairSample Male (CC0)',
    expectedMinBytes: 18_000_000,
  },
};

/**
 * Resolve where a sample lives in the cache. The directory may not
 * exist yet (created by ensureVrmSample on first fetch).
 */
export function resolveSamplePath(sampleId) {
  const def = VRM_SAMPLE_DEFINITIONS[sampleId];
  if (!def) {
    throw new Error(`Unknown VRM sample id: ${sampleId}`);
  }
  return {
    cacheDir: CACHE_DIR,
    filePath: path.join(CACHE_DIR, def.filename),
    definition: def,
  };
}

/**
 * Idempotent fetch. Resolves to a record with the on-disk path. Does
 * NOT redownload if the file already exists with size >= expectedMinBytes.
 *
 * Throws on transport / status errors; the caller decides whether
 * to surface that as a hard failure (CLI) or a soft skip (tests).
 *
 * @param {string} sampleId
 * @param {{ httpsGet?: typeof https.get, fsAdapter?: { existsSync: typeof existsSync, statSync: typeof statSync, mkdir: typeof fs.mkdir, writeFile: typeof fs.writeFile } }} [opts]
 */
export async function ensureVrmSample(sampleId, opts = {}) {
  const { cacheDir, filePath, definition } = resolveSamplePath(sampleId);
  const httpsGet = opts.httpsGet ?? https.get;
  const fsAdapter = opts.fsAdapter ?? {
    existsSync,
    statSync,
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
  };

  if (
    fsAdapter.existsSync(filePath) &&
    fsAdapter.statSync(filePath).size >= definition.expectedMinBytes
  ) {
    return {
      ...definition,
      filePath,
      cacheDir,
      fetched: false,
      sizeBytes: fsAdapter.statSync(filePath).size,
    };
  }

  await fsAdapter.mkdir(cacheDir, { recursive: true });
  const buffer = await downloadFollowingRedirects(definition.sourceUrl, httpsGet);
  if (buffer.length < definition.expectedMinBytes) {
    throw new Error(
      `VRM sample ${sampleId} download too small: got ${buffer.length} bytes, expected >= ${definition.expectedMinBytes}`,
    );
  }
  await fsAdapter.writeFile(filePath, buffer);
  return {
    ...definition,
    filePath,
    cacheDir,
    fetched: true,
    sizeBytes: buffer.length,
  };
}

/**
 * GET a URL, following up to MAX_REDIRECTS HTTP 3xx redirects.
 * Resolves to a Buffer of the response body.
 *
 * @param {string} startUrl
 * @param {typeof https.get} httpsGet
 */
export function downloadFollowingRedirects(startUrl, httpsGet = https.get) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    function go(currentUrl) {
      if (hops > MAX_REDIRECTS) {
        reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) starting at ${startUrl}`));
        return;
      }
      const req = httpsGet(currentUrl, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          hops += 1;
          // Drain so the socket can be reused.
          res.resume();
          const next = new URL(res.headers.location, currentUrl).toString();
          go(next);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status} fetching ${currentUrl}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms fetching ${currentUrl}`));
      });
      req.on('error', reject);
    }
    go(startUrl);
  });
}

/**
 * Ensure every sample in VRM_SAMPLE_DEFINITIONS, returning a result
 * record per sample.
 */
export async function ensureAllVrmSamples(opts) {
  const results = [];
  for (const id of Object.keys(VRM_SAMPLE_DEFINITIONS)) {
    results.push(await ensureVrmSample(id, opts));
  }
  return results;
}

function parseCliArgs(argv) {
  const opts = { id: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--id' && argv[i + 1]) {
      opts.id = argv[i + 1];
      i += 1;
    }
  }
  return opts;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const ids = args.id ? [args.id] : Object.keys(VRM_SAMPLE_DEFINITIONS);
  for (const id of ids) {
    process.stdout.write(`[fetch-vrm-models] ensuring ${id} ... `);
    try {
      const result = await ensureVrmSample(id);
      process.stdout.write(
        `${result.fetched ? 'fetched' : 'cached'} ${result.sizeBytes} bytes -> ${result.filePath}\n`,
      );
    } catch (err) {
      process.stdout.write('FAILED\n');
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[fetch-vrm-models] ${id} error: ${message}\n`);
      process.exitCode = 1;
    }
  }
}

// Only run main() when invoked directly (not when imported by a test).
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}
