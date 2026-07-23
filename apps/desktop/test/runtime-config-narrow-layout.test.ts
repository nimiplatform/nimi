import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const panelViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-panel-view.tsx'),
  'utf8',
);

const inlineFeedbackSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/ui/feedback/inline-feedback.tsx'),
  'utf8',
);

const statusBannerSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/ui/feedback/status-banner.tsx'),
  'utf8',
);

const overviewPageSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-page-overview.tsx'),
  'utf8',
);

test('runtime panel is narrow-first stacked and desktop split only at xl', () => {
  assert.match(
    panelViewSource,
    /className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 pb-3 pt-2 xl:flex-row"/,
    'runtime panel must stack sidebar above content on narrow viewports',
  );
  assert.match(
    panelViewSource,
    /--runtime-sidebar-width/,
    'runtime sidebar width must be a responsive CSS variable, not an unconditional inline width',
  );
  assert.match(
    panelViewSource,
    /w-full[^\n]+xl:w-\[var\(--runtime-sidebar-width\)\]/,
    'runtime sidebar must be full-width on narrow viewports and fixed-width only on desktop',
  );
  assert.match(
    panelViewSource,
    /className="hidden xl:block"/,
    'runtime sidebar resize handle must be hidden while the narrow stacked layout is active',
  );
});

test('runtime page title uses the existing sidebar locale key', () => {
  assert.match(
    panelViewSource,
    /const pageTitle = t\(`runtimeConfig\.sidebar\.\$\{activePage\}`/,
    'runtime panel page title must not stay English-only in zh locale',
  );
  assert.match(panelViewSource, /<h2[^>]+>\{pageTitle\}<\/h2>/);
});

test('runtime page scroll content stays min-width constrained on narrow viewports', () => {
  assert.match(
    panelViewSource,
    /<ScrollArea className="min-w-0 flex-1" viewportClassName="bg-transparent \[&>div\]:!block \[&>div\]:!min-w-0 \[&>div\]:!w-full \[&>div\]:!max-w-full" contentClassName="min-w-0 w-full max-w-full overflow-x-hidden"/,
    'runtime page scroll area must constrain the Radix content wrapper instead of letting it stretch to max content',
  );
});

test('runtime overview content uses narrow-first grids and wraps diagnostics', () => {
  assert.match(
    overviewPageSource,
    /grid grid-cols-1 gap-3 sm:grid-cols-3/,
    'overview snapshot tiles must stack before the small-screen breakpoint',
  );
  assert.match(
    overviewPageSource,
    /flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between/,
    'runtime daemon status header must not force a single horizontal row on narrow viewports',
  );
  assert.match(
    overviewPageSource,
    /text-\[11px\][^'"]*break-words \[overflow-wrap:anywhere\]/,
    'raw runtime daemon diagnostics must wrap instead of forcing horizontal overflow',
  );
});

test('inline feedback wraps long runtime diagnostic messages', () => {
  assert.match(
    inlineFeedbackSource,
    /\[overflow-wrap:anywhere\]/,
    'long runtime diagnostic JSON must wrap instead of forcing horizontal overflow',
  );
});

test('status banner respects narrow viewport and wraps long diagnostics', () => {
  assert.match(
    statusBannerSource,
    /w-\[min\(calc\(100cqw-2rem\),42rem\)\]/,
    'global status banner must not exceed the canonical renderer container width',
  );
  assert.match(
    statusBannerSource,
    /min-w-0 flex-1 break-words \[overflow-wrap:anywhere\]/,
    'global status banner message must wrap long diagnostic JSON',
  );
});
