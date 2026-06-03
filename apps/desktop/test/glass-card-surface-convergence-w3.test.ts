import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const homePostFeedSource = readWorkspaceFile('src/shell/renderer/features/home/post-feed.tsx');
const homeArticleSource = readWorkspaceFile('src/shell/renderer/features/home/article.tsx');
const exploreCardsSource = [
  readWorkspaceFile('src/shell/renderer/features/explore/explore-cards.tsx'),
  readWorkspaceFile('src/shell/renderer/features/explore/explore-agent-recommendation-card.tsx'),
].join('\n');
const notificationPanelSource = [
  readWorkspaceFile('src/shell/renderer/features/notification/notification-panel.tsx'),
  readWorkspaceFile('src/shell/renderer/features/notification/notification-panel-header.tsx'),
].join('\n');
const notificationPanelSurfaceSource = [
  notificationPanelSource,
  readWorkspaceFile('src/shell/renderer/features/notification/notification-panel-item-card.tsx'),
].join('\n');

test('W3 glass card convergence: home feed skeletons and post articles consume the shared promoted glass primitive', () => {
  assert.match(homePostFeedSource, /import \{ AppCardSurface \} from '@nimiplatform\/kit\/ui';/);
  assert.match(homePostFeedSource, /<AppCardSurface kind="promoted-glass" className="mb-6 p-5">/);
  assert.match(homeArticleSource, /import \{ AppCardSurface \} from '@nimiplatform\/kit\/ui';/);
  assert.match(homeArticleSource, /<AppCardSurface[\s\S]*kind="promoted-glass"[\s\S]*as="article"/);
});

test('W3 glass card convergence: explore discovery cards consume the shared promoted glass primitive', () => {
  assert.match(exploreCardsSource, /import \{ AppCardSurface \} from '@nimiplatform\/kit\/ui';/);
  assert.match(exploreCardsSource, /<AppCardSurface[\s\S]*kind="promoted-glass"[\s\S]*style=\{\{ background: palette\.background \}\}/);
});

test('W3 glass card convergence: notification rows and empty states consume the shared promoted glass primitive', () => {
  assert.match(notificationPanelSource, /from '@nimiplatform\/kit\/ui';/);
  assert.match(notificationPanelSource, /<Surface[\s\S]*material="glass-regular"/);
  assert.match(notificationPanelSource, /<AppCardSurface kind="promoted-glass" className="p-8 text-center text-sm text-\[var\(--nimi-text-secondary\)\]">/);
  assert.match(notificationPanelSurfaceSource, /<AppCardSurface[\s\S]*interactive=\{!itemBusy\}[\s\S]*active=\{!item\.isRead\}[\s\S]*kind="promoted-glass"/);
});
