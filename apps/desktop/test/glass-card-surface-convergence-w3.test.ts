import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const sharedSurfaceSource = readWorkspaceFile('src/shell/renderer/components/surface.tsx');
const homePostFeedSource = readWorkspaceFile('src/shell/renderer/features/home/post-feed.tsx');
const homeArticleSource = readWorkspaceFile('src/shell/renderer/features/home/article.tsx');
const exploreCardsSource = [
  readWorkspaceFile('src/shell/renderer/features/explore/explore-cards.tsx'),
  readWorkspaceFile('src/shell/renderer/features/explore/explore-agent-recommendation-card.tsx'),
].join('\n');
const notificationPanelSource = readWorkspaceFile('src/shell/renderer/features/notification/notification-panel.tsx');

test('W3 glass card convergence: shared desktop card surface supports interactive and active route rows', () => {
  assert.match(sharedSurfaceSource, /interactive\?: boolean;/);
  assert.match(sharedSurfaceSource, /active\?: boolean;/);
  assert.match(sharedSurfaceSource, /interactive=\{interactive\}/);
  assert.match(sharedSurfaceSource, /active=\{active\}/);
});

test('W3 glass card convergence: home feed skeletons and post articles consume the shared promoted glass primitive', () => {
  assert.match(homePostFeedSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(homePostFeedSource, /<DesktopCardSurface kind="promoted-glass" className="mb-6 p-5">/);
  assert.match(homeArticleSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(homeArticleSource, /<DesktopCardSurface[\s\S]*kind="promoted-glass"[\s\S]*as="article"/);
});

test('W3 glass card convergence: explore discovery cards consume the shared promoted glass primitive', () => {
  assert.match(exploreCardsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(exploreCardsSource, /<DesktopCardSurface kind="promoted-glass" className="flex flex-col p-4">/);
  assert.match(exploreCardsSource, /<DesktopCardSurface[\s\S]*kind="promoted-glass"[\s\S]*style=\{\{ background: palette\.background \}\}/);
  assert.match(exploreCardsSource, /<DesktopCardSurface kind="promoted-glass" className="overflow-hidden transition-shadow hover:shadow-md">/);
});

test('W3 glass card convergence: notification rows and empty states consume the shared promoted glass primitive', () => {
  assert.match(notificationPanelSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(notificationPanelSource, /<DesktopCardSurface kind="promoted-glass" className="p-8 text-center text-sm text-\[var\(--nimi-text-secondary\)\]">/);
  assert.match(notificationPanelSource, /<DesktopCardSurface[\s\S]*interactive=\{!itemBusy\}[\s\S]*active=\{!item\.isRead\}[\s\S]*kind="promoted-glass"/);
});
