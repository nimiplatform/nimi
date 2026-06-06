import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const postCardSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card.tsx'),
  'utf8',
);
const postCardActionAdapterSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card-action-adapter.tsx'),
  'utf8',
);
const postCardProjectionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/post-card-projections.ts'),
  'utf8',
);
const reportModalSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/report-modal.tsx'),
  'utf8',
);
const postCardUiSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/home/use-post-card-ui.ts'),
  'utf8',
);

test('post card action adapter uses real like/unlike/report/visibility APIs', () => {
  assert.match(postCardActionAdapterSource, /realmSocialData\.likePost\(/);
  assert.match(postCardActionAdapterSource, /realmSocialData\.unlikePost\(/);
  assert.match(postCardActionAdapterSource, /realmSocialData\.createReport\(/);
  assert.match(postCardActionAdapterSource, /realmSocialData\.updatePostVisibility\(/);
  assert.match(postCardSource, /actionAdapter\.likePost\(/);
  assert.match(postCardSource, /actionAdapter\.unlikePost\(/);
  assert.match(postCardSource, /actionAdapter\.createReport\(/);
  assert.match(postCardSource, /actionAdapter\.updatePostVisibility\(/);
});

test('report modal reason list matches backend enum contract', () => {
  assert.match(reportModalSource, /ReportReasonValues\.map/);
  assert.match(reportModalSource, /satisfies Record<ReportReason, string>/);
  assert.doesNotMatch(reportModalSource, /ReportReason\.[A-Z_]+/);
  assert.doesNotMatch(postCardSource, /keyof typeof ReportReason/);
});

test('post card author projection consumes generated UserLiteDto fields exactly', () => {
  assert.doesNotMatch(postCardSource, /_id/);
  assert.doesNotMatch(postCardProjectionsSource, /authorRecord/);
  assert.doesNotMatch(postCardProjectionsSource, /post\.author as Record<string, unknown>/);
  assert.match(postCardProjectionsSource, /const agent = author\?\.agent \?\? null/);
  assert.match(postCardProjectionsSource, /const agentProfile = author\?\.agentProfile \?\? null/);
});

test('report modal preserves failure feedback instead of silently closing on submit errors', () => {
  assert.match(reportModalSource, /const \[submitError, setSubmitError\] = useState<string \| null>\(null\)/);
  assert.match(reportModalSource, /catch \(error\)/);
  assert.match(reportModalSource, /setSubmitError/);
  assert.match(postCardSource, /ui\.setShowReportModal\(false\)/);
  assert.match(postCardSource, /throw error/);
});

test('edit post no longer shows coming soon path', () => {
  assert.doesNotMatch(postCardUiSource, /coming soon/i);
  assert.match(postCardUiSource, /setShowEditVisibilityModal\(true\)/);
});

test('post card does not keep an agent-chat unavailable branch in product UI', () => {
  assert.match(postCardSource, /showChatButton=\{post\.author\?\.isAgent !== true\}/);
  assert.doesNotMatch(postCardSource, /agentChatUnavailableFromMoments/);
});

test('post card is projection-only and consumes explicit owner adapters', () => {
  assert.match(postCardSource, /actionAdapter:\s*PostCardActionAdapter/);
  assert.doesNotMatch(postCardSource, /@runtime\/data-sync/);
  assert.doesNotMatch(postCardSource, /dataSync\./);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*ProfileDetailModal\b/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*SendGiftModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*send-gift-modal/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*CreatePostModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*create-post-modal(?:\.js)?['"]/);
  assert.doesNotMatch(postCardSource, /import\s+\{?\s*AddFriendModal\b/);
  assert.doesNotMatch(postCardSource, /from\s+['"].*add-friend-modal/);
});
