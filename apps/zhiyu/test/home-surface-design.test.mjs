import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function readHomeSurfaceSource() {
  return [
    await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8'),
    await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface-sections.tsx'), 'utf8'),
  ].join('\n');
}

test('home surface keeps the product hierarchy compact before diagnostics', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  const primaryRailIndex = source.indexOf('className="zhiyu-home__right-rail"');
  const diagnosticIndex = source.indexOf('data-zhiyu-diagnostics-drawer');
  assert.ok(primaryRailIndex >= 0, 'expected primary Memory/Avatar rail to render');
  assert.ok(diagnosticIndex >= 0, 'expected diagnostic drawer evidence to render');
  assert.ok(
    primaryRailIndex < diagnosticIndex,
    'primary Memory/Avatar rail should render before diagnostic evidence',
  );

  assert.doesNotMatch(
    css,
    /font-size:\s*[^;]*(?:clamp\(|vw)/,
    'home typography must use stable compact sizes instead of viewport-scaled hero sizing',
  );

  assert.doesNotMatch(
    css,
    /\.zhiyu-home__presence\s*\{[^}]*grid-row:\s*span\s+3\b/s,
    'agent presence should not span multiple grid rows as a hero panel',
  );

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*\.zhiyu-home__status-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\);/s,
    'narrow status rows must stack text instead of overlapping evidence labels',
  );

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*\.zhiyu-home__diagnostic-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    'narrow diagnostic rows must stack evidence labels and action hints',
  );
});

test('electron acceptance stores PP2 desktop and narrow visual evidence', async () => {
  const acceptance = await readFile(path.join(root, 'test', 'electron-acceptance.mjs'), 'utf8');

  assert.match(acceptance, /product-home-desktop\.png/);
  assert.match(acceptance, /product-home-narrow\.png/);
});

test('ZM6 product shell keeps diagnostics behind an explicit drawer', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(source, /data-zhiyu-product-shell="workspace"/);
  assert.match(source, /data-zhiyu-primary-ui="true"/);
  assert.match(source, /data-zhiyu-diagnostics-toggle="open"/);
  assert.match(source, /data-zhiyu-diagnostics-drawer=\{diagnosticsOpen \? 'open' : 'closed'\}/);
  assert.match(source, /hidden=\{!diagnosticsOpen\}/);
  assert.match(source, /technicalSurfaces\.map\(renderGatedSurface\)/);
  assert.match(source, /primaryMemorySurface \? renderGatedSurface\(primaryMemorySurface\) : null/);
  assert.match(source, /primaryAvatarSurface \? renderGatedSurface\(primaryAvatarSurface\) : null/);

  assert.match(css, /\.zhiyu-home__workspace\s*\{/);
  assert.match(css, /\.zhiyu-home__shell-grid\s*\{/);
  assert.match(css, /\.zhiyu-home__action-rail\s*\{/);
  assert.match(css, /\.zhiyu-home__right-rail\s*\{/);
  assert.match(css, /\.zhiyu-home__diagnostics-layer\s*\{/);
});

test('ZM6 primary product surfaces do not render raw projection tokens as user copy', async () => {
  const source = await readHomeSurfaceSource();
  const memory = await readFile(path.join(root, 'src', 'shell', 'app', 'home-memory-observatory-section.tsx'), 'utf8');

  assert.match(source, /formatProjectionValue/);
  assert.match(source, /formatReasonLabel/);
  assert.doesNotMatch(
    source,
    /<strong>\{value \?\? 'not_projected'\}<\/strong>/,
    'Avatar primary fields should show product copy while keeping not_projected in data attributes only',
  );
  assert.doesNotMatch(
    memory,
    />\{field\}: not_projected<\/span>/,
    'Memory lifecycle diagnostic tokens should not render as primary visible copy',
  );
  assert.doesNotMatch(
    memory,
    /<strong>not_projected<\/strong>/,
    'Memory graph should not render not_projected as primary visible copy',
  );
});

test('ZM6 AI action rail uses product copy instead of tester diagnostics', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');

  assert.match(source, /imageStudioResultText/);
  assert.doesNotMatch(source, /<p>\{evidence\.imageStudio\.message\}<\/p>/);
  assert.doesNotMatch(source, /AIConfig targetRef is required/);
  assert.doesNotMatch(source, /failed closed before request dispatch/);
  assert.doesNotMatch(source, /Run core Runtime AI capabilities through the shared Kit consume path\./);
  assert.doesNotMatch(source, /Run image\.generate through Runtime scenario jobs and Runtime-owned artifacts\./);
  assert.doesNotMatch(source, /placeholder="Write a short prompt for text, stream, or embedding\."/);
  assert.doesNotMatch(source, />Generate image<\/Button>/);
});

test('ZM8 no-runtime gate keeps raw Runtime transport detail out of primary copy', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'auth', 'runtime-unavailable-page.tsx'), 'utf8');

  assert.match(source, /runtime-unavailable-diagnostic-detail/);
  assert.match(source, /runtimeUnavailablePrimaryCopy/);
  assert.doesNotMatch(source, />Runtime session unavailable</);
  assert.doesNotMatch(source, />action required</);
  assert.doesNotMatch(source, />Retry Runtime check</);
  assert.doesNotMatch(source, /<span>\{body\}<\/span>/);
  assert.doesNotMatch(source, /projection\?\.actionHint \? <p className="runtime-action-hint">/);
});

test('ZM8 Capability Studio presents product text instead of raw Runtime envelopes', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');

  assert.match(source, /formatCapabilityStudioProductText/);
  assert.match(source, /stripRuntimeTextEnvelope/);
  assert.doesNotMatch(source, /return studio\.streamingText \|\| studio\.text \|\| studio\.message;/);
  assert.doesNotMatch(source, /Embedding ready:/);
  assert.doesNotMatch(source, /<message id=/);
});

test('ZM8 Image Studio exposes a deliberate preview state for Runtime artifacts', async () => {
  const source = await readFile(path.join(root, 'src', 'shell', 'app', 'HomeSurface.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');

  assert.match(source, /imageStudioPreviewState/);
  assert.match(source, /data-zhiyu-image-generate-preview-state/);
  assert.match(source, /Runtime 返回了图片产物/);
  assert.match(css, /\.zhiyu-home__image-studio-preview-frame\s*\{/);
});

test('ZM8 product workspace styles local buttons and text areas instead of exposing browser defaults', async () => {
  const css = await readFile(path.join(root, 'src', 'shell', 'app', 'home-surface.css'), 'utf8');
  const authCss = await readFile(path.join(root, 'src', 'shell', 'auth', 'runtime-auth.css'), 'utf8');

  assert.match(css, /\.zhiyu-home :where\(button\)\s*\{/);
  assert.match(css, /\.zhiyu-home :where\(textarea\)\s*\{/);
  assert.match(css, /"presence conversation side"\s+"presence capability side"\s+"presence image side"/);
  assert.match(authCss, /\.runtime-unavailable-screen :where\(button\)\s*\{/);
});

test('ZM8 Electron evidence persists page problem arrays with screenshots', async () => {
  const noRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-acceptance.mjs'), 'utf8');
  const liveRuntimeAcceptance = await readFile(path.join(root, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(noRuntimeAcceptance, /captureProductHomeEvidence\(page,\s*pageProblems,/);
  assert.match(noRuntimeAcceptance, /pageProblems:\s*\[\.\.\.pageProblems\]/);
  assert.match(liveRuntimeAcceptance, /captureLiveRuntimeEvidence\(page,\s*[^,]+,\s*pageProblems,/);
  assert.match(liveRuntimeAcceptance, /pageProblems:\s*\[\.\.\.pageProblems\]/);
});
