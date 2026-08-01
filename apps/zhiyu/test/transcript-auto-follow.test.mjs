import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

test('notifies the canonical virtualizer after programmatic bottom alignment and later layout commits', async () => {
  const { followZhiyuTranscriptToLatest } = await importAutoFollowModule();
  const previousResizeObserver = globalThis.ResizeObserver;
  const previousMutationObserver = globalThis.MutationObserver;
  const content = {};
  const observed = [];
  let resizeCallback = null;
  let mutationCallback = null;
  let resizeDisconnected = false;
  let mutationDisconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeCallback = callback;
    }

    observe(target) {
      observed.push(target);
    }

    disconnect() {
      resizeDisconnected = true;
    }
  };
  globalThis.MutationObserver = class {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe(target, options) {
      observed.push({ target, options });
    }

    disconnect() {
      mutationDisconnected = true;
    }
  };
  const scrollRoot = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    renderedVirtualIndices: [0, 1, 2],
    dispatchedEvents: [],
    querySelector(selector) {
      assert.equal(selector, '[data-canonical-transcript-width]');
      return content;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) {
      this.dispatchedEvents.push(event);
      if (event.type === 'scroll') {
        this.renderedVirtualIndices = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
      }
      return true;
    },
  };
  const end = {
    scrollIntoViewCalls: [],
    scrollIntoView(options) {
      this.scrollIntoViewCalls.push(options);
    },
  };

  try {
    const stop = followZhiyuTranscriptToLatest(scrollRoot, end);
    assert.equal(scrollRoot.scrollTop, 0);
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [0, 1, 2]);
    assert.equal(scrollRoot.dispatchedEvents.length, 0);
    await Promise.resolve();
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    assert.equal(scrollRoot.dispatchedEvents[0]?.type, 'scroll');
    assert.equal(scrollRoot.dispatchedEvents[0]?.bubbles, true);
    assert.deepEqual(end.scrollIntoViewCalls, [{ block: 'end', inline: 'nearest' }]);
    assert.equal(observed[0], content);
    assert.deepEqual(observed[1], {
      target: content,
      options: {
        attributes: true,
        attributeFilter: ['style', 'data-index'],
        childList: true,
        subtree: true,
      },
    });

    scrollRoot.scrollHeight = 500;
    scrollRoot.renderedVirtualIndices = [0, 1, 2];
    resizeCallback([]);
    assert.equal(scrollRoot.scrollTop, 400);
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [0, 1, 2]);
    await Promise.resolve();
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);

    scrollRoot.scrollHeight = 725;
    scrollRoot.renderedVirtualIndices = [0, 1, 2];
    mutationCallback([]);
    assert.equal(scrollRoot.scrollTop, 625);
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [0, 1, 2]);
    await Promise.resolve();
    assert.deepEqual(scrollRoot.renderedVirtualIndices, [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    assert.equal(end.scrollIntoViewCalls.length, 3);
    assert.equal(scrollRoot.dispatchedEvents.length, 3);

    scrollRoot.renderedVirtualIndices = [0, 1, 2];
    resizeCallback([]);
    stop();
    await Promise.resolve();
    assert.deepEqual(
      scrollRoot.renderedVirtualIndices,
      [0, 1, 2],
      'cleanup must suppress an already queued virtualizer notification',
    );
    assert.equal(scrollRoot.dispatchedEvents.length, 3);
    assert.equal(resizeDisconnected, true);
    assert.equal(mutationDisconnected, true);
  } finally {
    if (previousResizeObserver === undefined) {
      delete globalThis.ResizeObserver;
    } else {
      globalThis.ResizeObserver = previousResizeObserver;
    }
    if (previousMutationObserver === undefined) {
      delete globalThis.MutationObserver;
    } else {
      globalThis.MutationObserver = previousMutationObserver;
    }
  }
});

async function importAutoFollowModule() {
  if (!buildDir) {
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-transcript-auto-follow-'));
    await build({
      entryPoints: [path.join(root, 'src/shell/agent-chat/transcript-auto-follow.ts')],
      outfile: path.join(buildDir, 'transcript-auto-follow.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      logLevel: 'silent',
    });
  }
  return import(pathToFileURL(path.join(buildDir, 'transcript-auto-follow.mjs')).href);
}
