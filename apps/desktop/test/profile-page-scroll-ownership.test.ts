import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readRendererSource(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '../src/shell/renderer', relativePath), 'utf8');
}

const profilePanelSource = readRendererSource('features/profile/profile-panel.tsx');
const profileDetailContentSource = readRendererSource('features/relationship/profile-detail-view-content.tsx');
const profileDetailControllerSource = readRendererSource('features/relationship/profile-detail-view-controller.ts');

test('Profile route owns profile-page scrolling instead of nesting a second detail scroller', () => {
  assert.match(profilePanelSource, /<ScrollArea[\s\S]*viewportRef=\{profileScrollContainerRef\}[\s\S]*<Surface/);
  assert.match(
    profilePanelSource,
    /data-testid=\{E2E_IDS\.panel\('profile'\)\} className="flex min-h-0 flex-1 flex-col overflow-hidden"/,
    'profile panel root must not place padding outside the route scroll owner',
  );
  assert.match(
    profilePanelSource,
    /viewportClassName="bg-transparent px-5 pb-5 pt-4"/,
    'route padding belongs to the scroll viewport so the scrollbar stays outside the rounded page surface',
  );
  assert.match(profilePanelSource, /externalScrollContainerRef=\{profileScrollContainerRef\}/);
  assert.doesNotMatch(
    profilePanelSource,
    /className="min-h-0 flex-1 overflow-hidden rounded-\[2rem\]/,
    'profile route surface must not be a fixed-height overflow-hidden scroller shell',
  );
  assert.match(
    profilePanelSource,
    /className="min-h-full overflow-hidden rounded-\[2rem\]/,
    'profile surface must keep overflow clipping so the large page keeps its rounded corners',
  );
  assert.doesNotMatch(
    profilePanelSource,
    /className="min-h-full overflow-visible rounded-\[2rem\]/,
    'profile surface cannot be overflow-visible because it visually flattens the rounded page',
  );
});

test('Profile detail view keeps its internal ScrollArea only when no external scroll owner is supplied', () => {
  assert.match(profileDetailControllerSource, /externalScrollContainerRef\?: RefObject<HTMLDivElement \| null>/);
  assert.match(profileDetailControllerSource, /usesExternalScrollContainer/);
  assert.match(profileDetailContentSource, /usesExternalScrollContainer \?/);
  assert.match(profileDetailContentSource, /<ScrollArea[\s\S]*viewportRef=\{scrollContainerRef\}/);
  assert.doesNotMatch(
    profileDetailContentSource,
    /<ScrollArea[\s\S]*ref=\{scrollContainerRef\}/,
    'detail ScrollArea should bind the actual viewport, not the non-scrolling root',
  );
});
