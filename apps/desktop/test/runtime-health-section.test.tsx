import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { createDesktopI18n } from '../src/shell/renderer/i18n/desktop-i18n.js';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context.js';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import { RuntimeHealthSection } from '../src/shell/renderer/features/runtime-config/runtime-config-runtime-health-section.js';

(globalThis as { React?: typeof React }).React = React;

test('Runtime counters preserve reported values without invented device capacity or queue limits', async () => {
  await initI18n();
  await changeLocale('en');
  const resource = createDesktopI18n({ initialLocale: 'en', development: false, now: Date.now });
  await resource.init();
  const health = {
    status: 3, reason: 'ready', cpuMilli: '2500', memoryBytes: String(32 * 1024 ** 3),
    vramBytes: '0', queueDepth: 20, activeInferenceJobs: 2,
  } as GetRuntimeHealthResponse;
  const html = renderToStaticMarkup(
    <TooltipProvider><DesktopI18nResourceProvider resource={resource}>
      <RuntimeHealthSection runtimeHealth={health} loading={false} error={null} streamConnected stale={false} streamError={null} onRefresh={() => undefined} />
    </DesktopI18nResourceProvider></TooltipProvider>,
  );
  assert.match(html, /2\.5 cores/);
  assert.match(html, /32 GB/);
  assert.match(html, /0 B/);
  assert.match(html, />20<\/p>/);
  assert.match(html, /not this computer/);
  assert.match(html, /counter is not sampled/);
  assert.doesNotMatch(html, /role="progressbar"|aria-valuemax|16 GB proxy|24 GB proxy/);
});
