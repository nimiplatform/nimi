import assert from 'node:assert/strict';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import {
  ZHIYU_RESOURCE_PACK_TARGET_ID,
  ZHIYU_RESOURCE_PACK_TARGET_VERSION,
} from '../src/resource-pack/contract.ts';
import { ZhiyuResourcePackPresentationController } from '../src/resource-pack/presentation-controller.ts';

const agentA = `agent_ref_${'a'.repeat(43)}`;

test('D-098 keeps last-safe A through both Apply phases without calling it B', async () => {
  const urls = testUrls();
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: urls.factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: 'pack:A' });
  await controller.renderSelected({
    agentHandle: agentA,
    selectionRevision: '1',
    selectedResourceRef: 'pack:A',
    archiveBytes: pack('#dbeafe'),
  });
  const activeA = controller.getSnapshot();
  assert.equal(activeA.phase, 'selected');
  assert.equal(activeA.effectiveResourceRef, 'pack:A');

  await controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'B.nimipack',
    archiveBytes: pack('#ede9fe'),
  });
  assert.equal(controller.getSnapshot().phase, 'preview');
  assert.equal(controller.getSnapshot().effectiveSource, 'preview');

  const material = controller.prepareApply();
  assert.equal(material.expectedRevision, '1');
  assert.equal(controller.getSnapshot().phase, 'apply-in-flight');
  assert.equal(controller.getSnapshot().pendingTruth, 'selection-unchanged-candidate-not-applied');
  assert.equal(controller.getSnapshot().effectiveSource, 'last-safe');
  assert.equal(controller.getSnapshot().effectiveResourceRef, 'pack:A');

  controller.applyCommitted({
    agentHandle: agentA,
    selectionRevision: '2',
    selectedResourceRef: 'pack:B',
  });
  assert.equal(controller.getSnapshot().phase, 'render-pending');
  assert.equal(controller.getSnapshot().pendingTruth, 'selection-saved-not-effective');
  assert.equal(controller.getSnapshot().selectedResourceRef, 'pack:B');
  assert.equal(controller.getSnapshot().effectiveResourceRef, 'pack:A');
  assert.equal(controller.getSnapshot().effectiveSource, 'last-safe');

  await controller.renderSelected({
    agentHandle: agentA,
    selectionRevision: '2',
    selectedResourceRef: 'pack:B',
    archiveBytes: pack('#ede9fe'),
  });
  assert.equal(controller.getSnapshot().phase, 'selected');
  assert.equal(controller.getSnapshot().effectiveResourceRef, 'pack:B');
  assert.equal(controller.getSnapshot().pendingTruth, null);
});

test('known Apply failure restores current canonical selection and destroys review B', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '7', selectedResourceRef: null });
  await controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '7',
    fileName: 'B.nimipack',
    archiveBytes: pack('#ede9fe'),
  });
  controller.prepareApply();
  controller.applyFailed('revision conflict');
  assert.equal(controller.getSnapshot().phase, 'default');
  assert.equal(controller.getSnapshot().selectedResourceRef, null);
  assert.equal(controller.getSnapshot().reviewFileName, null);
  assert.equal(controller.getSnapshot().pendingTruth, null);
});

test('selected Pack render failure uses Default with honest selected/effective mismatch', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '2', selectedResourceRef: 'pack:B' });
  controller.selectedRenderFailed('Selected Pack could not render.');
  const state = controller.getSnapshot();
  assert.equal(state.phase, 'fallback');
  assert.equal(state.selectedResourceRef, 'pack:B');
  assert.equal(state.effectiveResourceRef, null);
  assert.equal(state.effectiveSource, 'default');
  assert.match(state.mismatchReason, /could not render/u);
});

test('Cancel from a fallback Preview keeps the canonical selection retryable', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '2', selectedResourceRef: 'pack:A' });
  controller.selectedRenderFailed('Selected Pack could not render.');
  await controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '2',
    fileName: 'B.nimipack',
    archiveBytes: pack('#ede9fe'),
  });

  controller.cancelPreview();

  const state = controller.getSnapshot();
  assert.equal(state.phase, 'fallback');
  assert.equal(state.selectedResourceRef, 'pack:A');
  assert.equal(state.effectiveSource, 'default');
  assert.match(state.mismatchReason, /selected Resource Pack/u);
});

test('Agent change invalidates preview and stale selected reads', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: null });
  await controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'A.nimipack',
    archiveBytes: pack('#dbeafe'),
  });
  const agentB = `agent_ref_${'b'.repeat(43)}`;
  controller.resetAgent({ agentHandle: agentB, selectionRevision: '1', selectedResourceRef: 'pack:B' });
  const adopted = await controller.renderSelected({
    agentHandle: agentA,
    selectionRevision: '1',
    selectedResourceRef: 'pack:A',
    archiveBytes: pack('#dbeafe'),
  });
  assert.equal(adopted, false);
  assert.equal(controller.getSnapshot().agentHandle, agentB);
  assert.equal(controller.getSnapshot().phase, 'default');
});

test('Cancel fences an in-flight parser before it can install a late preview', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: null });
  const pending = controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'late.nimipack',
    archiveBytes: pack('#dbeafe'),
  });
  controller.cancelPreview();
  await pending;
  assert.equal(controller.getSnapshot().phase, 'default');
  assert.equal(controller.getSnapshot().reviewFileName, null);
});

test('invalid replacement B destroys preview A and returns to canonical last-safe render', async () => {
  const controller = new ZhiyuResourcePackPresentationController({ urlFactory: testUrls().factory });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: null });
  await controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'A.nimipack',
    archiveBytes: pack('#dbeafe'),
  });
  await assert.rejects(controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'invalid-B.nimipack',
    archiveBytes: new Uint8Array([1, 2, 3]),
  }));
  assert.equal(controller.getSnapshot().phase, 'default');
  assert.equal(controller.getSnapshot().reviewFileName, null);
  assert.equal(controller.getSnapshot().effectiveSource, 'default');
});

test('resource decode failure never installs preview or selected success', async () => {
  const controller = new ZhiyuResourcePackPresentationController({
    urlFactory: testUrls().factory,
    imageDecoder: async () => { throw new Error('image decode failed'); },
  });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: null });
  await assert.rejects(controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'corrupt.nimipack',
    archiveBytes: packWithImage(),
  }), /image decode failed/u);
  assert.equal(controller.getSnapshot().phase, 'default');
  assert.equal(controller.getSnapshot().scopedCssText, null);
});

test('Cancel during slow image decode disposes the late render instead of installing preview', async () => {
  let releaseDecode;
  let markDecodeStarted;
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve; });
  const controller = new ZhiyuResourcePackPresentationController({
    urlFactory: testUrls().factory,
    imageDecoder: async () => {
      markDecodeStarted();
      await new Promise((resolve) => { releaseDecode = resolve; });
    },
  });
  controller.resetAgent({ agentHandle: agentA, selectionRevision: '1', selectedResourceRef: null });
  const pending = controller.beginPreview({
    agentHandle: agentA,
    expectedRevision: '1',
    fileName: 'slow.nimipack',
    archiveBytes: packWithImage(),
  });
  await decodeStarted;
  controller.cancelPreview();
  releaseDecode();
  await pending;
  assert.equal(controller.getSnapshot().phase, 'default');
  assert.equal(controller.getSnapshot().reviewFileName, null);
});

function pack(color) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 1,
      target: { id: ZHIYU_RESOURCE_PACK_TARGET_ID, version: ZHIYU_RESOURCE_PACK_TARGET_VERSION },
      styleEntry: 'style.css',
      resources: [],
    })),
    'style.css': strToU8(`[data-nimi-pack-zone="surface"] { background-color: ${color}; }`),
  });
}

function packWithImage() {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 1,
      target: { id: ZHIYU_RESOURCE_PACK_TARGET_ID, version: ZHIYU_RESOURCE_PACK_TARGET_VERSION },
      styleEntry: 'style.css',
      resources: ['assets/corrupt.png'],
    })),
    'style.css': strToU8('[data-nimi-pack-zone="surface"] { background-image: url("assets/corrupt.png"); }'),
    'assets/corrupt.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
}

function testUrls() {
  const active = new Set();
  return {
    active,
    factory: {
      create(resource) {
        const url = `blob:test/${resource.path}/${active.size}`;
        active.add(url);
        return url;
      },
      revoke(url) {
        active.delete(url);
      },
    },
  };
}
