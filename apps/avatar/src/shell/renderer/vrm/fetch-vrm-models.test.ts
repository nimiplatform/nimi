// Wave 2 chunk 2-D of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Unit tests for the VRM sample fetcher script
// (`apps/avatar/scripts/fetch-vrm-models.mjs`). Network is fully mocked
// — no real https.get call lands on the public internet during tests.
//
// The script lives under `apps/avatar/scripts/` (Node ESM, not part of
// the `src/**` Vite/TS bundle), but vitest is configured to discover
// `src/**/*.test.{ts,tsx}` only — so this `.test.ts` file is the
// re-entry point that imports the script via a relative path and
// exercises its public surface.

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  ensureVrmSample,
  downloadFollowingRedirects,
  resolveSamplePath,
  VRM_SAMPLE_DEFINITIONS,
  // @ts-ignore — sibling .mjs Node script is intentionally outside the
  // TS project rootDir; the typecheck CI gate validates `src/**` only.
} from '../../../../scripts/fetch-vrm-models.mjs';

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  bodyChunks: Buffer[];
};

/**
 * Build a minimal `https.get`-like stub that emits an HTTP-style
 * response after a microtask tick. Each invocation pops the next
 * scripted response off the queue so a redirect chain can be modelled.
 */
function makeHttpsGetStub(responses: MockResponse[]) {
  const calls: string[] = [];
  let cursor = 0;
  const stub = (url: string | URL, callback: (res: EventEmitter) => void) => {
    calls.push(typeof url === 'string' ? url : url.toString());
    const scripted = responses[cursor];
    cursor += 1;
    if (!scripted) {
      throw new Error(`Unexpected https.get call #${cursor} to ${url}`);
    }
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      resume: () => void;
    };
    res.statusCode = scripted.statusCode;
    res.headers = scripted.headers;
    res.resume = () => {};
    queueMicrotask(() => {
      callback(res);
      queueMicrotask(() => {
        for (const chunk of scripted.bodyChunks) {
          res.emit('data', chunk);
        }
        res.emit('end');
      });
    });
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, cb: () => void) => void;
      destroy: () => void;
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };
  return { stub, calls };
}

describe('VRM_SAMPLE_DEFINITIONS', () => {
  it('declares the pixiv constraint-twist sample with raw GitHub source URL', () => {
    const def = VRM_SAMPLE_DEFINITIONS['vrm1-constraint-twist'];
    expect(def).toBeDefined();
    expect(def.filename).toBe('VRM1_Constraint_Twist_Sample.vrm');
    expect(def.sourceUrl).toContain('raw.githubusercontent.com/pixiv/three-vrm');
    expect(def.license).toBe('MIT');
    expect(def.expectedMinBytes).toBeGreaterThan(0);
  });

  it('declares the admitted VRoid CC0 hair samples with concrete raw source URLs', () => {
    const female = VRM_SAMPLE_DEFINITIONS['vroid-hair-sample-female-cc0'];
    const male = VRM_SAMPLE_DEFINITIONS['vroid-hair-sample-male-cc0'];

    expect(female).toMatchObject({
      filename: 'HairSample_Female.vrm',
      license: 'CC0-1.0',
    });
    expect(male).toMatchObject({
      filename: 'HairSample_Male.vrm',
      license: 'CC0-1.0',
    });
    expect(female.sourceUrl).toContain('raw.githubusercontent.com/madjin/vrm-samples');
    expect(male.sourceUrl).toContain('raw.githubusercontent.com/madjin/vrm-samples');
    expect(female.expectedMinBytes).toBeGreaterThan(16_000_000);
    expect(male.expectedMinBytes).toBeGreaterThan(17_000_000);
  });

  it('keeps fetcher sample ids aligned with the admitted sample catalog', () => {
    expect(Object.keys(VRM_SAMPLE_DEFINITIONS).sort()).toEqual([
      'vrm1-constraint-twist',
      'vroid-hair-sample-female-cc0',
      'vroid-hair-sample-male-cc0',
    ]);
  });
});

describe('resolveSamplePath', () => {
  it('returns the cache directory + filename for a known sample id', () => {
    const r = resolveSamplePath('vrm1-constraint-twist');
    expect(r.filePath).toMatch(/\.cache\/assets\/vrm-models\/VRM1_Constraint_Twist_Sample\.vrm$/);
    expect(r.cacheDir).toMatch(/\.cache\/assets\/vrm-models$/);
  });

  it('throws on unknown sample id', () => {
    expect(() => resolveSamplePath('does-not-exist')).toThrow(/Unknown VRM sample id/);
  });
});

describe('downloadFollowingRedirects', () => {
  it('returns the response body for a 200 OK', async () => {
    const body = Buffer.alloc(10_000_000, 0xab);
    const { stub, calls } = makeHttpsGetStub([
      { statusCode: 200, headers: {}, bodyChunks: [body] },
    ]);
    const result = await downloadFollowingRedirects('https://example.test/x.vrm', stub);
    expect(result.length).toBe(body.length);
    expect(calls).toEqual(['https://example.test/x.vrm']);
  });

  it('follows a 302 redirect to the resolved location', async () => {
    const body = Buffer.alloc(10_000_000, 0xcd);
    const { stub, calls } = makeHttpsGetStub([
      { statusCode: 302, headers: { location: 'https://cdn.example.test/x.vrm' }, bodyChunks: [] },
      { statusCode: 200, headers: {}, bodyChunks: [body] },
    ]);
    const result = await downloadFollowingRedirects('https://example.test/x.vrm', stub);
    expect(result.length).toBe(body.length);
    expect(calls).toEqual([
      'https://example.test/x.vrm',
      'https://cdn.example.test/x.vrm',
    ]);
  });

  it('rejects after exceeding the max redirect chain length', async () => {
    const responses: MockResponse[] = Array.from({ length: 6 }, (_, i) => ({
      statusCode: 302,
      headers: { location: `https://hop-${i + 1}.example.test/x.vrm` },
      bodyChunks: [],
    }));
    const { stub } = makeHttpsGetStub(responses);
    await expect(
      downloadFollowingRedirects('https://example.test/x.vrm', stub),
    ).rejects.toThrow(/Too many redirects/);
  });

  it('rejects on non-2xx final status', async () => {
    const { stub } = makeHttpsGetStub([
      { statusCode: 404, headers: {}, bodyChunks: [] },
    ]);
    await expect(
      downloadFollowingRedirects('https://example.test/x.vrm', stub),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('ensureVrmSample (idempotent fetch)', () => {
  it('skips the network when a cached file already exceeds expectedMinBytes', async () => {
    const httpsGet = vi.fn(() => {
      throw new Error('https.get must not be called when cache is warm');
    });
    const fsAdapter = {
      existsSync: () => true,
      statSync: () => ({ size: 11_000_000 }) as unknown as ReturnType<typeof import('node:fs').statSync>,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };
    const result = await ensureVrmSample('vrm1-constraint-twist', {
      httpsGet,
      fsAdapter,
    });
    expect(result.fetched).toBe(false);
    expect(result.sizeBytes).toBe(11_000_000);
    expect(httpsGet).not.toHaveBeenCalled();
    expect(fsAdapter.writeFile).not.toHaveBeenCalled();
  });

  it('downloads and writes the file when the cache is cold', async () => {
    const body = Buffer.alloc(10_000_000, 0xff);
    const { stub } = makeHttpsGetStub([
      { statusCode: 200, headers: {}, bodyChunks: [body] },
    ]);
    const writes: Array<{ path: string; bytes: number }> = [];
    const fsAdapter = {
      existsSync: () => false,
      statSync: () => ({ size: 0 }) as unknown as ReturnType<typeof import('node:fs').statSync>,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: unknown, b: unknown) => {
        writes.push({ path: String(p), bytes: (b as Buffer).length });
      }),
    };
    const result = await ensureVrmSample('vrm1-constraint-twist', {
      httpsGet: stub,
      fsAdapter,
    });
    expect(result.fetched).toBe(true);
    expect(result.sizeBytes).toBe(body.length);
    expect(fsAdapter.mkdir).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.bytes).toBe(body.length);
  });

  it('rejects when the downloaded payload is smaller than expectedMinBytes', async () => {
    const tiny = Buffer.alloc(100, 0x00);
    const { stub } = makeHttpsGetStub([
      { statusCode: 200, headers: {}, bodyChunks: [tiny] },
    ]);
    const fsAdapter = {
      existsSync: () => false,
      statSync: () => ({ size: 0 }) as unknown as ReturnType<typeof import('node:fs').statSync>,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };
    await expect(
      ensureVrmSample('vrm1-constraint-twist', { httpsGet: stub, fsAdapter }),
    ).rejects.toThrow(/download too small/);
    expect(fsAdapter.writeFile).not.toHaveBeenCalled();
  });
});
