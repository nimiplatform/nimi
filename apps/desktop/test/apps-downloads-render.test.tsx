import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppPackageJobKind, AppPackageJobPhase, AppPackageSourceClass, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import { AppsDownloadsView, failedDownloadNeedsAttention } from '../src/shell/renderer/features/apps/apps-downloads-view.js';
import type { AppsDownloadsContextValue } from '../src/shell/renderer/features/apps/apps-downloads-context.js';
import { DownloadMetrics } from '../src/shell/renderer/components/download-metrics.js';

(globalThis as { React?: typeof React }).React = React;

function job(id = 1, phase = AppPackageJobPhase.QUEUED): AppPackageJob {
  return {
    jobId: new Uint8Array([id]), appId: `example.${id}`, sourceClass: AppPackageSourceClass.VERIFIED, kind: AppPackageJobKind.UPDATE,
    phase, targetRef: 'opaque-target', bytesCompleted: '1024', bytesTotal: '2048', progressBasis: 1, stepsCompleted: '0', terminalResult: 0,
    cancelable: ![AppPackageJobPhase.COMPLETED, AppPackageJobPhase.CANCELED, AppPackageJobPhase.FAILED].includes(phase), reasonCode: '',
    queuePosition: id, speedBytesPerSec: '1024', etaSeconds: '1', displayName: `Test App ${id}`, targetVersion: '2.0.0', previousVersion: '1.0.0',
    targetOs: 'macos', targetArch: 'aarch64', startedAt: { seconds: String(id), nanos: 0 },
    progressObservedAt: { seconds: String(Math.floor(Date.now() / 1000)), nanos: 0 },
  };
}

function render(jobs: AppPackageJob[], selectedJobId: string | null = null, status: 'ready' | 'unavailable' = 'ready') {
  const downloads = { jobs, selectedJobId, view: 'downloads', status, pendingIds: [], error: null } as unknown as AppsDownloadsContextValue;
  return renderToStaticMarkup(<AppsDownloadsView downloads={downloads} entries={[]} onViewApp={() => undefined} onRetry={() => undefined} />);
}

test('downloads renders every queued job and names keyboard reorder controls', async () => {
  await initI18n(); await changeLocale('en');
  const html = render(Array.from({ length: 9 }, (_, index) => job(index + 1)));
  for (let index = 1; index <= 9; index++) assert.ok(html.includes(`Move Test App ${index} up`));
  assert.match(html, /Download Test App 9 next/);
  assert.doesNotMatch(html, /Apps\.downloads\./);
});

test('completed and canceled detail does not retain update-in-progress instructions', async () => {
  await initI18n(); await changeLocale('en');
  const completed = render([job(1, AppPackageJobPhase.COMPLETED)], '01');
  assert.match(completed, /2\.0\.0 was installed/);
  assert.doesNotMatch(completed, /cannot open while its update/);
  const canceled = render([job(1, AppPackageJobPhase.CANCELED)], '01');
  assert.match(canceled, /Temporary downloads were removed/);
  assert.doesNotMatch(canceled, /cannot open while its update/);
  const paused = render([job(1, AppPackageJobPhase.PAUSED)], '01');
  assert.match(paused, /cannot open while its update is active, queued, or paused/);
  assert.match(paused, /Resuming adds this task to the end/);
});

test('disconnected task view retains bytes and read-only detail while disabling writes', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render([job(1, AppPackageJobPhase.DOWNLOADING)], '01', 'unavailable');
  assert.match(html, /显示上次确认的进度/);
  assert.match(html, /1\.0 KB \/ 2\.0 KB/);
  assert.match(html, /重新获取状态/);
  assert.doesNotMatch(html, /1\.0 KB\/s/);
  assert.doesNotMatch(html, /预计下载剩余 1s/);
});

test('old failures remain history when a later owner job exists', () => {
  const failed = job(1, AppPackageJobPhase.FAILED);
  const retry = { ...job(2), appId: failed.appId };
  assert.equal(failedDownloadNeedsAttention(failed, [failed]), true);
  assert.equal(failedDownloadNeedsAttention(failed, [failed, retry]), false);
});

test('shared download display gates unknown total, zero ETA, and expired observations', async () => {
  await initI18n(); await changeLocale('en');
  const props = { name: 'Transfer', received: 1024, speed: 1024, eta: 0, observedAt: Date.now() - 1000, available: true, transferring: true };
  const unknown = renderToStaticMarkup(<DownloadMetrics {...props} />);
  assert.match(unknown, /total size not available yet/);
  assert.doesNotMatch(unknown, /aria-valuenow=/);
  assert.doesNotMatch(unknown, /0s/);
  const stale = renderToStaticMarkup(<DownloadMetrics {...props} total={2048} eta={1} observedAt={Date.now() - 10_000} />);
  assert.match(stale, /Latest transfer metrics unavailable/);
  assert.doesNotMatch(stale, /1\.0 KB\/s/);
  assert.doesNotMatch(stale, /time left: 1s/);
});
